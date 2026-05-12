import { VM } from 'vm2';

export function runJavaScript(studentCode, testCode) {

  const vm = new VM({
    timeout: 1000,
    sandbox: {}
  });

  try {

    vm.run(studentCode);

    const wrappedTest = `
      (function() {
        ${testCode}
      })()
    `;

    const result = vm.run(wrappedTest);

    if (result === true) {

      return {
        passed: true,
        feedback: 'Passed'
      };

    }

    return {
      passed: false,
      feedback: 'Failed'
    };

  } catch (err) {

    return {
      passed: false,
      feedback: 'Execution Error'
    };

  }
}