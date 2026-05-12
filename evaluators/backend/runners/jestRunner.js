import { injectEvaluatorTests } from "../injectors/testInjector.js";

export async function runJestEvaluation(
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

  const result = await sandbox.commands.run(`
    cat ${outputFile}
  `);

  return JSON.parse(result.stdout);
}