async function runBehaviorChecks(page, rubric) {
  const results = {};

  for (const item of rubric) {
    if (item.type === "behavior" && item.checks) {
      for (const check of item.checks) {
        const key = `${item.description} :: ${check.selector}`;

        try {
          if (check.action === "click") {

            const [newPage] = await Promise.all([
              page.context().waitForEvent('page'),
              page.click(check.selector)
            ]);

            const url = newPage.url();
            results[key] = url.includes(check.expected.replace("url contains ", ""));

            await newPage.close();
          }

        } catch {
          results[key] = false;
        }
      }
    }
  }

  return results;
}

