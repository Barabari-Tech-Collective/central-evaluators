// gradingService.js

export function calculateScore({
  passed,
  total,
  astAnalysis
}) {

  const testScore =
    (passed / total) * 70;

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