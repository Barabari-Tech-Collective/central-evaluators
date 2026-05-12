// import extractSubmission from "./extractService";
import { cloneRepo } from "./repoService";
import runPlaywrightTests from "./playwrightTests";
import scoreSubmission from "./scoringService";
import {createSandbox} from "./sandboxService";


export async function evaluateReactProject(payload) {

  const repoPath = await cloneRepo(payload.repoUrl)

 
  const sandbox = await createSandbox(repoPath);

  const testResults = await runPlaywrightTests(sandbox);

  const score = await scoreSubmission(
    testResults,
    payload.rubric
  );

  return score;
}