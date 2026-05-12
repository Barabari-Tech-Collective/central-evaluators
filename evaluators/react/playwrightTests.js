import { chromium } from "playwright";
import { setupApiMocks, getMockSignals } from "./apiMock.js";

/**
 * Runs all Playwright-based UI tests against the student's React app.
 * The app runs inside Docker and is exposed on a dynamic host port.
 *
 * @param {string} appUrl - The public URL where the app is served (via E2B or locally)
 * @returns {{ results, logs }} - pass/fail per rubric criteria + log lines
 */
export default async function runPlaywrightTests(appUrl) {
  const APP_URL = appUrl;

  const browser = await chromium.launch({ headless: true });

  const results = {
    components: false,
    props: false,
    state: false,
    routing: false,
    api: false,
  };

  const logs = [];

  try {
    const page = await browser.newPage();

    // Set up pattern-matched API mocks BEFORE first navigation
    const interceptedUrls = await setupApiMocks(page);

    // Initial load
    logs.push("Navigating to app...");
    await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 8000 });
    await page.waitForTimeout(500); // Give React a moment to hydrate

    // ─── Test 1: Component Rendering ────────────────────────────────────────
    try {
      const rootHasContent = await page.evaluate(() => {
        const root = document.getElementById("root") || document.getElementById("app");
        return root ? root.children.length > 0 : document.body.children.length > 0;
      });

      const bodyText = await page.textContent("body");
      const hasVisibleText = bodyText.trim().length > 10;

      results.components = rootHasContent && hasVisibleText;
      logs.push(`[components] rootHasContent=${rootHasContent}, hasVisibleText=${hasVisibleText}`);
    } catch (err) {
      logs.push(`[components] FAILED — ${err.message}`);
    }

    // ─── Test 2: Props Handling ──────────────────────────────────────────────
    try {
      const hasPropDrivenContent = await page.evaluate(() => {
        const lists = document.querySelectorAll("ul li, ol li, [class*='card'], [class*='item'], [class*='list']");
        return lists.length > 0;
      });

      results.props = hasPropDrivenContent;
      logs.push(`[props] hasPropDrivenContent=${hasPropDrivenContent}`);
    } catch (err) {
      logs.push(`[props] FAILED — ${err.message}`);
    }

    // ─── Test 5: API Integration (Check DOM after initial load) ──────────────
    try {
      logs.push(`[api] Intercepted ${interceptedUrls.length} request(s): ${interceptedUrls.join(", ") || "none"}`);
      await page.waitForTimeout(200); // UI settles after fetch

      const bodyContent = await page.textContent("body");
      const mockSignals = getMockSignals();
      const apiDataRendered = mockSignals.some((signal) => bodyContent.includes(signal));

      results.api = apiDataRendered;
      logs.push(`[api] Mocked data rendered in DOM: ${apiDataRendered}`);
    } catch (err) {
      logs.push(`[api] FAILED — ${err.message}`);
    }

    // ─── Test 4: Routing ─────────────────────────────────────────────────────
    try {
      const initialUrl = page.url();
      const initialContent = await page.textContent("body");

      const navLinks = await page.$$("nav a, [role='navigation'] a, a[href^='/'], a[href^='#']");
      let clicked = false;

      for (const link of navLinks) {
        const href = await link.getAttribute("href");
        // Try to click a link that actually goes somewhere else, not just the homepage
        if (href && href !== "/" && href !== "#") {
          await link.click();
          clicked = true;
          break;
        }
      }

      // Fallback safely to any link
      if (!clicked && navLinks.length > 0) {
        await navLinks[navLinks.length - 1].click();
        clicked = true;
      }

      if (clicked) {
        await page.waitForTimeout(800);

        const newUrl = page.url();
        const newContent = await page.textContent("body");

        const urlChanged = initialUrl !== newUrl;
        const contentChanged = initialContent !== newContent;
        results.routing = urlChanged || contentChanged;
        logs.push(`[routing] urlChanged=${urlChanged}, contentChanged=${contentChanged}`);
      } else {
        logs.push("[routing] No navigation links found");
      }
    } catch (err) {
      logs.push(`[routing] FAILED — ${err.message}`);
    }

    // ─── Test 3: State Updates (Do this last as it Mutates UI) ───────────────
    try {
      const interactiveSelector = "button, input[type='checkbox'], input[type='radio'], [role='button'], [role='switch']";
      
      // Wait for at least one interactive element to appear (e.g. if the page is currently "Loading...")
      await page.waitForSelector(`${interactiveSelector}, input[type='text'], input[type='search'], textarea`, { timeout: 3000 }).catch(() => {});

      const interactiveEls = await page.$$(interactiveSelector);

      let stateChanged = false;
      for (const el of interactiveEls.slice(0, 3)) { // try up to 3 elements to find a state change
        const domBefore = await page.evaluate(() => document.body.innerHTML);
        await el.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
        const domAfter = await page.evaluate(() => document.body.innerHTML);
        if (domBefore !== domAfter) {
          stateChanged = true;
          break;
        }
      }

      if (stateChanged) {
        results.state = true;
        logs.push(`[state] DOM changed after click: true`);
      } else {
        const inputEl = await page.$("input[type='text'], input[type='search'], textarea");
        if (inputEl) {
          const domBeforeInput = await page.evaluate(() => document.body.innerHTML);
          await inputEl.fill("test").catch(() => {}); // .fill is more robust than .type
          await page.waitForTimeout(300);
          const domAfterInput = await page.evaluate(() => document.body.innerHTML);
          results.state = domBeforeInput !== domAfterInput;
          logs.push(`[state] DOM changed after typing/filling: ${domBeforeInput !== domAfterInput}`);
        } else {
          logs.push("[state] No interactive elements found to trigger state");
        }
      }
    } catch (err) {
      logs.push(`[state] FAILED — ${err.message}`);
    }

    await page.close();
  } finally {
    await browser.close();
  }

  return { results, logs };
}