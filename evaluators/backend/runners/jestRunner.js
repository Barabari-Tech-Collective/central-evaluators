import { injectEvaluatorTests } from "../injectors/testInjector.js";
import { normalizeJestResults } from "../utils/normalizeResults.js";

export default async function runJestEvaluation(
  sandbox,
  projectPath,
  rubric
) {
  const pkgCmd = await sandbox.commands.run(`
    cat ${projectPath}/package.json
  `);

  let pkgJson = {};

  try {
    pkgJson = JSON.parse(pkgCmd.stdout);
  } catch {}

  const deps = {
    ...pkgJson.dependencies,
    ...pkgJson.devDependencies
  };

  const hasJest = deps.jest;
  const hasSupertest = deps.supertest;

  await sandbox.commands.run(`
    cd ${projectPath} &&
    npm install
  `, {
    timeout: 120000
  });

  if (!hasJest || !hasSupertest) {
    await sandbox.commands.run(`
      cd ${projectPath} &&
      npm install --save-dev jest supertest
    `);
  }

  await injectEvaluatorTests(
    sandbox,
    projectPath,
    rubric
  );

  const outputFile = "/home/user/jest-results.json";

  await sandbox.commands.run(`
    cd ${projectPath} &&
    npx jest evaluator.test.js \
    --json \
    --outputFile=${outputFile} \
    --forceExit \
    --testTimeout=20000 || true
  `, {
    timeout: 120000
  });

  // Bug (backendBugs.md #6): if Jest itself never ran (e.g. `npm install`
  // failed, or the injected test file had a syntax error), the output file
  // never gets written and `cat` throws — which used to crash the whole
  // evaluation job instead of just scoring this submission as "no tests
  // could run".
  let raw;
  try {
    const result = await sandbox.commands.run(`cat ${outputFile}`);
    raw = JSON.parse(result.stdout);
  } catch (err) {
    return {
      passedCount: 0,
      totalTests: 0,
      test_details: [],
      warnings: [`Jest results file was not produced — the test run likely crashed before completing (${err.message}).`],
      execution_logs: []
    };
  }

  return normalizeJestResults(raw);
}