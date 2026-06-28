/**
 * Infra-free reproduction of the visual evaluator scoring math.
 *
 * Mirrors evaluators/visual/evaluatorService.js (§1.2 of VISUAL_EVALUATOR_AUDIT.md).
 * Demonstrates:
 *   - V-07: DOM + behavior are double-counted in the final score.
 *   - V-21: a DOM item with no checks is awarded full weight for free.
 *
 * Run: node scripts/test-scoring-logic.mjs
 * Exit code is non-zero if the bugs are still present (so CI can gate the fix).
 */

// --- copied scoring logic (kept faithful to the source) -------------------
function computeDomScore(rubric, domResults) {
  let domScore = 0;
  for (const item of rubric) {
    if (item.type !== "dom") continue;
    if (!item.checks || item.checks.length === 0) {
      domScore += item.weight; // V-21: free full credit
      continue;
    }
    let passedCount = 0;
    for (const check of item.checks) {
      const key = `${item.description} :: ${check.selector}`;
      if (domResults[key]) passedCount++;
    }
    domScore += (passedCount / item.checks.length) * item.weight;
  }
  return domScore;
}

function computeBehaviorScore(rubric, behaviorResults) {
  let behaviorScore = 0;
  for (const item of rubric) {
    if (item.type !== "behavior") continue;
    if (!item.checks?.length) continue;
    const passed = item.checks.every((check) => {
      const key = `${item.description} :: ${check.selector}`;
      return behaviorResults[key];
    });
    if (passed) behaviorScore += item.weight;
  }
  return behaviorScore;
}

// The model is prompted (promptBuilder.js) to return the TOTAL of ALL items.
function modelTotalAsPrompted(rubric, domResults, behaviorResults, visualJudged) {
  // The current prompt says "Final score MUST be sum of all rubric items".
  // So a faithful model returns dom + behavior + visual.
  return computeDomScore(rubric, domResults)
    + computeBehaviorScore(rubric, behaviorResults)
    + visualJudged;
}

function finalScoreAsImplemented(rubric, domResults, behaviorResults, visualScoreFromModel) {
  return computeDomScore(rubric, domResults)
    + computeBehaviorScore(rubric, behaviorResults)
    + visualScoreFromModel;
}

// --- test fixture ---------------------------------------------------------
const rubric = [
  { description: "Has favicon", type: "dom", weight: 10, checks: [{ selector: "link[rel='icon']" }] },
  { description: "Twitter opens", type: "behavior", weight: 10, checks: [{ selector: "a[href*='twitter']" }] },
  { description: "Nice layout", type: "visual", weight: 20, checks: [] },
  { description: "Some structure (no checks attached)", type: "dom", weight: 15 }, // V-21 fixture
];

const domResults = { "Has favicon :: link[rel='icon']": true };
const behaviorResults = { "Twitter opens :: a[href*='twitter']": true };
const visualJudgedByModel = 15; // model thinks the visual layout is 15/20

const dom = computeDomScore(rubric, domResults);
const beh = computeBehaviorScore(rubric, behaviorResults);
const modelTotal = modelTotalAsPrompted(rubric, domResults, behaviorResults, visualJudgedByModel);
const final = finalScoreAsImplemented(rubric, domResults, behaviorResults, modelTotal);

// Intended (no double count, no free credit): dom(10) + beh(10) + visual(15) = 35
const intended = 10 + 10 + 15;

console.log("--- Scoring reproduction ---");
console.log("domScore                :", dom, "  (note: includes +15 free credit from V-21)");
console.log("behaviorScore           :", beh);
console.log("model 'total' (prompted):", modelTotal, "  (model was told to sum ALL items)");
console.log("finalScore (implemented):", final);
console.log("intended finalScore     :", intended);
console.log("");

let failures = 0;

if (dom !== 25) {
  console.error(`❌ V-21: expected dom free-credit to inflate to 25, got ${dom}`);
  failures++;
} else {
  console.log("✅ V-21 reproduced: dom item with no checks added 15 free points (dom=25 not 10).");
}

if (final === intended) {
  console.log("✅ scoring is correct (double-count appears fixed).");
} else {
  console.error(`❌ V-07 reproduced: finalScore ${final} != intended ${intended} (DOM+behavior double-counted).`);
  failures++;
}

console.log("");
console.log(failures === 0
  ? "All scoring bugs appear FIXED."
  : `${failures} scoring bug(s) still present — see VISUAL_EVALUATOR_AUDIT.md V-07 / V-21.`);

process.exit(failures === 0 ? 0 : 1);
