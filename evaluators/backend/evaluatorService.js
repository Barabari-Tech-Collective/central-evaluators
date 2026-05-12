import extractSubmission from "./extractService.js";
import createSandbox from "./sandboxService.js";

import detectLanguage from "./utils/detectLanguage.js";

import runJestEvaluation from "./runners/jestRunner.js";
import runPytestEvaluation from "./runners/pytestRunner.js";

import scoreSubmission from "./scoringService.js";
import generateFeedback from "./feedbackService.js";

export async function evaluateBackendProject(payload) {

  // 1. Clone repo
  const extractedPath = await extractSubmission(payload.repoUrl);

  // 2. Sandbox
  const sandbox = await createSandbox(extractedPath);

  // 3. Detect stack
  const language = await detectLanguage(sandbox);

  let testResults;

  // 4. Run tests
  if (language === "python") {
    testResults = await runPytestEvaluation(
      sandbox,
      payload.rubric
    );
  } else {
    testResults = await runJestEvaluation(
      sandbox,
      payload.rubric
    );
  }

  // 5. Score
  const score = await scoreSubmission(
    testResults,
    payload.rubric
  );

  // 6. Feedback
  const feedback = await generateFeedback(
    testResults,
    payload.rubric
  );

  return {
    score,
    feedback,
    testResults
  };
}