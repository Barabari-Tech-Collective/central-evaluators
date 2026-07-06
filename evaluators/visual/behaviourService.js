// Behavior checks. V-11: handle BOTH new-tab (target=_blank) and same-tab
// navigation — the old code only waited for a new page and so failed (and hung
// 30s on) every in-tab link. V-38: guard a missing/empty `expected`.
//
// Each check uses short timeouts and resets the page to its starting URL so one
// click's navigation doesn't break the next check.

const CHECK_TIMEOUT = 5000;

export default async function runBehaviorChecks(page, rubric) {
  const results = {};
  const startUrl = page.url();

  for (const item of rubric) {
    if (item.type !== "behavior" || !item.checks) continue;

    for (const check of item.checks) {
      const key = `${item.description} :: ${check.selector}`;

      if (check.action !== "click") {
        results[key] = false;
        continue;
      }

      const expected =
        typeof check.expected === "string"
          ? check.expected.replace(/^url contains\s*/i, "").trim()
          : "";

      try {
        const el = await page.$(check.selector);
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
