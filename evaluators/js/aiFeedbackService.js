import Groq from "groq-sdk";

const groq =
  new Groq({
    apiKey:
      process.env.GROQ_API_KEY
  });

export async function generateAIFeedback({
  score,
  passed,
  total,
  failures,
  astAnalysis
}) {

  try {

    const prompt = `
You are a senior JavaScript mentor.

Student Score:
${score}/100

Passed:
${passed}/${total}

AST Analysis:
${JSON.stringify(astAnalysis)}

Failures:
${JSON.stringify(failures)}

Generate feedback.

Mention:

1. strengths
2. weaknesses
3. concepts to revise
4. next steps

Maximum 120 words.
`;

    const completion =
      await groq.chat.completions.create({

        model:
          "llama-3.3-70b-versatile",

        messages: [
          {
            role: "user",
            content: prompt
          }
        ],

        temperature: 0.3
      });

    return completion
      .choices[0]
      .message.content;

  } catch (err) {
      console.error(
    "[AI FEEDBACK ERROR]",
    err
  );
  console.log("error from ai service", err);
    return
      "AI feedback unavailable.";
  }
}