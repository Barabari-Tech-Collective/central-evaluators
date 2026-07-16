import fs from "fs";
import { runJavaScript } from "./executionService.js";
import { analyzeCode } from "./astService.js";
import { calculateScore } from "./gradingService.js";
import { generateFeedback } from "./feedbackService.js";
import { generateAIFeedback } from "./aiFeedbackService.js";
import { stripModuleSyntax } from "./moduleSyntax.js";

// Author: Arma Sahar
// Bugs fixed (jsBugs.md #1, #2):
//  1. Multi-function mode did `total = totalTests` on an undeclared
//     variable. ES modules run in strict mode, so that threw
//     `ReferenceError: total is not defined` on every multi-function run.
//  2. The final scoring block always used `testCases.length` as the total,
//     regardless of mode. Multi-function mode doesn't receive a top-level
//     `testCases` array (each function has its own), so this crashed with
//     "Cannot read properties of undefined". Script mode worked around it
//     by overwriting the `testCases` parameter with a dummy filled array
//     instead of fixing the root cause.
// Fix: track `passed`/`total` as real local variables for every mode, and
// use them directly for scoring instead of re-deriving `total` from
// `testCases.length` (which isn't meaningful outside function mode).
export async function evaluateStudent({
  filePath,
  evaluationMode,
  entryFunction,
  testCases,
  expectedLogs,
  functions
}) {
  const rawCode = fs.readFileSync(filePath, "utf8");

  // Author: Arma Sahar
  // Bug (jsBugs.md #11): a large share of "basic function" submissions use
  // ES module boilerplate (`export function foo(){}`,
  // `export default function foo(){}`). The sandbox executes code as a
  // plain script (no module loader), and the AST check parsed as
  // `sourceType: "script"`, so both steps rejected valid, correct
  // functions purely for using `export`. Fix: strip the import/export
  // wrapper once, up front, and analyze/run that normalized code
  // everywhere below.
  const studentCode = stripModuleSyntax(rawCode);

  const astAnalysis = analyzeCode(studentCode);
  if (!astAnalysis.syntaxValid) {
    return {
      score: 0,
      feedback: [{ testCase: "syntax", feedback: astAnalysis.error }]
    };
  }

  let passed = 0;
  let total = 0;
  const failures = [];

  // ---------------------
  // MULTI-FUNCTION MODE
  // ---------------------
  if (evaluationMode === "multi-function") {
    for (const fn of functions) {
      for (const testCase of fn.testCases) {
        total++;

        // Author: Arma Sahar
        // Bug (jsBugs.md #13): runJavaScript is now async (it awaits
        // async/Promise-returning entry functions) — every call site has
        // to await it or `result` here would be a pending Promise instead
        // of the actual { passed, ... } outcome.
        const result = await runJavaScript({
          studentCode,
          evaluationMode: "function",
          entryFunction: fn.name,
          testCase
        });

        if (result.passed) {
          passed++;
        } else {
          failures.push({
            function: fn.name,
            feedback:
              result.error ||
              `Expected ${JSON.stringify(result.expected)} got ${JSON.stringify(result.actual)}`
          });
        }
      }
    }
  }

  // ---------------------
  // FUNCTION MODE
  // ---------------------
  if (evaluationMode === "function") {
    total = testCases.length;

    for (const testCase of testCases) {
      const result = await runJavaScript({
        studentCode,
        evaluationMode,
        entryFunction,
        testCase
      });

      if (result.passed) {
        passed++;
      } else {
        // Author: Arma Sahar
        // Bug (jsBugs.md #12): when execution threw (e.g. a ReferenceError,
        // or previously "module is not defined" — see executionService.js),
        // `runJavaScript` returns `{ passed: false, error }` with no
        // `expected`/`actual` keys. This branch ignored `result.error` and
        // always showed "Expected undefined but got undefined", hiding the
        // real reason a correct-looking function failed every test case.
        // Multi-function mode already checked `result.error` first — bring
        // function mode in line with it.
        failures.push({
          feedback:
            result.error ||
            `Expected ${JSON.stringify(result.expected)} but got ${JSON.stringify(result.actual)}`
        });
      }
    }
  }

  // ---------------------
  // SCRIPT MODE
  // ---------------------
  if (evaluationMode === "script") {
    const result = await runJavaScript({ studentCode, evaluationMode, expectedLogs });

    passed = result.matched;
    total = result.total;

    for (const failure of result.failures) {
      failures.push({
        feedback: `Log ${failure.logNumber}: Expected "${failure.expected}" but got "${failure.actual}"`
      });
    }
  }

  const score = calculateScore({ passed, total, astAnalysis });

  const feedback = generateFeedback({ score, passed, total, failures });

  const aiFeedback = await generateAIFeedback({
    score,
    passed,
    total,
    failures,
    astAnalysis
  });

  return {
    score,
    passed,
    total,
    feedback,
    aiFeedback,
    astAnalysis
  };
}
