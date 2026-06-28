// DOM checks. V-22: honor `check.condition` instead of only testing existence.
// Supported conditions: "exists" (default), "visible", "textContains", "attr".

async function evaluateCheck(page, check) {
  const el = await page.$(check.selector);
  if (!el) return false;

  const condition = (check.condition || "exists").toLowerCase();
  switch (condition) {
    case "exists":
      return true;

    case "visible":
      return await el.isVisible();

    case "textcontains": {
      const text = (await el.textContent()) || "";
      return check.expected
        ? text.toLowerCase().includes(String(check.expected).toLowerCase())
        : text.trim().length > 0;
    }

    case "attr": {
      // expected: "href" (attr present) or "href=value" (attr equals/contains value)
      const [attr, value] = String(check.expected || "").split("=");
      const actual = await el.getAttribute(attr);
      if (actual === null) return false;
      return value ? actual.includes(value) : true;
    }

    default:
      return true; // unknown condition behaves like "exists"
  }
}

export async function runDynamicDomChecks(page, rubric) {
  const results = {};

  for (const item of rubric) {
    if (item.type !== "dom" || !item.checks) continue;
    for (const check of item.checks) {
      const key = `${item.description} :: ${check.selector}`;
      try {
        results[key] = await evaluateCheck(page, check);
      } catch {
        results[key] = false;
      }
    }
  }

  return results;
}
