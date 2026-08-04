import { injectPythonTests } from "../injectors/pyTestInjector.js";
import { normalizePytestResults } from "../utils/normalizeResults.js";

export default async function runPytestEvaluation(
  sandbox,
  projectPath,
  rubric
) {
  const outputFile = "/home/user/pytest-results.json";

  // Author: Arma Sahar
  // Bug: same class of issue as jestRunner.js — `pip install` (and
  // everything after it) ran unguarded, so an install-time failure (e.g. a
  // broken/unreachable requirements.txt entry) threw a bare "exit status 1"
  // and crashed the whole job instead of scoring this submission as "no
  // tests could run", same as an already-handled missing report file. One
  // try/catch around the whole install-through-read sequence now covers
  // both failure points uniformly.
  let raw;
  try {
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

    // Bug: found while auditing for edge cases, confirmed by actually running
    // pytest against a reproduced student config. A student's own
    // pytest.ini/pyproject.toml/setup.cfg can set `addopts = -x` (stop after
    // first failure) — confirmed: with 3 tests where the first fails, pytest
    // stopped immediately and the JSON report showed `{"total": 1,
    // "collected": 3}` — 2 real tests never ran, and totalTests silently read
    // as 1 instead of 3, scoring the submission on a third of the actual
    // signal with no warning. `-o addopts=""` clears any addopts a config
    // file would otherwise inject for this invocation (confirmed: same repro
    // now reports "total": 3 as expected) — the equivalent of jestRunner.js's
    // `--config '{}'` for the one pytest option shown to actually cause this.
    // (Unlike jest, an explicit `test_evaluator.py` argument already
    // overrides a config-file `testpaths` restriction on its own — confirmed
    // separately — so that particular risk doesn't need a matching override.)
    await sandbox.commands.run(`
      cd ${projectPath} &&
      pytest test_evaluator.py \
      -o addopts="" \
      --json-report \
      --json-report-file=${outputFile} || true
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
      warnings: [`Pytest evaluation could not complete — the run failed before producing results (${err.message}).`],
      execution_logs: []
    };
  }

  return normalizePytestResults(raw);
}