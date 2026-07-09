/**
 * Regression test for the JavaScript evaluator (evaluators/js/*).
 *
 * Exercises the real pieces the worker calls — no Redis/BullMQ needed —
 * and asserts the bugs logged in jsBugs.md stay fixed:
 *   - #1/#2: multi-function mode no longer throws / scores correctly.
 *   - #3:    function mode works for both scalar and array `input`.
 *   - #4:    AI feedback falls back to a real string (not undefined) on error.
 *   - #5:    a malicious repoUrl is rejected before any shell command runs.
 *   - #6:    the JS file scanner skips node_modules/.git and finds the
 *            student's real file.
 *   - #7:    zero test cases never produces a NaN score.
 *
 * Run: node scripts/test-js-evaluator.mjs   (exit 0 = all fixed)
 */
import fs from "fs";
import os from "os";
import path from "path";

import { evaluateStudent } from "../evaluators/js/evaluationService.js";
import { calculateScore } from "../evaluators/js/gradingService.js";
import { findJavaScriptFile } from "../evaluators/js/fileService.js";
import { cloneRepo } from "../evaluators/js/repoService.js";

let failures = 0;
function check(name, cond, detail) {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

function writeTempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "js-eval-test-"));
  const file = path.join(dir, "solution.js");
  fs.writeFileSync(file, content);
  return file;
}

// ---------------------------------------------------------------------------
// #3 — function mode: scalar input (repo's own config/testCases.js shape)
// ---------------------------------------------------------------------------
{
  const file = writeTempFile(`
    function isPrime(n) {
      if (n < 2) return false;
      for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
      return true;
    }
  `);
  const result = await evaluateStudent({
    filePath: file,
    evaluationMode: "function",
    entryFunction: "isPrime",
    testCases: [
      { input: 2, expected: true },
      { input: 4, expected: false }
    ]
  });
  check(
    "function mode: scalar input doesn't crash",
    typeof result.score === "number" && !Number.isNaN(result.score),
    `score=${result.score}`
  );
  check("function mode: scalar input scores 2/2 tests passed", result.passed === 2);
}

// ---------------------------------------------------------------------------
// #3 — function mode: array input (multi-arg functions)
// ---------------------------------------------------------------------------
{
  const file = writeTempFile(`function sum(a, b) { return a + b; }`);
  const result = await evaluateStudent({
    filePath: file,
    evaluationMode: "function",
    entryFunction: "sum",
    testCases: [
      { input: [2, 3], expected: 5 },
      { input: [1, 1], expected: 3 } // intentionally wrong to check failure path too
    ]
  });
  check("function mode: array input passes the correct case", result.passed === 1, `passed=${result.passed}`);
}

// ---------------------------------------------------------------------------
// #1/#2 — multi-function mode must not throw and must score correctly
// ---------------------------------------------------------------------------
{
  const file = writeTempFile(`
    function add(a, b) { return a + b; }
    function double(n) { return n * 2; }
  `);
  let result;
  let threw = null;
  try {
    result = await evaluateStudent({
      filePath: file,
      evaluationMode: "multi-function",
      functions: [
        { name: "add", testCases: [{ input: [2, 3], expected: 5 }] },
        { name: "double", testCases: [{ input: [4], expected: 8 }, { input: [5], expected: 999 }] }
      ]
    });
  } catch (err) {
    threw = err;
  }
  check("multi-function mode: does not throw ReferenceError", threw === null, threw?.message);
  check("multi-function mode: scores 2/3 passed", result?.passed === 2 && result?.total === 3, JSON.stringify(result && { passed: result.passed, total: result.total }));
}

// ---------------------------------------------------------------------------
// #7 — gradingService must not produce NaN when total is 0
// ---------------------------------------------------------------------------
{
  const score = calculateScore({
    passed: 0,
    total: 0,
    astAnalysis: { syntaxValid: true, functions: [], arrowFunctions: [], variables: [] }
  });
  check("gradingService: total=0 does not produce NaN", !Number.isNaN(score), `score=${score}`);
}

// ---------------------------------------------------------------------------
// #6 — file scanner should skip node_modules/.git and find the real file
// ---------------------------------------------------------------------------
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "js-eval-repo-"));
  fs.mkdirSync(path.join(root, "node_modules", "some-dep"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "some-dep", "index.js"), "// dependency, not the student's code");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "hooks.js"), "// git internals");
  fs.writeFileSync(path.join(root, "webpack.config.js"), "module.exports = {};");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "solution.js"), "function sum(a,b){return a+b;}");

  const found = findJavaScriptFile(root);
  check(
    "fileService: skips node_modules/.git/config files, finds src/solution.js",
    found === path.join(root, "src", "solution.js"),
    `found=${found}`
  );
  fs.rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// #5 — a malicious repoUrl must be rejected before any shell command runs
// ---------------------------------------------------------------------------
{
  const malicious = "https://github.com/x/y.git; touch /tmp/js-evaluator-pwned #";
  let threw = null;
  try {
    await cloneRepo(malicious);
  } catch (err) {
    threw = err;
  }
  const pwnedFileCreated = fs.existsSync("/tmp/js-evaluator-pwned");
  check("repoService: malicious repoUrl is rejected, not shell-executed", threw !== null && !pwnedFileCreated, threw?.message);
  if (pwnedFileCreated) fs.rmSync("/tmp/js-evaluator-pwned"); // cleanup if the bug is still present
}

// ---------------------------------------------------------------------------
// #4 — AI feedback must fall back to a real string, never undefined, on error
// ---------------------------------------------------------------------------
{
  process.env.GROQ_API_KEY = "sk-invalid-test-key-does-not-exist";
  const { generateAIFeedback } = await import("../evaluators/js/aiFeedbackService.js");
  const feedback = await generateAIFeedback({
    score: 50,
    passed: 1,
    total: 2,
    failures: [],
    astAnalysis: { syntaxValid: true, functions: [], arrowFunctions: [], variables: [] }
  });
  check(
    "aiFeedbackService: returns fallback string (not undefined) on API error",
    feedback === "AI feedback unavailable.",
    `feedback=${JSON.stringify(feedback)}`
  );
}

console.log("");
console.log(failures === 0 ? "All checks passed." : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
