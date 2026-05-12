import OpenAi from "openai"
export async function parseRubricWithSelectors(text) {

//   const prompt = `
// Convert the following rubric into STRICT JSON.

// Rules:
// - Each item MUST have:
//   - description
//   - weight (number)
//   - type ("visual" | "dom" | "behavior")

// - For "dom":
//   - include checks: [{ selector, condition: "exists" }]

// - For "behavior":
//   - include checks: [{ action: "click", selector, expected }]

// - For "visual":
//   - no checks

// Return ONLY JSON.

// Rubric:
// ${text}
// `;

const prompt = `
Convert the rubric into STRICT JSON.

VERY IMPORTANT CLASSIFICATION RULES:

- "dom" → anything related to:
  HTML structure, tags, inputs, favicon, elements existing

- "behavior" → anything related to:
  click, navigation, hover, interaction

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
{
  "type": "dom",
  "checks": [{ "selector": "link[rel='icon']", "condition": "exists" }]
}

Form →
{
  "type": "dom",
  "checks": [
    { "selector": "form input", "condition": "exists" },
    { "selector": "select", "condition": "exists" },
    { "selector": "textarea", "condition": "exists" }
  ]
}

Twitter click →
{
  "type": "behavior",
  "checks": [
    { "action": "click", "selector": "a[href*='twitter']", "expected": "twitter.com" }
  ]
}

ONLY return JSON.

Rubric:
${text}
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2
  });

  const raw = response.choices[0].message.content.trim();

  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error("Rubric parse failed", err);
    return [];
  }
}

