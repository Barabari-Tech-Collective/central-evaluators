export default function scoreFullstack(backendResults, frontendResults, rubric) {
  const criteria = rubric?.criteria ?? [];

  let totalScore = 0;
  let maxScore = 0;
  const rubric_breakdown = [];

  const backendPassRatio = ratio(backendResults.passed, backendResults.total);
  const frontendPassRatio = ratio(frontendResults.passed, frontendResults.total);

  for (const criterion of criteria) {
    const { name, weight, layer } = criterion;
    maxScore += weight;

    let achievedPoints;

    if (layer === "backend") {
      const match = backendResults.test_details.find((t) => t.name === name);
      achievedPoints = match
        ? match.status === "pass" ? weight : 0
        : Math.round(weight * backendPassRatio);
    } else if (layer === "frontend") {
      const match = frontendResults.test_details.find((t) => t.name === name);
      achievedPoints = match
        ? match.status === "pass" ? weight : 0
        : Math.round(weight * frontendPassRatio);
    } else {
      // No layer specified — use average pass ratio
      const avgRatio = (backendPassRatio + frontendPassRatio) / 2;
      achievedPoints = Math.round(weight * avgRatio);
    }

    totalScore += achievedPoints;
    rubric_breakdown.push({
      name,
      layer: layer ?? "general",
      points_achieved: achievedPoints,
      total_points: weight,
    });
  }

  const passPercent = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
  const status = passPercent >= 70 ? "pass" : "fail";

  return {
    score: totalScore,
    maxScore,
    passPercent: Math.round(passPercent),
    status,
    rubric_breakdown,
    backend: {
      passed: backendResults.passed,
      total: backendResults.total,
      test_details: backendResults.test_details,
    },
    frontend: {
      passed: frontendResults.passed,
      total: frontendResults.total,
      test_details: frontendResults.test_details,
    },
  };
}

function ratio(passed, total) {
  if (!total) return 0;
  return passed / total;
}
