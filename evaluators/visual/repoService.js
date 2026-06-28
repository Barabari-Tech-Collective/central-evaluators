import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

export async function cloneGitRepo(gitUrl) {

  const repoName =
    `visual_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const repoPath =
    path.join(
      process.cwd(),
      'temp',
      repoName
    );

  if (await fs.stat(repoPath).catch(() => false)) {
    await fs.rm(repoPath, {
      recursive: true,
      force: true
    });
  }

  await execPromise(
    `git clone ${gitUrl} ${repoPath}`
  );

  return repoPath;
}

export async function deleteRepo(
  repoPath
) {
  await fs.rm(
    repoPath,
    {
      recursive: true,
      force: true
    }
  );
}

/**
 * Remove clone dirs orphaned by a crash (V-25).
 * Deletes entries under <cwd>/temp older than `maxAgeMs` (default 2h).
 * Best-effort: never throws.
 */
export async function sweepStaleRepos(maxAgeMs = 2 * 60 * 60 * 1000) {
  const tempDir = path.join(process.cwd(), 'temp');
  let entries;
  try {
    entries = await fs.readdir(tempDir);
  } catch {
    return; // no temp dir yet
  }
  const now = Date.now();
  for (const entry of entries) {
    const full = path.join(tempDir, entry);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.rm(full, { recursive: true, force: true });
      }
    } catch {
      /* ignore individual failures */
    }
  }
}