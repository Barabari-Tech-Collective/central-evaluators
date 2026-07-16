// Author: Arma Sahar
//
// Strips ES module syntax (import/export) out of student code before it's
// analyzed or executed.
//
// Why this exists: the sandbox (executionService.js) runs code as a plain
// CommonJS-less script via vm2 — there's no real module loader, so
// `import`/`export` can't execute even if the syntax were allowed. Acorn
// also rejects `import`/`export` under the default `sourceType: "script"`.
// Since a huge share of "basic function" student templates use
// `export function foo() {}` or `export default function foo() {}`
// (common ES-module course boilerplate), leaving this unhandled meant a
// perfectly correct function failed 100% of its test cases on syntax alone.
//
// Approach: parse once as `sourceType: "module"` (which accepts both plain
// statements and import/export), then surgically remove/rewrite just the
// import/export wrapper text using acorn's exact character offsets — the
// function/const/class body itself is left byte-for-byte untouched.
import * as acorn from "acorn";

export function stripModuleSyntax(code) {
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
  } catch {
    // Not parseable as a module either — leave as-is and let the normal
    // script-mode parse (astService.js) surface the real syntax error.
    return code;
  }

  const edits = [];
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration") {
      // No real module resolution in the sandbox — drop entirely.
      edits.push({ start: node.start, end: node.end, replacement: "" });
    } else if (node.type === "ExportNamedDeclaration") {
      if (node.declaration) {
        // `export function foo(){}` / `export const x = 1;` -> drop "export "
        edits.push({ start: node.start, end: node.declaration.start, replacement: "" });
      } else {
        // `export { a, b };` — the bindings already exist locally, just drop the list.
        edits.push({ start: node.start, end: node.end, replacement: "" });
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration;
      const isNamedFnOrClass =
        (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id;
      if (isNamedFnOrClass) {
        // `export default function foo(){}` -> `function foo(){}`
        edits.push({ start: node.start, end: decl.start, replacement: "" });
      } else {
        // Anonymous default export (`export default function(){}`,
        // `export default 42`, `export default sum`) has no name to grade
        // by — keep it runnable (not a SyntaxError) by binding it to a
        // synthetic global instead of silently dropping it.
        edits.push({ start: node.start, end: decl.start, replacement: "var __defaultExport__ = " });
      }
    }
  }

  if (!edits.length) return code;

  edits.sort((a, b) => b.start - a.start); // back-to-front so earlier offsets stay valid
  let out = code;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}
