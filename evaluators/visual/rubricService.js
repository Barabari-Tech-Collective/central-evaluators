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

- "dom" → HTML structure, tags, inputs, favicon, elements existing
- "behavior" → click, navigation, hover, interaction
- "visual" → layout, design, styling, appearance

- Each item must have:
  description (string)
  weight (number)
  type ("dom" | "behavior" | "visual")

- DOM:
  checks = [{ "selector": "...", "condition": "exists" }]

- BEHAVIOR:
  checks = [{ "action": "click", "selector": "...", "expected": "twitter.com" }]

- VISUAL:
  checks = []

EXAMPLES:

Favicon →
{ "type": "dom", "description": "Has a favicon", "weight": 5,
  "checks": [{ "selector": "link[rel='icon']", "condition": "exists" }] }

Twitter click →
{ "type": "behavior", "description": "Twitter link opens twitter.com", "weight": 5,
  "checks": [{ "action": "click", "selector": "a[href*='twitter']", "expected": "twitter.com" }] }

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
