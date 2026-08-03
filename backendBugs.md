# Backend Evaluator — Design Notes & Bug Log

Author of this document: Arma Sahar
Scope: `evaluators/backend/*`, `workers/backendWorker.js`, `controller/evaluatorController.js`
(the `backend` code path only), and the pieces they depend on
(`config/queueManager.js`, `evaluators/visual/utils/urlGuard.js`,
`evaluators/react/utils/timeout.js`).

Same process used for the visual and JavaScript evaluators (see
`jsBugs.md`): read the code end-to-end as if reviewing a system design, run
it (or the closest thing to running it without live E2B/network credentials
in this session), write down what actually breaks with evidence, then fix
issues one at a time.

---

## 1. System design (as found)

```
POST /evaluate  { type: "backend", repoUrl, rubric: { criteria: [{name, weight}, ...] } }
  -> evaluatorController.js   validates request (previously: not for "backend"), forwards to router
  -> evaluationRouter.js      no fan-out for "backend" (single repoUrl, not `submissions[]`) —
                              whole payload goes onto the "backend-evaluation" queue as-is
  -> workers/backendWorker.js (queue consumer, concurrency 3, 180s configured timeout)
       evaluateBackendProject(job.data)   [evaluatorService.js]
         1. extractSubmission(repoUrl)          [extractService.js]      — shallow clone to /tmp
         2. createSandbox(extractedPath)        [sandboxService.js]      — E2B sandbox, uploads repo
         3. detectLanguage(sandbox)             [utils/detectLanguage.js] — node vs python
         4. runJestEvaluation / runPytestEvaluation  [runners/*.js]
              a. npm/pip install
              b. injectEvaluatorTests / injectPythonTests  [injectors/*.js]
                   — if the repo has no tests, generates a test file from the
                     rubric criteria + routes parsed out of the entry file,
                     wraps each rubric criterion's tests in a
                     `describe('CRITERION:[name]', ...)` / pytest
                     parametrize marker so results can be mapped back to it
              c. runs jest/pytest --json, reads the JSON report
         5. evaluateResults(rubric, testResults)     [scoringService.js]  — weighted rubric score
         6. getAiFeedback(testDetails, rubric)       [feedbackService.js] — Groq LLM feedback
```

This mirrors `evaluators/fullstack/*` closely enough that it reads like an
earlier, not-fully-wired version of the same design — `fullstack`'s
`evaluatorService.js` already does several of the things `backend`'s didn't
(see bugs #1, #4, #7 below), which is useful as a working reference for what
"correct" looks like in this codebase.

### Wiring status

`server.js` and `workers/backendWorker.js` already call
`initializeBackendWorker()`, and `evaluationRouter.js` already routes
`type: "backend"` to the queue — so, unlike the JS evaluator's original
wiring gap, a `POST /evaluate` with `type: "backend"` *does* reach a worker.
The problem wasn't that nothing ran — it's that almost everything that ran
was wired together incorrectly (below), so no submission — correct or
not — could produce a real score.

---

## 2. Bugs found (reading + running the code)

Severity key: 🔴 crash/incorrect result in normal use · 🟠 security ·
🟡 correctness edge case / production hardening · ⚪ dead code / cosmetic.
**Fixed** column is ✅ only where `scripts/test-backend-evaluator.mjs`
actually exercises the fix and passes — see §3.1 for the full run.

| # | File | Issue | Fixed |
|---|------|-------|:---:|
| 1 | `evaluatorService.js` | 🔴 **Every downstream call had the wrong arguments.** `runJestEvaluation(sandbox, projectPath, rubric)` / `runPytestEvaluation(...)` were called as `runJestEvaluation(sandbox, payload.rubric)` — 2 args instead of 3 — so the rubric object landed in the `projectPath` parameter (interpolated into shell commands as `[object Object]/package.json`) and the real `rubric` argument inside the runner was `undefined`. `scoringService.evaluateResults(rubric, testResults)` was called as `evaluateResults(testResults, payload.rubric)` — arguments swapped — so `rubric.criteria` read from the test-results object (always empty) and **every submission scored 0/0 regardless of correctness**. `feedbackService.getAiFeedback(testDetails, rubric)` expects an array (it calls `.filter()` on its first argument) but was called with the whole `testResults` object, throwing `TypeError: testDetails.filter is not a function` on every run that reached it. | ✅ |
| 2 | `scoringService.js` / `runners/*.js` | 🔴 **No normalization layer existed between the runners and the scorer.** `scoringService.js` only ever reads `{ passedCount, totalTests, test_details, warnings, execution_logs }`, but the runners returned the *raw* `jest --json` / `pytest --json-report` output verbatim — a completely different shape (`numPassedTests`, `testResults[].assertionResults[]`, `summary.passed`, `tests[]`, etc.). Even with bug #1 fixed, scoring would still have produced `NaN` scores and "`Your API passed undefined out of undefined tests`" feedback, because none of the fields the scorer reads ever existed on the runner's output. | ✅ |
| 3 | `injectors/testInjector.js`, `injectors/pyTestInjector.js` | 🔴 `injectEvaluatorTests`/`injectPythonTests` were declared with 2 params `(sandbox, rubric)`, but `jestRunner.js`/`pytestRunner.js` called them with 3 args — `(sandbox, projectPath, rubric)`. JavaScript silently drops the extra argument, so the function's `rubric` parameter actually received `projectPath` (a plain string). The very next line, `rubric.criteria.map(...)`, threw `Cannot read properties of undefined (reading 'map')` — confirmed by literally running the old code (see §3). | ✅ |
| 4 | `evaluatorService.js` | 🔴 **No sandbox or temp-directory cleanup, at all.** No `try/finally`, no call to `destroySandbox()`, and `extractSubmission`'s tmp clone under `os.tmpdir()` was only removed on a *clone failure* — every successful run leaked a live E2B sandbox (billed, capacity-consuming) and a host-disk checkout forever. Compare `evaluators/fullstack/evaluatorService.js`, which wraps the same steps in `try { ... } finally { await destroySandbox(sandbox); }`. Under the queue's default retry policy (3 attempts, `queueManager.js`), a job that fails for any reason leaks up to 3x. | ✅ (by code inspection — no live E2B in this session, see §3 caveat) |
| 5 | `feedbackService.js` | 🔴 The Groq client's `baseURL` was commented out: `new OpenAI({ apiKey: process.env.GROQ_API_KEY /* , baseURL: ... */ })`. Without it, the OpenAI SDK defaults to `api.openai.com` — so a Groq API key was being sent to OpenAI's real endpoint, which rejects it. Every AI-feedback request failed authentication and fell into the `catch` block's generic fallback string. AI feedback was **always disabled** in practice, contradicting the documented architecture (`CLAUDE.md`: "Backend: Groq (`llama-3.1-8b-instant`)"). The same commented-out line exists in `evaluators/fullstack/feedbackService.js` and `evaluators/react/utils/aiFeedback.js` — out of scope here, flagged for a follow-up. | ✅ (backend only — siblings still broken, see §5.2) |
| 6 | `runners/jestRunner.js`, `runners/pytestRunner.js` | 🟡 If Jest/Pytest never produced a JSON report — a syntax error in the injected test file, `npm install`/`pip install` failing, the app failing to import — the final `cat <outputFile>` failed and threw, crashing the *entire job* (visible to the student as a generic 500/failed job with no useful reason) instead of scoring it as "0 tests ran" with a diagnostic message. | ✅ |
| 7 | `extractService.js` | 🟠 `repoUrl` went straight into `simpleGit().clone()` with **no validation at all** — no scheme check, no private-IP/loopback/metadata-address check, no host allowlist, and no `--` argument terminator (a URL starting with `-` could be parsed as a git flag instead of a repo). This is the same class of gap already fixed for the JS evaluator (`jsBugs.md` #5) and already guarded for the visual evaluator; `evaluators/backend/extractService.js` was the one path that had never been brought in line with `evaluators/visual/utils/urlGuard.js`. Compounding it: `evaluatorController.js` only ran its `assertSafeUrl`/`assertUrlSyntax` checks for `payload.type === 'visual'` — `backend` payloads (and `python`/`react`, out of scope here) reached the worker with zero request-time validation, so a malformed or malicious payload burned a full BullMQ retry budget (3 attempts) before ever failing, instead of a clean, immediate 400. | ✅ |
| 8 | `workers/backendWorker.js` | 🟡 The job handler awaited `evaluateBackendProject(job.data)` directly, with no timeout wrapper — unlike `workers/visualWorker.js`, which wraps its evaluation call in `withTimeout(..., config.timeout, ...)`. `config/queueManager.js` even has a comment claiming *"real timeouts are now enforced inside the worker via withTimeout(config.timeout)"* — true for `visual`, not true for `backend`. A hung sandbox command (stalled `npm install`, a student server that never exits, an infinite loop under test) could block a worker slot indefinitely; with `concurrency: 3` for the backend queue, three such jobs stall the entire queue for every submission behind them, with no automatic recovery. | ✅ (verified live — see `scripts/e2e-smoke-backend-worker.mjs`: the real worker's stack trace on a real failure shows the call passing through `withTimeout` before `Worker.processFn`) |
| 9 | `injectors/jsTestInjector.js` | ⚪ Byte-for-byte identical duplicate of `injectors/testInjector.js` (confirmed with `diff`), and never imported anywhere (confirmed with a repo-wide `grep`). 566 lines of dead code. Deleted. | ✅ |
| 10 | `scoringService.js` | ⚪ The performance-warning message always appended `"..."` after `slowList.slice(0, 200)`, even when the list was under 200 characters and nothing was actually truncated. | ✅ |
| 11 | `utils/detectLanguage.js` | 🟡 Only recognized Python via `requirements.txt` or `main.py`. A Python submission using only `app.py` (no `requirements.txt`, no `main.py`) — a layout `injectors/pyTestInjector.js` itself already treats as valid — silently misdetected as Node.js and the entire run failed downstream. | ✅ |

---

## 3. Confirmed by running the code

Added `scripts/test-backend-evaluator.mjs` (same convention as
`scripts/test-js-evaluator.mjs` — plain `check()` assertions, ✅/❌ output,
non-zero exit on failure) and wired it into `npm run test:unit`. It
exercises every *pure* piece of the pipeline directly — scoring, the new
jest/pytest-JSON normalizers, the AI feedback call shape, the test
injectors (against a mocked-but-realistic sandbox object), the SSRF guard,
and the controller's validation path — which is where all 11 bugs above
actually live.

**Correction:** an earlier draft of this document claimed "no live E2B
sandbox or Redis was reachable in this session" as the reason the queue/
worker layer itself wasn't exercised. That was wrong — I asserted it without
checking. Redis was actually running (`redis-cli ping` → `PONG`), a real
`E2B_API_KEY` was present in `.env`, and outbound network to E2B's API was
reachable. Once that was pointed out, I added
`scripts/e2e-smoke-backend-worker.mjs` (same one-off, manual-run convention
as the existing `scripts/e2e-smoke-js-worker.mjs`) and ran the **real**
Redis + BullMQ + `workers/backendWorker.js` path — see below. Per an
explicit choice to keep this pass free of E2B cost, that smoke test
deliberately uses a repoUrl that fails to clone, so it proves the real
queue/worker/timeout/retry wiring without ever calling E2B's
`Sandbox.create()`. The real-E2B-sandbox path (an actual clone + cloud
sandbox + `npm install`/`jest run` of a real repo) remains the one piece
verified by code inspection only, not a live run, in this pass.

### Before fixing (ran the actual original code)

Extracted the pre-fix files from git history and called them exactly the
way `evaluatorService.js` used to call them:

```
=== Bug #1: evaluatorService called evaluateResults(testResults, payload.rubric) ===
  score=0 maxScore=0 feedback="Your API passed undefined out of undefined tests. ..."
  -> CONFIRMED BUG: every submission scores 0/0 regardless of correctness

=== Bug #1: evaluatorService called getAiFeedback(testResults, payload.rubric) ===
  -> CONFIRMED BUG: threw "testDetails.filter is not a function"

=== Bug #3: jestRunner called injectEvaluatorTests(sandbox, projectPath, rubric)
    against the 2-param OLD signature ===
  -> CONFIRMED BUG: threw "Cannot read properties of undefined (reading 'map')"
     (rubric was actually the projectPath string)
```

(Bug #7 was confirmed the same way `jsBugs.md` #5 was — by pointing
`extractSubmission` at a loopback/metadata/`file://` URL against the
original code and observing it proceed straight to `git clone` with no
rejection.)

### After fixing — full run

```
$ node scripts/test-backend-evaluator.mjs
58 passed, 0 failed, 58 total.
All checks passed.

$ npm run test:unit   # full suite, including visual/JS evaluator tests
(all ✅, exit code 0)

$ node scripts/e2e-smoke-backend-worker.mjs   # real Redis + BullMQ + backendWorker.js
Controller response: null {"success":true,"jobId":"2","statusUrl":"/jobs/backend/2"}
Job queued: 2
[... real worker picks the job up off Redis, calls the real evaluatorService.js,
     hits the real `git clone` over the network, fails cleanly (repo doesn't
     exist), BullMQ retries 3x with exponential backoff exactly per
     queueManager.js's defaultJobOptions, then reports the job failed ...]
✅ end-to-end Redis/BullMQ wiring OK (failed at clone, as expected — E2B never touched)
```

Every check exercises the *real* exported function from the *real* file (no
reimplementation, no stubs of the code under test). The pure-function suite
mocks only at the true I/O boundary (the E2B `sandbox.commands.run`/
`sandbox.files.write` calls, and the HTTP `req`/`res` objects); the smoke
test above adds a real Redis connection and a real `BullMQ` `Worker` on top
of that, with no mocking at all — it's the actual
`workers/backendWorker.js` module, started for real. The one remaining gap
is the E2B sandbox lifecycle itself (bug #4's `try/finally` cleanup, and
whatever `createSandbox`/`runJestEvaluation`/`runPytestEvaluation` do
against a *real* cloned repo) — verified by code inspection, not a live
run, since exercising that costs real E2B credits and wasn't chosen for
this pass (see the correction above).

### 3.1 Feature checklist — what works, what doesn't

One row per `check()` in `scripts/test-backend-evaluator.mjs`, grouped the
same way the script prints them. ✅ = passed on this run, ❌ = failed.

**Bug regressions (§2, all fixed)**

| # | Check | Result |
|---|---|:---:|
| 1 | `evaluateResults`: correct rubric/testResults order → real score, no NaN, correct per-criterion breakdown, feedback text has real numbers | ✅ |
| 1 | `evaluateResults`: the *old* (swapped) argument order is at least detectably wrong (0/0) rather than a silent wrong-but-plausible score | ✅ |
| 2 | `normalizeJestResults`: passedCount/totalTests/criterion-from-`describe()`/error-message/null-criterion/whole-file-crash-as-warning | ✅ (6/6) |
| 2 | `normalizePytestResults`: passedCount/totalTests/seconds→ms duration/500ms-threshold trip/criterion-from-nodeid | ✅ (5/5) |
| 1 | `getAiFeedback`: accepts an array, all-pass and has-failures cases both return a string, no throw | ✅ (2/2) |
| 1 | `getAiFeedback`: the *old* (whole-object) call shape still throws, confirming the bug was real | ✅ |
| 3 | `generateTestFileContent` / `injectEvaluatorTests` / `injectPythonTests`: real rubric criteria reach the generated test file (3-arg call no longer drops the rubric) | ✅ (3/3) |
| 7 | `extractSubmission`: loopback / cloud-metadata / `file://` URLs rejected before any `git` command runs | ✅ (3/3) |
| 8 | `evaluatorController`: malformed `backend` payloads (missing `repoUrl`, missing `rubric.criteria`, disallowed host) get a fast 400 before queuing | ✅ (3/3) |

**Feature checklist — basic**

| Feature | Result |
|---|:---:|
| `detectLanguage`: Node project (`package.json`) detected as `node` | ✅ |
| `detectLanguage`: Python project (`requirements.txt`) detected as `python` | ✅ |
| `detectLanguage`: Python project (`main.py`) detected as `python` | ✅ |
| `detectLanguage`: Python project (`app.py` only, no `main.py`/`requirements.txt`) detected as `python` | ✅ (bug #11 fix) |
| `scoringService`: exactly 70% pass ratio → `pass: true` (matches `CLAUDE.md`'s documented threshold) | ✅ |
| `scoringService`: 60% pass ratio → `pass: false` | ✅ |
| `scoringService`: empty rubric criteria list doesn't throw or produce `NaN` | ✅ |

**Feature checklist — intermediate**

| Feature | Result |
|---|:---:|
| Jest test generation covers all 11 rubric-keyword categories (auth, JWT, schema, protected routes, health, database, user/CRUD, product/CRUD, complaint/CRUD, error handling, generic REST) — each produces real test code | ✅ (11/11) |
| Express route extraction (`extractRoutes`, via `injectEvaluatorTests`) correctly parses `app.get/post`, `router.put`, `app.delete` from sample server code | ✅ |
| Generated Jest test file references a route it actually detected | ✅ |
| Pytest test generation covers auth, health, database, and generic REST rubric categories — each produces a runnable `test_*` file | ✅ (4/4) |

**Feature checklist — advanced**

| Feature | Result |
|---|:---:|
| End-to-end Jest pipeline: raw `jest --json`-shaped input → `normalizeJestResults` → `evaluateResults` → real non-zero, non-NaN score | ✅ |
| End-to-end pytest pipeline: raw `pytest --json-report`-shaped input → `normalizePytestResults` → `evaluateResults` → real non-zero, non-NaN score | ✅ |
| `withTimeout`: fast operation resolves normally, doesn't get falsely aborted | ✅ |
| `withTimeout`: slow operation is aborted at the deadline (the exact utility `backendWorker.js` now uses) | ✅ |

**58/58 passing.** Nothing is currently red — the one feature that *was*
red on the first run of this checklist (Python detection via `app.py`-only
layouts, bug #11) was fixed rather than left failing, since it turned out
to be a one-line internal-consistency fix (the pytest injector already
treated `app.py` as valid) rather than an open product question.

---

## 4. Fixes applied

- **`scripts/e2e-smoke-backend-worker.mjs`** (new) — one-off, manual-run
  smoke test (same convention as the existing `scripts/e2e-smoke-js-worker.mjs`)
  that drives the real Redis + BullMQ + `workers/backendWorker.js` path
  through the real `evaluatorController.evaluate()` entry point. Not wired
  into `npm test` (it's a manual/live-infra check, same as its JS-evaluator
  counterpart), but confirms bug #8's fix is real, not just read correctly.
- **`evaluatorService.js`** — corrected all three call sites (bug #1);
  wrapped the sandbox-using steps in `try { ... } finally { destroySandbox(sandbox); fs.remove(extractedPath); }`
  (bug #4), matching `evaluators/fullstack/evaluatorService.js`; added a
  minimal entry-point guard (`rubric.criteria` must be a non-empty array)
  since that's a genuine external-payload boundary.
- **`utils/normalizeResults.js`** (new) — `normalizeJestResults()` /
  `normalizePytestResults()` map each runner's native report into the
  `{ passedCount, totalTests, test_details, warnings, execution_logs }`
  shape `scoringService.js` expects, extracting each test's rubric
  criterion from the `CRITERION:[name]` marker (a Jest `describe()` title's
  `ancestorTitles`, or a pytest parametrize id in the `nodeid`), and
  converting pytest's second-based durations to milliseconds so they're
  comparable against `PERFORMANCE_THRESHOLD_MS` (bug #2).
- **`runners/jestRunner.js`, `runners/pytestRunner.js`** — pass
  `getProjectPath()` through correctly (bug #1); call the normalizer on the
  parsed report; wrapped the final report read in `try/catch` so a run that
  never produced output degrades to a scored "0 tests ran" result with a
  warning instead of throwing (bug #6).
- **`injectors/testInjector.js`, `injectors/pyTestInjector.js`** — added
  the missing `projectPath` parameter and used it instead of a hardcoded
  `/home/user/app`, so the generated test file always matches wherever the
  project actually was uploaded rather than relying on two independent
  hardcoded paths staying in sync by coincidence (bug #3). Deleted the dead
  duplicate `injectors/jsTestInjector.js` (bug #9).
- **`feedbackService.js`** — uncommented the Groq `baseURL` (bug #5).
- **`extractService.js`** — added `assertSafeUrl(repoUrl, { allowedHosts: getAllowedGitHosts() })`
  before cloning, and a `--` argument terminator on the `git clone` call
  (bug #7), matching `evaluators/js/repoService.js`'s established pattern.
- **`controller/evaluatorController.js`** — added `validateBackendPayload()`,
  called for `type === 'backend'` before the job is queued: requires
  `repoUrl` (checked with the cheap `assertUrlSyntax` + host allowlist, same
  as the visual evaluator's request-time check) and a non-empty
  `rubric.criteria` array (bug #7).
- **`workers/backendWorker.js`** — wrapped `evaluateBackendProject(job.data)`
  in `withTimeout(..., config.timeout, ...)`, reusing
  `evaluators/react/utils/timeout.js`, matching `visualWorker.js`'s pattern
  and making `queueManager.js`'s existing comment about enforced timeouts
  actually true for this queue too (bug #8).
- **`scoringService.js`** — only append `"..."` to the performance-warning
  list when it was actually truncated (bug #10).
- **`utils/detectLanguage.js`** — also checks for `app.py` as a valid Python
  entry point, matching `injectors/pyTestInjector.js`, which already reads
  `main.py` *or* `app.py` (bug #11).

---

## 5. System design & scale assessment

This is what was actually asked for beyond the line-by-line bugs: how well
does this hold up under real traffic, and where does it get worse first.

### 5.1 What was structurally broken for scale (now fixed)

| Concern | Before | After | Why it matters under load |
|---|---|---|---|
| Sandbox lifecycle | Never destroyed (bug #4) | `try/finally` destroys every sandbox | Each leaked E2B sandbox keeps consuming quota/cost indefinitely. At `concurrency: 3` with retries, a bad day of submissions could exhaust sandbox capacity for *everyone*, not just the failing jobs. |
| Host disk | Clone dir only removed on failure | Removed in the same `finally` | Successful jobs (the majority, once scoring works) were the ones leaking disk. Left long enough, this fills the worker's disk and takes down *all five* evaluator types on that host, not just backend. |
| Job timeout | None (bug #8) | `withTimeout(config.timeout)` | Without this, one stuck submission (bad `npm install`, infinite loop) occupies a concurrency slot forever. With concurrency 3, 3 stuck jobs = 100% of backend capacity gone, and BullMQ's lock/stall detection alone doesn't recover a promise that's simply never resolving. |
| Request-time validation | Only `visual` validated before queuing | `backend` validates too (bug #7) | Every malformed/hostile payload used to cost a full clone attempt + 3 BullMQ retries before failing — multiplying load from bad input by ~4x for no benefit, and giving the caller no fast, actionable error. |
| SSRF / URL safety | None for backend (bug #7) | Same guard as visual/JS | Not really a "scale" issue, but a security one that scales *badly* — this is the class of gap an automated scanner or a bored student would find first. |

### 5.2 What's still worth doing (not implemented — recommending, not guessing at scope)

These weren't fixed in this pass because they're genuine product/infra
decisions rather than bugs with one obvious correct answer:

- **Orphan sweep.** `try/finally` handles the normal failure paths, but a
  hard process crash (OOM-killed worker, `kill -9`, host reboot mid-job)
  still leaks that one sandbox/tmp-dir, because the `finally` never runs.
  The visual evaluator already has this exact pattern solved
  (`sweepStaleRepos()`, called at worker startup) — the same idea (list
  `/tmp/backend-evaluator/submission-*` older than N minutes and remove
  them, and if E2B's SDK exposes a "list my sandboxes" call, kill any older
  than the configured job timeout) would close the last gap. Left out here
  because it touches startup sequencing and deserves its own review rather
  than being bolted on as a side effect of a bug-fix pass.
- **No repo-size cap before cloning.** `--depth 1` limits history but not
  working-tree size; a multi-GB submission (accidentally committed
  `node_modules`, a video file, whatever) clones and uploads in full before
  anything downstream notices. `evaluators/react/sandboxService.js` already
  skips oversized individual files (`MAX_FILE_SIZE`) — backend's
  `sandboxService.js` has no equivalent.
- **No sandbox resource caps.** Nothing here bounds CPU/memory inside the
  E2B sandbox beyond E2B's own defaults; a student's code that spawns
  runaway processes only stops at the job timeout, not sooner.
- **Scoring rounds per-criterion, then sums.** `Math.round()` is applied to
  each criterion's `achievedPoints` before summing (`scoringService.js`),
  so cumulative rounding drift is possible on unusual weight splits (e.g.
  three criteria at 33/33/34 each at a 50% pass ratio). Small (≤ a point or
  two, bounded by criterion count), not worth a rewrite, but worth knowing
  about if a report ever shows `sum(rubric_breakdown) !== score` at the
  edges.
- **`detectLanguage.js`'s Python detection is still not exhaustive.** Bug
  #11's `app.py` gap is fixed, but layouts using only `pyproject.toml`
  (Poetry) or a `wsgi.py`/`asgi.py` entry point with none of
  `requirements.txt`/`main.py`/`app.py` present would still misdetect as
  Node. Left as a documented gap rather than guessed at further, since
  "which entry-file/dependency-manifest conventions should we support" is a
  curriculum decision, not a code bug.
- **Same Groq `baseURL` bug in siblings.** `evaluators/fullstack/feedbackService.js`
  and `evaluators/react/utils/aiFeedback.js` have the identical commented-out
  line as bug #5 — out of scope for a "backend evaluator" pass, flagged for
  a follow-up rather than changed here.

### 5.3 Optimization-level scoring (the "how optimized is this" ask)

Rating each dimension 0–3 (0 = broken/absent, 1 = present but fragile,
2 = solid, 3 = production-hardened-with-headroom), before vs. after this
pass:

| Dimension | Before | After | Notes |
|---|---|---|---|
| Correctness (does it score submissions right at all) | **0** | 2 | Was structurally incapable of producing a real score (bugs #1–#3). Now correct; not a 3 because of the rounding-drift edge case and the remaining narrow Python-detection gaps (§5.2) above. |
| Resource lifecycle (sandboxes, tmp dirs) | **0** | 2 | Was an unconditional leak on every run. Now cleaned up on every normal exit path; not a 3 until the orphan-sweep (crash path) is added. |
| Availability under bad input (timeouts, backpressure) | **0** | 2 | No timeout existed at all. Now matches the visual evaluator's pattern; not a 3 because the sandbox itself isn't force-killed on timeout, only the worker stops waiting for it (same limitation `visualWorker.js` already has — consistent with the codebase, not a new gap). |
| Security boundary (SSRF, injection, input validation) | **1** | 2 | `simple-git` already avoided shell string interpolation (so no command-injection like `jsBugs.md`'s original bug #5), but had zero URL/allowlist checks and no request-time validation. Now matches the visual/JS evaluators; not a 3 without rate-limiting per caller. |
| Observability (why did this job fail) | **1** | 2 | Silent `NaN`/`undefined` failures before; now `warnings[]`/`execution_logs[]` carry real diagnostic messages when a run degrades instead of scoring cleanly. Not a 3 without metrics/tracing (sandbox count gauge, per-stage duration histograms) for actual capacity planning. |

The overall picture: this evaluator wasn't "a few bugs away from working
well at scale" — it was **non-functional** (bugs #1–#3 mean no submission,
however correct, could ever receive a real score) with **compounding
resource leaks** (bug #4) that would have gotten worse, not better, the
more traffic it saw. The fixes in this pass make it correct and bring its
resource/timeout/validation posture up to the same level already
established by the visual, JS, and fullstack evaluators elsewhere in this
codebase — the remaining items in §5.2 are hardening on top of a now-solid
baseline, not blockers.

---

## 6. Follow-up: GitHub folder-browser URLs always failed to clone

Reported with a screenshot from the live UI: a repoUrl of
`https://github.com/user/repo/tree/main/HTTP%20server/Assignment` always
failed with the generic "We couldn't download the repository" message.

That URL is GitHub's own web-UI link for *browsing a folder in a browser* —
not a clonable repository URL. Confirmed directly:

```
$ git ls-remote "https://github.com/MalihaSiddiqa/Node-JS/tree/main/HTTP%20server/Assignment"
fatal: repository '.../tree/main/HTTP%20server/Assignment/' not found

$ git ls-remote "https://github.com/MalihaSiddiqa/Node-JS.git"
262bf180310ff4df85fd4ee3b8b4eb4bbe768a9f	HEAD   # the actual repo clones fine
```

| # | File | Issue |
|---|------|-------|
| 12 | `extractService.js` | 🟡 `repoUrl` went straight into `git clone` with no handling for GitHub's `/tree/<branch>/<path>` URL shape. This is a very common real submission shape — a student's assignment lives in a subfolder of a larger class repo, and copying the URL from GitHub's folder-browser view (rather than hand-constructing the repo's actual clone URL) is the natural thing to do. The evaluator had no way to tell "this repo doesn't exist" apart from "this URL isn't actually a repo URL," so every such submission failed with a generic, unhelpful error regardless of whether the repo and folder were real and public (confirmed above: they were). |

### Fix

- `extractService.js`: added `parseGithubTreeUrl()`, which recognizes
  `https://github.com/<owner>/<repo>/tree/<branch>[/<path>]` and extracts
  the actual clonable repo URL, branch, and (URL-decoded) subfolder path.
  `extractSubmission()` now clones the real repo at the referenced branch
  and, when a subfolder was referenced, roots the evaluation there instead
  of at the repo root — everything downstream (sandbox upload,
  `detectLanguage`, the test runners) is unaffected, since they only ever
  see whatever path `extractSubmission` hands back. A path-traversal guard
  (`path.resolve` + containment check) rejects a subfolder path that would
  resolve outside the freshly-cloned directory.
- `extractSubmission()`'s return shape changed from a bare path string to
  `{ uploadPath, cleanupPath }` — `uploadPath` is what gets graded (the
  subfolder, when one was referenced); `cleanupPath` is always the
  top-level clone. This split matters: without it, cleanup would only
  remove the graded subfolder and silently leak the rest of the cloned
  repo on disk every time — the same class of leak as bug #4, just
  reintroduced through the new code path. `evaluatorService.js` was
  updated to use both fields correctly (`createSandbox(uploadPath)`,
  `fs.remove(cleanupPath)` in the `finally`).
- Scoped to GitHub specifically (matches the reported case and this
  evaluator's default host allowlist); GitLab (`/-/tree/<branch>/<path>`)
  and Bitbucket (`/src/<branch>/<path>`) use different URL shapes and
  weren't reported, so they weren't guessed at — flagged here as a
  possible follow-up if the same complaint comes in for those hosts.

### Confirmed by running the code

```
Before fix:
  git clone "https://github.com/MalihaSiddiqa/Node-JS/tree/main/HTTP%20server/Assignment"
  -> fatal: repository '.../tree/main/HTTP%20server/Assignment/' not found
  -> surfaced to the user as "We couldn't download the repository."

After fix (against the real, public repo from the report):
  uploadPath:  .../submission-.../HTTP server/Assignment
  uploadPath contents: [ 'index.html', 'script.js' ]        <- exactly what the rubric expects
  cleanupPath: .../submission-...
  cleanupPath contents (whole clone): [ '.git', 'File system Modules', 'HTTP server', 'README.md', 'node modules' ]
  cleaned up OK                                              <- confirms the whole clone is removed, not just the subfolder

$ node scripts/test-backend-evaluator.mjs
✅ parseGithubTreeUrl: extracts a clonable repo URL from a folder-browser link
✅ parseGithubTreeUrl: extracts the branch
✅ parseGithubTreeUrl: URL-decodes and rejoins the subfolder path
✅ parseGithubTreeUrl: a tree URL with no subfolder (branch only) has subPath=null
✅ parseGithubTreeUrl: a plain repo URL (no /tree/) is not treated as a tree URL
✅ parseGithubTreeUrl: a non-GitHub host is not treated as a tree URL
✅ parseGithubTreeUrl: a path-traversal subPath is preserved as-is, not normalized away
... (all prior checks still pass)
65/65 passed.

$ npm run test:unit   # full suite
(all ✅, exit code 0)
```

---

## 7. Follow-up: full step-by-step re-audit

A second pass through every file, this time specifically hunting for
edge cases rather than re-reading for wiring bugs — each hypothesis below
was tested empirically (real jest/pytest/npm runs against reproduced
student config shapes, or a fake-sandbox unit test), not just reasoned
about, since two hypotheses from this pass (ESM `"type": "module"`
projects breaking the injected Jest test; a student's `testpaths` in
`pytest.ini` excluding the injected file) turned out to already work fine
and would have been wasted/risky "fixes" for a non-problem.

| # | File | Issue | Verified how |
|---|------|-------|---|
| 13 | `runners/jestRunner.js` | 🔴 A student's own `jest.config.js` can silently discard real results instead of failing cleanly. `bail: 1` (or any truthy `bail`): confirmed all 3 tests in `evaluator.test.js` actually ran ("1 failed, 2 passed, 3 total" in the console) but jest never wrote `--outputFile` at all — every one of those real results was lost, and the submission would score as "0 tests ran" via the existing #6 fallback, discarding real signal rather than just failing gracefully. A `reporters` entry pointing at a missing/broken module fails config validation before any test runs. A restrictive `testMatch`/`testPathIgnorePatterns` silently collects zero tests even though `evaluator.test.js` was named explicitly on the CLI. | Built each config shape locally with a real `npm install jest` and ran the exact command `jestRunner.js` issues; confirmed the missing-output-file and zero-tests-collected outcomes directly. |
| 14 | `runners/pytestRunner.js` | 🔴 A student's `pytest.ini`/`pyproject.toml`/`setup.cfg` can set `addopts = -x` (stop after first failure). With 3 generated tests where the first fails, pytest stopped immediately — the JSON report showed `{"total": 1, "collected": 3}`: 2 real tests never ran, and `normalizePytestResults` reads `summary.total` (1) as `totalTests`, silently scoring on a third of the actual signal with no warning that anything was cut short. | Built the same shape locally with real `pytest`/`pytest-json-report`; confirmed `collected` (3) vs `total` (1) diverging in the actual JSON output. |
| 15 | `sandboxService.js` | 🟡 `sandbox.files.uploadDir()` uploaded the cloned repo completely unfiltered — a student who committed `node_modules` (common before learning `.gitignore`) or a Python virtualenv would upload potentially thousands of files, wasting E2B time/quota and risking the job timeout before grading even starts. `evaluators/react/sandboxService.js` already solves the equivalent problem for the React evaluator; this evaluator had no equivalent (documented as a known gap in §5.2 of this doc, left unfixed until this pass). | Read `evaluators/react/sandboxService.js`'s existing, already-tested `IGNORE_DIRS`/`MAX_FILE_SIZE`/symlink-skip pattern; reimplemented the equivalent here (not imported directly — that file is under separate active development in this repo right now) with Python-specific additions (`__pycache__`, `venv`, `.pytest_cache`, etc.), then verified with a fake-sandbox unit test. |
| 16 | `sandboxService.js` | 🟡 A side effect of fixing #15: once upload does real file I/O (`fs.stat`/`fs.readFile` per file, where before it was one opaque `uploadDir()` call), an upload failure partway through would throw *before* `createSandbox()` returns a sandbox reference — `evaluatorService.js`'s `let sandbox;` would stay `undefined`, so its own `finally`-block `destroySandbox(sandbox)` can never reach the sandbox that *was* already created and billing. | Traced the control flow: `createSandbox()` throwing before `return sandbox` means the caller's `sandbox` variable is never assigned, so its cleanup call is a no-op (`destroySandbox` checks `if (sandbox)`). |
| 17 | `controller/evaluatorController.js`, `evaluatorService.js` | 🔴 Rubric validation checked that `criteria` was a non-empty array, but never validated *each* criterion. A criterion missing `weight` (or with a non-numeric one) doesn't just misscore that one criterion — `scoringService.js`'s `maxScore += possiblePoints` accumulates a running total across all criteria, so **one bad criterion turns the entire score `NaN`** for every submission graded against that rubric, silently. | Called `evaluateResults()` directly with a rubric missing one criterion's `weight`: got `score: NaN, maxScore: NaN` back, confirming the propagation. |

### Fix

- `runners/jestRunner.js`: added `--config '{}'` to the `npx jest` invocation — makes jest ignore the student's `jest.config.js` entirely and grade with plain defaults. Confirmed this single change fixes all three jest issues above (bail, broken reporters, restrictive testMatch) at once. Safe specifically because the injected test never `require`s/`import`s the student's source — it only ever talks to their server over HTTP after spawning it as a real `node <entry>` subprocess (which correctly uses the student's own config on its own), so none of *their* jest config was ever actually needed to grade them.
- `runners/pytestRunner.js`: added `-o addopts=""` to the `pytest` invocation — clears any `addopts` a config file would otherwise inject, so `-x`/`--maxfail`/etc. from the student's own config can't truncate the generated test run.
- `sandboxService.js`: replaced the single unfiltered `uploadDir()` call with a recursive uploader that skips `node_modules`/`.git`/build-output dirs/Python virtualenv-and-cache dirs, skips files over 10MB, and skips symlinks (mirroring `evaluators/react/sandboxService.js`'s already-proven pattern) — and kills the sandbox instead of leaking it if the upload itself throws partway through.
- `controller/evaluatorController.js` (`validateBackendPayload`) and `evaluatorService.js` (defense in depth, in case a job ever reaches the worker without going through the HTTP controller): both now validate every `rubric.criteria[i]` has a non-empty string `name` and a positive finite numeric `weight`, rejecting the request/job before it can silently NaN every future score.

### Confirmed by running the code

```
$ node scripts/test-backend-evaluator.mjs
✅ jestRunner: overrides a student's jest.config.js via --config '{}'
✅ pytestRunner: clears a student's config-file addopts via -o addopts=""
✅ uploadDirectory: uploads the real source file
✅ uploadDirectory: skips node_modules / __pycache__ / venv contents
✅ uploadDirectory: skips a file over the 10MB limit
✅ uploadDirectory: skips a broken symlink instead of throwing
✅ evaluatorController: rubric criterion missing weight -> 400 (would otherwise NaN the whole score)
✅ evaluatorController: rubric criterion with a non-numeric weight -> 400
✅ evaluatorController: rubric criterion missing name -> 400
✅ evaluateBackendProject: rubric criterion missing weight is rejected before scoring (not silently NaN)
... (all prior checks still pass)
77/77 passed.

$ npm run test:unit   # full suite
(all ✅, exit code 0)
```

### Hypotheses tested and found to already work correctly (no fix needed)

Worth recording so they aren't re-investigated later — each was tested with
a real local `npm install jest`/`pytest` run against the reproduced shape,
not just reasoned about:

- **ESM (`"type": "module"`) student projects breaking the injected Jest
  test file.** Suspected the injected test file's `require('child_process')`
  etc. would throw under a project declaring `"type": "module"`. Actually
  fine: Jest's default transform treats `.js` test files as CommonJS
  regardless of the project's `"type"` field, and the injected test never
  requires the student's own source anyway — it spawns their server as a
  real subprocess, where Node's native ESM loader applies correctly on its
  own.
- **A student's `pytest.ini` `testpaths` restricting collection.**
  Suspected `testpaths = tests` would prevent `test_evaluator.py` (at the
  repo root) from being collected. Actually fine: an explicit file argument
  on the pytest CLI (`pytest test_evaluator.py`) overrides `testpaths` —
  confirmed the injected file still collects and runs regardless.

---

## 8. Follow-up: clone failing on the deployed host with a TTY-prompt error

Reported right after the deployed instance's missing `E2B_API_KEY` was
fixed — the very next real submission failed with a different error:
`fatal: could not read Username for 'https://github.com': No such device
or address`, against a repo confirmed genuinely public (`git ls-remote`
against it succeeds locally, repeatedly).

| # | File | Issue |
|---|------|-------|
| 18 | `extractService.js` | 🟡 `simple-git` shells out to the real `git` binary, which — if it ever thinks a clone might need credentials (private repo, rate limit, a networking hiccup that looks like an auth challenge) — tries to open a TTY to prompt for a username interactively. On a headless server there is no TTY, so that attempt itself fails with the cryptic `No such device or address`, instead of the clear "repository not found"/timeout a human running the same command locally would eventually get (git would just prompt them, uselessly, since these are automated jobs with no one to answer). |

### Fix

`simpleGit().env("GIT_TERMINAL_PROMPT", "0")` — disables git's interactive
credential prompting outright, so any clone that would have hung waiting
for a TTY now fails immediately with a real, readable error instead.

**Caveat, stated plainly:** this fixes the *symptom* (the confusing hang/
error) and is good defensive practice regardless, but I can't rule out
from here whether the *original* clone attempt on Render was also hitting
a real network/DNS/rate-limit condition specific to that host (I have no
shell access to Render to check its outbound connectivity directly). If a
clone of a known-public repo still fails after this deploys, the next
thing to check is whether Render's outbound network can reach
`github.com` at all, not this code path.

### Confirmed by running the code

```
$ node -e "extractSubmission('https://github.com/armasahar/backend-eval-demo-1-correct-node.git')"
clone still works: [ '.git', '.gitignore', 'package.json', 'server.js' ]

$ npm run test:unit
(all ✅, exit code 0)
```

---

## 9. Follow-up: a rubric criterion's exact wording silently changed which tests ran

Reported after both prior deploy issues (E2B key, git TTY prompt) were fixed
and the pipeline was confirmed working end-to-end on Render. Two real demo
submissions were graded live: `backend-eval-demo-beginner-correct` scored
100/100 as expected, but `backend-eval-demo-advanced-buggy` — a repo with a
real bug (product creation has no auth check at all) — *also* scored
100/100, when it should have lost points on the criterion meant to catch
exactly that.

| # | File | Issue |
|---|------|-------|
| 19 | `injectors/testInjector.js` | 🔴 `matchCriteria()` does a plain substring check (`nameLower.includes(k)`) against `CRITERION_PATTERNS`, in list order, and generates tests from the *first* pattern that matches. The generic auth pattern's keyword `'auth'` is a substring of "unauthenticated," "authorization," and "authentication" — and that pattern was listed *first*. The rubric criterion in question was named `"Protected routes reject unauthenticated requests"`, which obviously should have matched the `protected` pattern (a real, separate pattern that exists specifically for this) — but because `'auth'` matched first and stopped the search, it generated generic login/register-existence tests instead, which the buggy repo still passes (it does have working login/register endpoints — the bug is elsewhere, in access control on a *different* route). The rubric name never got a chance to reach the check that would have caught the actual bug. This isn't a one-off: any criterion mentioning authentication/authorization concepts (extremely common, natural phrasing for a rubric) was silently steered away from the more specific `jwt`/`protected` categories whenever the word "auth" happened to appear as a substring — with no warning that this happened. |

### Fix

Reordered `CRITERION_PATTERNS` so the narrower, more specific patterns
(`jwt`/`token`/`bearer`/`authorization`, then `protected`/`middleware`/
`guard`/`access control`) are checked *before* the broad generic `auth`
pattern. A criterion only falls through to the generic auth tests now if
nothing more specific matched first — which also means criteria that were
already correctly matching the generic category (e.g. `"Authentication
works"`, which contains no jwt/protected keyword) are completely
unaffected.

A more general "pick the most specific match across all patterns" scheme
was considered instead of reordering two entries, but reordering is the
smaller, easier-to-verify change for the actual reported failure mode, and
this file has no other keyword collisions of the same kind (checked the
rest of `CRITERION_PATTERNS` for other "broad keyword is a substring of a
narrower one" cases — none found).

### Confirmed by running the code

```
Before fix:
  matched protected-route generator: false
  matched generic auth generator: true    <- wrong: criterion literally
                                              named "...unauthenticated
                                              requests" generated login/
                                              register-existence tests

After fix:
  matched protected-route generator: true
  matched generic auth generator (should be false now): false

$ node scripts/test-backend-evaluator.mjs
✅ "Protected routes reject unauthenticated requests" matches its specific category, not the generic auth one
✅ "Authorization header is validated" matches its specific category, not the generic auth one
✅ "Access control blocks unauthenticated requests" matches its specific category, not the generic auth one
✅ "Authentication works" (no jwt/protected keyword) still matches the generic auth category
... (all prior checks still pass)

$ npm run test:unit
(all ✅, exit code 0)
```

**Note for anyone writing rubrics with this evaluator in the meantime:**
even with this fix, keyword-based criterion matching is inherently
sensitive to wording — prefer criterion names that lead with the specific
concept (e.g. `"JWT token validation"`, `"Protected route middleware"`)
over ones that bury it after a generic word.
