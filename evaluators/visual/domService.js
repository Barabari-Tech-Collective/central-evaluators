// DOM checks. V-22: honor `check.condition` instead of only testing existence.
// Supported conditions: "exists" (default), "visible", "textContains", "attr",
// "updatesOverTime", "matchesNow".

// Parse a rubric-supplied format string (e.g. "DD/MM/YYYY", "hh:mm:ss A") into
// a regex + the token order, so a displayed value can be checked against the
// real current date/time rather than just "some text is present".
function buildFormatRegex(format) {
  const tokenMap = [
    ["YYYY", "(\\d{4})"],
    ["MM", "(\\d{1,2})"],
    ["DD", "(\\d{1,2})"],
    ["HH", "(\\d{1,2})"],
    ["hh", "(\\d{1,2})"],
    ["mm", "(\\d{1,2})"],
    ["ss", "(\\d{1,2})"],
    ["A", "(AM|PM|am|pm)"]
  ];
  let pattern = "";
  const tokens = [];
  let i = 0;
  while (i < format.length) {
    const hit = tokenMap.find(([tok]) => format.slice(i, i + tok.length) === tok);
    if (hit) {
      pattern += hit[1];
      tokens.push(hit[0]);
      i += hit[0].length;
    } else {
      pattern += format[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return { regex: new RegExp(pattern), tokens };
}

/**
 * Does `text` (as parsed via `format`) match the real current date/time?
 * Date components must match exactly; time is allowed a small tolerance
 * (page load + evaluation latency between render and this check).
 */
export function valueMatchesNow(text, format) {
  if (!format) return false;
  const { regex, tokens } = buildFormatRegex(format);
  const m = regex.exec(text || "");
  if (!m) return false;

  const parts = {};
  tokens.forEach((tok, idx) => {
    parts[tok] = m[idx + 1];
  });

  const now = new Date();
  if (parts.YYYY && Number(parts.YYYY) !== now.getFullYear()) return false;
  if (parts.MM && Number(parts.MM) !== now.getMonth() + 1) return false;
  if (parts.DD && Number(parts.DD) !== now.getDate()) return false;

  if (parts.HH || parts.hh) {
    let hour = Number(parts.HH ?? parts.hh);
    if (parts.hh && parts.A) {
      const ampm = parts.A.toUpperCase();
      if (ampm === "PM" && hour !== 12) hour += 12;
      if (ampm === "AM" && hour === 12) hour = 0;
    }
    const minute = parts.mm ? Number(parts.mm) : 0;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const valMinutes = hour * 60 + minute;
    const diff = Math.min(Math.abs(nowMinutes - valMinutes), 1440 - Math.abs(nowMinutes - valMinutes));
    if (diff > 2) return false; // tolerate a couple minutes of check latency
  }

  return true;
}

// Confirmed live (2026-07-08, Digital Clock batch test): the rubric parser
// generates a bare ID selector ("#container") for element names the rubric
// doesn't specify id-vs-class for, but real submissions commonly implement
// them as classes ("class='container'") — an ID selector can never match a
// class attribute, so every student failed a check they'd actually satisfied.
//
// Confirmed live again the same day on a different student: the parser wrote
// "#toggleBtn" (camelCase) for a rubric line about a toggle button, but the
// real element was "id='toggle-btn'" (kebab-case) — a working toggle scored 0
// purely on naming-convention mismatch. Rather than rely on the model always
// guessing the exact spelling AND the exact id/class convention, widen a bare
// single id/class selector across both attribute types and the common naming
// conventions (camelCase, kebab-case, snake_case). Selectors that are already
// more specific (combinators, attribute selectors, tag names) are untouched.
function toCamelCase(name) {
  return name.replace(/[-_]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""));
}
function toKebabCase(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
}
function toSnakeCase(name) {
  return toKebabCase(name).replace(/-/g, "_");
}

export function widenSelector(selector) {
  const bareIdOrClass = /^([.#])([\w-]+)$/.exec((selector || "").trim());
  if (!bareIdOrClass) return selector;
  const [, , name] = bareIdOrClass;
  const variants = new Set([name, toCamelCase(name), toKebabCase(name), toSnakeCase(name)]);
  const selectors = [];
  for (const v of variants) selectors.push(`#${v}`, `.${v}`);
  return selectors.join(", ");
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

    // Proves a value is actually LIVE (e.g. "time updates every second")
    // rather than assuming it from a single static snapshot: read it twice,
    // ~1.1s apart, and require it to have changed.
    case "updatesovertime": {
      const before = ((await el.textContent()) || "").trim();
      if (!before) return false;
      await page.waitForTimeout(1100);
      const elAgain = await page.$(widenSelector(check.selector));
      const after = elAgain ? ((await elAgain.textContent()) || "").trim() : "";
      return !!after && after !== before;
    }

    // Verifies a displayed value is factually correct (matches the real
    // current date/time), not merely present. `check.expected` carries the
    // format string, e.g. "DD/MM/YYYY" or "hh:mm:ss A".
    case "matchesnow": {
      const text = ((await el.textContent()) || "").trim();
      return valueMatchesNow(text, check.expected);
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
