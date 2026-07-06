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
  assembleScore,
  computeMaxScore
} from "../evaluators/visual/scoring.js";

const rubric = [
  { description: "Has favicon", type: "dom", weight: 10, checks: [{ selector: "link[rel='icon']" }] },
  { description: "Twitter opens", type: "behavior", weight: 10, checks: [{ selector: "a[href*='twitter']" }] },
  { description: "Nice layout", type: "visual", weight: 20, checks: [] },
  { description: "Some structure (no checks)", type: "dom", weight: 15 }, // V-21 fixture
];

const domResults = { "Has favicon :: link[rel='icon']": true };
const behaviorResults = { "Twitter opens :: a[href*='twitter']": true };
const visualScore = 15; // what the vision model returns for the visual item

const domScore = computeDomScore(rubric, domResults);
const behaviorScore = computeBehaviorScore(rubric, behaviorResults);
const score = assembleScore({ rubric, domScore, behaviorScore, visualScore });
const manual = manualReviewItems(rubric);

console.log("--- Scoring ---");
console.log("domScore   :", domScore, "(favicon 10; no-checks dom -> 0)");
console.log("behavior   :", behaviorScore);
console.log("visualScore:", visualScore);
console.log("total      :", score.total, "/ maxTotal", score.maxTotal, "=> normalized", score.normalized + "%");
console.log("manualReviewItems:", manual);
console.log("");

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

check("V-21: no-checks DOM item earns 0 (domScore === 10)", domScore === 10);
check("V-21: no-checks DOM item flagged for manual review", manual.length === 1);
check("V-07: total is single-counted (10+10+15 === 35)", score.total === 35);
check("V-30: maxTotal === sum of weights (55)", score.maxTotal === computeMaxScore(rubric) && score.maxTotal === 55);
check("V-30: normalized === round(35/55*100) === 63.64", score.normalized === 63.64);

console.log("");
console.log(failures === 0 ? "All scoring assertions PASS." : `${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
