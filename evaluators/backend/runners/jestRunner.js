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

  const outputFile = "/home/user/jest-results.json";

  // Author: Arma Sahar
  // Bug: reported live -- `npm install` (and everything after it) ran
  // unguarded, so a project with no package.json, a broken dependency, or
  // any other install-time failure threw a bare "exit status 1" with no
  // context and crashed the whole evaluation job instead of just scoring
  // this submission as "no tests could run", the same way a missing
  // jest-results.json already was handled below. One try/catch around the
  // whole install-through-read sequence now covers both failure points
  // uniformly.
  let raw;
  try {
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

    // Bug: found while auditing for edge cases, confirmed by actually running
    // jest against reproduced student config shapes. A student's own
    // jest.config.js can silently break grading in ways that don't just fail
    // cleanly — they fail *quietly*, discarding real results:
    //   - `bail: 1` (or any truthy bail): all tests in evaluator.test.js still
    //     run (confirmed — console showed "1 failed, 2 passed, 3 total"), but
    //     jest never writes --outputFile at all, so every one of those real
    //     results is lost and this submission scores as "0 tests ran".
    //   - a `reporters` entry pointing at a missing/broken custom reporter
    //     module fails config validation before any test runs at all.
    //   - a `testMatch`/`testPathIgnorePatterns` that doesn't cover the repo
    //     root silently collects zero tests ("No tests found"), even though
    //     evaluator.test.js was named explicitly on the CLI.
    // `--config '{}'` makes jest ignore the student's config file entirely
    // and grade with jest's plain defaults (confirmed: fixes all three cases
    // above). This is safe here specifically because the injected test never
    // requires/imports the student's source — it only ever talks to their
    // server over HTTP after spawning it as a real `node <entry>` subprocess
    // (see testInjector.js), so none of the config a student might have set
    // for their *own* module resolution/environment is actually needed to
    // grade them.
    await sandbox.commands.run(`
      cd ${projectPath} &&
      npx jest evaluator.test.js \
      --config '{}' \
      --json \
      --outputFile=${outputFile} \
      --forceExit \
      --testTimeout=20000 || true
    `, {
      timeout: 120000
    });

    const result = await sandbox.commands.run(`cat ${outputFile}`);
    raw = JSON.parse(result.stdout);
  } catch (err) {
    return {
      passedCount: 0,
      totalTests: 0,
      test_details: [],
      warnings: [`Jest evaluation could not complete — the run failed before producing results (${err.message}).`],
      execution_logs: []
    };
  }

  return normalizeJestResults(raw);
}