// Pure scoring helpers for the visual evaluator (V-07, V-21, V-30).
// No I/O, no browser — unit-testable in isolation (see scripts/test-scoring-logic.mjs).

/** Sum of all rubric weights = the maximum attainable score. */
export function computeMaxScore(rubric) {
  return rubric.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
}

/**
 * Proportional DOM score.
 * V-21: a DOM item with no checks can NOT be auto-graded → it earns 0 and is
 * surfaced via manualReviewItems(); it is never awarded full weight for free.
 */
export function computeDomScore(rubric, domResults) {
  let score = 0;
  for (const item of rubric) {
    if (item.type !== "dom") continue;
    if (!item.checks || item.checks.length === 0) continue; // V-21: no free credit
    let passed = 0;
    for (const check of item.checks) {
      const key = `${item.description} :: ${check.selector}`;
      if (domResults[key]) passed++;
    }
    score += (passed / item.checks.length) * (Number(item.weight) || 0);
  }
  return score;
}

/** All-or-nothing behavior score. */
export function computeBehaviorScore(rubric, behaviorResults) {
  let score = 0;
  for (const item of rubric) {
    if (item.type !== "behavior") continue;
    if (!item.checks?.length) continue;
    const passed = item.checks.every(
      check => behaviorResults[`${item.description} :: ${check.selector}`]
    );
    if (passed) score += Number(item.weight) || 0;
  }
  return score;
}

/** DOM items that cannot be auto-graded (no checks) — flag for manual review (V-21). */
export function manualReviewItems(rubric) {
  return rubric
    .filter(item => item.type === "dom" && (!item.checks || item.checks.length === 0))
    .map(item => item.description);
}

/**
 * Single source of truth for the final score (V-07): DOM + behavior + the
 * model's VISUAL-items subtotal — each counted exactly once. Also returns the
 * normalized 0–100 view (V-30) so scores are comparable across rubrics.
 */
export function assembleScore({ rubric, domScore, behaviorScore, visualScore }) {
  const total = domScore + behaviorScore + visualScore;
  const maxTotal = computeMaxScore(rubric);
  const normalized = maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  return {
    domScore,
    behaviorScore,
    visualScore,
    total,
    maxTotal,
    normalized: Math.round(normalized * 100) / 100
  };
}
