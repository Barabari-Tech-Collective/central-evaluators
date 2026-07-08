// Source-code-based checks — the capability the evaluator was missing
// entirely before. Everything else in this evaluator judges a rendered page
// (DOM structure, a click, a screenshot); nothing ever looked at the actual
// source files the clone already has on disk. That's what made "Code
// quality", "uses Date() correctly", "uses setInterval() correctly" etc. look
// unscorable — they aren't unscorable, they just need the source, not a
// screenshot.
import fs from "fs/promises";
import OpenAI from "openai";
import { clampScore } from "./scoring.js";

// V-42-style lazy init: don't crash the server at boot over a missing key.
let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// Cap total source size sent anywhere (GPT prompt, memory) — plenty for a
// student assignment, guards against an unexpectedly huge repo.
const MAX_SOURCE_CHARS = 40000;

/** Concatenate the student's HTML/CSS/JS source into one labeled string. */
export async function readSourceText(student) {
  const files = [student.html, ...(student.css || []), ...(student.js || [])].filter(Boolean);

  let combined = "";
  for (const file of files) {
    if (combined.length >= MAX_SOURCE_CHARS) break;
    try {
      const content = await fs.readFile(file, "utf8");
      const label = file.replace(student.basePath, "").replace(/\\/g, "/");
      const remaining = MAX_SOURCE_CHARS - combined.length;
      combined += `\n\n=== ${label} ===\n${content.slice(0, remaining)}`;
    } catch {
      // Unreadable (binary, permissions, symlink loop, ...) — skip it rather
      // than fail the whole job over one file.
    }
  }
  return combined.trim();
}

// Confirmed live (2026-07-08): "files linked correctly" was being checked by
// substring-matching the literal filename ("index.html", "styles.css") the
// rubric parser guessed against the WHOLE concatenated source — nonsensical,
// since index.html doesn't reference its own filename, and a student who
// named their stylesheet "style.css" would fail regardless of whether it was
// actually linked correctly. What "linked correctly" really means is: does
// the HTML contain a real <link rel="stylesheet" href="*.css"> and a real
// <script src="*.js">, independent of the exact filename chosen.
function isFileLinked(sourceText, target) {
  if (target === "css") {
    const linkTags = sourceText.match(/<link\b[^>]*>/gi) || [];
    return linkTags.some(tag => /rel\s*=\s*["']?stylesheet["']?/i.test(tag) && /href\s*=\s*["'][^"']+\.css["']/i.test(tag));
  }
  if (target === "js") {
    const scriptTags = sourceText.match(/<script\b[^>]*>/gi) || [];
    return scriptTags.some(tag => /src\s*=\s*["'][^"']+\.js["']/i.test(tag));
  }
  return false;
}

/** Deterministic "does the source contain/match this pattern" check. */
function evaluatePatternCheck(sourceText, check) {
  if (check.kind === "filesLinked") return isFileLinked(sourceText, check.target);
  if (!check.pattern) return false;
  if (check.kind === "regex") {
    try {
      return new RegExp(check.pattern, "i").test(sourceText);
    } catch {
      return false; // a bad regex from the model shouldn't crash the job
    }
  }
  return sourceText.toLowerCase().includes(String(check.pattern).toLowerCase());
}

/** GPT judges one "quality"-type item directly against the real source. */
async function judgeCodeQuality(sourceText, item) {
  const max = Number(item.weight) || 0;
  if (!sourceText) {
    return { awarded: 0, reason: "No readable source files were found in the submission." };
  }

  const prompt = `You are grading source code for exactly this criterion: "${item.description}" (worth up to ${max} points).
Judge ONLY this criterion — indentation, naming, readability, comments, structure, or whatever the criterion specifically asks for. Be strict but fair. Do not judge anything else about the code.

Return STRICT JSON only: { "awarded": <number 0-${max}>, "reason": "<one or two sentences>" }

SOURCE CODE:
${sourceText}`;

  const res = await getOpenAI().chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }]
  });

  try {
    const parsed = JSON.parse(res.choices?.[0]?.message?.content ?? "{}");
    return { awarded: clampScore(parsed.awarded, max), reason: parsed.reason || "" };
  } catch {
    return { awarded: 0, reason: "Could not parse the model's response for this criterion." };
  }
}

/**
 * Score every "code" rubric item against the real source text:
 *   - if any check has kind "quality", the item is judged holistically by
 *     GPT-4o reading the source (for subjective things like code quality);
 *   - otherwise every check is a deterministic contains/regex match against
 *     the source (for objective things like "uses setInterval()"), scored
 *     proportionally like a DOM item.
 * Never silently skipped into "manual" — this is the actual answer to
 * criteria a screenshot/DOM check could never verify.
 */
export async function computeCodeScore(rubric, sourceText) {
  let score = 0;
  const breakdown = [];

  for (const item of rubric) {
    if (item.type !== "code") continue;
    const checks = item.checks || [];
    const max = Number(item.weight) || 0;

    const qualityCheck = checks.find(c => c.kind === "quality");
    if (qualityCheck) {
      const { awarded, reason } = await judgeCodeQuality(sourceText, item);
      score += awarded;
      breakdown.push({ item: item.description, awarded, max, reason });
      continue;
    }

    if (checks.length === 0) {
      breakdown.push({
        item: item.description,
        awarded: 0,
        max,
        reason: "No checks were generated for this criterion."
      });
      continue;
    }

    const results = checks.map(c => ({
      pattern: c.kind === "filesLinked" ? `.${c.target} file is linked via <link>/<script>` : c.pattern,
      label: c.kind === "filesLinked" ? "checked" : "source contains",
      passed: evaluatePatternCheck(sourceText, c)
    }));
    const passedCount = results.filter(r => r.passed).length;
    const awarded = (passedCount / results.length) * max;
    score += awarded;
    breakdown.push({
      item: item.description,
      awarded: Math.round(awarded * 100) / 100,
      max,
      checks: results
    });
  }

  return { score, breakdown };
}
