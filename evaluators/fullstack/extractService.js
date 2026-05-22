import path from "path";
import os from "os";
import fs from "fs-extra";
import crypto from "crypto";
import simpleGit from "simple-git";

const TMP_ROOT = path.join(os.tmpdir(), "fullstack-evaluator");

await fs.ensureDir(TMP_ROOT);

export default async function extractSubmission(repoUrl) {

  if (!repoUrl) {
    throw new Error("Repository URL is required");
  }

  const folderName =
    `submission-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const targetPath = path.join(TMP_ROOT, folderName);

  await fs.ensureDir(targetPath);

  const git = simpleGit();

  try {

    await git.clone(repoUrl, targetPath, ["--depth", "1"]);

    return targetPath;

  } catch (err) {

    await fs.remove(targetPath);

    throw new Error(`Failed to clone repository: ${err.message}`);
  }
}
