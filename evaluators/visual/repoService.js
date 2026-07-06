import fs from 'fs/promises';
import path from 'path';
import { simpleGit } from 'simple-git';
import { assertSafeUrl, getAllowedGitHosts } from './utils/urlGuard.js';

export async function cloneGitRepo(gitUrl) {
  // V-02/V-03: validate the URL (scheme, allowlist, no private targets) BEFORE
  // touching git, and clone with an args array via simple-git — no shell, so the
  // URL can never be interpreted as a command.
  await assertSafeUrl(gitUrl, { allowedHosts: getAllowedGitHosts() });

  const repoName =
    `visual_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

  const tempDir = path.join(process.cwd(), 'temp');
  const repoPath = path.join(tempDir, repoName);

  await fs.mkdir(tempDir, { recursive: true });

  if (await fs.stat(repoPath).catch(() => false)) {
    await fs.rm(repoPath, {
      recursive: true,
      force: true
    });
  }

  // --depth 1 (shallow) keeps clones small/fast. `--` ends option parsing so a
  // hostile URL can't smuggle flags (e.g. --upload-pack).
  await simpleGit().clone(gitUrl, repoPath, ['--depth', '1', '--']);

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