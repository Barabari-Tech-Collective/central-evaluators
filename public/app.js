/* Central Evaluators — web UI logic (vanilla JS, no build). */

// ---------- Evaluator schemas (one source of truth for the forms) ----------
const SUBS_VISUAL = [
  { key: "studentId", ph: "id (optional)" },
  { key: "studentName", ph: "student name" },
  { key: "repoUrl", ph: "https://github.com/user/repo.git", required: true },
  { key: "entryFile", ph: "entry .html (optional)" }
];
// Only the visual evaluator is wired up on the server for this deploy — the
// other 5 worker types aren't started (see server.js), so their forms are
// left out here rather than shipping dead-end buttons that queue forever.
const EVALUATORS = {
  visual: {
    emoji: "🎨", name: "Visual / UI",
    desc: "Compare a built site to a reference design",
    blurb: "Best for static HTML/CSS sites. The submission must be a built/hosted site, not raw React/Vue source.",
    fields: [
      { key: "expectedUrl", label: "Reference site URL", sub: "the correct / expected version", type: "url", required: true, ph: "https://reference.example.com" },
      { key: "rubricText", label: "Grading rubric", sub: "plain text — the AI turns it into checks", type: "textarea", required: true, ph: "1. Has a favicon\n2. Twitter link opens twitter.com\n3. Clean centered card layout" },
      { key: "submissions", type: "submissions", subFields: SUBS_VISUAL }
    ]
  }
};

// ---------- Plain-language error help ----------
const ERROR_HELP = [
  [/Host not in allowlist/i, "That repository host isn't allowed. Use a GitHub, GitLab, or Bitbucket URL."],
  [/Refusing to access private|private\/loopback/i, "That URL points to a private/internal address and was blocked for safety."],
  [/Disallowed URL scheme/i, "Only http:// and https:// links are allowed."],
  [/Invalid URL/i, "That doesn't look like a valid URL — check for typos."],
  [/DNS resolution failed/i, "We couldn't reach that web address. Is it spelled correctly and online?"],
  [/Rubric .*parse|RubricParseError|Rubric is empty|invalid weight|invalid type|Rubric is not/i, "We couldn't understand the rubric. Try simplifying it and check the points/criteria."],
  [/Missing required inputs|non-empty array|is required/i, "Some required fields are empty. Please fill them in."],
  [/Too many submissions/i, "Too many submissions at once — reduce the batch size."],
  [/rubricText too large/i, "The rubric text is too long — shorten it."],
  [/Unauthorized/i, "Your API key is missing or wrong. Open ⚙️ Settings and paste a valid key."],
  [/No JavaScript file found|No .*file found/i, "We couldn't find the expected source file in that repo."],
  [/Timeout|exceeded \d+ms/i, "The evaluation took too long and timed out — the site/app may be slow or stuck."],
  [/clone|git /i, "We couldn't download the repository. Make sure it's public and the URL is correct."]
];
function friendlyError(msg) {
  for (const [re, help] of ERROR_HELP) if (re.test(msg || "")) return help;
  return null;
}

const STATE = {
  waiting: { cls: "waiting", label: "⏳ In queue" },
  delayed: { cls: "waiting", label: "⏳ Waiting" },
  active: { cls: "active", label: "⚙️ Running…" },
  completed: { cls: "completed", label: "✅ Done" },
  failed: { cls: "failed", label: "❌ Failed" }
};

// ---------- tiny helpers ----------
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const getKey = () => localStorage.getItem("ce_api_key") || "";

let selectedType = "visual";

// ---------- Settings drawer ----------
$("#settingsBtn").addEventListener("click", () => $("#settings").classList.toggle("hidden"));
$("#saveKey").addEventListener("click", () => {
  localStorage.setItem("ce_api_key", $("#apiKey").value.trim());
  $("#keyStatus").textContent = "Saved ✓";
});
function initSettings() {
  $("#apiKey").value = getKey();
  $("#keyStatus").textContent = getKey() ? "A key is saved in this browser." : "No key saved yet.";
}

// ---------- Evaluator picker ----------
function renderPicker() {
  $("#evaluatorPicker").innerHTML = Object.entries(EVALUATORS).map(([k, e]) => `
    <button type="button" class="pick ${k === selectedType ? "active" : ""}" data-type="${k}">
      <div class="emoji">${e.emoji}</div>
      <div class="name">${esc(e.name)}</div>
      <div class="desc">${esc(e.desc)}</div>
    </button>`).join("");
  document.querySelectorAll(".pick").forEach(btn =>
    btn.addEventListener("click", () => { selectedType = btn.dataset.type; renderPicker(); renderForm(); }));
  $("#evaluatorBlurb").textContent = EVALUATORS[selectedType].blurb;
}

// ---------- Form rendering ----------
function fieldHTML(f) {
  if (f.type === "submissions") {
    return `<div class="field" data-key="submissions">
      <label>Submissions <span class="sub">— one row per student (repo URL required)</span></label>
      <div class="subs" id="subsBox"></div>
      <button type="button" class="ghost-btn add-row" id="addSub">＋ Add submission</button>
    </div>`;
  }
  const label = `<label>${esc(f.label)}${f.sub ? ` <span class="sub">— ${esc(f.sub)}</span>` : ""}${f.required ? " *" : ""}</label>`;
  let control;
  if (f.type === "textarea") control = `<textarea name="${f.key}" placeholder="${esc(f.ph || "")}"></textarea>`;
  else if (f.type === "select") control = `<select name="${f.key}">${f.options.map(o => `<option value="${o.v}">${esc(o.t)}</option>`).join("")}</select>`;
  else control = `<input type="${f.type === "url" ? "text" : "text"}" name="${f.key}" placeholder="${esc(f.ph || "")}" />`;
  return `<div class="field" data-key="${f.key}">${label}${control}</div>`;
}

function subRowHTML(subFields) {
  const inputs = subFields.map(s => `<input name="sub_${s.key}" placeholder="${esc(s.ph)}" />`).join("");
  return `<div class="sub-row">${inputs}<button type="button" class="icon-btn rm">✕</button></div>`;
}

function renderForm() {
  const ev = EVALUATORS[selectedType];
  $("#evalForm").innerHTML = ev.fields.map(fieldHTML).join("");

  const subsField = ev.fields.find(f => f.type === "submissions");
  if (subsField) {
    const box = $("#subsBox");
    const addRow = () => box.insertAdjacentHTML("beforeend", subRowHTML(subsField.subFields));
    addRow();
    $("#addSub").addEventListener("click", addRow);
    box.addEventListener("click", e => {
      if (e.target.classList.contains("rm") && box.children.length > 1) e.target.closest(".sub-row").remove();
    });
  }
  $("#evalForm").addEventListener("input", applyConditional);
  applyConditional();
  $("#formError").classList.add("hidden");
}

function readRaw() {
  const d = {};
  $("#evalForm").querySelectorAll("[name]").forEach(el => { if (!el.name.startsWith("sub_")) d[el.name] = el.value; });
  return d;
}
function applyConditional() {
  const d = readRaw();
  EVALUATORS[selectedType].fields.forEach(f => {
    if (!f.showIf) return;
    const wrap = $(`#evalForm .field[data-key="${f.key}"]`);
    if (wrap) wrap.classList.toggle("hidden", !f.showIf(d));
  });
}

// ---------- Collect + validate ----------
function collectPayload() {
  const ev = EVALUATORS[selectedType];
  const raw = readRaw();
  const errors = [];
  const payload = { type: selectedType };

  for (const f of ev.fields) {
    if (f.type === "submissions") continue;
    if (f.showIf && !f.showIf(raw)) continue;
    let val = (raw[f.key] || "").trim();

    if (f.required && !val) { errors.push(`"${f.label}" is required.`); continue; }
    if (!val) continue;

    if (f.type === "url" && !/^https?:\/\//i.test(val)) errors.push(`"${f.label}" must start with http:// or https://`);

    if (f.key === "testCases" || f.key === "expectedLogs") {
      try { payload[f.key] = JSON.parse(val); }
      catch { errors.push(`"${f.label}" is not valid JSON.`); }
      continue;
    }
    payload[f.key] = val;
  }

  // submissions
  const subsField = ev.fields.find(f => f.type === "submissions");
  if (subsField) {
    const rows = [...$("#subsBox").querySelectorAll(".sub-row")].map(row => {
      const o = {};
      subsField.subFields.forEach(s => {
        const v = row.querySelector(`[name="sub_${s.key}"]`).value.trim();
        if (v) o[s.key] = v;
      });
      return o;
    }).filter(o => Object.keys(o).length);
    if (rows.length === 0) errors.push("Add at least one submission with a repo URL.");
    rows.forEach((r, i) => {
      if (!r.repoUrl) errors.push(`Submission #${i + 1} is missing a repo URL.`);
      else if (!/^https?:\/\//i.test(r.repoUrl)) errors.push(`Submission #${i + 1} repo URL must start with http(s)://`);
    });
    payload.submissions = rows;
  }

  return { payload, errors };
}

// ---------- Submit + poll ----------
$("#resetBtn").addEventListener("click", () => { renderForm(); $("#results").innerHTML = `<p class="placeholder">Cleared.</p>`; });

$("#evaluateBtn").addEventListener("click", async () => {
  const { payload, errors } = collectPayload();
  const errBox = $("#formError");
  if (errors.length) {
    errBox.innerHTML = "Please fix:<br>• " + errors.map(esc).join("<br>• ");
    errBox.classList.remove("hidden");
    return;
  }
  errBox.classList.add("hidden");

  const results = $("#results");
  results.innerHTML = `<p class="placeholder">Submitting…</p>`;

  let res, body;
  try {
    res = await fetch("/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": getKey() },
      body: JSON.stringify(payload)
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    results.innerHTML = banner(`Couldn't reach the server: ${esc(e.message)}`);
    return;
  }

  if (!res.ok || body.success === false) {
    const msg = body.error || `Request failed (HTTP ${res.status})`;
    const help = friendlyError(msg) || (res.status === 401 ? "Your API key is missing or wrong. Open ⚙️ Settings." : null);
    results.innerHTML = banner(msg, help);
    return;
  }

  // Normalize to a list of jobs, labelled by student where possible
  const jobs = Array.isArray(body.jobs) ? body.jobs : [{ jobId: body.jobId }];
  const subs = payload.submissions || [];
  const cards = jobs.map((j, i) => ({
    jobId: j.jobId,
    label: subs[i]?.studentName || subs[i]?.repoUrl || payload.repoUrl || `Job ${j.jobId}`
  }));

  results.innerHTML = cards.map(c => cardShell(c)).join("");
  cards.forEach(pollJob);
});

function cardShell(c) {
  return `<div class="result-card" id="card-${esc(c.jobId)}">
    <div class="result-head">
      <span class="result-title">${esc(c.label)}</span>
      <span class="chip waiting" id="chip-${esc(c.jobId)}">⏳ In queue</span>
    </div>
    <div id="body-${esc(c.jobId)}"></div>
  </div>`;
}

async function pollJob(card) {
  const chip = $(`#chip-${CSS.escape(card.jobId)}`);
  const bodyEl = $(`#body-${CSS.escape(card.jobId)}`);
  let tries = 0;
  const tick = async () => {
    tries++;
    let job;
    try {
      const r = await fetch(`/jobs/${selectedType}/${encodeURIComponent(card.jobId)}`);
      job = await r.json();
    } catch (e) { bodyEl.innerHTML = small(`Polling error: ${esc(e.message)}`); return; }

    if (!job) { if (tries < 150) setTimeout(tick, 2000); return; }

    const st = STATE[job.state] || { cls: "active", label: job.state };
    chip.className = `chip ${st.cls}`;
    chip.textContent = st.label;

    if (job.state === "completed") { bodyEl.innerHTML = renderResult(job.returnvalue ?? job.result); return; }
    if (job.state === "failed") { bodyEl.innerHTML = renderFailure(job.failedReason); return; }
    if (tries < 150) setTimeout(tick, 2000);
  };
  tick();
}

// ---------- Result rendering ----------
function normalizeResults(ret) {
  if (!ret) return [];
  let list = ret.result ?? ret.results ?? ret;
  if (!Array.isArray(list)) list = [list];
  return list.map(e => {
    const score = e.score ?? e.total ?? e.evaluation?.score ?? e.evaluation?.total;
    const fb = e.feedback ?? e.evaluation?.feedback;
    return {
      name: e.name ?? e.studentName ?? e.evaluation?.studentName,
      score,
      total: e.total,
      maxTotal: e.maxTotal,
      normalized: e.normalized,
      domScore: e.domScore,
      behaviorScore: e.behaviorScore,
      visualScore: e.visualScore,
      pendingManualPoints: e.pendingManualPoints,
      domBreakdown: e.domBreakdown,
      behaviorBreakdown: e.behaviorBreakdown,
      visualBreakdown: e.visualBreakdown ?? (Array.isArray(fb?.breakdown) ? fb.breakdown : null),
      manualReviewDetail: e.manualReviewDetail,
      feedback: typeof fb === "object" ? (fb.feedback ?? JSON.stringify(fb, null, 2)) : fb,
      error: e.error ?? e.evaluation?.error,
      manualReviewItems: e.manualReviewItems,
      raw: e
    };
  });
}

function renderResult(ret) {
  const items = normalizeResults(ret);
  if (!items.length) return small("Completed, but no structured result was returned.") + rawBlock(ret);

  return items.map(it => {
    let html = "";
    if (it.name && items.length > 1) html += `<div class="kv"><b>${esc(it.name)}</b></div>`;

    if (it.error) {
      const help = friendlyError(it.error);
      html += explainBox(it.error, help);
    }

    if (typeof it.score === "number") {
      const pct = typeof it.normalized === "number" ? it.normalized
        : (typeof it.maxTotal === "number" && it.maxTotal > 0 ? Math.round((it.score / it.maxTotal) * 1000) / 10 : null);
      html += `<div class="score"><span class="big">${esc(it.score)}${it.maxTotal != null ? ` / ${esc(it.maxTotal)}` : ""}</span>${pct != null ? `<span class="pct">${pct}%</span>` : ""}</div>`;
      if (pct != null) html += `<div class="bar"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;
    }

    html += breakdownTable(it);

    if (Array.isArray(it.manualReviewDetail) && it.manualReviewDetail.length) {
      const points = it.pendingManualPoints != null ? it.pendingManualPoints : it.manualReviewDetail.reduce((s, m) => s + (m.weight || 0), 0);
      html += `<div class="explain"><b>Needs manual review (${esc(points)} pts not auto-gradable):</b><ul style="margin:6px 0 0 18px;padding:0">` +
        it.manualReviewDetail.map(m => `<li>${esc(m.description)} <span style="opacity:.7">(${esc(m.weight)} pts) — ${esc(m.reason)}</span></li>`).join("") +
        `</ul></div>`;
    } else if (Array.isArray(it.manualReviewItems) && it.manualReviewItems.length) {
      html += `<div class="explain"><b>Needs manual review:</b> ${esc(it.manualReviewItems.join(", "))}</div>`;
    }
    if (it.feedback) html += `<div class="feedback">${esc(it.feedback)}</div>`;

    html += rawBlock(it.raw);
    return html;
  }).join("<hr style='border:none;border-top:1px solid var(--line);margin:14px 0'>");
}

// Per-criterion "why did I get/lose these points" table — pulls DOM/behavior
// per-check pass-fail detail and the vision model's own per-item breakdown
// into one place, so a score isn't just an opaque number.
function breakdownTable(it) {
  const rows = [];

  (it.domBreakdown || []).forEach(row => {
    const detail = (row.checks || [])
      .map(c => `${c.passed ? "✓" : "✗"} ${esc(c.selector)} (${esc(c.condition)})`)
      .join("<br>");
    rows.push({ type: "DOM", item: row.item, awarded: row.awarded, max: row.max, detail });
  });

  (it.behaviorBreakdown || []).forEach(row => {
    const detail = (row.checks || [])
      .map(c => `${c.passed ? "✓" : "✗"} click ${esc(c.selector)}`)
      .join("<br>");
    rows.push({ type: "Behavior", item: row.item, awarded: row.awarded, max: row.max, detail });
  });

  (it.visualBreakdown || []).forEach(row => {
    rows.push({ type: "Visual", item: row.item, awarded: row.awarded, max: row.max, detail: esc(row.reason || "") });
  });

  if (!rows.length) return "";

  return `<table class="breakdown" style="width:100%;border-collapse:collapse;margin:10px 0;font-size:13px">
    <thead><tr style="text-align:left;opacity:.7">
      <th style="padding:4px 8px 4px 0">Type</th><th style="padding:4px 8px">Criterion</th>
      <th style="padding:4px 8px">Points</th><th style="padding:4px 0">Why</th>
    </tr></thead>
    <tbody>${rows.map(r => `<tr style="border-top:1px solid var(--line)">
      <td style="padding:4px 8px 4px 0;opacity:.7">${esc(r.type)}</td>
      <td style="padding:4px 8px">${esc(r.item)}</td>
      <td style="padding:4px 8px;white-space:nowrap">${esc(r.awarded)} / ${esc(r.max)}</td>
      <td style="padding:4px 0">${r.detail}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderFailure(reason) {
  const help = friendlyError(reason) || "The job failed. See the technical details below.";
  return explainBox(reason || "Unknown error", help);
}

// ---------- small html helpers ----------
function banner(msg, help) {
  return `<div class="banner error">${help ? `<b>${esc(help)}</b><br><span style="opacity:.8">${esc(msg)}</span>` : esc(msg)}</div>`;
}
function explainBox(msg, help) {
  return `<div class="explain">${help ? `<b>${esc(help)}</b><br>` : ""}<details><summary>Technical details</summary><pre class="raw">${esc(msg)}</pre></details></div>`;
}
function small(t) { return `<p class="kv" style="color:var(--muted)">${esc(t)}</p>`; }
function rawBlock(obj) {
  return `<details><summary>Show raw JSON</summary><pre class="raw">${esc(JSON.stringify(obj, null, 2))}</pre></details>`;
}

// ---------- boot ----------
initSettings();
renderPicker();
renderForm();
