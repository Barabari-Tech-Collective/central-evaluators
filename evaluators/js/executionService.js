// executionService.js

import { VM } from "vm2";

export function runJavaScript({
  studentCode,
  evaluationMode,
  entryFunction,
  testCase,
  expectedLogs
}) {

  const logs = [];

  const vm = new VM({
    timeout: 1000,
    sandbox: {
      console: {
        log: (...args) => {
          logs.push(args.join(" "));
        }
      }
    }
  });

  try {

    vm.run(studentCode);

    // -------------------------
    // FUNCTION MODE
    // -------------------------
    if (evaluationMode === "function") {

      if (!entryFunction) {

    return {
      passed: false,
      error:
        "entryFunction required for function mode"
    };
  }

      const result = vm.run(`
        ${entryFunction}(
          ...${JSON.stringify(testCase.input)}
        )
      `);

      const passed =
        JSON.stringify(result) ===
        JSON.stringify(testCase.expected);

      return {
        passed,
        actual: result,
        expected: testCase.expected,
        logs
      };
    }

    // -------------------------
    // SCRIPT MODE
    // -------------------------
    if (evaluationMode === "script") {

      const passed =
        JSON.stringify(logs) ===
        JSON.stringify(expectedLogs);

      return {
        passed,
        actual: logs,
        expected: expectedLogs
      };
    }

    return {
      passed: false,
      error:
        "Unsupported evaluation mode"
    };

  } catch (err) {

    return {
      passed: false,
      error: err.message
    };
  }
}