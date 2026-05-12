import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

const STUDENT_DIR = path.join(process.cwd(), 'temp', 'visual_students');

export async function cloneGitRepo(gitUrl) {

  if (!gitUrl) {
    throw new Error('repoUrl is required');
  }

  if (await fs.stat(STUDENT_DIR).catch(() => false)) {
    await fs.rm(STUDENT_DIR, { recursive: true });
  }

  await execPromise(`git clone ${gitUrl} ${STUDENT_DIR}`);

  return STUDENT_DIR;
}