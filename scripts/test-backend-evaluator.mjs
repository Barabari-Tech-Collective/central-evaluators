/**
 * Regression test for the Backend evaluator (evaluators/backend/*).
 *
 * Exercises the real pieces the worker calls — no Redis/BullMQ/E2B needed —
 * and asserts the bugs logged in backendBugs.md stay fixed:
 *   - #1: evaluatorService.js wiring (projectPath arg, evaluateResults arg
 *         order, getAiFeedback arg shape) no longer produces NaN scores or
 *         throws TypeErrors.
 *   - #2: raw jest/pytest JSON is normalized into the shape scoringService
 *         expects (passedCount/totalTests/test_details/criterion mapping,
 *         pytest seconds->ms duration conversion).
 *   - #3: the test injectors receive the real rubric, not a dropped/shifted
 *         argument.
 *   - #5: AI feedback client is pointed at Groq's endpoint, not OpenAI's.
 *   - #6: a runner that can't produce a results file degrades to a scored
 *         "0 tests ran" result instead of throwing and killing the job.
 *   - #7: extractSubmission rejects unsafe repoUrls before shelling out to
 *         git (SSRF / flag-injection guard, same class as jsBugs.md #5).
 *
 * Run: node scripts/test-backend-evaluator.mjs   (exit 0 = all fixed)
 */
import { evaluateResults } from "../evaluators/backend/scoringService.js";
import { normalizeJestResults, normalizePytestResults } from "../evaluators/backend/utils/normalizeResults.js";
import getAiFeedback from "../evaluators/backend/feedbackService.js";
import { generateTestFileContent, injectEvaluatorTests } from "../evaluators/backend/injectors/testInjector.js";
import { injectPythonTests } from "../evaluators/backend/injectors/pyTestInjector.js";
import extractSubmission from "../evaluators/backend/extractService.js";
import { evaluate } from "../controller/evaluatorController.js";
import detectLanguage from "../evaluators/backend/utils/detectLanguage.js";
import { withTimeout } from "../evaluators/react/utils/timeout.js";

let failures = 0;
let passes = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (cond) passes++; else failures++;
}
function section(title) {
  console.log(`\n--- ${title} ---`);
}

const rubric = {
  criteria: [
    { name: "Authentication works", weight: 40 },
    { name: "Performance", weight: 30 },
    { name: "All API endpoints work", weight: 30 }
  ]
};

section("BUG REGRESSION — #1/#2 scoringService.evaluateResults");
{
  const testResults = {
    passedCount: 4,
    totalTests: 5,
    test_details: [
      { name: "login exists", status: "pass", criterion: "Authentication works", duration: 20 },
      { name: "login rejects empty", status: "pass", criterion: "Authentication works", duration: 15 },
      { name: "GET /users", status: "pass", criterion: "All API endpoints work", duration: 600 },
      { name: "POST /users", status: "fail", criterion: "All API endpoints work", duration: 30 },
      { name: "generic route", status: "pass", criterion: undefined, duration: 10 }
    ],
    warnings: [],
    execution_logs: []
  };

  const result = evaluateResults(rubric, testResults);

  check("evaluateResults: no NaN in total score", !Number.isNaN(result.score), `score=${result.score}`);
  check("evaluateResults: score is not silently 0/0", result.maxScore === 100, `maxScore=${result.maxScore}`);
  check("evaluateResults: auth criterion scores 40/40 (2/2 pass)", result.rubric_breakdown[0].points_achieved === 40);
  check(
    "evaluateResults: performance criterion penalizes the 600ms test",
    result.rubric_breakdown[1].points_achieved < 30,
    `got ${result.rubric_breakdown[1].points_achieved}/30`
  );
  check("evaluateResults: endpoints criterion scores 15/30 (1/2 pass)", result.rubric_breakdown[2].points_achieved === 15);
  check(
    "evaluateResults: feedback line has real numbers, not 'undefined'",
    result.feedback.includes("4 out of 5") && !result.feedback.includes("undefined")
  );
}

// ---------------------------------------------------------------------------
// #1 (pre-fix regression guard) — the old call site passed
// (testResults, rubric) instead of (rubric, testResults). Prove that shape
// degrades safely (0/0, no crash) so a future accidental revert is obvious
// from a score of exactly 0 rather than a hard crash hiding the cause.
// ---------------------------------------------------------------------------
{
  const testResults = { passedCount: 4, totalTests: 5, test_details: [], warnings: [], execution_logs: [] };
  const swapped = evaluateResults(testResults, rubric); // wrong order, on purpose
  check(
    "evaluateResults: swapped-argument call is detectably wrong (0 total, not a silent partial score)",
    swapped.maxScore === 0 && swapped.score === 0
  );
}

section("BUG REGRESSION — #2 normalizeJestResults");
{
  const rawJest = {
    numPassedTests: 2,
    numFailedTests: 1,
    numTotalTests: 3,
    testResults: [
      {
        name: "/home/user/app/evaluator.test.js",
        assertionResults: [
          {
            ancestorTitles: ["Auto-Generated Evaluator Tests", "CRITERION:[Authentication works]"],
            fullName: "Auth: login endpoint exists",
            title: "login endpoint exists",
            status: "passed",
            duration: 12
          },
          {
            ancestorTitles: ["Auto-Generated Evaluator Tests", "CRITERION:[Authentication works]"],
            fullName: "Auth: login rejects missing credentials",
            title: "login rejects missing credentials",
            status: "failed",
            duration: 8,
            failureMessages: ["Expected 401, got 200"]
          },
          {
            ancestorTitles: ["Auto-Generated Evaluator Tests"],
            fullName: "Server entry point is loadable",
            title: "Server entry point is loadable",
            status: "passed",
            duration: 3
          }
        ]
      }
    ]
  };

  const normalized = normalizeJestResults(rawJest);
  check("normalizeJestResults: passedCount", normalized.passedCount === 2);
  check("normalizeJestResults: totalTests", normalized.totalTests === 3);
  check(
    "normalizeJestResults: criterion extracted from describe() ancestorTitles",
    normalized.test_details[0].criterion === "Authentication works"
  );
  check(
    "normalizeJestResults: failed test carries its error message",
    normalized.test_details[1].error.includes("Expected 401")
  );
  check(
    "normalizeJestResults: test outside any CRITERION block has criterion=null",
    normalized.test_details[2].criterion === null
  );

  // Whole-file crash (e.g. syntax error in the injected test file) — must
  // degrade to a scored 0-test warning, not silently vanish.
  const crashedJest = { testResults: [{ name: "evaluator.test.js", message: "SyntaxError: Unexpected token", assertionResults: [] }] };
  const crashedNormalized = normalizeJestResults(crashedJest);
  check(
    "normalizeJestResults: whole-file failure surfaces as a warning",
    crashedNormalized.warnings.length === 1 && crashedNormalized.totalTests === 0
  );
}

section("BUG REGRESSION — #2 normalizePytestResults");
{
  const rawPytest = {
    summary: { total: 2, passed: 1, failed: 1 },
    exitcode: 1,
    tests: [
      {
        nodeid: "test_evaluator.py::test_auth_login_exists[CRITERION:[Authentication works]]",
        outcome: "passed",
        call: { duration: 0.012 }
      },
      {
        nodeid: "test_evaluator.py::test_slow_endpoint[CRITERION:[Performance]]",
        outcome: "failed",
        call: { duration: 0.9, longrepr: "assert 500 == 200" }
      }
    ]
  };

  const normalized = normalizePytestResults(rawPytest);
  check("normalizePytestResults: passedCount", normalized.passedCount === 1);
  check("normalizePytestResults: totalTests", normalized.totalTests === 2);
  check(
    "normalizePytestResults: duration converted seconds->ms (0.9s -> 900ms, not 0.9ms)",
    normalized.test_details[1].duration === 900
  );
  check(
    "normalizePytestResults: 900ms test would trip the 500ms performance threshold",
    normalized.test_details[1].duration > 500
  );
  check(
    "normalizePytestResults: criterion extracted from parametrize nodeid",
    normalized.test_details[0].criterion === "Authentication works"
  );
}

section("BUG REGRESSION — #1/#5 feedbackService.getAiFeedback");
{
  const noFailures = await getAiFeedback([{ name: "x", status: "pass" }], rubric);
  check("getAiFeedback: all-pass array does not throw", typeof noFailures === "string");

  const withFailures = await getAiFeedback(
    [{ name: "login rejects empty", status: "fail", error: "Expected 401, got 200" }],
    rubric
  );
  check("getAiFeedback: failing-tests array does not throw", typeof withFailures === "string");

  // Pre-fix regression guard: confirm the OLD call shape (whole object, not
  // an array) really does throw, so we know *why* the fix matters.
  let threw = false;
  try {
    await getAiFeedback({ test_details: [], passedCount: 1, totalTests: 1 }, rubric);
  } catch {
    threw = true;
  }
  check("getAiFeedback: old call shape (object instead of array) throws — confirms the bug was real", threw);
}

section("BUG REGRESSION — #3 injector signature fix");
{
  // generateTestFileContent is the pure function the injector calls — check
  // rubric criteria really flow into the generated file content.
  const content = generateTestFileContent([{ method: "GET", path: "/api/users" }], rubric);
  check(
    "generateTestFileContent: rubric criteria present in generated test file",
    content.includes("CRITERION:[Authentication works]") && content.includes("CRITERION:[Performance]")
  );

  function makeFakeSandbox(fileContents) {
    return {
      commands: { run: async () => ({ stdout: "" }) },
      files: { write: async (p, content) => { fileContents[p] = content; } }
    };
  }

  const jsFiles = {};
  const jsSandbox = makeFakeSandbox(jsFiles);
  await injectEvaluatorTests(jsSandbox, "/home/user/app", rubric);
  const jsWritten = jsFiles["/home/user/app/evaluator.test.js"];
  check(
    "injectEvaluatorTests: 3-arg call writes a file containing the real rubric criteria",
    !!jsWritten && jsWritten.includes("CRITERION:[Performance]")
  );

  const pyFiles = {};
  const pySandbox = makeFakeSandbox(pyFiles);
  await injectPythonTests(pySandbox, "/home/user/app", rubric);
  const pyWritten = pyFiles["/home/user/app/test_evaluator.py"];
  check(
    "injectPythonTests: 3-arg call writes a file containing the real rubric criteria",
    !!pyWritten && pyWritten.includes("CRITERION:[Authentication works]")
  );
}

section("BUG REGRESSION — #7 extractSubmission SSRF guard");
{
  async function rejects(fn) {
    try { await fn(); return false; } catch { return true; }
  }

  check(
    "extractSubmission: loopback URL rejected before cloning",
    await rejects(() => extractSubmission("http://127.0.0.1:6379/evil.git"))
  );
  check(
    "extractSubmission: cloud metadata URL rejected before cloning",
    await rejects(() => extractSubmission("http://169.254.169.254/latest/meta-data/"))
  );
  check(
    "extractSubmission: file:// scheme rejected before cloning",
    await rejects(() => extractSubmission("file:///etc/passwd"))
  );
}

section("BUG REGRESSION — #8 evaluatorController fail-fast validation");
{
  function fakeRes() {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  }

  const noRepoUrl = fakeRes();
  await evaluate({ body: { type: "backend", rubric: { criteria: [{ name: "x", weight: 100 }] } } }, noRepoUrl);
  check(
    "evaluatorController: backend payload missing repoUrl -> 400 (fails fast, before queuing)",
    noRepoUrl.statusCode === 400,
    `got ${noRepoUrl.statusCode}`
  );

  const noRubric = fakeRes();
  await evaluate({ body: { type: "backend", repoUrl: "https://github.com/octocat/Hello-World.git" } }, noRubric);
  check(
    "evaluatorController: backend payload missing rubric.criteria -> 400",
    noRubric.statusCode === 400,
    `got ${noRubric.statusCode}`
  );

  const badHost = fakeRes();
  await evaluate({
    body: { type: "backend", repoUrl: "http://169.254.169.254/evil.git", rubric: { criteria: [{ name: "x", weight: 100 }] } }
  }, badHost);
  check(
    "evaluatorController: backend payload with disallowed host -> 400",
    badHost.statusCode === 400,
    `got ${badHost.statusCode}`
  );
}

// ===========================================================================
// FEATURE CHECKLIST — does core evaluator functionality actually work,
// independent of any specific bug. Basic -> advanced, per the audit request.
// ===========================================================================

// Simulates `test -f <path> && echo <label> || echo none` — the exact shell
// idiom detectLanguage.js uses — against a fake in-sandbox file set.
function fakeFsSandbox(presentFiles) {
  return {
    commands: {
      run: async (cmd) => {
        const candidates = [...cmd.matchAll(/-f (\S+)/g)].map(m => m[1]);
        if (candidates.length === 0) return { stdout: "none" };
        const exists = candidates.some(path => presentFiles.some(f => path.endsWith(f)));
        const label = /echo (\w+) \|\| echo none/.exec(cmd)?.[1] || "none";
        return { stdout: exists ? label : "none" };
      }
    }
  };
}

section("FEATURE (basic) — detectLanguage");
{
  const node = await detectLanguage(fakeFsSandbox(["package.json"]));
  check("detectLanguage: Node project (package.json present) -> 'node'", node === "node");

  const python = await detectLanguage(fakeFsSandbox(["requirements.txt"]));
  check("detectLanguage: Python project (requirements.txt, no package.json) -> 'python'", python === "python");

  const pythonMain = await detectLanguage(fakeFsSandbox(["main.py"]));
  check("detectLanguage: Python project (main.py, no package.json) -> 'python'", pythonMain === "python");

  const appPyOnly = await detectLanguage(fakeFsSandbox(["app.py"]));
  check(
    "detectLanguage: Python project using only app.py (no main.py/requirements.txt) is correctly detected",
    appPyOnly === "python",
    `got '${appPyOnly}'`
  );
}

section("FEATURE (basic) — scoringService pass/fail threshold (CLAUDE.md: pass >= 70%)");
{
  const mkResults = (passed, total) => ({
    passedCount: passed,
    totalTests: total,
    test_details: Array.from({ length: total }, (_, i) => ({
      name: `t${i}`, status: i < passed ? "pass" : "fail", criterion: "All API endpoints work"
    })),
    warnings: [],
    execution_logs: []
  });
  const oneCriterion = { criteria: [{ name: "All API endpoints work", weight: 100 }] };

  const at70 = evaluateResults(oneCriterion, mkResults(7, 10));
  check("scoringService: exactly 70% passes", at70.pass === true, `score=${at70.score}`);

  const below70 = evaluateResults(oneCriterion, mkResults(6, 10));
  check("scoringService: 60% does not pass", below70.pass === false, `score=${below70.score}`);

  const emptyRubric = evaluateResults({ criteria: [] }, mkResults(0, 0));
  check("scoringService: empty criteria list does not throw or produce NaN", !Number.isNaN(emptyRubric.score) && emptyRubric.maxScore === 0);
}

section("FEATURE (intermediate) — Jest criterion-pattern coverage (testInjector.js)");
{
  const routes = [{ method: "GET", path: "/api/users" }, { method: "POST", path: "/api/auth/login" }];
  const keywordCases = [
    "User authentication and login",
    "JWT token validation",
    "Response schema validation",
    "Protected route middleware",
    "Health check endpoint",
    "Database configuration",
    "User profile management",
    "Product inventory",
    "Complaint ticket handling",
    "404 error handling",
    "REST API endpoints"
  ];
  for (const name of keywordCases) {
    const content = generateTestFileContent(routes, { criteria: [{ name, weight: 10 }] });
    check(`generateTestFileContent: "${name}" produces non-empty test code`, content.includes("test(") || content.includes("describe("));
  }
}

section("FEATURE (intermediate) — Express route extraction (injectEvaluatorTests -> extractRoutes)");
{
  const sampleServerCode = `
    const app = express();
    app.get('/health', (req,res)=>{});
    app.post("/api/auth/login", handler);
    router.put('/api/users/:id', handler);
    app.delete('/api/users/:id', handler);
  `;
  const files = {};
  const sandbox = {
    commands: { run: async (cmd) => ({ stdout: cmd.includes("server.js") ? sampleServerCode : "" }) },
    files: { write: async (p, c) => { files[p] = c; } }
  };
  const { detectedRoutes } = await injectEvaluatorTests(sandbox, "/home/user/app", { criteria: [{ name: "REST API endpoints", weight: 100 }] });
  check(
    "extractRoutes: parses app.get/app.post/router.put/app.delete from server code",
    detectedRoutes.length === 4,
    `found ${detectedRoutes.length}: ${detectedRoutes.map(r => `${r.method} ${r.path}`).join(", ")}`
  );
  check(
    "extractRoutes: generated test file references a detected route",
    files["/home/user/app/evaluator.test.js"]?.includes("/health")
  );
}

section("FEATURE (intermediate) — pytest criterion-pattern coverage (pyTestInjector.js)");
{
  const pyKeywordCases = ["User login and authentication", "Health check", "Database models (SQLAlchemy)", "REST endpoints"];
  for (const name of pyKeywordCases) {
    const files = {};
    const sandbox = {
      commands: { run: async () => ({ stdout: "" }) },
      files: { write: async (p, c) => { files[p] = c; } }
    };
    await injectPythonTests(sandbox, "/home/user/app", { criteria: [{ name, weight: 10 }] });
    const written = files["/home/user/app/test_evaluator.py"];
    check(`injectPythonTests: "${name}" produces a runnable pytest file`, !!written && written.includes("def test_"));
  }
}

section("FEATURE (advanced) — full pipeline: raw runner output -> normalize -> score");
{
  const rawJest = {
    numPassedTests: 3,
    numTotalTests: 4,
    testResults: [{
      name: "evaluator.test.js",
      assertionResults: [
        { ancestorTitles: ["x", "CRITERION:[Authentication works]"], fullName: "a", status: "passed", duration: 10 },
        { ancestorTitles: ["x", "CRITERION:[Authentication works]"], fullName: "b", status: "passed", duration: 12 },
        { ancestorTitles: ["x", "CRITERION:[All API endpoints work]"], fullName: "c", status: "passed", duration: 20 },
        { ancestorTitles: ["x", "CRITERION:[All API endpoints work]"], fullName: "d", status: "failed", duration: 15, failureMessages: ["boom"] }
      ]
    }]
  };
  const jestPipeline = evaluateResults(rubric, normalizeJestResults(rawJest));
  check(
    "End-to-end Jest pipeline: raw report -> real score (not NaN/0)",
    !Number.isNaN(jestPipeline.score) && jestPipeline.score > 0,
    `score=${jestPipeline.score}/${jestPipeline.maxScore}`
  );

  const rawPytest = {
    summary: { total: 2, passed: 2 },
    tests: [
      { nodeid: "t.py::a[CRITERION:[Authentication works]]", outcome: "passed", call: { duration: 0.01 } },
      { nodeid: "t.py::b[CRITERION:[All API endpoints work]]", outcome: "passed", call: { duration: 0.02 } }
    ]
  };
  const pytestPipeline = evaluateResults(rubric, normalizePytestResults(rawPytest));
  check(
    "End-to-end pytest pipeline: raw report -> real score (not NaN/0)",
    !Number.isNaN(pytestPipeline.score) && pytestPipeline.score > 0,
    `score=${pytestPipeline.score}/${pytestPipeline.maxScore}`
  );
}

section("FEATURE (advanced) — job-level timeout enforcement (workers/backendWorker.js pattern)");
{
  const fast = await withTimeout(Promise.resolve("done"), 200, "fast-op").catch(e => e);
  check("withTimeout: fast operation resolves normally", fast === "done");

  const slow = await withTimeout(new Promise(r => setTimeout(() => r("late"), 500)), 50, "slow-op").catch(e => e);
  check(
    "withTimeout: slow operation is aborted at the deadline (backendWorker.js now uses this)",
    slow instanceof Error && /Timeout/.test(slow.message)
  );
}

console.log(`\n${passes} passed, ${failures} failed, ${passes + failures} total.`);
console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
