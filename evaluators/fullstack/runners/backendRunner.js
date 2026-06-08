import { injectBackendTests } from "../injectors/testInjector.js";

export async function runBackendTests(sandbox, backendRoot, rubric) {
  // Install deps
  await sandbox.commands.run(`cd ${backendRoot} && npm install`, {
    timeout: 120000,
  });

  // Ensure jest + supertest are available
  await sandbox.commands.run(
    `cd ${backendRoot} && npm install --save-dev jest supertest`,
    { timeout: 60000 }
  );

  await injectBackendTests(sandbox, backendRoot, rubric);

  const outputFile = "/home/user/jest-backend-results.json";

  await sandbox.commands.run(
    `cd ${backendRoot} && npx jest evaluator.test.js --json --outputFile=${outputFile} --forceExit --testTimeout=20000 || true`,
    { timeout: 120000 }
  );

  const result = await sandbox.commands.run(`cat ${outputFile}`);

  try {
    return parseJestOutput(JSON.parse(result.stdout));
  } catch {
    return { passed: 0, total: 0, test_details: [], raw: result.stdout };
  }
}

function parseJestOutput(raw) {
  const test_details = [];
  let passed = 0;
  let total = 0;

  for (const suite of raw.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      total++;
      const status = t.status === "passed" ? "pass" : "fail";
      if (status === "pass") passed++;
      test_details.push({
        name: t.title,
        status,
        error: t.failureMessages?.[0]?.slice(0, 300) ?? null,
        duration: t.duration,
      });
    }
  }

  return { passed, total, test_details };
}
