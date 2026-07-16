import { injectPythonTests } from "../injectors/pyTestInjector.js";
import { normalizePytestResults } from "../utils/normalizeResults.js";

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

  // Bug (backendBugs.md #6): same failure mode as the Jest runner — if
  // pytest never produced a report (e.g. the app couldn't be imported), the
  // `cat` used to throw and crash the whole job.
  let raw;
  try {
    const result = await sandbox.commands.run(`cat ${outputFile}`);
    raw = JSON.parse(result.stdout);
  } catch (err) {
    return {
      passedCount: 0,
      totalTests: 0,
      test_details: [],
      warnings: [`Pytest results file was not produced — the test run likely crashed before completing (${err.message}).`],
      execution_logs: []
    };
  }

  return normalizePytestResults(raw);
}