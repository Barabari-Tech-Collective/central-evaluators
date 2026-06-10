// src/evaluators/python/services/evaluatorService.js

import { runPython } from "./executionService.js";
import testCases from "../../config/testCases.js";

async function evaluateStudent(student) {

  let passed = 0;
  let feedback = [];

  for (let i = 0; i < testCases.length; i++) {

    const test = testCases[i];

    const output = await runPython(
      student.filePath,
      test.input
    );

    if (output === test.expected) {

      passed++;

    } else {

      feedback.push({
        testCase: i + 1,
        input: test.input,
        expected: test.expected,
        got: output
      });
    }
  }

  return {
    name: student.name,
    score: (passed / testCases.length) * 100,
    passed,
    total: testCases.length,
    feedback
  };
}

export async function evaluateAll(students) {

  const results = [];

  for (const student of students) {

    const result = await evaluateStudent(student);

    results.push(result);
  }

  return results;
}