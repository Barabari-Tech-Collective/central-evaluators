import fs from "fs-extra";

import extractSubmission from "./extractService.js";
import createSandbox, { destroySandbox, getProjectPath } from "./sandboxService.js";

import detectLanguage from "./utils/detectLanguage.js";

import runJestEvaluation from "./runners/jestRunner.js";
import runPytestEvaluation from "./runners/pytestRunner.js";

import { evaluateResults } from "./scoringService.js";
import getAiFeedback from "./feedbackService.js";

export async function evaluateBackendProject(payload) {

  if (!payload.rubric || !Array.isArray(payload.rubric.criteria) || payload.rubric.criteria.length === 0) {
    throw new Error("payload.rubric.criteria must be a non-empty array");
  }

  // 1. Clone repo
  const extractedPath = await extractSubmission(payload.repoUrl);

  let sandbox;

  try {
    // 2. Sandbox
    // Bug (backendBugs.md #4): the sandbox created here was never destroyed
    // — every run (success or failure) leaked a live E2B sandbox that kept
    // billing/consuming quota indefinitely. Everything below now runs inside
    // this try so destroySandbox() always fires, mirroring how the
    // fullstack evaluator (evaluators/fullstack/evaluatorService.js) does it.
    sandbox = await createSandbox(extractedPath);

    // 3. Detect stack
    const language = await detectLanguage(sandbox);
    const projectPath = getProjectPath();

    let testResults;

    // 4. Run tests
    // Bug (backendBugs.md #1): these calls used to omit `projectPath`
    // entirely — `runJestEvaluation(sandbox, projectPath, rubric)` was
    // invoked as `runJestEvaluation(sandbox, payload.rubric)`, so the
    // rubric object was passed positionally as `projectPath` (interpolated
    // into shell commands as "[object Object]") and `rubric` inside the
    // runner was `undefined`.
    if (language === "python") {
      testResults = await runPytestEvaluation(
        sandbox,
        projectPath,
        payload.rubric
      );
    } else {
      testResults = await runJestEvaluation(
        sandbox,
        projectPath,
        payload.rubric
      );
    }

    // 5. Score
    // Bug (backendBugs.md #1): scoringService.evaluateResults has the
    // signature (rubric, testResults) — this call passed them in the
    // opposite order, so `rubric.criteria` read from the test-results object
    // (always empty) and every submission scored 0/0.
    const score = evaluateResults(
      payload.rubric,
      testResults
    );

    // 6. Feedback
    // Bug (backendBugs.md #1): feedbackService.getAiFeedback expects an
    // array of individual test results (it calls `.filter()` on it), but
    // this passed the whole `testResults` object, throwing
    // `TypeError: testDetails.filter is not a function` on every run that
    // reached this line.
    const feedback = await getAiFeedback(
      testResults.test_details,
      payload.rubric
    );

    return {
      score,
      feedback,
      testResults
    };

  } finally {
    // Bug (backendBugs.md #4): the cloned repo under os.tmpdir() was only
    // ever removed on a clone *failure* (see extractService.js's catch
    // block) — every successful run leaked its checkout on the host disk.
    await destroySandbox(sandbox);
    await fs.remove(extractedPath);
  }
}