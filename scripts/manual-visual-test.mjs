/**
 * Transparent, step-by-step run of the REAL visual-evaluator services on a real
 * submission — for learning + verifying the audit fixes.
 *
 * It runs every real stage EXCEPT the two OpenAI calls (no API key available):
 *   - rubric parsing (gpt-4o)      -> replaced with a hand-authored rubric [STUB]
 *   - vision scoring (gpt-4o)      -> replaced with a fixed visualScore     [STUB]
 *
 * Everything else is the production code path: clone (V-02/V-03), scan (V-20),
 * static server (V-36), browser pool (V-12/V-15), viewport (V-23), networkidle
 * + fonts (V-24), DOM checks (V-22), scoring (V-07/V-21/V-30), and full cleanup
 * (V-05/V-06/V-25).
 *
 * Usage: node scripts/manual-visual-test.mjs <repoUrl> <expectedUrl>
 */
import fs from "fs/promises";
import path from "path";

import { cloneGitRepo, deleteRepo } from "../evaluators/visual/repoService.js";
import { scanStudentFolders } from "../evaluators/visual/scannerService.js";
import { startStaticServer } from "../evaluators/visual/localServerService.js";
import { getBrowserPool } from "../evaluators/visual/browserPool.js";
import { runDynamicDomChecks } from "../evaluators/visual/domService.js";
import {
  computeDomScore,
  computeBehaviorScore,
  manualReviewItems,
  assembleScore
} from "../evaluators/visual/scoring.js";
import { assertSafeUrl } from "../evaluators/visual/utils/urlGuard.js";

// ---- Inputs ----
const REPO_URL = process.argv[2] || "https://github.com/myfamilyf238-design/Reactunit3";
const EXPECTED_URL = process.argv[3] || "https://todotasks001.netlify.app/";
const VIEWPORT = { width: 1366, height: 900 };
const OUT_DIR = path.join(process.cwd(), "manual-test-output");

// [STUB] Stand-in for the gpt-4o rubric parser. Hand-authored to the SUBSET a
// static/DOM evaluator can actually observe (the rubric names these selectors).
const RUBRIC = [
  { description: "Task input field (#taskInput)", type: "dom", weight: 5,
    checks: [{ selector: "#taskInput, input[type='text'], input:not([type])", condition: "exists" }] },
  { description: "Add button (#addTaskBtn)", type: "dom", weight: 5,
    checks: [{ selector: "#addTaskBtn, button", condition: "exists" }] },
  { description: "Task list container (#taskList)", type: "dom", weight: 5,
    checks: [{ selector: "#taskList, ul, ol", condition: "exists" }] },
  { description: "Filter controls (all/active/completed)", type: "dom", weight: 5,
    checks: [{ selector: "[data-filter], .filter, button", condition: "exists" }] },
  { description: "Clean, styled, centered layout", type: "visual", weight: 5, checks: [] }
];
const STUB_VISUAL_SCORE = 4; // [STUB] what the vision model would return (0..5)

const log = (...a) => console.log(...a);
const hr = () => log("─".repeat(72));

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  hr(); log("STEP 0 · Inputs");
  log("  repoUrl    :", REPO_URL);
  log("  expectedUrl:", EXPECTED_URL);
  log("  rubric     : [STUB] 5 items (4 dom, 1 visual) standing in for gpt-4o parse");

  let repoPath = null, server = null, browser = null, context = null, browserPool = null;

  try {
    hr(); log("STEP 1 · Clone repo  (real cloneGitRepo: simple-git, --depth 1, URL-guarded)");
    const t0 = Date.now();
    repoPath = await cloneGitRepo(REPO_URL);
    log(`  ✓ cloned to ${repoPath}  (${Date.now() - t0}ms)`);

    hr(); log("STEP 2 · Scan for HTML/CSS  (real scanStudentFolders)");
    const student = await scanStudentFolders(repoPath);
    log("  entry html :", student.html ? path.relative(repoPath, student.html) : "(none)");
    log("  css files  :", student.css.length);
    log("  flags      :", student.flags.length ? student.flags.join(", ") : "(none)");

    if (student.flags.length > 0) {
      log("\n  ⚠ Missing required files — real evaluator returns score 0 + manualCorrection.");
    }

    hr(); log("STEP 3 · Serve the repo locally  (real startStaticServer, 127.0.0.1)");
    const started = await startStaticServer(student.basePath);
    server = started.server;
    log("  serving at :", started.url);

    hr(); log("STEP 4 · Browser pool  (real getBrowserPool, no --single-process)");
    browserPool = await getBrowserPool(2);
    browser = await browserPool.borrow();
    context = await browser.newContext({ viewport: VIEWPORT }); // V-23
    log("  pool stats :", JSON.stringify(browserPool.getStats()));

    hr(); log("STEP 5 · Screenshot the REFERENCE (hosted) site");
    await assertSafeUrl(EXPECTED_URL);
    const refPage = await context.newPage();
    await refPage.goto(EXPECTED_URL, { waitUntil: "networkidle", timeout: 30000 });
    await refPage.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    const refTitle = await refPage.title();
    const refFinalUrl = refPage.url();
    const refPath = path.join(OUT_DIR, "reference.png");
    await refPage.screenshot({ path: refPath, fullPage: false });
    await refPage.close();
    log(`  ✓ title="${refTitle}"  finalUrl=${refFinalUrl}`);
    log(`    saved ${path.relative(process.cwd(), refPath)}`);

    hr(); log("STEP 6 · Screenshot the STUDENT submission (served statically)");
    const relativeHtml = student.html.replace(student.basePath, "").replace(/\\/g, "/");
    const studentUrl = `${started.url}${relativeHtml}`;
    log("  student url:", studentUrl);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
    const resp = await page.goto(studentUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(e => { log("  goto error:", e.message); return null; });
    await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
    const bodyText = (await page.evaluate(() => document.body && document.body.innerText).catch(() => "")) || "";
    const stuPath = path.join(OUT_DIR, "student.png");
    await page.screenshot({ path: stuPath, fullPage: false });
    log(`  http status: ${resp?.status()}`);
    log(`  visible text length: ${bodyText.trim().length} chars  ${bodyText.trim().length === 0 ? "← BLANK" : "← renders"}`);
    if (consoleErrors.length) log("  browser console errors:", consoleErrors.slice(0, 3));
    log(`  ✓ saved ${path.relative(process.cwd(), stuPath)}`);

    hr(); log("STEP 7 · DOM checks against the student page  (real runDynamicDomChecks)");
    const domResults = await runDynamicDomChecks(page, RUBRIC);
    for (const [k, v] of Object.entries(domResults)) log(`  ${v ? "PASS" : "FAIL"}  ${k}`);

    hr(); log("STEP 7.1 · V-40 verdict  (the decision the SHIPPED evaluator now makes)");
    const httpStatus = resp?.status() ?? 0;
    const blank = bodyText.trim().length < 3;
    const badStatus = httpStatus >= 400;
    if (blank || badStatus) {
      log(`  → FLAG manualCorrection=true  (${blank ? "page rendered blank" : "HTTP " + httpStatus}); vision call SKIPPED.`);
      log("    (Before V-40 this was silently scored; now it's routed to a human.)");
    } else {
      log("  → page has content → would proceed to gpt-4o vision scoring.");
    }

    hr(); log("STEP 7.5 · Functional smoke  [EXTRA — not in shipped visual evaluator; this is what the react evaluator does properly]");
    try {
      const input = await page.$("#taskInput, input[type='text'], input:not([type])");
      const btn = await page.$("#addTaskBtn, button");
      if (input && btn) {
        const before = await page.$$eval("#taskList, ul, ol", els => (els[0]?.children.length ?? 0)).catch(() => 0);
        await input.fill("Buy milk (eval smoke test)");
        await btn.click();
        await page.waitForTimeout(400);
        const after = await page.$$eval("#taskList, ul, ol", els => (els[0]?.children.length ?? 0)).catch(() => 0);
        const afterPath = path.join(OUT_DIR, "student-after-add.png");
        await page.screenshot({ path: afterPath, fullPage: false });
        log(`  typed a task + clicked Add → list children ${before} → ${after} ${after > before ? "✓ APP IS FUNCTIONAL" : "(no change)"}`);
        log(`    saved ${path.relative(process.cwd(), afterPath)}`);
      } else {
        log("  (skipped: input/button not found)");
      }
    } catch (e) { log("  smoke error:", e.message); }

    await page.close().catch(() => {});

    hr(); log("STEP 8 · Scoring  (real scoring.js; visualScore is the [STUB])");
    const domScore = computeDomScore(RUBRIC, domResults);
    const behaviorScore = computeBehaviorScore(RUBRIC, {});
    const score = assembleScore({ rubric: RUBRIC, domScore, behaviorScore, visualScore: STUB_VISUAL_SCORE });
    log("  domScore       :", domScore);
    log("  behaviorScore  :", behaviorScore);
    log("  visualScore    :", STUB_VISUAL_SCORE, "[STUB - would come from gpt-4o vision]");
    log("  total          :", score.total, "/", score.maxTotal, `(normalized ${score.normalized}%)`);
    log("  manualReview   :", manualReviewItems(RUBRIC));
  } finally {
    hr(); log("CLEANUP · release browser, close server, delete clone  (real finally path)");
    if (context) await context.close().catch(() => {});
    if (browser && browserPool) browserPool.return(browser);
    if (server) server.close();
    if (browserPool) await browserPool.close().catch(() => {});
    if (repoPath) { await deleteRepo(repoPath).catch(() => {}); log("  ✓ deleted clone"); }
    log("  ✓ resources released");
    hr();
  }
}

main().then(() => process.exit(0)).catch(e => { console.error("FATAL:", e); process.exit(1); });
