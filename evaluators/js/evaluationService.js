import fs from 'fs';
import { runJavaScript } from './executionService.js';

export async function evaluateStudent(
  filePath,
  testCases,
  entryFunction
) {

  const studentCode =
    fs.readFileSync(filePath, 'utf8');

  let passed = 0;
  const feedback = [];

  for (let i = 0; i < testCases.length; i++) {

    const testCase = testCases[i];

    const result = runJavaScript(
      studentCode,
      testCase,
      entryFunction
    );

    if (result.passed) {

      passed++;

    } else {

      feedback.push({
        testCase: i + 1,
        feedback: result.feedback
      });
    }
  }

  return {
    score:
      (passed / testCases.length) * 100,
    passed,
    total: testCases.length,
    feedback
  };
}