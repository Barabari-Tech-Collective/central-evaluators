import fs from 'fs';
// import testCases from '../../config/testCases.js';
import { runJavaScript } from './executionService.js';

export async function evaluateStudent(student, testCases) {

  const studentCode = fs.readFileSync(student.filePath, 'utf-8');

  let passed = 0;
  let feedback = [];

  for (let i = 0; i < testCases.length; i++) {

    const test = testCases[i];

    const result = runJavaScript(
      studentCode,
      test
      // test.test
    );

    if (result.passed) {

      passed++;

    } else {

      feedback.push({
        testCase: i + 1,
        name: test.name,
        feedback: result.feedback
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

export async function evaluateAll(students, testCases) {

  const results = [];

  for (const student of students) {

    const result = await evaluateStudent(student, testCases);

    results.push(result);
  }

  return results;
}