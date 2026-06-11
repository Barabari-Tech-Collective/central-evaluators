import { cloneGitRepo } from "./repoService.js";
import { parseRubricWithSelectors } from "./rubricService.js";
import { scanStudentFolders } from "./scannerService.js";
import { runDynamicDomChecks } from "./domService.js";
import runBehaviorChecks from "./behaviourService.js";
import  buildVisionPrompt  from "./utils/promptBuilder.js";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

export async function evaluateStudentsWithVision({ studentId,
  studentName,
  repoUrl,
  rubricText,
  expectedUrl }) {

  if (!repoUrl || !rubricText || !expectedUrl) {
    throw new Error("Missing required inputs");
  }

  await cloneGitRepo(repoUrl);

  const rubric = await parseRubricWithSelectors(rubricText);
  console.log("this is the actual rubric", rubric);
  console.log("📋 FULL RUBRIC:", JSON.stringify(rubric, null, 2));
  const students = await scanStudentFolders();

  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });

  const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
  const context = await browser.newContext();

  // expected screenshot
  const expectedPage = await context.newPage();
  await expectedPage.goto(expectedUrl);
  await expectedPage.screenshot({ path: EXPECTED_PATH, fullPage: true });
  await expectedPage.close();

  const expectedImg = await fs.readFile(EXPECTED_PATH);

  const results = [];

  for (const student of students) {

    const name = student.name;
    const url = `${base_url}/student/${encodeURIComponent(name)}`;

    if (student.flags.length > 0) {
      results.push({
        name,
        score: 0,
        feedback: `Missing files: ${student.flags.join(', ')}`,
        manualCorrection: true
      });
      continue;
    }

    const page = await context.newPage();

    try {
      await page.goto(url, { timeout: 30000 });

      const screenshotPath = path.join(SCREENSHOT_DIR, `${name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const domResults = await runDynamicDomChecks(page, rubric);
      const behaviorResults = await runBehaviorChecks(page, rubric);

      // DOM SCORE
      let domScore = 0;

for (const item of rubric) {
  if (item.type === "dom") {

    // fallback: if no checks → still give score if detected
    if (!item.checks || item.checks.length === 0) {
      domScore += item.weight;
      continue;
    }

    // const passed = item.checks.every(check => {
    //   const key = `${item.description} :: ${check.selector}`;
    //   return domResults[key];
    // });

    // if (passed) domScore += item.weight;
    let passedCount = 0;

for (const check of item.checks) {
  const key = `${item.description} :: ${check.selector}`;
  if (domResults[key]) passedCount++;
}

const partialScore = (passedCount / item.checks.length) * item.weight;
domScore += partialScore;
  }
}
      // let domScore = 0;
      // for (const item of rubric) {
      //   if (item.type === "dom" && item.checks) {
      //     const passed = item.checks.every(check => {
      //       const key = `${item.description} :: ${check.selector}`;
      //       return domResults[key];
      //     });
      //     if (passed) domScore += item.weight;
      //   }
      // }

      // ✅ BEHAVIOR SCORE
      let behaviorScore = 0;

for (const item of rubric) {
  if (item.type === "behavior") {

    if (!item.checks || item.checks.length === 0) {
      continue;
    }

    const passed = item.checks.every(check => {
      const key = `${item.description} :: ${check.selector}`;
      return behaviorResults[key];
    });

    if (passed) behaviorScore += item.weight;
  }
}
      // let behaviorScore = 0;
      // for (const item of rubric) {
      //   if (item.type === "behavior" && item.checks) {
      //     const passed = item.checks.every(check => {
      //       const key = `${item.description} :: ${check.selector}`;
      //       return behaviorResults[key];
      //     });
      //     if (passed) behaviorScore += item.weight;
      //   }
      // }
   

      const studentImage = await fs.readFile(screenshotPath);

      const prompt = buildVisionPrompt(rubric, domResults, behaviorResults);
      
      const aiRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${studentImage.toString('base64')}` } },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${expectedImg.toString('base64')}` } }
          ]
        }]
      });
      let visualScore = 0;
      
        const response = aiRes.choices[0].message.content;
        const aiScoreMatch = response.match(/(\d+(\.\d+)?)/);
        if(aiScoreMatch){
          visualScore = aiScoreMatch ? parseFloat(aiScoreMatch[1]) : 0;
        }
     
      const finalScore = domScore + behaviorScore + visualScore;
      console.log("finalScore", finalScore);
         console.log({
         domScore,
         behaviorScore,
         visualScore
        });

        console.log("Behaviour Results", behaviorResults);
        console.log("DOM Results", domResults);

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
    }

    await page.close();
  }

  await browser.close();

  await fs.writeFile(
    path.join(__dirname, 'final_scores.json'),
    JSON.stringify(results, null, 2)
  );

  return results;
}