/**
 * Regression test for the capabilities added after live-batch testing showed
 * "manual" was being used as a lazy catch-all instead of an actual fallback:
 *   - "code" rubric type: deterministic source-pattern checks + GPT-judged
 *     quality, both scored from real source text (evaluators/visual/codeService.js)
 *   - "matchesNow" DOM condition: a displayed value checked against the real
 *     current date/time (evaluators/visual/domService.js)
 *   - "updatesOverTime" DOM condition relies on real timing (page automation),
 *     so it's covered by the integration test plan, not here.
 *
 * Run: node scripts/test-code-and-temporal-checks.mjs   (exit 0 = fixed)
 */
import { computeCodeScore } from "../evaluators/visual/codeService.js";
import { valueMatchesNow } from "../evaluators/visual/domService.js";
import { clampScore, assembleScore } from "../evaluators/visual/scoring.js";

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

console.log("--- computeCodeScore: deterministic pattern checks ---");
{
  const rubric = [
    { description: "Uses Date() and setInterval()", type: "code", weight: 10, checks: [{ pattern: "new Date(" }, { pattern: "setInterval(" }] },
  ];
  const sourceWithBoth = "function tick() { const d = new Date(); } setInterval(tick, 1000);";
  const sourceWithOne = "function tick() { const d = new Date(); }";

  const full = await computeCodeScore(rubric, sourceWithBoth);
  const half = await computeCodeScore(rubric, sourceWithOne);

  check("both patterns present → full credit (10)", full.score === 10);
  check("one of two patterns present → proportional credit (5)", half.score === 5);
  check("breakdown reports each pattern's pass/fail", half.breakdown[0].checks.some(c => c.pattern === "new Date(" && c.passed) && half.breakdown[0].checks.some(c => c.pattern === "setInterval(" && !c.passed));
}

console.log("");
console.log("--- computeCodeScore: filesLinked (not a literal-filename match) ---");
{
  const rubric = [
    { description: "Files linked correctly", type: "code", weight: 10, checks: [{ kind: "filesLinked", target: "css" }, { kind: "filesLinked", target: "js" }] },
  ];
  // Confirmed live bug: a real, correctly-linked page using a DIFFERENT
  // filename than the rubric's example ("style.css" not "styles.css") used
  // to score 0 under literal-substring matching. It must pass now.
  const properlyLinkedDifferentNames = `<html><head><link rel="stylesheet" href="style.css"></head><body><script src="app.js"></script></body></html>`;
  const notLinked = `<html><head></head><body>plain page, no link/script tags</body></html>`;
  const inlineOnly = `<html><head><style>body{color:red}</style></head><body><script>console.log(1)</script></body></html>`;

  const linked = await computeCodeScore(rubric, properlyLinkedDifferentNames);
  const unlinked = await computeCodeScore(rubric, notLinked);
  const inline = await computeCodeScore(rubric, inlineOnly);

  check("real <link>/<script> tags with DIFFERENT filenames than any example → full credit", linked.score === 10);
  check("no <link>/<script> tags at all → zero credit", unlinked.score === 0);
  check("inline <style>/<script> (no external file) → does not count as linked", inline.score === 0);
}

console.log("");
console.log("--- computeCodeScore: regex kind ---");
{
  const rubric = [
    { description: "Declares a function", type: "code", weight: 5, checks: [{ kind: "regex", pattern: "function\\s+\\w+\\s*\\(" }] },
  ];
  const withFn = await computeCodeScore(rubric, "function toggleFormat() {}");
  const withoutFn = await computeCodeScore(rubric, "const toggleFormat = 1;");
  check("regex pattern match → full credit", withFn.score === 5);
  check("regex pattern no-match → zero credit", withoutFn.score === 0);
}

console.log("");
console.log("--- computeCodeScore: no source files found ---");
{
  const rubric = [{ description: "Code quality", type: "code", weight: 5, checks: [{ kind: "quality" }] }];
  const result = await computeCodeScore(rubric, "");
  check("empty source → 0 awarded, no crash, no API call", result.score === 0 && result.breakdown[0].awarded === 0);
}

console.log("");
console.log("--- valueMatchesNow: date/time correctness against the real clock ---");
{
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const realDate = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const wrongDate = "01/01/2000";
  const realTime24 = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  check("real current date in DD/MM/YYYY format → matches", valueMatchesNow(realDate, "DD/MM/YYYY"));
  check("wrong date → does not match", !valueMatchesNow(wrongDate, "DD/MM/YYYY"));
  check("real current time (24h) → matches", valueMatchesNow(realTime24, "HH:mm"));
  check("garbage text against a format → does not match (no crash)", !valueMatchesNow("not a date", "DD/MM/YYYY"));
  check("no format provided → does not match (fails safe, not silently true)", !valueMatchesNow(realDate, undefined));
}

console.log("");
console.log("--- assembleScore: codeScore is counted exactly once, alongside dom/behavior/visual ---");
{
  const rubric = [
    { description: "dom", type: "dom", weight: 10 },
    { description: "behavior", type: "behavior", weight: 10 },
    { description: "visual", type: "visual", weight: 10 },
    { description: "code", type: "code", weight: 10 },
  ];
  const score = assembleScore({ rubric, domScore: 10, behaviorScore: 10, visualScore: 10, codeScore: 10 });
  check("total includes all four score sources (40)", score.total === 40);
  check("maxTotal reflects all four rubric items (40)", score.maxTotal === 40);
  check("codeScore defaults to 0 when omitted (backward compatible)", assembleScore({ rubric: [{ weight: 10, type: "dom" }], domScore: 5, behaviorScore: 0, visualScore: 0 }).total === 5);
}

console.log("");
console.log("--- clampScore sanity (shared with the visual score clamp) ---");
{
  check("clamps above max", clampScore(999, 10) === 10);
  check("clamps below zero", clampScore(-5, 10) === 0);
}

console.log("");
console.log(failures === 0 ? "All code/temporal-check assertions PASS." : `${failures} assertion(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
