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

  // Bug: reported live -- a repo with neither a package.json nor any Python
  // entry point (e.g. a bare "app.js" script with no manifest at all)
  // defaulted to "node" here, which sent it into runJestEvaluation, whose
  // first real step is an unguarded `npm install`. With no package.json to
  // install, that command fails and throws a bare "exit status 1" with no
  // context -- a confusing crash instead of a clear "couldn't grade this"
  // message. Defaulting to *any* language when neither check actually
  // matched was the real bug; return null so the caller can fail this
  // submission cleanly instead of guessing.
  return null;
}