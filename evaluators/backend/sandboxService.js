import { Sandbox } from "@e2b/code-interpreter";
import fs from "fs-extra";
import path from "path";

export default async function createSandbox(projectPath) {

  if (!projectPath) {
    throw new Error("projectPath missing");
  }

  const sandbox = await Sandbox.create();

  // Upload project folder recursively
  await sandbox.files.uploadDir(
    projectPath,
    "/home/user/app"
  );

  return sandbox;
}

export async function destroySandbox(sandbox) {

  if (sandbox) {
    await sandbox.kill();
  }
}

export function getProjectPath() {
  return "/home/user/app";
}