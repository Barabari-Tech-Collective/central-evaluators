/**
 * normalizeResults.js
 * ─────────────────────────────────────────────────────────────
 * Bug (backendBugs.md #2): scoringService.js only ever reads
 * `{ passedCount, totalTests, test_details, warnings, execution_logs }`,
 * but jestRunner.js / pytestRunner.js used to hand it the RAW
 * `jest --json` / `pytest-json-report` output verbatim — neither of those
 * shapes has any of those fields. Every field scoringService touched was
 * `undefined`, so every submission silently scored NaN/0 regardless of how
 * correct the code was, and the "X out of Y tests" feedback line printed
 * "undefined out of undefined".
 *
 * These two functions map each runner's native JSON report into the single
 * shape scoringService.js expects, extracting the rubric criterion each test
 * belongs to from the `CRITERION:[name]` marker the injectors wrap tests in
 * (a Jest `describe()` title, or a pytest `parametrize` id).
 */

const CRITERION_RE = /CRITERION:\[([^\]]+)\]/;

function findCriterion(strings) {
  for (const s of strings) {
    const m = CRITERION_RE.exec(s || '');
    if (m) return m[1];
  }
  return null;
}

/**
 * @param {object} raw Parsed `jest --json` output
 */
export function normalizeJestResults(raw) {
  const test_details = [];
  const warnings = [];
  const execution_logs = [];

  for (const fileResult of raw.testResults || []) {
    if (fileResult.message && (!fileResult.assertionResults || fileResult.assertionResults.length === 0)) {
      // Whole file failed to run (syntax error, throw at module load, etc.)
      // — no individual test cases exist to blame, so surface it directly.
      warnings.push(`Jest could not run ${fileResult.name || 'the test file'}: ${fileResult.message.slice(0, 500)}`);
      execution_logs.push(fileResult.message);
      continue;
    }

    for (const assertion of fileResult.assertionResults || []) {
      test_details.push({
        name: assertion.fullName || assertion.title,
        status: assertion.status === 'passed' ? 'pass' : 'fail',
        criterion: findCriterion(assertion.ancestorTitles || []),
        duration: typeof assertion.duration === 'number' ? assertion.duration : undefined,
        error: (assertion.failureMessages || []).join('\n').slice(0, 1000) || undefined
      });
    }
  }

  const passedCount = typeof raw.numPassedTests === 'number'
    ? raw.numPassedTests
    : test_details.filter(t => t.status === 'pass').length;
  const totalTests = typeof raw.numTotalTests === 'number'
    ? raw.numTotalTests
    : test_details.length;

  return { passedCount, totalTests, test_details, warnings, execution_logs };
}

/**
 * @param {object} raw Parsed `pytest --json-report` output
 */
export function normalizePytestResults(raw) {
  const test_details = [];
  const warnings = [];
  const execution_logs = [];

  for (const test of raw.tests || []) {
    // pytest reports duration in seconds; scoringService's threshold
    // (PERFORMANCE_THRESHOLD_MS) is in milliseconds — without this
    // conversion every Python submission would trivially pass the
    // performance criterion since e.g. 0.05 < 500.
    const seconds = test.call?.duration ?? test.duration;
    const duration = typeof seconds === 'number' ? seconds * 1000 : undefined;

    test_details.push({
      name: test.nodeid,
      status: test.outcome === 'passed' ? 'pass' : 'fail',
      criterion: findCriterion([test.nodeid]),
      duration,
      error: test.call?.longrepr ? String(test.call.longrepr).slice(0, 1000) : undefined
    });
  }

  if ((!raw.tests || raw.tests.length === 0) && raw.exitcode !== 0) {
    warnings.push('Pytest collected no tests — the run likely errored before collection (missing app import, syntax error, etc.).');
  }

  const summary = raw.summary || {};
  const passedCount = typeof summary.passed === 'number'
    ? summary.passed
    : test_details.filter(t => t.status === 'pass').length;
  const totalTests = typeof summary.total === 'number'
    ? summary.total
    : test_details.length;

  return { passedCount, totalTests, test_details, warnings, execution_logs };
}
