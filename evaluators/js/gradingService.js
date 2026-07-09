// gradingService.js

export function calculateScore({
  passed,
  total,
  astAnalysis
}) {

  // Author: Arma Sahar
  // Bug (jsBugs.md #7): (passed / total) * 70 produced NaN whenever total
  // was 0 (e.g. an empty test case list), and NaN then propagated through
  // Math.round() to the final score. Fix: treat "no tests to run" as no
  // test-score contribution instead of dividing by zero.
  const testScore =
    total > 0 ? (passed / total) * 70 : 0;

  let qualityScore = 0;

  if (astAnalysis.syntaxValid) {
    qualityScore += 10;
  }

  if (
    astAnalysis.functions.length > 0 ||
    astAnalysis.arrowFunctions.length > 0
  ) {
    qualityScore += 10;
  }

  if (
    astAnalysis.variables.length > 0
  ) {
    qualityScore += 10;
  }

  const finalScore =
    Math.round(
      testScore + qualityScore
    );

  return Math.min(finalScore, 100);
}