/**
 * Regression test + feature/bug checklist for the JavaScript evaluator
 * (evaluators/js/*). Exercises the real pieces the worker calls — no
 * Redis/BullMQ needed — grouped by area so the printed output doubles as
 * a readable "what works / what doesn't" report (see jsBugs.md for the
 * full write-up behind each bug number).
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
const summary = []; // { section, name, ok }

function section(title) {
  console.log(`\n## ${title}`);
}

function check(name, cond, detail) {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
  summary.push({ section: currentSection, name, ok: cond });
}

let currentSection = "";
function begin(title) {
  currentSection = title;
  section(title);
}

function writeTempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "js-eval-test-"));
  const file = path.join(dir, "solution.js");
  fs.writeFileSync(file, content);
  return file;
}

// =============================================================================
begin("Basic functions");
// =============================================================================
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
  check("scalar input (single-arg function) grades correctly", result.passed === 2, `passed=${result.passed}`);
}
{
  const file = writeTempFile(`function sum(a, b) { return a + b; }`);
  const result = await evaluateStudent({
    filePath: file,
    evaluationMode: "function",
    entryFunction: "sum",
    testCases: [
      { input: [2, 3], expected: 5 },
      { input: [1, 1], expected: 3 } // intentionally wrong, to check the failure path too
    ]
  });
  check("array input (multi-arg function) grades correctly, incl. a wrong case", result.passed === 1, `passed=${result.passed}`);
}
{
  const file = writeTempFile(`const sum = (a, b) => a + b;`);
  const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [2, 3], expected: 5 }] });
  check("arrow function assigned to const", result.passed === 1, `score=${result.score}`);
}

// =============================================================================
begin("Intermediate JS");
// =============================================================================
{
  const cases = [
    ["destructured params", "function area({w, h}) { return w * h; }", "area", [{ input: [{ w: 3, h: 4 }], expected: 12 }]],
    ["default params + template literals", "function greet(n = 'world') { return `hi ${n}`; }", "greet", [{ input: [], expected: "hi world" }]],
    ["spread/rest args", "function total(...nums) { return nums.reduce((a,b)=>a+b,0); }", "total", [{ input: [1, 2, 3], expected: 6 }]],
    ["class with a method", "class Calc { add(a,b){ return a+b; } } function useCalc(a,b){ return new Calc().add(a,b); }", "useCalc", [{ input: [2, 3], expected: 5 }]],
    ["closures / higher-order functions", "function makeAdder(x) { return (y) => x + y; } function addFive(y) { return makeAdder(5)(y); }", "addFive", [{ input: [10], expected: 15 }]],
    ["array methods (map/filter/reduce)", "function sumEven(arr) { return arr.filter(n=>n%2===0).reduce((a,b)=>a+b,0); }", "sumEven", [{ input: [[1, 2, 3, 4, 5, 6]], expected: 12 }]],
    ["generator functions", "function* gen(n) { for (let i=0;i<n;i++) yield i; } function sumGen(n) { return [...gen(n)].reduce((a,b)=>a+b,0); }", "sumGen", [{ input: [4], expected: 6 }]]
  ];
  for (const [label, code, entryFunction, testCases] of cases) {
    const file = writeTempFile(code);
    const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction, testCases });
    check(label, result.passed === testCases.length, `score=${result.score} issues=${JSON.stringify(result.feedback?.issues)}`);
  }
}

// =============================================================================
begin("Advanced JS: async / Promises / API calls");
// =============================================================================
{
  const asyncCases = [
    ["async/await returning a value", "async function sum(a,b) { return a + b; }"],
    ["async with an internal await delay (setTimeout)", "async function sum(a,b) { await new Promise(r => setTimeout(r, 20)); return a + b; }"],
    ["plain Promise-returning function", "function sum(a,b) { return Promise.resolve(a + b); }"]
  ];
  for (const [label, code] of asyncCases) {
    const file = writeTempFile(code);
    const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [2, 3], expected: 5 }] });
    check(label, result.passed === 1, `score=${result.score} issues=${JSON.stringify(result.feedback?.issues)}`);
  }
}
{
  const file = writeTempFile("async function sum(a,b) { await fetch('https://example.com'); return a + b; }");
  const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [2, 3], expected: 5 }] });
  check(
    "fetch()/API calls: clear 'not available' message (deliberately unsupported — no outbound network from graded code)",
    (result.feedback?.issues || []).some(i => i.includes("fetch() is not available")),
    JSON.stringify(result.feedback?.issues)
  );
}
{
  const rejectFile = writeTempFile("async function sum() { throw new Error('nope'); }");
  const rejectResult = await evaluateStudent({ filePath: rejectFile, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [], expected: 1 }] });
  check("rejected async function surfaces its real error message", (rejectResult.feedback?.issues || []).some(i => i.includes("nope")), JSON.stringify(rejectResult.feedback?.issues));

  const hangFile = writeTempFile("async function sum() { await new Promise(() => {}); return 1; }");
  const start = Date.now();
  const hangResult = await evaluateStudent({ filePath: hangFile, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [], expected: 1 }] });
  const elapsed = Date.now() - start;
  check(
    "a never-resolving async function times out cleanly instead of hanging the worker",
    elapsed < 7000 && (hangResult.feedback?.issues || []).some(i => i.includes("timed out")),
    `elapsed=${elapsed}ms issues=${JSON.stringify(hangResult.feedback?.issues)}`
  );
}

// =============================================================================
begin("Module boilerplate tolerance (CommonJS / ES modules)");
// =============================================================================
{
  const cases = [
    ["module.exports = { sum } (CommonJS named)", "function sum(a, b) { return a + b; }\nmodule.exports = { sum };"],
    ["module.exports = sum (CommonJS default-style)", "function sum(a, b) { return a + b; }\nmodule.exports = sum;"],
    ["export function sum (ES module)", "export function sum(a, b) { return a + b; }"],
    ["export default function sum (ES module)", "export default function sum(a, b) { return a + b; }"],
    ["import + export function (mixed)", "import fs from 'fs';\nexport function sum(a, b) { return a + b; }"]
  ];
  for (const [label, code] of cases) {
    const file = writeTempFile(code);
    const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [2, 3], expected: 5 }] });
    check(label, result.passed === 1, `score=${result.score} issues=${JSON.stringify(result.feedback?.issues)}`);
  }
}
{
  const file = writeTempFile("const fs = require('fs');\nfunction sum(a, b) { return a + b; }");
  const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [2, 3], expected: 5 }] });
  check("require(): clear message, doesn't crash the whole sandbox run", (result.feedback?.issues || []).some(i => i.includes("require() is not available")), JSON.stringify(result.feedback?.issues));
}

// =============================================================================
begin("Error reporting quality (real errors, not confusing crashes)");
// =============================================================================
{
  const file = writeTempFile("function sum(a, b) { return a + ; }");
  const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [2, 3], expected: 5 }] });
  check("a genuine syntax error is still reported (module-stripping doesn't mask real bugs)", result.score === 0 && result.feedback?.[0]?.testCase === "syntax", JSON.stringify(result.feedback));
}
{
  const file = writeTempFile("function sum(a, b) { throw new Error('boom'); }");
  const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [{ input: [2, 3], expected: 5 }] });
  check("a real execution error is surfaced, not 'Expected undefined but got undefined'", (result.feedback?.issues || []).some(i => i.includes("boom")), JSON.stringify(result.feedback?.issues));
}
{
  // Reported live: pasting a flat [{input,expected}] array into "Functions"
  // (missing the {name, testCases} wrapper) crashed the whole job with a
  // raw "fn.testCases is not iterable" instead of a clean message.
  const file = writeTempFile("function validateAge(age) { return age; }");
  const result = await evaluateStudent({
    filePath: file,
    evaluationMode: "multi-function",
    functions: [{ input: 25, expected: "Thank you! Your age is: 25" }]
  });
  check(
    "malformed 'functions' shape (missing name/testCases) fails cleanly, not with a raw crash",
    result.score === 0 && result.feedback?.[0]?.testCase === "validation",
    JSON.stringify(result.feedback)
  );
}
{
  const file = writeTempFile("function sum(a,b) { return a+b; }");
  const result = await evaluateStudent({ filePath: file, evaluationMode: "function", entryFunction: "sum", testCases: [] });
  check("empty testCases array fails cleanly, not with a crash", result.score === 0 && result.feedback?.[0]?.testCase === "validation", JSON.stringify(result.feedback));
}
{
  const file = writeTempFile("function sum(a,b) { return a+b; }");
  const result = await evaluateStudent({ filePath: file, evaluationMode: "script", expectedLogs: undefined });
  check("script mode with missing expectedLogs fails cleanly, not with a crash", result.score === 0 && result.feedback?.[0]?.testCase === "validation", JSON.stringify(result.feedback));
}

// =============================================================================
begin("Multi-function mode");
// =============================================================================
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
  check("well-formed multi-function payload doesn't throw", threw === null, threw?.message);
  check("well-formed multi-function payload scores 2/3 passed", result?.passed === 2 && result?.total === 3, JSON.stringify(result && { passed: result.passed, total: result.total }));
}

// =============================================================================
begin("Script mode (console.log comparison)");
// =============================================================================
{
  const file = writeTempFile("console.log('Hello'); console.log(2 + 2);");
  const result = await evaluateStudent({ filePath: file, evaluationMode: "script", expectedLogs: ["Hello", "4"] });
  check("script mode matches console.log output in order", result.passed === 2 && result.total === 2, JSON.stringify({ passed: result.passed, total: result.total }));
}

// =============================================================================
begin("Scoring & grading");
// =============================================================================
{
  const score = calculateScore({ passed: 0, total: 0, astAnalysis: { syntaxValid: true, functions: [], arrowFunctions: [], variables: [] } });
  check("zero test cases never produces a NaN score", !Number.isNaN(score), `score=${score}`);
}

// =============================================================================
begin("File discovery (fileService.js)");
// =============================================================================
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
  check("skips node_modules/.git, finds the student's real file", found === path.join(root, "src", "solution.js"), `found=${found}`);
  fs.rmSync(root, { recursive: true, force: true });
}

// =============================================================================
begin("Security: repo cloning");
// =============================================================================
{
  const malicious = "https://github.com/x/y.git; touch /tmp/js-evaluator-pwned #";
  let threw = null;
  try {
    await cloneRepo(malicious);
  } catch (err) {
    threw = err;
  }
  const pwnedFileCreated = fs.existsSync("/tmp/js-evaluator-pwned");
  check("malicious repoUrl is rejected before any shell command runs (no command injection)", threw !== null && !pwnedFileCreated, threw?.message);
  if (pwnedFileCreated) fs.rmSync("/tmp/js-evaluator-pwned"); // cleanup if the bug is still present
}

// =============================================================================
begin("AI feedback (Groq)");
// =============================================================================
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
  check("falls back to a real string (not undefined) when the API call fails", feedback === "AI feedback unavailable.", `feedback=${JSON.stringify(feedback)}`);
}

// =============================================================================
// Final checklist
// =============================================================================
console.log("\n\n========================= CHECKLIST =========================");
let lastSection = null;
for (const s of summary) {
  if (s.section !== lastSection) {
    console.log(`\n${s.section}`);
    lastSection = s.section;
  }
  console.log(`  ${s.ok ? "✅" : "❌"} ${s.name}`);
}
console.log("===============================================================");
console.log(failures === 0 ? `\nAll ${summary.length} checks passed.` : `\n${failures}/${summary.length} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
