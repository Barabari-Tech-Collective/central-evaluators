import { chromium } from "playwright";

const FRONTEND_PORT = 5173;
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const BUILD_TIMEOUT = 120000;
const SERVER_WAIT_MS = 8000;

export async function runFrontendTests(sandbox, frontendRoot, rubric) {
  const criteria = rubric?.criteria ?? [];
  const frontendCriteria = criteria.filter(
    (c) => c.layer === "frontend" || !c.layer
  );

  // Install and build
  await sandbox.commands.run(`cd ${frontendRoot} && npm install`, {
    timeout: BUILD_TIMEOUT,
  });

  // Try vite preview or serve; fall back to npx serve
  const serveCmd = await resolveServeCommand(sandbox, frontendRoot);

  // Start dev/preview server in background
  sandbox.commands.run(serveCmd, { background: true }).catch(() => {});

  // Wait for server to be ready
  await sandbox.commands.run(`sleep ${Math.ceil(SERVER_WAIT_MS / 1000)}`);

  const results = await runPlaywrightChecks(frontendCriteria);

  return results;
}

async function resolveServeCommand(sandbox, frontendRoot) {
  const pkgRaw = await sandbox.commands.run(`cat ${frontendRoot}/package.json`);
  try {
    const pkg = JSON.parse(pkgRaw.stdout);
    const scripts = pkg.scripts ?? {};
    if (scripts.preview) return `cd ${frontendRoot} && npm run preview -- --port ${FRONTEND_PORT}`;
    if (scripts.start) return `cd ${frontendRoot} && npm start`;
  } catch {}
  return `cd ${frontendRoot} && npx serve -s . -l ${FRONTEND_PORT}`;
}

async function runPlaywrightChecks(criteria) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const test_details = [];
  let passed = 0;

  try {
    await page.goto(FRONTEND_URL, { waitUntil: "networkidle", timeout: 30000 });
  } catch (err) {
    await browser.close();
    return {
      passed: 0,
      total: criteria.length,
      test_details: criteria.map((c) => ({
        name: c.name,
        status: "fail",
        error: `Could not load frontend: ${err.message}`,
      })),
    };
  }

  for (const criterion of criteria) {
    const result = await runCriterionCheck(page, criterion);
    test_details.push(result);
    if (result.status === "pass") passed++;
  }

  await browser.close();

  return { passed, total: criteria.length, test_details };
}

async function runCriterionCheck(page, criterion) {
  const { name, selector, expectedText, action } = criterion;

  try {
    if (action === "click" && selector) {
      await page.click(selector, { timeout: 5000 });
      return { name, status: "pass" };
    }

    if (selector) {
      const el = await page.$(selector);
      if (!el) return { name, status: "fail", error: `Selector "${selector}" not found` };

      if (expectedText) {
        const text = await el.textContent();
        const matches = text?.includes(expectedText);
        if (!matches) {
          return { name, status: "fail", error: `Expected text "${expectedText}", got "${text?.slice(0, 100)}"` };
        }
      }

      return { name, status: "pass" };
    }

    // No selector — just check page loaded
    return { name, status: "pass" };

  } catch (err) {
    return { name, status: "fail", error: err.message?.slice(0, 200) };
  }
}
