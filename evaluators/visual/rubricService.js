import OpenAI from "openai";
import { RubricParseError, normalizeRubric } from "./rubricSchema.js";

export { RubricParseError, normalizeRubric };

// V-42: lazy init — constructing the client at import time crashes the whole
// server on boot when OPENAI_API_KEY is unset (even for unrelated evaluators).
let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export async function parseRubricWithSelectors(text) {
  const prompt = `
Convert the rubric into STRICT JSON.

VERY IMPORTANT CLASSIFICATION RULES:

- "dom" → HTML structure, tags, inputs, favicon, elements existing in the
  rendered page (a one-time, static existence/attribute/text check).
- "behavior" → a click that NAVIGATES to a new URL or opens a new tab (e.g. a
  link/icon that goes to an external site). This tool can ONLY detect a URL
  change after a click — it CANNOT detect an in-page change (text, a toggled
  class, a counter, a modal) that happens without navigating anywhere.
- "visual" → subjective layout/design/appearance judged from a SCREENSHOT
  (alignment, colors, spacing, typography, responsiveness). Only use this for
  things visibly different between two static images.
- "manual" → anything this tool cannot mechanically verify. Use this for:
    (a) source code quality (indentation, variable names, comments, "clean
        code", algorithmic correctness) — a screenshot/DOM check cannot read
        source files;
    (b) a value that must be observed CHANGING OVER TIME (e.g. "updates every
        second", "a live clock", "a counter that increments") — a single
        snapshot can't confirm it's live;
    (c) an in-page interaction that changes something WITHOUT navigating to a
        new URL (e.g. a toggle button, a format switcher, an accordion, a
        show/hide) — see the "behavior" note above, this tool cannot detect
        in-page state changes, only navigation;
    (d) verifying a displayed value is factually CORRECT (e.g. "shows the
        current date/time accurately") rather than merely present.
  Do NOT force these into "dom"/"behavior"/"visual" — misclassifying them
  produces a false 0 that looks like a bug. Classifying as "manual" is the
  correct, honest answer.

- Each item must have:
  description (string)
  weight (number)
  type ("dom" | "behavior" | "visual" | "manual")

- DOM:
  checks = [{ "selector": "...", "condition": "exists" }]

- BEHAVIOR:
  checks = [{ "action": "click", "selector": "...", "expected": "twitter.com" }]

- VISUAL:
  checks = []

- MANUAL:
  checks = []

EXAMPLES:

Favicon →
{ "type": "dom", "description": "Has a favicon", "weight": 5,
  "checks": [{ "selector": "link[rel='icon']", "condition": "exists" }] }

Twitter click (navigates to an external URL) →
{ "type": "behavior", "description": "Twitter link opens twitter.com", "weight": 5,
  "checks": [{ "action": "click", "selector": "a[href*='twitter']", "expected": "twitter.com" }] }

Code quality (needs source review) →
{ "type": "manual", "description": "Proper indentation, meaningful variable names, readable code", "weight": 5, "checks": [] }

Live-updating value (needs observation over time) →
{ "type": "manual", "description": "Time updates every second using setInterval", "weight": 10, "checks": [] }

In-page toggle (no navigation happens) →
{ "type": "manual", "description": "12/24-hour toggle button switches format correctly", "weight": 15, "checks": [] }

Return a JSON object of the form: { "items": [ ...rubric items... ] }

Rubric:
${text}
`;

  const response = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }]
  });

  const raw = response.choices?.[0]?.message?.content ?? "";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RubricParseError(`Rubric JSON parse failed: ${err.message}`);
  }

  return normalizeRubric(parsed);
}
