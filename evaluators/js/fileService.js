import fs from 'fs';
import path from 'path';
import { analyzeCode } from './astService.js';
import { stripModuleSyntax } from './moduleSyntax.js';

// Author: Arma Sahar
// Bug (jsBugs.md #6): this walked into node_modules/.git and returned
// whichever .js file fs.readdirSync happened to list first (filesystem
// order, not alphabetical) — on a repo with more than one .js file it could
// grade a dependency or git-internal file instead of the student's code.
// Fix: skip node_modules/.git (and any other dotfile directory) and sort
// entries before scanning so the result is deterministic.
const SKIP_DIRS = new Set(['node_modules', '.git']);

function collectJsFiles(rootDir) {
  const files = [];

  function scan(dir) {
    const items = fs.readdirSync(dir).sort();

    for (const item of items) {
      if (SKIP_DIRS.has(item) || item.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, item);

      if (fs.statSync(fullPath).isDirectory()) {
        scan(fullPath);
      } else if (item.endsWith('.js')) {
        files.push(fullPath);
      }
    }
  }

  scan(rootDir);
  return files;
}

// Author: Arma Sahar
// Bug: even after #6's fix made file order deterministic, a repo with more
// than one .js file (a README-style stub, a helper file, a second exercise)
// still always graded whichever file sorted first alphabetically —
// regardless of whether it contained the function actually being graded.
// Confirmed with a real submission: "README.js" sorted before "index.js"
// (where `validateAge` was actually implemented), so every test case failed
// with "validateAge is not defined" even though the function was correct.
// Fix: when the caller tells us which function name(s) we're about to grade
// (`requiredNames` — the entryFunction, or every functions[].name in
// multi-function mode), prefer the first .js file (same deterministic order
// as before) that actually *declares* one of those names as a top-level
// function or variable — reusing the same AST parser (astService.js) and
// export-stripping (moduleSyntax.js) evaluationService.js already grades
// with, so "does this file declare it" matches exactly what's gradable. (A
// plain substring/regex search was tried first, but false-matched a comment
// that just mentioned the function's name without defining it — the AST
// only sees real declarations, not comments or strings.) Falls back to
// "just the first .js file" if none match, or if no names were given at
// all — this keeps script mode (no discrete function name to search for)
// working exactly as it did before.
export function findJavaScriptFile(rootDir, requiredNames = []) {
  const files = collectJsFiles(rootDir);
  if (files.length === 0) return null;

  const names = requiredNames.filter(Boolean);
  if (names.length > 0) {
    const match = files.find(f => {
      const code = stripModuleSyntax(fs.readFileSync(f, 'utf8'));
      const { functions, variables } = analyzeCode(code);
      const declared = new Set([...functions, ...variables]);
      return names.some(name => declared.has(name));
    });
    if (match) {
      console.log(`[FILE SERVICE] Found JS file (declares ${names.join(', ')}): ${match}`);
      return match;
    }
    console.log(`[FILE SERVICE] No .js file declares ${names.join(', ')} — falling back to first file found: ${files[0]}`);
  }

  console.log(`[FILE SERVICE] Found JS file: ${files[0]}`);
  return files[0];
}