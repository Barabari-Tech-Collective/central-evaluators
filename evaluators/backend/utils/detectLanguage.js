import { getProjectPath } from "../sandboxService.js";

export default async function detectLanguage(sandbox) {

  const root = getProjectPath();

  const nodeCheck = await sandbox.commands.run(
    `test -f ${root}/package.json && echo node || echo none`
  );

  if (nodeCheck.stdout.trim() === "node") {
    return "node";
  }

  const pythonCheck = await sandbox.commands.run(
    `test -f ${root}/requirements.txt -o -f ${root}/main.py && echo python || echo none`
  );

  if (pythonCheck.stdout.trim() === "python") {
    return "python";
  }

  return "node";
}