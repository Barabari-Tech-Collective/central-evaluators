async function runDynamicDomChecks(page, rubric) {
  const results = {};

  for (const item of rubric) {
    if (item.type === 'dom' && item.checks) {
      for (const check of item.checks) {
        const key = `${item.description} :: ${check.selector}`;
        try {
          const found = await page.$(check.selector);
          results[key] = !!found;
        } catch {
          results[key] = false;
        }
      }
    }
  }

  return results;
}