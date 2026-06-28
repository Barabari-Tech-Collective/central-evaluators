/**
 * Infra-free reproduction of the rubric-parse fragility (V-09).
 *
 * Mirrors the parse path in evaluators/visual/rubricService.js:
 *   JSON.parse(raw.replace(/```json|```/g, '').trim())   // returns [] on throw
 * and the downstream assumption in evaluatorService.js:
 *   for (const item of rubric) { ... }                   // needs an ARRAY
 *
 * gpt-4o frequently wraps results in an object ({ "rubric": [...] }) or emits
 * prose around the JSON. This script shows how those shapes silently produce
 * an empty rubric (whole cohort scored 0) or a non-iterable (job fails ×3).
 *
 * Run: node scripts/test-rubric-fallback.mjs
 */

function parseLikeService(raw) {
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (err) {
    return []; // <-- silent fallback, same as the source
  }
}

function isUsableRubric(parsed) {
  // evaluatorService iterates with `for...of`; only a non-empty array works.
  return Array.isArray(parsed) && parsed.length > 0;
}

const cases = [
  {
    name: "ideal array (works)",
    raw: '[{"description":"favicon","type":"dom","weight":10,"checks":[{"selector":"link[rel=\'icon\']","condition":"exists"}]}]',
  },
  {
    name: "fenced array (works after strip)",
    raw: '```json\n[{"description":"x","type":"visual","weight":20,"checks":[]}]\n```',
  },
  {
    name: "object-wrapped (V-09: non-array → cohort silently 0)",
    raw: '{"rubric":[{"description":"x","type":"visual","weight":20,"checks":[]}]}',
  },
  {
    name: "prose around JSON (V-09: parse throws → [])",
    raw: 'Sure! Here is the JSON:\n[{"description":"x","type":"dom","weight":10,"checks":[]}]',
  },
  {
    name: "trailing comma (V-09: parse throws → [])",
    raw: '[{"description":"x","type":"dom","weight":10,},]',
  },
];

let silentFailures = 0;
console.log("--- Rubric parse reproduction ---\n");
for (const c of cases) {
  const parsed = parseLikeService(c.raw);
  const usable = isUsableRubric(parsed);
  const shape = Array.isArray(parsed) ? `array(${parsed.length})` : typeof parsed;
  console.log(`${usable ? "✅" : "❌"} ${c.name}`);
  console.log(`    parsed shape: ${shape}, usable: ${usable}`);
  if (!usable) {
    silentFailures++;
    console.log("    → downstream: empty/non-iterable rubric ⇒ student(s) scored 0 with no signal.\n");
  } else {
    console.log("");
  }
}

console.log(
  silentFailures === 0
    ? "All rubric shapes parse into a usable array — V-09 appears FIXED."
    : `${silentFailures}/${cases.length} realistic model outputs silently fail — V-09 present. ` +
      "Fix with response_format:json_object + schema validation + flag-don't-zero."
);

process.exit(silentFailures === 0 ? 0 : 1);
