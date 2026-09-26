/* Since When — Activity Tracker
   Static app. All data lives in localStorage under "sinceWhen.v1". */
"use strict";

const STORE_KEY = "sinceWhen.v1";
const THEME_KEY = "sinceWhen.theme";
const DAY_MS = 86400000;

const EMOJIS = ["💪","🏃","🚴","🧘","📚","🎸","🎮","🍳","🧹","🌱","💧","🐕","📞","💤","✈️","🎨","💰","🧠","❤️","🎬","🍺","☕","🧸","💊","🚗","🧺","🎯","🌙","🔥","⭐","🏖️","📝"];

let state = { version: 1, activities: [] };
let ui = { search: "", category: "", sort: "elapsed-desc" };
let editingActivityId = null;   // modal edit target
let editingLog = null;          // { activityId, ts }

/* ---------------- storage ---------------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.activities)) {
        state = parsed;
        // normalize logs: numbers, sorted
        state.activities.forEach(a => {
          a.logs = (a.logs || []).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
        });
        return;
      }
    }
  } catch (e) { console.warn("load failed", e); }
  state = { version: 1, activities: [] };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("Couldn't save (storage full?)"); }
}

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(36).slice(2));
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function lastLog(a) { return a.logs.length ? a.logs[a.logs.length - 1] : null; }
function elapsedMs(a) { const l = lastLog(a); return l == null ? null : Date.now() - l; }

function fmtElapsed(ms) {
  if (ms == null) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d >= 60) return `<span>${d}</span><span class="unit">d</span>`;
  if (d >= 1)  return `<span>${d}</span><span class="unit">d</span> <span>${h}</span><span class="unit">h</span>`;
  if (h >= 1)  return `<span>${h}</span><span class="unit">h</span> <span>${m}</span><span class="unit">m</span>`;
  if (m >= 1)  return `<span>${m}</span><span class="unit">m</span> <span>${sec}</span><span class="unit">s</span>`;
  return `<span>${sec}</span><span class="unit">s</span>`;
}
function fmtElapsedShort(ms) {
  if (ms == null) return "–";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d >= 1) return d + "d " + h + "h";
  if (h >= 1) return h + "h " + m + "m";
  return m + "m";
}
function fmtDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}
function fmtGap(ms) {
  const d = ms / DAY_MS;
  if (d >= 1) return d >= 2 ? Math.round(d) + " days later" : "a day later";
  const h = ms / 3600000;
  if (h >= 1) return Math.round(h) + "h later";
  return Math.max(1, Math.round(ms / 60000)) + "m later";
}
function avgGap(a) {
  if (a.logs.length < 2) return null;
  let total = 0;
  for (let i = 1; i < a.logs.length; i++) total += a.logs[i] - a.logs[i - 1];
  return total / (a.logs.length - 1);
}
function longestGap(a) {
  if (a.logs.length < 2) return null;
  let max = 0;
  for (let i = 1; i < a.logs.length; i++) max = Math.max(max, a.logs[i] - a.logs[i - 1]);
  return max;
}
function isOverdue(a) {
  const e = elapsedMs(a);
  return a.targetDays && e != null && e > a.targetDays * DAY_MS;
}
function overdueBy(a) {
  const e = elapsedMs(a);
  return e - a.targetDays * DAY_MS;
}

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ---------------- sample data ---------------- */
function sampleData() {
  const now = Date.now();
  const daysAgo = (d, h = 0, m = 0) => now - d * DAY_MS - h * 3600000 - m * 60000;
  return { version: 1, activities: [
    { id: uid(), name: "Gym session", emoji: "💪", color: "#6366f1", category: "Health",
      targetDays: 3, createdAt: daysAgo(60),
      logs: [daysAgo(60), daysAgo(57), daysAgo(54), daysAgo(50), daysAgo(47), daysAgo(44), daysAgo(40), daysAgo(37), daysAgo(33), daysAgo(29), daysAgo(26), daysAgo(22), daysAgo(18), daysAgo(15), daysAgo(11), daysAgo(8), daysAgo(4), daysAgo(1, 3)] },
    { id: uid(), name: "Watered the plants", emoji: "🌱", color: "#22c55e", category: "Home",
      targetDays: 7, createdAt: daysAgo(45),
      logs: [daysAgo(45), daysAgo(38), daysAgo(31), daysAgo(24), daysAgo(16), daysAgo(9)] },
    { id: uid(), name: "Called mom", emoji: "📞", color: "#f59e0b", category: "Family",
      targetDays: 7, createdAt: daysAgo(50),
      logs: [daysAgo(50), daysAgo(43), daysAgo(36), daysAgo(29), daysAgo(21), daysAgo(12)] },
    { id: uid(), name: "Date night", emoji: "❤️", color: "#ec4899", category: "Fun",
      targetDays: 14, createdAt: daysAgo(90),
      logs: [daysAgo(90), daysAgo(76), daysAgo(61), daysAgo(47), daysAgo(33), daysAgo(19)] },
    { id: uid(), name: "Read a book", emoji: "📚", color: "#8b5cf6", category: "Growth",
      targetDays: null, createdAt: daysAgo(30),
      logs: [daysAgo(30), daysAgo(27), daysAgo(25), daysAgo(20), daysAgo(17), daysAgo(13), daysAgo(6), daysAgo(2, 5)] },
  ]};
}

/* ---------------- filtering / sorting ---------------- */
function visibleActivities() {
  const q = ui.search.trim().toLowerCase();
  let list = state.activities.filter(a => {
    const okQ = !q || a.name.toLowerCase().includes(q) || (a.category || "").toLowerCase().includes(q);
    const okC = !ui.category || (a.category || "") === ui.category;
    return okQ && okC;
  });
  const key = (a) => {
    switch (ui.sort) {
      case "elapsed-desc": { const e = elapsedMs(a); return e == null ? Infinity : -e; }
      case "elapsed-asc":  { const e = elapsedMs(a); return e == null ? Infinity : e; }
      case "name":         return a.name.toLowerCase();
      case "count-desc":    return -a.logs.length;
      default: return 0;
    }
  };
  // "never logged" floats to top for longest-since; to bottom otherwise handled above via Infinity
  list.sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return list;
}

/* ---------------- rendering ---------------- */
function render() {
  renderStats();
  renderCategories();
  renderGrid();
}

function renderStats() {
  const now = Date.now();
  const weekAgo = now - 7 * DAY_MS;
  $("statActivities").textContent = state.activities.length;
  $("statLogs").textContent = state.activities.reduce((n, a) => n + a.logs.filter(t => t >= weekAgo).length, 0);
  $("statOverdue").textContent = state.activities.filter(isOverdue).length;
  let longest = null;
  state.activities.forEach(a => {
    const e = elapsedMs(a);
    if (e != null && (longest == null || e > longest)) longest = e;
  });
  $("statLongest").textContent = longest == null ? "–" : fmtElapsedShort(longest);
}

function allCategories() {
  const set = new Set();
  state.activities.forEach(a => { if (a.category) set.add(a.category); });
  return [...set].sort((x, y) => x.localeCompare(y));
}

function renderCategories() {
  const cats = allCategories();
  const sel = $("categoryFilter");
  const prev = sel.value;
  sel.innerHTML = `<option value="">All categories</option>` +
    cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = cats.includes(prev) ? prev : "";
  ui.category = sel.value;

  const chips = $("categoryChips");
  chips.innerHTML = "";
  const mk = (label, value, active) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : "");
    b.textContent = label;
    b.onclick = () => { ui.category = value; sel.value = value; render(); };
    return b;
  };
  chips.appendChild(mk("All", "", ui.category === ""));
  cats.forEach(c => chips.appendChild(mk(c, c, ui.category === c)));

  const dl = $("categoryList");
  dl.innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
}

function renderGrid() {
  const grid = $("grid");
  const list = visibleActivities();
  $("empty").classList.toggle("hidden", !(state.activities.length === 0));
  grid.innerHTML = "";
  if (!list.length && state.activities.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🔍</div><h2>No matches</h2><p>Try a different search or category.</p></div>`;
    return;
  }
  list.forEach(a => grid.appendChild(cardEl(a)));
}

function cardEl(a) {
  const e = elapsedMs(a);
  const l = lastLog(a);
  const overdue = isOverdue(a);
  const avg = avgGap(a);

  const card = document.createElement("div");
  card.className = "card" + (overdue ? " overdue" : "");
  card.style.setProperty("--card-color", a.color || "#6366f1");

  const targetTxt = a.targetDays ? ` · target every ${a.targetDays}d` : "";
  let sub;
  if (l == null) {
    sub = `<p class="card-sub">Never logged — hit <b>Log now</b> to start the clock.</p>`;
  } else if (overdue) {
    sub = `<p class="card-sub overdue-text">⚠️ Overdue by ${fmtElapsedShort(overdueBy(a))}${targetTxt}</p>`;
  } else {
    sub = `<p class="card-sub">Last: ${fmtDateTime(l)}${targetTxt}</p>`;
  }

  card.innerHTML = `
    <div class="card-top">
      <span class="card-emoji">${esc(a.emoji || "⏱️")}</span>
      <h3 class="card-name">${esc(a.name)}</h3>
      ${a.category ? `<span class="card-cat">${esc(a.category)}</span>` : ""}
    </div>
    <p class="card-since-label">Time since last</p>
    <p class="card-timer" data-timer-for="${a.id}">${e == null ? "—" : fmtElapsed(e)}</p>
    ${sub}
    <div class="card-actions">
      <button class="log-btn" data-log="${a.id}">✅ Log now</button>
    </div>
    <div class="card-stats">
      <span>🔢 <b>${a.logs.length}</b> logs</span>
      ${avg != null ? `<span>📊 avg gap <b>${fmtElapsedShort(avg)}</b></span>` : ""}
    </div>`;

  card.querySelector("[data-log]").addEventListener("click", (ev) => {
    ev.stopPropagation();
    logNow(a.id);
  });
  card.addEventListener("click", () => openDetail(a.id));
  return card;
}

/* live ticking: update every timer each second */
setInterval(() => {
  document.querySelectorAll("[data-timer-for]").forEach(el => {
    const a = state.activities.find(x => x.id === el.dataset.timerFor);
    if (!a) return;
    const e = elapsedMs(a);
    el.innerHTML = e == null ? "—" : fmtElapsed(e);
  });
}, 1000);

/* ---------------- actions ---------------- */
function logNow(id) {
  const a = state.activities.find(x => x.id === id);
  if (!a) return;
  a.logs.push(Date.now());
  save();
  render();
  if (!$("detailModal").classList.contains("hidden") && detailId === id) renderDetail(id);
  toast(`✅ Logged “${a.name}” — clock reset!`);
}

let detailId = null;
function openDetail(id) {
  detailId = id;
  renderDetail(id);
  $("detailModal").classList.remove("hidden");
}
function renderDetail(id) {
  const a = state.activities.find(x => x.id === id);
  if (!a) { $("detailModal").classList.add("hidden"); return; }
  const e = elapsedMs(a), l = lastLog(a);
  const avg = avgGap(a), lg = longestGap(a);

  $("dEmoji").textContent = a.emoji || "⏱️";
  $("dName").textContent = a.name;
  $("dMeta").textContent =
    (a.category ? a.category + " · " : "") +
    (a.targetDays ? "target every " + a.targetDays + " days · " : "") +
    (l ? "last " + fmtDateTime(l) : "never logged");

  $("dStats").innerHTML = `
    <div class="dstat"><b>${a.logs.length}</b><span>logs</span></div>
    <div class="dstat"><b>${e == null ? "–" : fmtElapsedShort(e)}</b><span>since last</span></div>
    <div class="dstat"><b>${avg == null ? "–" : fmtElapsedShort(avg)}</b><span>avg gap</span></div>
    <div class="dstat"><b>${lg == null ? "–" : fmtElapsedShort(lg)}</b><span>longest gap</span></div>`;

  const h = $("dHistory");
  h.innerHTML = "";
  if (!a.logs.length) {
    h.innerHTML = `<li class="empty-h">No logs yet — press “Log it now”.</li>`;
    return;
  }
  const desc = [...a.logs].sort((x, y) => y - x);
  desc.forEach((ts, i) => {
    const li = document.createElement("li");
    const prev = desc[i + 1];
    li.innerHTML = `
      <span><span class="h-date">${fmtDateTime(ts)}</span>
      ${prev != null ? `<span class="h-gap">${fmtGap(ts - prev)} after previous</span>` : `<span class="h-gap">first log</span>`}</span>
      <span class="h-actions">
        <button title="Edit" data-editlog="${ts}">✏️</button>
        <button title="Delete" data-dellog="${ts}">🗑️</button>
      </span>`;
    li.querySelector("[data-editlog]").onclick = () => openLogEdit(a.id, ts);
    li.querySelector("[data-dellog]").onclick = () => {
      if (!confirm("Delete this log entry?")) return;
      a.logs = a.logs.filter(t => t !== ts);
      save(); render(); renderDetail(a.id);
      toast("Log entry deleted");
    };
    h.appendChild(li);
  });
}

/* ---- add / edit activity modal ---- */
let pickedEmoji = "⏱️";
function renderEmojiPicker() {
  const p = $("emojiPicker");
  p.innerHTML = "";
  EMOJIS.forEach(e => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = e;
    b.className = e === pickedEmoji ? "selected" : "";
    b.onclick = () => { pickedEmoji = e; renderEmojiPicker(); };
    p.appendChild(b);
  });
}
function openActivityModal(id) {
  editingActivityId = id || null;
  const a = id ? state.activities.find(x => x.id === id) : null;
  $("modalTitle").textContent = a ? "Edit activity" : "New activity";
  $("fName").value = a ? a.name : "";
  pickedEmoji = a ? (a.emoji || "⏱️") : "⏱️";
  if (a && !EMOJIS.includes(pickedEmoji)) EMOJIS.unshift(pickedEmoji);
  $("fColor").value = a ? (a.color || "#6366f1") : "#6366f1";
  $("fCategory").value = a ? (a.category || "") : "";
  if (a && a.targetDays) { $("fTarget").value = a.targetDays; $("fTargetUnit").value = "1"; }
  else { $("fTarget").value = ""; }
  renderEmojiPicker();
  $("activityModal").classList.remove("hidden");
  setTimeout(() => $("fName").focus(), 50);
}
function saveActivityForm(ev) {
  ev.preventDefault();
  const name = $("fName").value.trim();
  if (!name) return;
  const targetVal = parseFloat($("fTarget").value);
  const targetDays = Number.isFinite(targetVal) && targetVal > 0
    ? Math.round(targetVal * parseFloat($("fTargetUnit").value)) : null;
  const data = {
    name,
    emoji: pickedEmoji,
    color: $("fColor").value,
    category: $("fCategory").value.trim(),
    targetDays,
  };
  if (editingActivityId) {
    const a = state.activities.find(x => x.id === editingActivityId);
    if (a) Object.assign(a, data);
    toast("Activity updated");
  } else {
    state.activities.push(Object.assign({ id: uid(), createdAt: Date.now(), logs: [] }, data));
    toast(`“${name}” added — log it to start the clock!`);
  }
  save();
  $("activityModal").classList.add("hidden");
  render();
}

/* ---- edit single log entry ---- */
function openLogEdit(activityId, ts) {
  editingLog = { activityId, ts };
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  $("logDateTime").value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $("logModal").classList.remove("hidden");
}
function saveLogEdit() {
  const v = $("logDateTime").value;
  if (!v || !editingLog) return;
  const a = state.activities.find(x => x.id === editingLog.activityId);
  if (!a) return;
  const newTs = new Date(v).getTime();
  if (!Number.isFinite(newTs)) { toast("Invalid date"); return; }
  a.logs = a.logs.filter(t => t !== editingLog.ts);
  a.logs.push(newTs);
  a.logs.sort((x, y) => x - y);
  save();
  $("logModal").classList.add("hidden");
  render(); renderDetail(a.id);
  toast("Log entry updated");
}

/* ---------------- export / import / wipe ---------------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "since-when-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded");
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.activities)) throw new Error("bad shape");
      if (!confirm(`Import backup with ${parsed.activities.length} activities? This replaces your current data.`)) return;
      state = parsed;
      state.activities.forEach(a => {
        if (!a.id) a.id = uid();
        a.logs = (a.logs || []).map(Number).filter(Number.isFinite).sort((x, y) => x - y);
      });
      save(); render();
      toast("Backup imported");
    } catch (e) { toast("Couldn't read that file"); }
  };
  reader.readAsText(file);
}

/* ---------------- theme ---------------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("themeToggle").textContent = t === "dark" ? "☀️" : "🌙";
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
}
function initTheme() {
  let t = null;
  try { t = localStorage.getItem(THEME_KEY); } catch (e) {}
  if (!t) t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(t);
}

/* ---------------- wiring ---------------- */
function init() {
  load();
  initTheme();
  render();

  $("search").addEventListener("input", (e) => { ui.search = e.target.value; renderGrid(); renderStats(); });
  $("categoryFilter").addEventListener("change", (e) => { ui.category = e.target.value; render(); });
  $("sortSelect").addEventListener("change", (e) => { ui.sort = e.target.value; renderGrid(); });

  $("addBtn").onclick = () => openActivityModal(null);
  $("emptyAddBtn").onclick = () => openActivityModal(null);
  $("emptySampleBtn").onclick = loadSamples;
  $("activityForm").addEventListener("submit", saveActivityForm);
  $("cancelModal").onclick = () => $("activityModal").classList.add("hidden");

  $("closeDetail").onclick = () => $("detailModal").classList.add("hidden");
  $("dLogNow").onclick = () => { if (detailId) logNow(detailId); };
  $("dEdit").onclick = () => { if (detailId) { $("detailModal").classList.add("hidden"); openActivityModal(detailId); } };
  $("dDelete").onclick = () => {
    const a = state.activities.find(x => x.id === detailId);
    if (!a) return;
    if (!confirm(`Delete “${a.name}” and all its logs?`)) return;
    state.activities = state.activities.filter(x => x.id !== detailId);
    detailId = null;
    save(); render();
    $("detailModal").classList.add("hidden");
    toast("Activity deleted");
  };

  $("cancelLog").onclick = () => $("logModal").classList.add("hidden");
  $("saveLog").onclick = saveLogEdit;

  $("themeToggle").onclick = () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

  const menu = $("menu");
  $("menuBtn").onclick = (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); };
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("hidden") && !menu.contains(e.target)) menu.classList.add("hidden");
  });
  menu.querySelectorAll("[data-action]").forEach(b => b.addEventListener("click", () => {
    menu.classList.add("hidden");
    const act = b.dataset.action;
    if (act === "export") exportData();
    if (act === "import") $("importFile").click();
    if (act === "samples") loadSamples();
    if (act === "wipe") {
      if (confirm("Delete ALL activities and logs? This can't be undone.")) {
        state = { version: 1, activities: [] };
        save(); render();
        toast("Everything deleted");
      }
    }
  }));
  $("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });

  // close modals on backdrop click / Escape
  document.querySelectorAll(".modal-backdrop").forEach(bd => {
    bd.addEventListener("click", (e) => { if (e.target === bd) bd.classList.add("hidden"); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach(bd => bd.classList.add("hidden"));
  });
}

function loadSamples() {
  if (state.activities.length && !confirm("Load sample data? This replaces your current data.")) return;
  state = sampleData();
  save(); render();
  toast("Sample data loaded");
}

document.addEventListener("DOMContentLoaded", init);
