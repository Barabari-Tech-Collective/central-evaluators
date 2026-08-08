import { cloneRepo, deleteRepo } from "./repoService.js";
import runTests from "./playwrightService.js";
import scoreSubmission from "./scoringService.js";

export async function evaluateReactProject(
  payload
) {

  const repoPath =
    await cloneRepo(payload.repoUrl);

  try {
    const testResults =
      await runTests(repoPath);

    return await scoreSubmission(
      testResults,
      payload.rubric,
      repoPath
    );
  } finally {
    await deleteRepo(repoPath);
  }
}