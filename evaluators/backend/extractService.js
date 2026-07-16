import path from "path";
import os from "os";
import fs from "fs-extra";
import crypto from "crypto";
import simpleGit from "simple-git";
import { assertSafeUrl, getAllowedGitHosts } from "../visual/utils/urlGuard.js";

const TMP_ROOT = path.join(os.tmpdir(), "backend-evaluator");

await fs.ensureDir(TMP_ROOT);

export default async function extractSubmission(repoUrl) {

  if (!repoUrl) {
    throw new Error("Repository URL is required");
  }

  // Bug (backendBugs.md #7): unlike the visual/JS evaluators, `repoUrl` here
  // went straight into `git clone` with no SSRF/allowlist check — a
  // submission could point at an internal host, a loopback/metadata address,
  // or (without a `--` terminator) an argument that git interprets as a
  // flag instead of a URL. Same guard the visual and JS evaluators use.
  await assertSafeUrl(repoUrl, { allowedHosts: getAllowedGitHosts() });

  const folderName =
    `submission-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  const targetPath = path.join(TMP_ROOT, folderName);

  await fs.ensureDir(targetPath);

  const git = simpleGit();

  try {

    await git.clone(repoUrl, targetPath, [
      "--depth",
      "1",
      "--"
    ]);

    return targetPath;

  } catch (err) {

    await fs.remove(targetPath);

    throw new Error(
      `Failed to clone repository: ${err.message}`
    );
  }
}