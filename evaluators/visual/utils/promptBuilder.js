// Builds the GPT-4o vision prompt.
//
// V-07/V-10/V-18: the model now scores ONLY the visual rubric items (DOM and
// behavior are graded deterministically elsewhere and added once by the
// orchestrator — no more double counting), and must return strict JSON so the
// score is read from a field rather than scraped from prose with a regex.
//
// `domResults`/`behaviorResults` are accepted for signature compatibility but
// intentionally not fed into the score — they are not the model's job.
export default function buildVisionPrompt(rubric, _domResults, _behaviorResults) {
  const visualItems = rubric.filter(r => r.type === "visual");
  const maxVisual = visualItems.reduce(
    (s, r) => s + (Number(r.weight) || 0),
    0
  );

  let prompt = `You are an expert UI evaluator. The FIRST image is the STUDENT's page; the SECOND image is the EXPECTED reference design.

Score ONLY the VISUAL rubric items below (layout, spacing, colors, typography, overall appearance).
Do NOT score DOM/structure or behavior/interaction items — those are graded separately.
Judge strictly from the two screenshots. Do not guess.

VISUAL rubric items (max ${maxVisual} points total):`;

  if (visualItems.length === 0) {
    prompt += `\n(none — return "visualScore": 0)`;
  } else {
    visualItems.forEach((r, i) => {
      prompt += `\n${i + 1}. ${r.description} (weight ${r.weight})`;
    });
  }

  prompt += `

Return STRICT JSON ONLY (no markdown, no prose) in exactly this shape:
{
  "visualScore": <number between 0 and ${maxVisual}>,
  "breakdown": [
    { "item": "<rubric item description>", "awarded": <number>, "max": <number>, "reason": "<short>" }
  ],
  "feedback": "<2-4 sentences of concrete, actionable feedback>"
}`;

  return prompt;
}
