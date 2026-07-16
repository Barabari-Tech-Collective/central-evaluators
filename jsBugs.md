# JavaScript Evaluator — Design Notes & Bug Log

Author of this document: Arma Sahar
Scope: `evaluators/js/*`, `workers/jsWorker.js`, and the pieces they depend on
(`config/testCases.js`, `router/evaluationRouter.js`, `server.js`).

This follows the same process used for the visual evaluator: read the code,
write down the system design, run it and note what actually breaks, then fix
issues one at a time with before/after test evidence.

---

## 1. System design (as found)

```
POST /evaluate  { type: "javascript", submissions: [...], testCases | functions, entryFunction, evaluationMode, expectedLogs }
  -> evaluatorController.js   validates request, forwards to router
  -> evaluationRouter.js      fans out one BullMQ job per submission on the
                              "javascript-evaluation" queue
  -> workers/jsWorker.js      (queue consumer)
       1. cloneRepo(submission.repoUrl)      [repoService.js]
       2. findJavaScriptFile(repoPath)       [fileService.js]
       3. evaluateStudent({...})             [evaluationService.js]
       4. deleteRepo(repoPath)               [repoService.js, in `finally`]
  -> evaluationService.js     orchestrates one of three eval modes:
       - "function"        run entryFunction against `testCases`
       - "multi-function"  run several named functions, each with its own
                            `fn.testCases`
       - "script"          run the whole file, compare console.log output
                            against `expectedLogs`
       for every mode it calls:
         - executionService.js  runJavaScript()  -> VM2 sandbox execution
         - atsService.js        analyzeCode()    -> acorn AST pass (syntax
                                                    validity + simple
                                                    style signals)
         - gradingService.js    calculateScore() -> 70% test pass rate +
                                                    30% "quality" heuristics
         - feedbackService.js   generateFeedback() -> canned summary text
         - aiFeedbackService.js generateAIFeedback() -> Groq LLM feedback
```

Three evaluation modes exist, but only "function" mode is exercised by the
sample fixture shipped in the repo (`config/testCases.js`, an isPrime-style
list of `{ input, expected }` objects with a **scalar** `input`).

### Wiring status

`server.js` currently only calls `initializeVisualWorker()`. There is no
`initializeJsWorker()` call anywhere in `server.js`, and `public/app.js` has
no form for `type: "javascript"`. This means: **even with all the bugs below
fixed, a `POST /evaluate` with `type: "javascript"` will enqueue a job that
no worker ever consumes.** This is a wiring/deployment decision, not a code
bug in `evaluators/js/*` itself — noted here so it isn't missed, and it's
required to actually run the evaluator end-to-end instead of only unit
testing the pure functions.

---

## 2. Bugs found (reading + running the code)

Severity key: 🔴 crash/incorrect result in normal use · 🟠 security ·
🟡 correctness edge case · ⚪ dead code / cosmetic.

| # | File | Issue |
|---|------|-------|
| 1 | `evaluationService.js` | 🔴 `total = totalTests` inside the multi-function branch assigns to an **undeclared** variable. ES modules run in strict mode, so this throws `ReferenceError: total is not defined` — multi-function mode cannot complete a single run. |
| 2 | `evaluationService.js` | 🔴 The final score/feedback block always does `total: testCases.length`, regardless of `evaluationMode`. In multi-function mode the caller supplies per-function `fn.testCases`, not a top-level `testCases` array, so `testCases` is `undefined` → `TypeError: Cannot read properties of undefined (reading 'length')`. Script mode "fixes" this by overwriting the `testCases` parameter with a dummy filled array (`new Array(result.total).fill(1)`) — a workaround that hides bug #2 instead of fixing it. |
| 3 | `executionService.js` | 🔴 Function-mode invocation builds `entryFunction(...${JSON.stringify(testCase.input)})` — i.e. it **always spreads** `testCase.input`. That assumes every test case's `input` is an array of arguments. The repo's own fixture (`config/testCases.js`) uses a scalar `input` (e.g. `input: -1`), so `...(-1)` throws `TypeError: (intermediate value)(...) is not iterable`. Every "function" mode run using that fixture crashes. |
| 4 | `aiFeedbackService.js` | 🔴 In the `catch` block: `return\n  "AI feedback unavailable.";`. Automatic Semicolon Insertion turns the bare `return` (followed by a newline) into `return;` — the string on the next line is unreachable. So whenever the Groq call fails (missing/invalid API key, network error, rate limit), the function silently returns `undefined` instead of the intended fallback string. |
| 5 | `repoService.js` | 🟠 `execSync(\`git clone ${repoUrl} ${repoPath}\`)` interpolates an attacker/student-controlled URL directly into a shell string — classic command injection (OWASP A03). No `--` argument terminator, no shallow clone, and no SSRF/allowlist check (compare `evaluators/visual/repoService.js`, which uses `simple-git` with an argv array and `assertSafeUrl`). `evaluatorController.js` also only runs `assertSafeUrl`/`assertUrlSyntax` when `payload.type === 'visual'`, so JS submissions get none of that validation today. |
| 6 | `fileService.js` | 🟡 `findJavaScriptFile` walks the whole repo and returns the *first* `.js` file hit by `fs.readdirSync` (order is filesystem-dependent, not alphabetical/deterministic), without skipping `node_modules`, `.git`, or common non-solution config files (`webpack.config.js`, `.eslintrc.js`, `jest.config.js`). On any repo with more than one `.js` file this can silently grade the wrong file. |
| 7 | `gradingService.js` | 🟡 `(passed / total) * 70` divides by zero (`NaN`) when `total === 0` (e.g. an empty test case list, or a multi-function payload with no test cases). `Math.round(NaN)` propagates `NaN` all the way to the final score. |
| 8 | `jsWorker.js` | ⚪ The job processor `return`s early (success and no-file-found paths); every `logger.info` call after that `return` (lines ~101-113 in the original file: "Processing…", "Found file…", "Entry Function…", "Received N test cases…", "JS Job completed") is unreachable dead code and never runs. |
| 9 | `jsWorker.js` | 🟡 The "no JS file found" early return has response shape `{ success, results: [{ studentId, studentName, evaluation }] }`, while the normal path returns the flat shape `{ success, studentId, studentName, evaluation }`. Two different shapes for the same job type makes the result harder to consume reliably. |
| 10 | `evaluationService.js` / `executionService.js` | ⚪ Extremely fragmented formatting (single tokens split across many lines) throughout both files made bugs #1-#3 hard to spot by eye. Reformatted while fixing so the logic reads top-to-bottom. |

Renamed (per your go-ahead):
- `atsService.js` → `astService.js` (via `git mv`, history preserved). The
  file's own top-of-file comment already read `// astService.js` — the file
  on disk was the odd one out. Updated the one import in
  `evaluationService.js` and confirmed nothing else referenced the old name.

---

## 3. Confirmed by running the code

Added `scripts/test-js-evaluator.mjs` (same convention as the existing
`scripts/test-scoring-logic.mjs` — plain `check()` assertions, ✅/❌ output,
non-zero exit on failure) and wired it into `npm run test:unit`. Also added
`scripts/e2e-smoke-js-worker.mjs`, a manual one-off (like the existing
`scripts/manual-visual-test.mjs`) that drives the **real** BullMQ queue +
Redis + `jsWorker.js` + a real `https://github.com/...` clone, to prove the
whole pipeline (not just the pure functions) works.

### Before fixing (ran the suite against the original code)

| # | Check | Result |
|---|-------|--------|
| 1/2 | multi-function mode | `ReferenceError: total is not defined` |
| 1/2 | multi-function mode score | crashed before scoring |
| 3 | function mode, scalar `input` (repo's own fixture shape) | test cases silently scored 0/2 — the spread `TypeError` was swallowed by `executionService.js`'s own try/catch, so it didn't crash the whole run, but every test case using a scalar input always "failed" regardless of correctness |
| 7 | `calculateScore({ passed: 0, total: 0 })` | `NaN` |
| 6 | `findJavaScriptFile` on a repo with `node_modules`/`.git` | picked `.git/hooks.js` instead of `src/solution.js` |
| 5 | `cloneRepo("https://github.com/x/y.git; touch /tmp/js-evaluator-pwned #")` | **actually ran `touch`** — confirmed real command injection, not just theoretical (PoC file was created on disk, then removed) |
| 4 | `generateAIFeedback(...)` with the Groq call failing (missing/invalid key) | returned `undefined` |

### After fixing

```
$ node scripts/test-js-evaluator.mjs
✅ function mode: scalar input doesn't crash — score=100
✅ function mode: scalar input scores 2/2 tests passed
✅ function mode: array input passes the correct case — passed=1
✅ multi-function mode: does not throw ReferenceError
✅ multi-function mode: scores 2/3 passed — {"passed":2,"total":3}
✅ gradingService: total=0 does not produce NaN — score=10
✅ fileService: skips node_modules/.git/config files, finds src/solution.js
✅ repoService: malicious repoUrl is rejected, not shell-executed
✅ aiFeedbackService: returns fallback string (not undefined) on API error
All checks passed.

$ node scripts/e2e-smoke-js-worker.mjs
Job queued: ...
Result shape: { "success": true, "studentId": "smoke-test", "studentName": "Smoke Test", "evaluation": { ... } }
✅ end-to-end wiring OK

$ npm run test:unit   # full suite, including the pre-existing visual tests
(all ✅, exit code 0)
```

`jsWorker.js`'s dead-code and response-shape fixes (bugs #8/#9) aren't
covered by assertions in `test-js-evaluator.mjs` (they don't change scoring
math), but were exercised live by the `e2e-smoke-js-worker.mjs` run above and
verified by reading the resulting job output shape.

---

## 4. Wiring — now enabled

Per your go-ahead, the JS evaluator is now live the same way the visual
evaluator is:

- `server.js` now also calls `initializeJsWorker()` at startup and
  `stopJsWorker()` on graceful shutdown, right alongside the visual worker.
- `public/app.js` has a new `javascript` entry in the `EVALUATORS` map:
  an evaluation-mode picker (function / multi-function / script) that shows
  only the relevant fields (`entryFunction` + `testCases`, or `functions`,
  or `expectedLogs`) via the existing `showIf` mechanism, plus the usual
  submissions list (studentId/studentName/repoUrl — no entry file needed,
  `fileService.js` finds the student's `.js` file itself).
- The JS evaluator's structured feedback object (`{ summary, strengths,
  issues, recommendations }`) now renders as readable text instead of a raw
  JSON dump, and the Groq AI mentor feedback string is shown too — added as
  a new, isolated code path in `normalizeResults`/`renderResult` in
  `public/app.js` that only triggers for that specific shape, so the visual
  evaluator's rendering is untouched.

### Verified

- `node --check` on `server.js` and `public/app.js` — no syntax errors.
- `npm run test:unit` — still all green after the rename + wiring changes.
- Started the real server (`node server.js`, both workers initialize) and
  hit the actual HTTP path a browser click would take:
  `POST /evaluate` with the exact payload shape `collectPayload()` in
  `app.js` builds (`type: "javascript"`, `evaluationMode: "function"`,
  `testCases`, `submissions`) → got back `{ success: true, jobs: [...] }` →
  polled `GET /jobs/javascript/:id` the same way `pollJob()` does → got
  `state: "completed"` with the exact result shape `normalizeResults()`
  expects (`{ success, studentId, studentName, evaluation: { score,
  feedback } }`).
- Confirmed `public/app.js` is served with the new `javascript` entry
  present (`curl localhost:PORT/app.js`).
- **Not done:** a literal mouse-click walkthrough in a live Chrome window —
  no browser was connected to this session (Claude in Chrome extension
  wasn't reachable). The HTTP-level test above exercises the identical
  request/response path the UI drives, and the pure-function tests already
  cover real pass/fail scoring correctness, but if you want a from-scratch
  eyeball check, open the app and try it — the server is left running at
  the point this session ended.

---

## 5. Follow-up: "basic functions" still failing in production

Reported after the first round of fixes shipped: real student submissions
were still failing, including ones with obviously correct logic. Root
cause was **not** missing "advanced JS" support — modern syntax (arrow
functions, destructuring, template literals, async/await, classes, default
params, spread/rest, optional chaining) already parses and runs fine, since
acorn is configured with `ecmaVersion: "latest"` and vm2 supports all of
that once code is in scope. The actual causes were narrower and all three
made "basic function" submissions fail regardless of whether the logic was
correct:

| # | File | Issue |
|---|------|-------|
| 10 | `executionService.js` | 🔴 The vm2 sandbox only defined `console`. The single most common Node/CommonJS starter-template line, `module.exports = { foo };` (or `require(...)` for a debug import), threw `ReferenceError: module/require is not defined`. Because `vm.run(studentCode)` runs the *whole* file in one shot, that error aborted the entire evaluation before the entry function was ever called — a perfectly correct function scored 0 on every test case. |
| 11 | `evaluationService.js` (new: `moduleSyntax.js`) | 🔴 The AST check parsed with the default `sourceType: "script"`, and the sandbox executes as a plain script too — so any `import`/`export`/`export default` (extremely common in ES-module course templates) failed the syntax check outright, before execution was even attempted. |
| 12 | `evaluationService.js` | 🟡 When `runJavaScript` returned `{ passed: false, error }` (an actual exception, not a wrong return value), the function-mode failure branch ignored `result.error` and always displayed "Expected undefined but got undefined" — so even once you *had* one of the failures above, the feedback gave no clue why. This is very likely why the real cause (#10/#11) went unnoticed: the UI/feedback never showed the real error. Multi-function mode already handled this correctly; function mode didn't.

### Fix

- Added `evaluators/js/moduleSyntax.js` (`stripModuleSyntax`): parses the
  code once as `sourceType: "module"`, then uses acorn's exact character
  offsets to surgically remove/rewrite just the `import`/`export` wrapper
  text (e.g. `export function foo(){}` → `function foo(){}`), leaving
  everything else byte-for-byte untouched. If the code doesn't parse as a
  module either, it's returned unchanged so the normal script-mode parse
  still reports the real syntax error — this only strips well-formed
  module syntax, it never masks a genuine bug in the student's code
  (verified with a deliberately broken function, see tests below).
  Called once in `evaluationService.js` right after reading the file, so
  AST analysis and execution both see the same normalized code.
- `executionService.js`'s sandbox now also defines `module: { exports: {} }`
  and `exports: {}` (inert — we always call the entry function by name, so
  we never need to read from them) and a `require` stub that throws a
  clear, gradeable message instead of a bare ReferenceError.
- `evaluationService.js`'s function-mode failure branch now checks
  `result.error` first, matching multi-function mode.

### Confirmed by running the code

```
$ node scripts/test-js-evaluator.mjs
✅ module boilerplate tolerated: module.exports = { sum } — score=90
✅ module boilerplate tolerated: module.exports = sum (default-style) — score=90
✅ module boilerplate tolerated: export function sum — score=90
✅ module boilerplate tolerated: export default function sum — score=90
✅ module boilerplate tolerated: import + export function (mixed) — score=90
✅ require(): clear message, not a silent module crash
✅ genuine syntax error is still reported
✅ real execution error is surfaced in feedback, not swallowed
... (all prior checks still pass)
All checks passed.

$ npm run test:unit   # full suite including visual evaluator tests
(all ✅, exit code 0)
```

Before this fix, cases like `module.exports = { sum }` and
`export function sum(){}` scored 0 with a useless "Expected undefined but
got undefined" message despite `sum` being implemented correctly — that
combination is almost certainly what generated the "doesn't work even for
basic functions" reports.

---

## 6. Follow-up: async functions and API calls

Asked directly: does the evaluator support intermediate/advanced JS and
async/API calls? Checked with real test cases rather than assuming:

- **Basic/intermediate — confirmed working**: destructured params, default
  params, template literals, spread/rest args, classes with methods,
  closures/higher-order functions, `.map/.filter/.reduce`, generators.
- **Async — confirmed broken** (bug #13):

| Pattern | Before |
|---|---|
| `async function sum(a,b){ return a+b; }` | Always failed — graded on the unresolved `Promise` object (`JSON.stringify` → `"{}"`), never its resolved value |
| Plain function returning a `Promise` | Same |
| `await fetch(...)` | `fetch` undefined in the sandbox → generic ReferenceError |
| `await new Promise(r => setTimeout(r, ms))` | `setTimeout` undefined — and because the throw happens inside a Promise executor, it became an **unhandled promise rejection** *after* `runJavaScript` had already returned a (wrong) result, rather than a normal caught error. In a bare Node process this crashed the process outright; in the real server it's caught by the existing global `unhandledRejection` safety net, but the job still silently returned a wrong grade with the real cause disconnected from it in the logs. |

### Fix (`executionService.js`, `evaluationService.js`)

- `runJavaScript` is now `async` and awaits the entry function's result
  when it's thenable, bounded by a new `ASYNC_TIMEOUT_MS` (5000ms) —
  separate from vm2's own `timeout` option, which only bounds *synchronous*
  execution and does nothing for pending async work. All three call sites
  in `evaluationService.js` (function, multi-function, script mode) now
  `await` it.
- Sandbox gains a real `setTimeout`/`clearTimeout` (delegating to Node's),
  so `await new Promise(r => setTimeout(r, ms))` — the standard way to
  simulate async delay — works correctly. Every timer a test case creates
  is tracked and force-cleared in a `finally` block once grading for that
  case finishes, so a huge or forgotten delay can't keep a stale sandbox
  context alive in the event loop.
- `fetch` is a deliberate stub that throws a clear "not available" message
  (`require()`'s existing pattern), **not** real network access: letting
  arbitrary student-submitted code make outbound requests from the grading
  server is an SSRF/abuse vector. This was a deliberate scope decision, not
  an oversight — flagged and confirmed before implementing.
- A student function that never resolves now times out cleanly after 5s
  with a clear "Async execution timed out after 5000ms" message instead of
  hanging that test case (or, in the old code, going undetected as an
  unhandled rejection).

### Confirmed by running the code

```
✅ async support: async/await returning a value — score=90
✅ async support: async with an internal await delay — score=90
✅ async support: plain Promise-returning function — score=90
✅ fetch(): clear 'not available' message
✅ rejected async function surfaces its real error — ["nope"]
✅ a never-resolving async function times out instead of hanging — elapsed=5004ms
... (all prior checks still pass)
All checks passed.

$ npm run test:unit   # full suite including visual evaluator tests
(all ✅, exit code 0)
```

Verified the timeout/cleanup path specifically: after a never-resolving
async function's test case finishes (via the 5s timeout), the Node process
still exits cleanly with no lingering timers/handles — confirming the
per-case timer cleanup actually works, not just that the score comes back
right.

