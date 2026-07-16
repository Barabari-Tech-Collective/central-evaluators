import { getProjectPath } from "../sandboxService.js";

export default async function detectLanguage(sandbox) {

  const root = getProjectPath();

  const nodeCheck = await sandbox.commands.run(
    `test -f ${root}/package.json && echo node || echo none`
  );

  if (nodeCheck.stdout.trim() === "node") {
    return "node";
  }

  // Bug (backendBugs.md #11): only checked requirements.txt/main.py, so a
  // FastAPI project using only app.py (the entry point injectors/pyTestInjector.js
  // itself already treats as valid — it reads main.py *or* app.py) silently
  // misdetected as Node and the whole run failed downstream.
  const pythonCheck = await sandbox.commands.run(
    `test -f ${root}/requirements.txt -o -f ${root}/main.py -o -f ${root}/app.py && echo python || echo none`
  );

  if (pythonCheck.stdout.trim() === "python") {
    return "python";
  }

  return "node";
}