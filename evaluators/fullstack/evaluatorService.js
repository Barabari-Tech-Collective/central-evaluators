import extractSubmission from "./extractService.js";
import createSandbox, { destroySandbox } from "./sandboxService.js";
import detectStack from "./utils/detectStack.js";
import { runBackendTests } from "./runners/backendRunner.js";
import { runFrontendTests } from "./runners/frontendRunner.js";
import scoreFullstack from "./scoringService.js";
import { generateFullstackFeedback } from "./feedbackService.js";

export async function evaluateFullstackProject(payload) {
  const { repoUrl, rubric } = payload;

  let sandbox = null;

  try {
    // 1. Clone repo
    const extractedPath = await extractSubmission(repoUrl);

    // 2. Create E2B sandbox and upload project
    sandbox = await createSandbox(extractedPath);

    // 3. Detect backend + frontend stack and layout
    const stack = await detectStack(sandbox);

    console.log(
      `[FullstackEvaluator] Detected stack — backend: ${stack.backend}, frontend: ${stack.frontend}, layout: ${stack.layout}`
    );

    // 4. Run backend API tests
    const backendResults = await runBackendTests(
      sandbox,
      stack.backendRoot,
      rubric
    );

    // 5. Run frontend Playwright tests
    const frontendResults = await runFrontendTests(
      sandbox,
      stack.frontendRoot,
      rubric
    );

    // 6. Score combined
    const scoreResult = scoreFullstack(backendResults, frontendResults, rubric);

    // 7. Generate AI feedback
    const feedback = await generateFullstackFeedback(
      backendResults,
      frontendResults,
      rubric
    );

    return {
      ...scoreResult,
      feedback,
      stack,
    };

  } finally {
    await destroySandbox(sandbox);
  }
}
