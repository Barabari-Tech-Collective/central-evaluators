// DOM checks. V-22: honor `check.condition` instead of only testing existence.
// Supported conditions: "exists" (default), "visible", "textContains", "attr".

// Confirmed live (2026-07-08, Digital Clock batch test): the rubric parser
// generates a bare ID selector ("#container") for element names the rubric
// doesn't specify id-vs-class for, but real submissions commonly implement
// them as classes ("class='container'") — an ID selector can never match a
// class attribute, so every student failed a check they'd actually satisfied.
// Rather than rely on the model always guessing right, widen a bare single
// id/class selector to match either form. Selectors that are already more
// specific (combinators, attribute selectors, tag names) are left untouched.
function widenSelector(selector) {
  const bareIdOrClass = /^([.#])([\w-]+)$/.exec((selector || "").trim());
  if (!bareIdOrClass) return selector;
  const [, , name] = bareIdOrClass;
  return `#${name}, .${name}`;
}

async function evaluateCheck(page, check) {
  const el = await page.$(widenSelector(check.selector));
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
