import fs from "fs";
import { runJavaScript } from "./executionService.js";
import { analyzeCode } from "./astService.js";
import { calculateScore } from "./gradingService.js";
import { generateFeedback } from "./feedbackService.js";
import { generateAIFeedback } from "./aiFeedbackService.js";

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
  const studentCode = fs.readFileSync(filePath, "utf8");

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

        const result = runJavaScript({
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
      const result = runJavaScript({
        studentCode,
        evaluationMode,
        entryFunction,
        testCase
      });

      if (result.passed) {
        passed++;
      } else {
        failures.push({
          feedback: `Expected ${JSON.stringify(result.expected)} but got ${JSON.stringify(result.actual)}`
        });
      }
    }
  }

  // ---------------------
  // SCRIPT MODE
  // ---------------------
  if (evaluationMode === "script") {
    const result = runJavaScript({ studentCode, evaluationMode, expectedLogs });

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
