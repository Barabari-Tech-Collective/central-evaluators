import fs from "fs";
import path from "path";
import { Sandbox } from "@e2b/code-interpreter";

const IGNORE_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next"
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Recursively uploads a local project directory
 * into the E2B sandbox.
 */
async function uploadDirectory(
  sandbox,
  localDir,
  remoteDir
) {

  const entries = await fs.promises.readdir(
    localDir,
    { withFileTypes: true }
  );

  await sandbox.commands.run(
    `mkdir -p "${remoteDir}"`
  );

  for (const entry of entries) {

    // Skip heavy folders
    if (
      entry.isDirectory() &&
      IGNORE_DIRS.includes(entry.name)
    ) {
      continue;
    }

    const localPath = path.join(
      localDir,
      entry.name
    );

    const remotePath =
      `${remoteDir}/${entry.name}`;

    if (entry.isDirectory()) {

      await uploadDirectory(
        sandbox,
        localPath,
        remotePath
      );

      continue;
    }

    const stat =
      await fs.promises.stat(localPath);

    // Skip very large files
    if (stat.size > MAX_FILE_SIZE) {
      console.log(
        `Skipping large file: ${localPath}`
      );
      continue;
    }

    const buffer =
      await fs.promises.readFile(localPath);

    await sandbox.files.write(
      remotePath,
      buffer
    );
  }
}

/**
 * Creates an E2B sandbox and uploads
 * the cloned repository into it.
 *
 * @param {string} projectPath
 */
export async function spinTestEnvironment(
  projectPath
) {

  const sandbox =
    await Sandbox.create();

  try {

    await uploadDirectory(
      sandbox,
      projectPath,
      "/home/user/app"
    );

    const hostUrl =
      await sandbox.getHost(3000);

    const findCmd =
      await sandbox.commands.run(
        "find /home/user/app -maxdepth 3 -name 'package.json' | head -n 1"
      );

    let projectDir =
      "/home/user/app";

    if (
      findCmd.exitCode === 0 &&
      findCmd.stdout.trim()
    ) {

      projectDir =
        findCmd.stdout
          .trim()
          .replace(
            /\/package\.json$/,
            ""
          );

      console.log(
        "Detected project directory:",
        projectDir
      );
    }

    return {
      sandbox,
      appUrl: `https://${hostUrl}`,
      projectDir
    };

  } catch (err) {

    try {
      await sandbox.kill();
    } catch {}

    throw err;
  }
}

/**
 * Execute command inside sandbox.
 */
export async function execCommand(
  sandbox,
  command,
  cwd = "/home/user/app"
) {

  const result =
    await sandbox.commands.run(
      command,
      {
        cwd,
        timeout: 300000
      }
    );

  if (
    result.exitCode !== 0
  ) {

    throw new Error(
      result.stderr ||
      result.stdout ||
      "Command failed"
    );
  }

  return [
    result.stdout,
    result.stderr
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Execute command in background.
 */
export async function execCommandDetached(
  sandbox,
  command,
  cwd = "/home/user/app"
) {

  await sandbox.commands.run(
    command,
    {
      cwd,
      background: true
    }
  );
}

/**
 * Auto terminate sandbox
 * after timeout.
 */
export function enforceTimeout(
  sandbox,
  timeout = 120000
) {

  const timer = setTimeout(
    async () => {

      try {

        await sandbox.kill();

        console.log(
          "Sandbox killed due to timeout."
        );

      } catch {}
    },
    timeout
  );

  return timer;
}

/**
 * Safe cleanup helper.
 */
export async function destroySandbox(
  sandbox
) {

  if (!sandbox) return;

  try {

    await sandbox.kill();

  } catch (err) {

    console.error(
      "Failed to destroy sandbox:",
      err.message
    );
  }
}