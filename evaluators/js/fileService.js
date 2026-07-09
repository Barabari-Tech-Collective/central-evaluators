import fs from 'fs';
import path from 'path';

// Author: Arma Sahar
// Bug (jsBugs.md #6): this walked into node_modules/.git and returned
// whichever .js file fs.readdirSync happened to list first (filesystem
// order, not alphabetical) — on a repo with more than one .js file it could
// grade a dependency or git-internal file instead of the student's code.
// Fix: skip node_modules/.git (and any other dotfile directory) and sort
// entries before scanning so the result is deterministic.
const SKIP_DIRS = new Set(['node_modules', '.git']);

export function findJavaScriptFile(rootDir) {

  function scan(dir) {

    const items = fs.readdirSync(dir).sort();

    for (const item of items) {

      if (SKIP_DIRS.has(item) || item.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, item);

      if (fs.statSync(fullPath).isDirectory()) {

        const result = scan(fullPath);

        if (result) {
          return result;
        }

      } else if (item.endsWith('.js')) {

        console.log(
          `[FILE SERVICE] Found JS file: ${fullPath}`
        );

        return fullPath;
      }
    }

    return null;
  }

  return scan(rootDir);
}