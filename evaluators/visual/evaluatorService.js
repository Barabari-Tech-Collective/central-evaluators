// Visual evaluator orchestrator.
//
// Batch 2 (this commit): resource lifecycle is now leak-proof.
//   - V-05/V-06: every browser/context/server is released in a single `finally`,
//     even when the reference screenshot or navigation throws.
//   - V-16/V-25: all artifacts (screenshots) live in a per-job temp dir that is
//     deleted in `finally`; nothing is written into the source tree anymore
//     (the old `final_scores.json` write is gone — results are returned instead).
//
// Scoring / rubric / vision correctness is addressed in Batch 3.
import { parseRubricWithSelectors } from "./rubricService.js";
import { scanStudentFolders } from "./scannerService.js";
import { runDynamicDomChecks } from "./domService.js";
import runBehaviorChecks from "./behaviourService.js";
import buildVisionPrompt from "./utils/promptBuilder.js";
import {
  computeDomScore,
  computeBehaviorScore,
  manualReviewItems,
  assembleScore
} from "./scoring.js";
import fs from "fs/promises";
import os from "os";
import path from "path";
import OpenAI from "openai";
import { getBrowserPool } from "./browserPool.js";
import { startStaticServer } from "./localServerService.js";
import { assertSafeUrl } from "./utils/urlGuard.js";
import logger from "../../config/logger.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function evaluateStudentsWithVision({
  jobId,
  studentId,
  studentName,
  repoPath,
  rubricText,
  expectedUrl
}) {
  if (!repoPath || !rubricText || !expectedUrl) {
    throw new Error("Missing required inputs");
  }

  const rubric = await parseRubricWithSelectors(rubricText);
  const student = await scanStudentFolders(repoPath);

  const results = [];
  const name = studentName;

  // Missing required files: bail out BEFORE spinning up a server/browser (V-06).
  if (student.flags.length > 0) {
    results.push({
      name,
      score: 0,
      feedback: `Missing files: ${student.flags.join(", ")}`,
      manualCorrection: true
    });
    return results;
  }

  // Per-job artifact dir (V-16/V-25) — unique, outside the source tree, always cleaned up.
  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `visual-${jobId || studentId || "job"}-`)
  );

  const browserPool = await getBrowserPool();
  let browser = null;
  let context = null;
  let server = null;

  try {
    const started = await startStaticServer(student.basePath);
    server = started.server;
    const localUrl = started.url;

    browser = await browserPool.borrow();
    context = await browser.newContext();

    // ---- Reference (expected) screenshot ----
    // V-03: re-validate right before navigating (defense in depth vs DNS rebinding).
    await assertSafeUrl(expectedUrl);

    const expectedPath = path.join(workDir, "expected.png");
    const expectedPage = await context.newPage();
    await expectedPage.goto(expectedUrl, { timeout: 30000 });
    // V-26: fullPage:false caps the screenshot to the viewport — a pathological
    // student/reference page can't blow memory with a 50k-px-tall capture.
    await expectedPage.screenshot({ path: expectedPath, fullPage: false });
    await expectedPage.close();
    const expectedImg = await fs.readFile(expectedPath);

    const relativeHtml = student.html
      .replace(student.basePath, "")
      .replace(/\\/g, "/");
    const url = `${localUrl}${relativeHtml}`;

    const page = await context.newPage();
    try {
      const responsePage = await page.goto(url, { timeout: 30000 });
      logger.debug(`Opening student url: ${url} status: ${responsePage?.status()}`);

      const screenshotPath = path.join(workDir, `${studentId || name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false }); // V-26

      const domResults = await runDynamicDomChecks(page, rubric);
      const behaviorResults = await runBehaviorChecks(page, rubric);

      // Deterministic, single-counted scores (V-07/V-21).
      const domScore = computeDomScore(rubric, domResults);
      const behaviorScore = computeBehaviorScore(rubric, behaviorResults);

      const studentImage = await fs.readFile(screenshotPath);
      const prompt = buildVisionPrompt(rubric, domResults, behaviorResults);

      // Deterministic vision call returning strict JSON (V-10/V-18).
      const aiRes = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${studentImage.toString("base64")}`
                }
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${expectedImg.toString("base64")}`
                }
              }
            ]
          }
        ]
      });

      const raw = aiRes.choices?.[0]?.message?.content ?? "{}";
      let visualScore = 0;
      let visionFeedback = raw;
      try {
        const parsed = JSON.parse(raw);
        visualScore = Number(parsed.visualScore) || 0;
        visionFeedback = parsed;
      } catch {
        // keep raw text as feedback; visualScore stays 0
      }

      const score = assembleScore({ rubric, domScore, behaviorScore, visualScore });
      const needsManual = manualReviewItems(rubric);

      results.push({
        name,
        studentId,
        score: score.total, // backwards-compatible field
        ...score, // domScore, behaviorScore, visualScore, total, maxTotal, normalized
        manualReviewItems: needsManual,
        feedback: visionFeedback,
        manualCorrection: needsManual.length > 0
      });
    } catch (err) {
      results.push({
        name,
        score: 0,
        error: err.message,
        manualCorrection: true
      });
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    // Unconditional resource release (V-05/V-06/V-25)
    if (context) await context.close().catch(() => {});
    if (browser) browserPool.return(browser);
    if (server) server.close();
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  return results;
}
