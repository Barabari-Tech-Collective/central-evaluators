import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// const STUDENT_DIR = path.join(process.cwd(), 'temp', 'visual_students');
const repoName =
  `visual_${Date.now()}`;

const repoPath =
  path.join(
    process.cwd(),
    'temp',
    repoName
  );

export async function cloneGitRepo(gitUrl) {

  if (!gitUrl) {
    throw new Error('repoUrl is required');
  }

  if (await fs.stat(repo_path).catch(() => false)) {
    await fs.rm(repo_path, { recursive: true });
  }

  await execPromise(`git clone ${gitUrl} ${repo_path}`);

  return repo_path;
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