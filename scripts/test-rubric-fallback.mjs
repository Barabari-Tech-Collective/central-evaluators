/**
 * Regression test for rubric parsing/validation (V-09).
 *
 * Imports the REAL pure validator from evaluators/visual/rubricSchema.js and
 * asserts that realistic gpt-4o outputs are EITHER normalized into a usable
 * array OR rejected with a typed RubricParseError — never silently turned into
 * an empty rubric that scores a whole cohort 0.
 *
 * Run: node scripts/test-rubric-fallback.mjs   (exit 0 = fixed)
 */
import { normalizeRubric, RubricParseError } from "../evaluators/visual/rubricSchema.js";

// With response_format:json_object the model returns a parsed JS object/array;
// these fixtures represent the parsed shapes we must handle.
const cases = [
  {
    name: "bare array",
    input: [{ description: "favicon", type: "dom", weight: 10, checks: [] }],
    expect: "array",
  },
  {
    name: "object-wrapped under items (was V-09 silent-0)",
    input: { items: [{ description: "x", type: "visual", weight: 20, checks: [] }] },
    expect: "array",
  },
  {
    name: "object-wrapped under rubric",
    input: { rubric: [{ description: "x", type: "dom", weight: 5, checks: [] }] },
    expect: "array",
  },
  {
    name: "empty array → typed error (flagged, not silent-0)",
    input: [],
    expect: "throw",
  },
  {
    name: "missing weight → typed error",
    input: { items: [{ description: "x", type: "dom" }] },
    expect: "throw",
  },
  {
    name: "invalid type → typed error",
    input: { items: [{ description: "x", type: "color", weight: 5 }] },
    expect: "throw",
  },
  {
    name: "manual type (rare last-resort fallback) → accepted",
    input: { items: [{ description: "Something truly unverifiable", type: "manual", weight: 5, checks: [] }] },
    expect: "array",
  },
  {
    name: "code type with pattern checks (e.g. uses setInterval()) → accepted",
    input: { items: [{ description: "Uses setInterval()", type: "code", weight: 10, checks: [{ pattern: "setInterval(" }] }] },
    expect: "array",
  },
  {
    name: "code type with a quality check → accepted",
    input: { items: [{ description: "Code quality", type: "code", weight: 5, checks: [{ kind: "quality" }] }] },
    expect: "array",
  },
  {
    name: "non-array/non-object → typed error",
    input: "not json",
    expect: "throw",
  },
];

let failures = 0;
console.log("--- Rubric validation ---\n");

for (const c of cases) {
  let outcome, detail;
  try {
    const arr = normalizeRubric(c.input);
    outcome = "array";
    detail = `array(${arr.length})`;
  } catch (err) {
    outcome = err instanceof RubricParseError ? "throw" : "wrong-error";
    detail = `${err.name}: ${err.message}`;
  }

  const ok = outcome === c.expect;
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${c.name}`);
  console.log(`    → ${detail} (expected ${c.expect})\n`);
}

console.log(
  failures === 0
    ? "All rubric shapes are handled (usable array or typed RubricParseError) — V-09 fixed."
    : `${failures} case(s) behaved unexpectedly.`
);
process.exit(failures === 0 ? 0 : 1);
