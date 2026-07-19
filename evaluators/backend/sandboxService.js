import { Sandbox } from "@e2b/code-interpreter";
import fs from "fs-extra";
import path from "path";

// Author: Arma Sahar
// Bug/edge case: `sandbox.files.uploadDir()` uploaded the cloned repo
// completely unfiltered — a student who accidentally committed
// node_modules (a very common first-project mistake before learning about
// .gitignore) or a Python virtualenv would upload potentially thousands of
// files, wasting E2B time/quota and risking the job timeout before grading
// even starts. `evaluators/react/sandboxService.js` already solves exactly
// this for the React evaluator (IGNORE_DIRS + MAX_FILE_SIZE + symlink
// skip); this mirrors that same pattern rather than importing it directly,
// since that file is under active, separate development in this repo right
// now and this evaluator has different ignore-list needs anyway (it grades
// both Node and Python submissions, so it needs Python's equivalents too).
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next",
  "__pycache__", ".venv", "venv", "env", ".pytest_cache", ".mypy_cache"
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Exported so it can be unit-tested against a fake in-memory sandbox stub
// without needing a real E2B sandbox — see scripts/test-backend-evaluator.mjs.
export async function uploadDirectory(sandbox, localDir, remoteDir) {
  const entries = await fs.readdir(localDir, { withFileTypes: true });

  await sandbox.commands.run(`mkdir -p "${remoteDir}"`);

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) {
      continue;
    }

    // A broken/circular symlink throws on readFile below, which would
    // otherwise abort the whole upload over one bad link.
    if (entry.isSymbolicLink()) {
      console.log(`[sandboxService] Skipping symlink: ${path.join(localDir, entry.name)}`);
      continue;
    }

    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`;

    if (entry.isDirectory()) {
      await uploadDirectory(sandbox, localPath, remotePath);
      continue;
    }

    const stat = await fs.stat(localPath);
    if (stat.size > MAX_FILE_SIZE) {
      console.log(`[sandboxService] Skipping large file (${stat.size} bytes): ${localPath}`);
      continue;
    }

    const buffer = await fs.readFile(localPath);
    await sandbox.files.write(remotePath, buffer);
  }
}

export default async function createSandbox(projectPath) {

  if (!projectPath) {
    throw new Error("projectPath missing");
  }

  const sandbox = await Sandbox.create();

  // If the upload itself throws (e.g. a permission error reading a file),
  // createSandbox() never returns a sandbox reference — evaluatorService.js's
  // `let sandbox;` stays undefined, so its own finally-block cleanup can't
  // destroy something it was never given. Kill it here instead of leaking a
  // live, billed sandbox that nothing will ever clean up.
  try {
    await uploadDirectory(sandbox, projectPath, "/home/user/app");
  } catch (err) {
    await sandbox.kill();
    throw err;
  }

  return sandbox;
}

export async function destroySandbox(sandbox) {

  if (sandbox) {
    await sandbox.kill();
  }
}

export function getProjectPath() {
  return "/home/user/app";
}