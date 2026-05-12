export default function buildVisionPrompt(rubric, domResults, behaviorResults) {

  // let prompt = `
// You are an expert evaluator.
// STRICT RULES:
// - DOM → use DOM results only
// - Behavior → use Behavior results only
// - Visual → use screenshots only

// DO NOT GUESS.

// Rubric:
// `;

//   rubric.forEach((r, i) => {
//     prompt += `\n${i + 1}. ${r.description} (${r.weight}) [${r.type}]`;
//   });

//   prompt += `\n\nDOM Results:`;
//   for (const [k, v] of Object.entries(domResults)) {
//     prompt += `\n- ${k}: ${v ? 'PASS' : 'FAIL'}`;
//   }

//   prompt += `\n\nBehavior Results:`;
//   for (const [k, v] of Object.entries(behaviorResults)) {
//     prompt += `\n- ${k}: ${v ? 'PASS' : 'FAIL'}`;
//   }

//   prompt += `\n\nGive:
// - Total score ONLY for visual items
// - ONLY give score for visual items.
// - Do NOT include DOM or behavior in total.
// - Breakdown
// - Feedback
// `;
let prompt = `
You are an expert evaluator.

STRICT RULES:
- DOM → use ONLY DOM results
- Behavior → use ONLY Behavior results
- Visual → use screenshots

DO NOT GUESS ANYTHING.

Rubric:
`;

  rubric.forEach((r, i) => {
    prompt += `\n${i + 1}. ${r.description} (${r.weight}) [${r.type}]`;
  });

  prompt += `\n\nDOM Results:`;
  for (const [k, v] of Object.entries(domResults)) {
    prompt += `\n- ${k}: ${v ? 'PASS' : 'FAIL'}`;
  }

  prompt += `\n\nBehavior Results:`;
  for (const [k, v] of Object.entries(behaviorResults)) {
    prompt += `\n- ${k}: ${v ? 'PASS' : 'FAIL'}`;
  }

  prompt += `\n\nIMPORTANT:
- Give FULL evaluation (visual + dom + behavior)
- Final score MUST be sum of all rubric items
- Show breakdown per rubric item

Return:
- Total score out of full marks
- Breakdown (each item)
- Feedback
`;

  return prompt;
}
