import { getProjectPath } from "../sandboxService.js";

/**
 * Detects the backend and frontend frameworks used in a fullstack project.
 * Expects a monorepo layout: /home/user/app/backend and /home/user/app/frontend
 * or a flat layout where both coexist at the root.
 *
 * Returns: { backend: 'node'|'python', frontend: 'react'|'vue'|'vanilla', layout: 'monorepo'|'flat' }
 */
export default async function detectStack(sandbox) {
  const root = getProjectPath();

  const layout = await detectLayout(sandbox, root);

  const backendRoot = layout === "monorepo" ? `${root}/backend` : root;
  const frontendRoot = layout === "monorepo" ? `${root}/frontend` : root;

  const backend = await detectBackend(sandbox, backendRoot);
  const frontend = await detectFrontend(sandbox, frontendRoot);

  return { backend, frontend, layout, backendRoot, frontendRoot };
}

async function detectLayout(sandbox, root) {
  const check = await sandbox.commands.run(
    `test -d ${root}/backend && test -d ${root}/frontend && echo monorepo || echo flat`
  );
  return check.stdout.trim();
}

async function detectBackend(sandbox, backendRoot) {
  const nodeCheck = await sandbox.commands.run(
    `test -f ${backendRoot}/package.json && echo node || echo none`
  );
  if (nodeCheck.stdout.trim() === "node") return "node";

  const pythonCheck = await sandbox.commands.run(
    `test -f ${backendRoot}/requirements.txt -o -f ${backendRoot}/main.py && echo python || echo none`
  );
  if (pythonCheck.stdout.trim() === "python") return "python";

  return "node";
}

async function detectFrontend(sandbox, frontendRoot) {
  const pkgCheck = await sandbox.commands.run(
    `test -f ${frontendRoot}/package.json && cat ${frontendRoot}/package.json || echo {}`
  );

  try {
    const pkg = JSON.parse(pkgCheck.stdout);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.react) return "react";
    if (deps.vue) return "vue";
    if (deps.svelte) return "svelte";
  } catch {}

  return "vanilla";
}
