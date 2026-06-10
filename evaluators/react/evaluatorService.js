import { cloneRepo } from "./repoService.js";
import runTests from "./playwrightService.js";
import scoreSubmission from "./scoringService.js";

export async function evaluateReactProject(
  payload
) {

  const repoPath =
    await cloneRepo(payload.repoUrl);

  const testResults =
    await runTests(repoPath);

  return await scoreSubmission(
    testResults,
    payload.rubric,
    repoPath
  );
}