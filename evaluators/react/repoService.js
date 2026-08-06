import path from 'path';
import fs from 'fs';
import { simpleGit } from 'simple-git';
import { assertSafeUrl, getAllowedGitHosts } from '../visual/utils/urlGuard.js';

const TEMP_DIR = path.join(process.cwd(), 'temp');

// Same fix as evaluators/js/repoService.js (jsBugs.md #5): this used to
// shell out via `execSync(\`git clone ${repoUrl} ${repoPath}\`)`, which lets
// an unescaped repoUrl inject extra shell commands. Cloning through
// simple-git passes the URL as a single argv entry to `git`, never through
// a shell, and assertSafeUrl blocks non-http(s) schemes, private/loopback
// targets, and hosts outside the allowlist.
export async function cloneRepo(repoUrl) {

  if (!repoUrl) {
    throw new Error('repoUrl is required');
  }

  await assertSafeUrl(repoUrl, { allowedHosts: getAllowedGitHosts() });

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const repoName = `repo_${Date.now()}`;
  const repoPath = path.join(TEMP_DIR, repoName);

  await simpleGit().clone(repoUrl, repoPath, ['--depth', '1', '--']);

  return repoPath;
}

export async function deleteRepo(repoPath) {
  try {
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`[REPO CLEANUP ERROR] ${err.message}`);
  }
}
