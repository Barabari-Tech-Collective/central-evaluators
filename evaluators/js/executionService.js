import { VM } from 'vm2';

export function runJavaScript(
  studentCode,
  testCase,
  entryFunction
) {

  const vm = new VM({
    timeout: 1000,
    sandbox: {}
  });
  if (!entryFunction) {
  throw new Error(
    'entryFunction is required'
  );
}
  try {

    vm.run(studentCode);

    const input =
      JSON.stringify(testCase.input);

    const expected =
      JSON.stringify(testCase.expected);

    const result = vm.run(`
      // fibonacci(...${input})
       ${entryFunction}(...${input})
    `);

    if (
      JSON.stringify(result) === expected
    ) {
      return {
        passed: true,
        feedback: 'Passed'
      };
    }

    return {
      passed: false,
      feedback:
        `Expected ${expected} but got ${JSON.stringify(result)}`
    };

  } catch (err) {

    return {
      passed: false,
      feedback: err.message
    };
  }
}