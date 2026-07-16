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
