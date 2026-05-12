// src/evaluators/python/services/repoService.js

import path from "path";
import { execSync } from "child_process";
import fs from "fs";

const TEMP_DIR = path.join(process.cwd(), "temp");

export async function cloneRepo(repoUrl) {

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const repoName = `repo_${Date.now()}`;

  const repoPath = path.join(
    TEMP_DIR,
    repoName
  );

  execSync(`git clone ${repoUrl} ${repoPath}`);

  return repoPath;
}