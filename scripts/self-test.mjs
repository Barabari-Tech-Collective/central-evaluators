/**
 * Self-contained end-to-end test of the visual evaluator on assignments we author.
 *
 * Creates a "reference" (correct) site + 4 student variants, then runs each
 * through the REAL evaluator services (scanner, static server, browser pool,
 * DOM checks, behavior checks, scoring, V-40 blank detection, missing-files
 * path). Only the two gpt-4o calls are stubbed (no API key):
 *   - rubric parse  -> the RUBRIC constant below (hand-authored)
 *   - vision score  -> STUB_VISUAL per student (clearly labelled)
 *
 * Run: node scripts/self-test.mjs
 */
import fs from "fs/promises";
import os from "os";
import path from "path";

import { scanStudentFolders } from "../evaluators/visual/scannerService.js";
import { startStaticServer } from "../evaluators/visual/localServerService.js";
import { getBrowserPool } from "../evaluators/visual/browserPool.js";
import { runDynamicDomChecks } from "../evaluators/visual/domService.js";
import runBehaviorChecks from "../evaluators/visual/behaviourService.js";
import {
  computeDomScore,
  computeBehaviorScore,
  manualReviewItems,
  assembleScore
} from "../evaluators/visual/scoring.js";

const OUT = path.join(process.cwd(), "manual-test-output", "self-test");
const VIEWPORT = { width: 1200, height: 820 };
const log = (...a) => console.log(...a);
const hr = () => log("─".repeat(72));

// ---- The rubric (hand-authored; stands in for the gpt-4o rubric parser) ----
const RUBRIC = [
  { description: "Task input present", type: "dom", weight: 20, checks: [{ selector: "#taskInput", condition: "exists" }] },
  { description: "Add button present", type: "dom", weight: 20, checks: [{ selector: "#addBtn", condition: "exists" }] },
  { description: "Task list present", type: "dom", weight: 20, checks: [{ selector: "#taskList", condition: "exists" }] },
  { description: "Nav link goes to About page", type: "behavior", weight: 20, checks: [{ action: "click", selector: "#nav", expected: "about.html" }] },
  { description: "Centered card styling", type: "visual", weight: 20, checks: [] }
];

// ---- Assignment source files ----
const STYLE = `body{font-family:system-ui;background:#eef;display:flex;justify-content:center;padding:40px}
.card{background:#fff;padding:24px;border-radius:12px;box-shadow:0 6px 24px #0002;width:360px}
h1{margin:0 0 12px}input{padding:8px;width:70%}button{padding:8px 14px}`;

const GOOD_APP = `const b=document.getElementById('addBtn'),i=document.getElementById('taskInput'),l=document.getElementById('taskList');
b.addEventListener('click',()=>{if(!i.value.trim())return;const li=document.createElement('li');li.textContent=i.value;l.appendChild(li);i.value='';});`;

const ABOUT = `<!doctype html><html><head><meta charset=utf-8><title>About</title></head><body><h1>About this app</h1></body></html>`;

const ASSIGNMENTS = {
  // The ideal / correct version (used as the reference)
  reference: {
    "index.html": `<!doctype html><html><head><meta charset=utf-8><title>To-Do</title><link rel=stylesheet href=style.css></head>
<body><div class="card"><h1>My To-Do List</h1>
<input id="taskInput" placeholder="Add a task"/><button id="addBtn">Add</button>
<ul id="taskList"></ul><a id="nav" href="about.html">About</a></div><script src="app.js"></script></body></html>`,
    "style.css": STYLE, "app.js": GOOD_APP, "about.html": ABOUT
  },
  // A strong student: everything present, styled, works
  student_good: {
    "index.html": `<!doctype html><html><head><meta charset=utf-8><title>To-Do</title><link rel=stylesheet href=style.css></head>
<body><div class="card"><h1>My To-Do List</h1>
<input id="taskInput" placeholder="Add a task"/><button id="addBtn">Add</button>
<ul id="taskList"></ul><a id="nav" href="about.html">About</a></div><script src="app.js"></script></body></html>`,
    "style.css": STYLE, "app.js": GOOD_APP, "about.html": ABOUT
  },
  // A weak student: no Add button, no nav link, no styling — but renders text
  student_broken: {
    "index.html": `<!doctype html><html><head><meta charset=utf-8><title>To-Do</title></head>
<body><h1>todo</h1><input id="taskInput"/><ul id="taskList"></ul></body></html>`,
    "style.css": "body{}"
  },
  // An unbuilt-React-style shell: renders blank (should be FLAGGED by V-40)
  student_blank: {
    "index.html": `<!doctype html><html><head><meta charset=utf-8><title>App</title></head>
<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
    "style.css": "body{}"
  },
  // A non-submission: no HTML at all (should be FLAGGED as missing files)
  student_missing: { "notes.txt": "forgot to add my files" }
};

async function writeAssignment(root, name, files) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  for (const [f, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, f), content);
  }
  return dir;
}

async function screenshot(page, name) {
  const p = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return path.relative(process.cwd(), p);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ce-selftest-"));
  log("Workspace:", root);

  // materialize all assignments
  const dirs = {};
  for (const [name, files] of Object.entries(ASSIGNMENTS)) dirs[name] = await writeAssignment(root, name, files);

  const pool = await getBrowserPool(2);
  const browser = await pool.borrow();
  const context = await browser.newContext({ viewport: VIEWPORT });

  try {
    // ---- Reference screenshot (local, so we skip the SSRF guard here) ----
    const refSrv = await startStaticServer(dirs.reference);
    const refPage = await context.newPage();
    await refPage.goto(`${refSrv.url}/index.html`, { waitUntil: "networkidle", timeout: 15000 });
    log("\nReference captured:", await screenshot(refPage, "reference"));
    await refPage.close();
    refSrv.server.close();

    // ---- Evaluate each student the way the shipped orchestrator does ----
    for (const name of ["student_good", "student_broken", "student_blank", "student_missing"]) {
      hr(); log("STUDENT:", name);
      const student = await scanStudentFolders(dirs[name]);

      // Missing-files path (as in evaluateStudentsWithVision)
      if (student.flags.length > 0) {
        log(`  flags: ${student.flags.join(", ")}`);
        log(`  → RESULT score=0  manualCorrection=true  ("Missing files: ${student.flags.join(", ")}")`);
        continue;
      }

      const srv = await startStaticServer(student.basePath);
      const page = await context.newPage();
      const rel = student.html.replace(student.basePath, "").replace(/\\/g, "/");
      const resp = await page.goto(`${srv.url}${rel}`, { waitUntil: "networkidle", timeout: 15000 }).catch(() => null);
      await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
      const shotRel = await screenshot(page, name);

      // V-40 blank / error detection
      const httpStatus = resp?.status() ?? 0;
      const bodyText = (await page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "")) || "";
      const blank = bodyText.trim().length < 3;
      log(`  entry: ${path.relative(dirs[name], student.html)} | http ${httpStatus} | visible text ${bodyText.trim().length} chars | shot ${shotRel}`);

      const domResults = await runDynamicDomChecks(page, RUBRIC);
      const behaviorResults = await runBehaviorChecks(page, RUBRIC);
      const domScore = computeDomScore(RUBRIC, domResults);
      const behaviorScore = computeBehaviorScore(RUBRIC, behaviorResults);

      if (blank || httpStatus >= 400) {
        log(`  → RESULT (V-40): manualCorrection=true  (${blank ? "blank page" : "HTTP " + httpStatus}); vision SKIPPED`);
        await page.close(); srv.server.close(); continue;
      }

      // per-check detail
      for (const [k, v] of Object.entries(domResults)) log(`    DOM  ${v ? "PASS" : "FAIL"}  ${k.split(" :: ")[0]}`);
      for (const [k, v] of Object.entries(behaviorResults)) log(`    BEH  ${v ? "PASS" : "FAIL"}  ${k.split(" :: ")[0]}`);

      const STUB_VISUAL = name === "student_good" ? 18 : 6; // [STUB gpt-4o vision]
      const score = assembleScore({ rubric: RUBRIC, domScore, behaviorScore, visualScore: STUB_VISUAL });
      log(`  → SCORE  dom ${domScore} + behavior ${behaviorScore} + visual ${STUB_VISUAL}[stub] = ${score.total}/${score.maxTotal}  (${score.normalized}%)`);
      log(`     manualReview: ${JSON.stringify(manualReviewItems(RUBRIC))}`);

      await page.close();
      srv.server.close();
    }
  } finally {
    await context.close().catch(() => {});
    pool.return(browser);
    await pool.close().catch(() => {});
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    hr(); log("cleanup done");
  }
}

main().then(() => process.exit(0)).catch(e => { console.error("FATAL:", e); process.exit(1); });
