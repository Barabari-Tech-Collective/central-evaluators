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