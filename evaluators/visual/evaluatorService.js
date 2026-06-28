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
import fs from "fs/promises";
import os from "os";
import path from "path";
import OpenAI from "openai";
import { getBrowserPool } from "./browserPool.js";
import { startStaticServer } from "./localServerService.js";

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
    const expectedPath = path.join(workDir, "expected.png");
    const expectedPage = await context.newPage();
    await expectedPage.goto(expectedUrl, { timeout: 30000 });
    await expectedPage.screenshot({ path: expectedPath, fullPage: true });
    await expectedPage.close();
    const expectedImg = await fs.readFile(expectedPath);

    const relativeHtml = student.html
      .replace(student.basePath, "")
      .replace(/\\/g, "/");
    const url = `${localUrl}${relativeHtml}`;

    const page = await context.newPage();
    try {
      const responsePage = await page.goto(url, { timeout: 30000 });
      console.log("Opening student url:", url, "status:", responsePage?.status());

      const screenshotPath = path.join(workDir, `${studentId || name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const domResults = await runDynamicDomChecks(page, rubric);
      const behaviorResults = await runBehaviorChecks(page, rubric);

      // ---- DOM SCORE ----  (logic unchanged here; fixed in Batch 3)
      let domScore = 0;
      for (const item of rubric) {
        if (item.type !== "dom") continue;
        if (!item.checks || item.checks.length === 0) {
          domScore += item.weight;
          continue;
        }
        let passedCount = 0;
        for (const check of item.checks) {
          const key = `${item.description} :: ${check.selector}`;
          if (domResults[key]) passedCount++;
        }
        domScore += (passedCount / item.checks.length) * item.weight;
      }

      // ---- BEHAVIOR SCORE ----
      let behaviorScore = 0;
      for (const item of rubric) {
        if (item.type !== "behavior") continue;
        if (!item.checks?.length) continue;
        const passed = item.checks.every(check => {
          const key = `${item.description} :: ${check.selector}`;
          return behaviorResults[key];
        });
        if (passed) behaviorScore += item.weight;
      }

      const studentImage = await fs.readFile(screenshotPath);
      const prompt = buildVisionPrompt(rubric, domResults, behaviorResults);

      const aiRes = await openai.chat.completions.create({
        model: "gpt-4o",
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

      const response = aiRes.choices[0].message.content ?? "";

      let visualScore = 0;
      const totalMatch = response.match(/total\s*score[:\s]+(\d+(\.\d+)?)/i);
      if (totalMatch) visualScore = Number(totalMatch[1]);

      const finalScore = domScore + behaviorScore + visualScore;

      results.push({
        name,
        score: finalScore,
        feedback: response,
        manualCorrection: false
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
