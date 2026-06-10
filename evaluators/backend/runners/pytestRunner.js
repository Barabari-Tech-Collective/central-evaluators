import { injectPythonTests } from "../injectors/pyTestInjector.js";

export default async function runPytestEvaluation(
  sandbox,
  projectPath,
  rubric
) {
  await sandbox.commands.run(`
    pip install pytest pytest-json-report httpx
  `);

  const reqCheck = await sandbox.commands.run(`
    test -f ${projectPath}/requirements.txt && echo yes || echo no
  `);

  if (reqCheck.stdout.trim() === "yes") {
    await sandbox.commands.run(`
      cd ${projectPath} &&
      pip install -r requirements.txt
    `);
  }

  await injectPythonTests(
    sandbox,
    projectPath,
    rubric
  );

  const outputFile = "/home/user/pytest-results.json";

  await sandbox.commands.run(`
    cd ${projectPath} &&
    pytest test_evaluator.py \
    --json-report \
    --json-report-file=${outputFile} || true
  `, {
    timeout: 120000
  });

  const result = await sandbox.commands.run(`
    cat ${outputFile}
  `);

  return JSON.parse(result.stdout);
}