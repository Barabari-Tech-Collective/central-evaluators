import fs from 'fs';
import { Sandbox } from '@e2b/code-interpreter';

/**
 * Spins up an isolated E2B cloud sandbox and uploads the student's project zip.
 *
 * @param {string} zipPath  - Absolute path to the local zip file
 * @returns {Promise<{ sandbox: unknown, appUrl: string }>}
 */
export async function spinTestEnvironment(zipPath) {
  // Create an E2B Sandbox using the default template
  // Setting a longer timeout if needed (default 5 mins), but we kill it manually anyway
  const sandbox = await Sandbox.create();
  
  // Upload the zip file into the sandbox
  const zipBuffer = await fs.promises.readFile(zipPath);
  await sandbox.files.write("/home/user/app.zip", zipBuffer);
  
  // Extract the zip into /home/user/app. Unzip returns 1 for warnings (like extra bytes), which causes E2B to throw.
  try {
    await sandbox.commands.run("mkdir -p /home/user/app && unzip -o /home/user/app.zip -d /home/user/app");
  } catch (e) {
    console.log("Ignored unzip warning/error:", e.message);
    // If it's a real failure (not just a warning), the npm install step will gracefully fail later.
  }
  
  // The React app serves on port 3000
  const hostUrl = sandbox.getHost(3000);
  
  // Find the exact directory containing package.json in case it is inside a nested folder (GitHub exports)
  const findCmd = await sandbox.commands.run("find /home/user/app -maxdepth 2 -name 'package.json' | head -n 1");
  let projectDir = "/home/user/app";
  if (!findCmd.error && findCmd.stdout.trim()) {
    projectDir = findCmd.stdout.trim().replace(/\/package\.json$/, "");
    console.log("Detected project directory with package.json:", projectDir);
  }

  // Note: Playwright can navigate to this public URL
  return { sandbox, appUrl: `https://${hostUrl}`, projectDir };
}

/**
 * Runs a shell command inside the sandbox and returns stdout+stderr as a string.
 * @param {unknown} sandbox   - E2B Sandbox instance
 * @param {string} command    - Shell command to run
 * @param {string} cwd        - Working directory inside the sandbox
 * @returns {Promise<string>}
 */
export async function execCommand(sandbox, command, cwd = "/home/user/app") {
  // We run all commands inside the extracted directory with a generous 5-minute timeout
  const result = await sandbox.commands.run(command, { cwd, timeoutMs: 300000 });
  
  if (result.error) {
    throw new Error(result.error.message || result.stderr || "Command execution failed");
  }
  
  return (result.stdout + "\n" + result.stderr).trim();
}

/**
 * Runs a command in the background (detached), so it stays alive even after 
 * this execution session closes (crucial for long-running servers).
 * @param {unknown} sandbox - E2B Sandbox instance
 * @param {string} command - Shell command to run
 * @param {string} cwd - Working directory inside the sandbox
 */
export async function execCommandDetached(sandbox, command, cwd = "/home/user/app") {
  await sandbox.commands.run(command, { cwd, background: true });
}

/**
 * Automatically kills the sandbox after the specified timeout (ms).
 * Prevents runaway processes from consuming host resources.
 *
 * @param {unknown} sandbox   - E2B Sandbox instance
 * @param {number} timeout    - Timeout in milliseconds (default: 120s)
 */
export async function enforceTimeout(sandbox, timeout = 120000) {
  setTimeout(async () => {
    try {
      await sandbox.kill();
      console.log("Sandbox killed due to timeout.");
    } catch {
      // Sandbox may have already stopped — silently ignore
    }
  }, timeout);
}