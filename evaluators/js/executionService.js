// executionService.js

// TODO(security, V-34): vm2 is deprecated and has known sandbox-escape CVEs.
// Migrate JS execution to isolated-vm or an E2B sandbox. See VISUAL_EVALUATOR_AUDIT.md V-34.
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

      // Author: Arma Sahar
      // Bug (jsBugs.md #3): this always spread `testCase.input`, assuming
      // every test case's input is an args array. The repo's own fixture
      // (config/testCases.js) uses a scalar input (e.g. `input: -1`), so
      // `...(-1)` threw "not iterable" and every such test case silently
      // failed. Fix: only spread when input is actually an array; otherwise
      // pass it as the single argument the function expects.
      const args = Array.isArray(testCase.input)
        ? testCase.input
        : [testCase.input];

      const result = vm.run(`
        ${entryFunction}(
          ...${JSON.stringify(args)}
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
  const normalizedActual =
    logs.map(v => String(v).trim());
  const normalizedExpected =
    expectedLogs.map(v => String(v).trim());
  let matched = 0;
  const failures = [];
  for (
    let i = 0;
    i < normalizedExpected.length;
    i++
  ) {
    const expected =
      normalizedExpected[i];

    const actual =
      normalizedActual[i];
    if (actual === expected) {
      matched++;
    } else {
      failures.push({
        logNumber: i + 1,
        expected,
        actual
      });
    }
  }
  return {
    passed:
      matched ===
      normalizedExpected.length,
    matched,
    total:
      normalizedExpected.length,
    failures,
    actual: normalizedActual,
    expected: normalizedExpected
  };
}else{
  return {
    passed: false,
    error:
      "Unsupported evaluation mode"
  };
}
  } catch (err) {
    return {
      passed: false,
      error: err.message
    };
  }
}