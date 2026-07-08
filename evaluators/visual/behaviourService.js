// Behavior checks. V-11: handle BOTH new-tab (target=_blank) and same-tab
// navigation — the old code only waited for a new page and so failed (and hung
// 30s on) every in-tab link. V-38: guard a missing/empty `expected`.
//
// Confirmed live (2026-07-08): a click that changes something ON THE SAME
// PAGE without navigating (a toggle button, a format switcher) always failed
// here, because the only pass condition was "did the URL change". That's a
// real capability gap, not a correctness bug in the student's code — added
// `mode: "stateChange"` below to check a target element's text/attribute
// before vs after the click instead of assuming navigation.
//
// Each check uses short timeouts and resets the page to its starting URL so one
// click's navigation doesn't break the next check.
import { widenSelector } from "./domService.js";

const CHECK_TIMEOUT = 5000;

async function runStateChangeCheck(page, check) {
  const targetSelector = check.targetSelector || check.selector;

  const btn = await page.$(widenSelector(check.selector));
  if (!btn) return false;

  const beforeEl = await page.$(widenSelector(targetSelector));
  const before = beforeEl ? ((await beforeEl.textContent()) || "").trim() : null;

  await btn.click().catch(() => {});
  await page.waitForTimeout(300); // let any in-page JS handler finish updating the DOM

  const afterEl = await page.$(widenSelector(targetSelector));
  const after = afterEl ? ((await afterEl.textContent()) || "").trim() : null;

  if (before === null || after === null) return false;

  // Confirmed live: gating pass/fail on `expectedContains` (e.g. "AM") is
  // unreliable — which format appears after a toggle depends on the
  // student's own default state (a page that defaults to 12-hour flips INTO
  // 24-hour on the first click, correctly removing AM/PM, not adding it). The
  // rubric parser can't know a student's default in advance, so a genuine
  // state change alone is the pass signal for "this interaction does
  // something" — `expectedContains` isn't used as a way to fail an
  // otherwise-working toggle.
  return before !== after;
}

export default async function runBehaviorChecks(page, rubric) {
  const results = {};
  const startUrl = page.url();

  for (const item of rubric) {
    if (item.type !== "behavior" || !item.checks) continue;

    for (const check of item.checks) {
      const key = `${item.description} :: ${check.selector}`;

      if (check.mode === "stateChange") {
        try {
          results[key] = await runStateChangeCheck(page, check);
        } catch {
          results[key] = false;
        }
        continue;
      }

      if (check.action !== "click") {
        results[key] = false;
        continue;
      }

      const expected =
        typeof check.expected === "string"
          ? check.expected.replace(/^url contains\s*/i, "").trim()
          : "";

      try {
        const el = await page.$(widenSelector(check.selector));
        if (!el) {
          results[key] = false;
          continue;
        }

        // Race a new tab against an in-tab navigation; whichever happens wins.
        const newPagePromise = page
          .context()
          .waitForEvent("page", { timeout: CHECK_TIMEOUT })
          .catch(() => null);
        const navPromise = page
          .waitForNavigation({ timeout: CHECK_TIMEOUT })
          .catch(() => null);

        await el.click().catch(() => {});

        const newPage = await newPagePromise;
        let resultUrl;

        if (newPage) {
          await newPage
            .waitForLoadState("load", { timeout: CHECK_TIMEOUT })
            .catch(() => {});
          resultUrl = newPage.url();
          await newPage.close().catch(() => {});
        } else {
          await navPromise;
          resultUrl = page.url();
        }

        results[key] = expected
          ? resultUrl.includes(expected)
          : resultUrl !== startUrl; // no expected → any navigation counts as pass

        // Reset for the next check
        if (page.url() !== startUrl) {
          await page.goto(startUrl, { timeout: 10000 }).catch(() => {});
        }
      } catch {
        results[key] = false;
      }
    }
  }

  return results;
}
