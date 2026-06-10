import { VM } from 'vm2';

export function runJavaScript(studentCode, testCases) {

  const vm = new VM({
    timeout: 1000,
    sandbox: {}
  });

   try {

    const fn = vm.run(`
      ${studentCode}
    `);

    const actual = fn(...testCase.input);

    const passed =
      JSON.stringify(actual) ===
      JSON.stringify(testCase.expected);

    return {
      passed,
      expected: testCase.expected,
      actual
    };

  } catch (err) {

    return {
      passed: false,
      error: err.message
    };

  }

//   try {

//     vm.run(studentCode);

//     const wrappedTest = `
//       (function() {
//         ${testCode}
//       })()
//     `;

//     const result = vm.run(wrappedTest);

//     if (result === true) {

//       return {
//         passed: true,
//         feedback: 'Passed'
//       };

//     }

//     return {
//       passed: false,
//       feedback: 'Failed'
//     };

//   } catch (err) {

//     return {
//       passed: false,
//       feedback: 'Execution Error'
//     };

//   }
}