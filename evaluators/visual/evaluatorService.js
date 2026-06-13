// import { cloneGitRepo } from "./repoService.js";
import { parseRubricWithSelectors } from "./rubricService.js";
import { scanStudentFolders } from "./scannerService.js";
import { runDynamicDomChecks } from "./domService.js";
import runBehaviorChecks from "./behaviourService.js";
import  buildVisionPrompt  from "./utils/promptBuilder.js";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import path from "path";
import OpenAI from "openai";
import { getBrowserPool } from "./browserPool.js";
import {
  startStaticServer
} from "./localServerService.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(
  __dirname,
  "screenshots"
);

const EXPECTED_PATH = path.join(
  SCREENSHOT_DIR,
  "expected.png"
);

// const base_url = process.env.BASE_URL;
export async function evaluateStudentsWithVision({ studentId,
  studentName,
  repoPath,
  rubricText,
  expectedUrl }) {

  if (!repoPath || !rubricText || !expectedUrl) {
    throw new Error("Missing required inputs");
  }

  const rubric = await parseRubricWithSelectors(rubricText);
  console.log("this is the actual rubric", rubric);
  console.log("FULL RUBRIC:", JSON.stringify(rubric, null, 2));
  const student = await scanStudentFolders(repoPath);

  const {
  server,
  url: localUrl
} =
 await startStaticServer(
   student.basePath
 );

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

//   const browser = await chromium.launch({
//   headless: true,
//   args: ['--no-sandbox', '--disable-setuid-sandbox']
// });
//   const context = await browser.newContext();
const browserPool =
  await getBrowserPool();

const browser =
  await browserPool.borrow();

const context =
  await browser.newContext();

  // expected screenshot
  const expectedPage = await context.newPage();
  await expectedPage.goto(expectedUrl);
  await expectedPage.screenshot({ path: EXPECTED_PATH, fullPage: true });
  await expectedPage.close();

  const expectedImg = await fs.readFile(EXPECTED_PATH);

  const results = [];

    const name = studentName;
    // const url = `${base_url}/student/${encodeURIComponent(name)}`;
    const relativeHtml =
student.html
.replace(student.basePath, "")
.replace(/\\/g, "/");

const url =
`${localUrl}${relativeHtml}`;

    if (student.flags.length > 0) {
      results.push({
        name,
        score: 0,
        feedback: `Missing files: ${student.flags.join(', ')}`,
        manualCorrection: true
      });
      // await browser.close();
      await context.close();
      browserPool.return(browser);
      
      return results;
    }

   const page = await context.newPage();

try {
  
  console.log(
  "Opening student url:",
  url
  );

  const responsePage = await page.goto(url, {timeout: 30000});

  console.log(
    "Status:",
    responsePage?.status()
  );

  // await page.goto(url, { timeout: 30000 });

  const screenshotPath = path.join(
    SCREENSHOT_DIR,
    `${name}.png`
  );

  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });

  const domResults =
    await runDynamicDomChecks(page, rubric);

  const behaviorResults =
    await runBehaviorChecks(page, rubric);

  // ---- DOM SCORE ----
  let domScore = 0;

  for (const item of rubric) {
    if (item.type !== "dom") continue;

    if (!item.checks || item.checks.length === 0) {
      domScore += item.weight;
      continue;
    }

    let passedCount = 0;

    for (const check of item.checks) {
      const key =
        `${item.description} :: ${check.selector}`;

      if (domResults[key]) {
        passedCount++;
      }
    }

    domScore +=
      (passedCount / item.checks.length) *
      item.weight;
  }

  // ---- BEHAVIOR SCORE ----
  let behaviorScore = 0;

  for (const item of rubric) {
    if (item.type !== "behavior") continue;

    if (!item.checks?.length) continue;

    const passed = item.checks.every(check => {
      const key =
        `${item.description} :: ${check.selector}`;

      return behaviorResults[key];
    });

    if (passed) {
      behaviorScore += item.weight;
    }
  }

  const studentImage =
    await fs.readFile(screenshotPath);

  const prompt =
    buildVisionPrompt(
      rubric,
      domResults,
      behaviorResults
    );

  const aiRes =
    await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url:
                  `data:image/png;base64,${studentImage.toString("base64")}`
              }
            },
            {
              type: "image_url",
              image_url: {
                url:
                  `data:image/png;base64,${expectedImg.toString("base64")}`
              }
            }
          ]
        }
      ]
    });

  const response =
    aiRes.choices[0].message.content ?? "";

  let visualScore = 0;

  // const aiScoreMatch =
  //   response.match(/(\d+(\.\d+)?)/);

  // if (aiScoreMatch) {
  //   visualScore =
  //     parseFloat(aiScoreMatch[1]);
  // }
  const totalMatch =
  response.match(
    /total\s*score[:\s]+(\d+(\.\d+)?)/i
  );

if (totalMatch) {
  visualScore =
    Number(totalMatch[1]);
}

  const finalScore =
    domScore +
    behaviorScore +
    visualScore;

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

  await page.close()
  .catch(() => {});
  if (server) {
    server.close();
  }
}

// browser cleanup
// await browser.close();
await context.close();
browserPool.return(browser);

await fs.writeFile(
  path.join(
    __dirname,
    "final_scores.json"
  ),
  JSON.stringify(results, null, 2)
);

return results;

}