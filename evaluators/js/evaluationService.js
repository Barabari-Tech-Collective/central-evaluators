import fs from "fs";
import { runJavaScript } from "./executionService.js";
import { analyzeCode } from "./atsService.js";
import { calculateScore } from "./gradingService.js";
import { generateFeedback } from "./feedbackService.js";
import { aiFeedback } from "./aiFeedbackService.js";
export async function evaluateStudent({
  filePath,
  evaluationMode,
  entryFunction,
  testCases,
  expectedLogs,
  functions
}) {

  const studentCode =
    fs.readFileSync(
      filePath,
      "utf8"
    );

  const astAnalysis = analyzeCode(studentCode);
  if (!astAnalysis.syntaxValid) {
    return {
      score: 0,
      feedback: [
        {
          testCase: "syntax",
          feedback:
            astAnalysis.error
        }
      ]
    };
  }
  let passed = 0;
  const failures = [];
  //-------------------
  //Multi-function Mode
  //-------------------
  if (
  evaluationMode ===
  "multi-function"
) {
  let totalTests = 0;
  let passedTests = 0;
  for (
    const fn of functions
  ) {
    for (
      const testCase
      of fn.testCases
    ) {
      totalTests++;
      const result =
        runJavaScript({
          studentCode,
          evaluationMode:
            "function",
          entryFunction:
            fn.name,
          testCase
        });
      if (
        result.passed
      ) {
        passedTests++;
      } else {
        failures.push({
          function:
            fn.name,
          feedback:
            result.error ||
            `Expected ${JSON.stringify(result.expected)}
             got ${JSON.stringify(result.actual)}`
        });
      }
    }
  }
  passed = passedTests;
  total = totalTests;
}
  // ---------------------
  // FUNCTION MODE
  // ---------------------
  if (
    evaluationMode ===
    "function"
  ) {
    for (
      const testCase
      of testCases
    ) {
      const result =
        runJavaScript({
          studentCode,
          evaluationMode,
          entryFunction,
          testCase
        });
      if (result.passed) {
        passed++;
      } else {
        failures.push({
          feedback:
            `Expected ${JSON.stringify(result.expected)} but got ${JSON.stringify(result.actual)}`
        });
      }
    }
  }

  // ---------------------
  // SCRIPT MODE
  // ---------------------
  if (
    evaluationMode ===
    "script"
  ) {

    const result =
      runJavaScript({
        studentCode,
        evaluationMode,
        expectedLogs
      });

    if (result.passed) {
      passed = 1;
    } else {
      failures.push({
        feedback:
          "Console output mismatch"
      });
    }
    testCases = [1];
  }

  const score =
    calculateScore({
      passed,
      total:
        testCases.length,
      astAnalysis
    });

  const feedback =
    generateFeedback({
      score,
      passed,
      total:
        testCases.length,
      failures
    });

    const aiFeedback =
await generateAIFeedback({
  score,
  passed,
  total,
  failures,
  astAnalysis
});

  return {
    score,
    passed,
    total:
      testCases.length,
    feedback,
    aiFeedback,
    astAnalysis
  };
}