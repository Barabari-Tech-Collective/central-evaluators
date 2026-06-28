/* Drives the running UI (localhost:3000) and captures screenshots for review. */
import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";

const OUT = path.join(process.cwd(), "manual-test-output");
const BASE = process.env.UI_BASE || "http://localhost:3000";

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 980 } });

const shot = async name => { await page.screenshot({ path: path.join(OUT, name) }); console.log("saved", name); };

// 1) Landing — visual evaluator selected by default
await page.goto(BASE, { waitUntil: "networkidle" });
await shot("ui-1-visual.png");

// 2) Switch to JavaScript — shows a different schema-driven form
await page.click('.pick[data-type="javascript"]');
await page.waitForTimeout(200);
await shot("ui-2-javascript.png");

// 3) Validation: click Evaluate with empty required fields
await page.click("#evaluateBtn");
await page.waitForSelector("#formError:not(.hidden)");
await shot("ui-3-validation.png");

// 4) Friendly SERVER error: visual + reachable expectedUrl + disallowed repo host
await page.click('.pick[data-type="visual"]');
await page.waitForTimeout(200);
await page.evaluate(() => localStorage.setItem("ce_api_key", "testkey"));
await page.fill('input[name="expectedUrl"]', "https://github.com/");
await page.fill('textarea[name="rubricText"]', "1. Page has a title\n2. Centered card layout");
await page.fill('input[name="sub_repoUrl"]', "https://evil.example.com/repo.git");
await page.fill('input[name="sub_studentName"]', "Test Student");
await page.click("#evaluateBtn");
// wait for either a friendly error card or banner
await page.waitForFunction(() => {
  const r = document.querySelector("#results");
  return r && /isn't allowed|Technical details|allowlist|safety/i.test(r.textContent);
}, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(500);
await page.locator("#resultsPanel").scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
await shot("ui-4-friendly-error.png");

await browser.close();
console.log("done");
