/**
 * Regression test for the visual evaluator scoring math.
 *
 * Imports the REAL pure helpers from evaluators/visual/scoring.js and asserts:
 *   - V-07: DOM + behavior are counted exactly once (no double count).
 *   - V-21: a DOM item with no checks earns 0 (not free full weight) and is
 *           surfaced for manual review.
 *   - V-30: a normalized 0..100 score is produced.
 *
 * Run: node scripts/test-scoring-logic.mjs   (exit 0 = fixed)
 */
import {
  computeDomScore,
  computeBehaviorScore,
  manualReviewItems,
  manualReviewDetail,
  assembleScore,
  computeMaxScore,
  clampScore,
  buildDomBreakdown,
  buildBehaviorBreakdown,
  pendingManualPoints
} from "../evaluators/visual/scoring.js";

const rubric = [
  { description: "Has favicon", type: "dom", weight: 10, checks: [{ selector: "link[rel='icon']" }] },
  { description: "Twitter opens", type: "behavior", weight: 10, checks: [{ selector: "a[href*='twitter']" }] },
  { description: "Nice layout", type: "visual", weight: 20, checks: [] },
  { description: "Some structure (no checks)", type: "dom", weight: 15 }, // V-21 fixture
  { description: "Code quality", type: "manual", weight: 5, checks: [] }, // manual-type fixture
];

const domResults = { "Has favicon :: link[rel='icon']": true };
const behaviorResults = { "Twitter opens :: a[href*='twitter']": true };
const visualScore = 15; // what the vision model returns for the visual item

const domScore = computeDomScore(rubric, domResults);
const behaviorScore = computeBehaviorScore(rubric, behaviorResults);
const score = assembleScore({ rubric, domScore, behaviorScore, visualScore });
const manual = manualReviewItems(rubric);
const manualDetail = manualReviewDetail(rubric);
const domBreakdown = buildDomBreakdown(rubric, domResults);
const behaviorBreakdown = buildBehaviorBreakdown(rubric, behaviorResults);

console.log("--- Scoring ---");
console.log("domScore   :", domScore, "(favicon 10; no-checks dom -> 0)");
console.log("behavior   :", behaviorScore);
console.log("visualScore:", visualScore);
console.log("total      :", score.total, "/ maxTotal", score.maxTotal, "=> normalized", score.normalized + "%");
console.log("manualReviewItems:", manual);
console.log("pendingManualPoints:", score.pendingManualPoints);
console.log("");

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

check("V-21: no-checks DOM item earns 0 (domScore === 10)", domScore === 10);
check("no-checks DOM item + manual-type item both flagged (manual.length === 2)", manual.length === 2);
check("V-07: total is single-counted (10+10+15 === 35)", score.total === 35);
check("V-30: maxTotal === sum of ALL weights incl. manual (60)", score.maxTotal === computeMaxScore(rubric) && score.maxTotal === 60);
check("V-30: normalized === round(35/60*100) === 58.33", score.normalized === 58.33);

// New: manual-type classification + reasons
check("manualReviewDetail carries weight for each unscorable item", manualDetail.reduce((s, i) => s + i.weight, 0) === 20);
check("pendingManualPoints matches manualReviewDetail total (20)", pendingManualPoints(rubric) === 20);

// New: score clamping (fixes >100 totals from an unbounded vision score)
check("clampScore caps an over-limit model score to max", clampScore(35, 20) === 20);
check("clampScore floors a negative score to 0", clampScore(-5, 20) === 0);
check("clampScore passes through an in-range score unchanged", clampScore(15, 20) === 15);

// New: per-item breakdown transparency (was previously invisible — only the
// aggregate domScore/behaviorScore numbers were returned to the caller)
check("domBreakdown includes the passing favicon item at full credit", domBreakdown.some(i => i.item === "Has favicon" && i.awarded === 10 && i.max === 10));
check("domBreakdown omits the no-checks item (nothing to break down)", !domBreakdown.some(i => i.item === "Some structure (no checks)"));
check("behaviorBreakdown includes the passing twitter item at full credit", behaviorBreakdown.some(i => i.item === "Twitter opens" && i.awarded === 10));

console.log("");
console.log(failures === 0 ? "All scoring assertions PASS." : `${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
