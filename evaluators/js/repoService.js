import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

const TEMP_DIR = path.join(process.cwd(), 'temp');

export async function cloneRepo(repoUrl) {

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const repoName = `repo_${Date.now()}`;
  const repoPath = path.join(TEMP_DIR, repoName);

  if (!repoUrl) {
  throw new Error('repoUrl is required');
  }

  execSync(`git clone ${repoUrl} ${repoPath}`,
     {
    stdio: 'pipe'
  }
  );

  return repoPath;
}