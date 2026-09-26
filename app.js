/* Since When — Activity Tracker
   Static app with optional cloud sync.
   - Signed out: data lives in localStorage ("sinceWhen.v1") — same as before.
   - Signed in (email magic link): activities + full log history sync to Supabase
     (tables: activities, activity_logs; row-level security per user).
   Log entries are {t: timestamp ms, id: Supabase uuid or null}. */
"use strict";

/* ---------------- Supabase config ----------------
   The anon key is public by design (it's the "publishable" key) — the
   database's row-level security policies ensure users only ever see
   their own rows. Never put the service_role key here. */
const SUPABASE_URL = "https://drlbyykbafttshuwrlmj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRybGJ5eWtiYWZ0dHNodXdybG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0NDE3MzIsImV4cCI6MjEwNjAxNzczMn0.a5qFYl8kLUY7Zq3lqKggKrfPGqwnTttrqtUteRlaaPE";
const SITE_URL = "https://thanhlam94.github.io/since-when-tracker/";

const STORE_KEY = "sinceWhen.v1";
const THEME_KEY = "sinceWhen.theme";
const DAY_MS = 86400000;

const EMOJIS = ["💪","🏃","🚴","🧘","📚","🎸","🎮","🍳","🧹","🌱","💧","🐕","📞","💤","✈️","🎨","💰","🧠","❤️","🎬","🍺","☕","🧸","💊","🚗","🧺","🎯","🌙","🔥","⭐","🏖️","📝"];

let state = { version: 1, activities: [] };
let ui = { search: "" };
let editingActivityId = null;
let editingLog = null;          // { activityId, entry }
let db = null;                  // Supabase client
let sessionUser = null;         // signed-in user or null
let syncing = false;

/* ---------------- storage (local cache) ---------------- */
function normalizeLogs(logs) {
  return (logs || [])
    .map(l => typeof l === "number" ? { t: l, id: null, n: "" }
         : { t: Number(l && l.t), id: (l && l.id) || null, n: (l && l.n) || "" })
    .filter(l => Number.isFinite(l.t))
    .sort((a, b) => a.t - b.t);
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.activities)) {
        state = parsed;
        state.activities.forEach(a => { a.logs = normalizeLogs(a.logs); });
        return;
      }
    }
  } catch (e) { console.warn("load failed", e); }
  state = { version: 1, activities: [] };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("Couldn't save locally (storage full?)"); }
}

/* ---------------- Supabase data layer ---------------- */
function dbClient() {
  if (db) return db;
  if (!window.supabase) { console.warn("supabase-js not loaded"); return null; }
  try { db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
  catch (e) { console.warn("supabase init failed", e); db = null; }
  return db;
}
const iso = (t) => new Date(t).toISOString();

async function dbWrap(query, label) {
  if (!sessionUser || !db) return null;
  try {
    const res = await query;
    if (res.error) throw res.error;
    return res.data;
  } catch (e) {
    console.warn("db " + label + " failed", e);
    toast("Couldn't reach the database — kept locally");
    return null;
  }
}

/* Pull the user's rows and rebuild state. If the cloud is empty but this
   browser has local data, push the local data up instead (first sync). */
async function syncOnSignIn() {
  if (syncing || !db || !sessionUser) return;
  syncing = true;
  try {
    const acts = await dbWrap(db.from("activities").select("*").order("created_at", { ascending: true }), "fetch activities") || [];
    const logs = await dbWrap(db.from("activity_logs").select("*").order("logged_at", { ascending: true }), "fetch logs") || [];

    if (acts.length === 0 && state.activities.length > 0) {
      for (const a of state.activities) {
        const ins = await dbWrap(
          db.from("activities").insert({
            user_id: sessionUser.id, name: a.name, emoji: a.emoji,
            color: a.color, category: a.category || null, target_days: a.targetDays,
          }).select("id").single(), "push activity");
        if (!ins) continue;
        a.id = ins.id;
        if (a.logs.length) {
          const lins = await dbWrap(
            db.from("activity_logs").insert(a.logs.map(l => ({
              activity_id: ins.id, user_id: sessionUser.id, logged_at: iso(l.t),
              note: l.n || null,
            }))).select("id,logged_at"), "push logs");
          if (lins) {
            const byTime = {};
            lins.forEach(r => { byTime[new Date(r.logged_at).getTime()] = r.id; });
            a.logs.forEach(l => { l.id = byTime[l.t] || null; });
          }
        }
      }
      save();
      toast("☁️ Your data is now synced to the database");
    } else {
      const byAct = {};
      acts.forEach(r => {
        byAct[r.id] = {
          id: r.id, name: r.name, emoji: r.emoji, color: r.color,
          category: r.category || "", targetDays: r.target_days,
          createdAt: new Date(r.created_at).getTime(), logs: [],
        };
      });
      logs.forEach(r => {
        const a = byAct[r.activity_id];
        if (a) a.logs.push({ t: new Date(r.logged_at).getTime(), id: r.id, n: r.note || "" });
      });
      state.activities = Object.values(byAct);
      state.activities.forEach(a => a.logs.sort((x, y) => x.t - y.t));
      save();
    }
  } catch (e) {
    console.warn("sync failed", e);
    toast("Couldn't reach the database — using local data");
  }
  syncing = false;
  render();
  updateAuthUi();
}

/* ---------------- auth ---------------- */
function updateAuthUi() {
  const btn = $("authBtn");
  const dot = $("syncDot");
  if (sessionUser) {
    const email = sessionUser.email || "?";
    btn.textContent = email[0].toUpperCase();
    btn.classList.add("signed-in");
    btn.title = "Signed in as " + email + " — tap to sign out";
    dot.classList.remove("hidden");
  } else {
    btn.textContent = "👤";
    btn.classList.remove("signed-in");
    btn.title = "Sign in to sync across devices";
    dot.classList.add("hidden");
  }
  const so = $("signOutBtn");
  if (so) so.classList.toggle("hidden", !sessionUser);
}

async function sendMagicLink(email) {
  const c = dbClient();
  if (!c) { toast("Database library couldn't load — check connection"); return; }
  const { error } = await c.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: SITE_URL },
  });
  if (error) { toast("Couldn't send link: " + error.message); return; }
  $("authStatus").textContent = "📧 Check your email for the sign-in link.";
  toast("Sign-in link sent");
}

async function signOut() {
  if (db) { try { await db.auth.signOut(); } catch (e) {} }
  sessionUser = null;
  load();
  render();
  updateAuthUi();
  toast("Signed out — using local data");
}

async function initDb() {
  const c = dbClient();
  if (!c) { updateAuthUi(); return; }
  c.auth.onAuthStateChange(async (event, sess) => {
    const was = !!sessionUser;
    sessionUser = sess && sess.user ? sess.user : null;
    updateAuthUi();
    if (sessionUser && (event === "SIGNED_IN" || event === "INITIAL_SESSION") && !was) {
      await syncOnSignIn();
    } else if (!sessionUser && was) {
      load(); render();
    } else {
      render();
    }
  });
  try {
    const { data } = await c.auth.getSession();
    // onAuthStateChange fires INITIAL_SESSION too; this is a backstop
    if (data.session && data.session.user && !sessionUser) {
      sessionUser = data.session.user;
      updateAuthUi();
      await syncOnSignIn();
    }
  } catch (e) { console.warn("getSession failed", e); }
  updateAuthUi();
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
function elapsedMs(a) { const l = lastLog(a); return l == null ? null : Date.now() - l.t; }

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
  for (let i = 1; i < a.logs.length; i++) total += a.logs[i].t - a.logs[i - 1].t;
  return total / (a.logs.length - 1);
}
function longestGap(a) {
  if (a.logs.length < 2) return null;
  let max = 0;
  for (let i = 1; i < a.logs.length; i++) max = Math.max(max, a.logs[i].t - a.logs[i - 1].t);
  return max;
}
function isOverdue(a) {
  const e = elapsedMs(a);
  return a.targetDays && e != null && e > a.targetDays * DAY_MS;
}
function overdueBy(a) {
  return elapsedMs(a) - a.targetDays * DAY_MS;
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
  const s = { version: 1, activities: [
    { id: uid(), name: "Gym session", emoji: "💪", color: "#6366f1", category: "Health",
      targetDays: 3, createdAt: daysAgo(60),
      logs: [60,57,54,50,47,44,40,37,33,29,26,22,18,15,11,8,4].map(daysAgo).concat([daysAgo(1,3)]) },
    { id: uid(), name: "Watered the plants", emoji: "🌱", color: "#22c55e", category: "Home",
      targetDays: 7, createdAt: daysAgo(45),
      logs: [45,38,31,24,16,9].map(daysAgo) },
    { id: uid(), name: "Called mom", emoji: "📞", color: "#f59e0b", category: "Family",
      targetDays: 7, createdAt: daysAgo(50),
      logs: [50,43,36,29,21,12].map(daysAgo) },
    { id: uid(), name: "Date night", emoji: "❤️", color: "#ec4899", category: "Fun",
      targetDays: 14, createdAt: daysAgo(90),
      logs: [90,76,61,47,33,19].map(daysAgo) },
    { id: uid(), name: "Read a book", emoji: "📚", color: "#8b5cf6", category: "Growth",
      targetDays: null, createdAt: daysAgo(30),
      logs: [30,27,25,20,17,13,6].map(daysAgo).concat([daysAgo(2,5)]) },
  ]};
  s.activities.forEach(a => { a.logs = normalizeLogs(a.logs); });
  return s;
}

/* ---------------- filtering ---------------- */
function visibleActivities() {
  const q = ui.search.trim().toLowerCase();
  const list = state.activities.filter(a =>
    !q || a.name.toLowerCase().includes(q) || (a.category || "").toLowerCase().includes(q));
  // longest since last first; never-logged sink to the end
  list.sort((a, b) => {
    const ea = elapsedMs(a), eb = elapsedMs(b);
    const ka = ea == null ? Infinity : -ea, kb = eb == null ? Infinity : -eb;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return list;
}

/* ---------------- rendering ---------------- */
function render() {
  renderCategoryDatalist();
  renderGrid();
}

function allCategories() {
  const set = new Set();
  state.activities.forEach(a => { if (a.category) set.add(a.category); });
  return [...set].sort((x, y) => x.localeCompare(y));
}

/* suggestions for the category field in the add/edit form */
function renderCategoryDatalist() {
  const dl = $("categoryList");
  if (dl) dl.innerHTML = allCategories().map(c => `<option value="${esc(c)}">`).join("");
}

function renderGrid() {
  const grid = $("grid");
  const list = visibleActivities();
  $("empty").classList.toggle("hidden", !(state.activities.length === 0));
  grid.innerHTML = "";
  if (!list.length && state.activities.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🔍</div><h2>No matches</h2><p>Try a different search.</p></div>`;
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
  card.dataset.activityId = a.id;
  card.style.setProperty("--card-color", a.color || "#6366f1");

  const targetTxt = a.targetDays ? ` · target every ${a.targetDays}d` : "";
  let sub;
  if (l == null) {
    sub = `<p class="card-sub">Never logged — hit <b>Log now</b> to start the clock.</p>`;
  } else if (overdue) {
    sub = `<p class="card-sub overdue-text">⚠️ Overdue by ${fmtElapsedShort(overdueBy(a))}${targetTxt}</p>`;
  } else {
    sub = `<p class="card-sub">Last: ${fmtDateTime(l.t)}${targetTxt}</p>`;
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

/* live ticking */
setInterval(() => {
  document.querySelectorAll("[data-timer-for]").forEach(el => {
    const a = state.activities.find(x => x.id === el.dataset.timerFor);
    if (!a) return;
    const e = elapsedMs(a);
    el.innerHTML = e == null ? "—" : fmtElapsed(e);
  });
}, 1000);

/* ---------------- actions ---------------- */
async function logNow(id) {
  const a = state.activities.find(x => x.id === id);
  if (!a) return;
  const entry = { t: Date.now(), id: null, n: "" };
  a.logs.push(entry);
  save();
  render();
  if (!$("detailModal").classList.contains("hidden") && detailId === id) renderDetail(id);
  toast(`✅ Logged “${a.name}” — clock reset!`);
  // satisfying pulse on the card that was just logged
  const el = document.querySelector(`[data-activity-id="${CSS.escape(id)}"]`);
  if (el) {
    el.classList.remove("just-logged");
    void el.offsetWidth;
    el.classList.add("just-logged");
    setTimeout(() => el.classList.remove("just-logged"), 900);
  }
  if (sessionUser && db) {
    const ins = await dbWrap(
      db.from("activity_logs").insert({
        activity_id: a.id, user_id: sessionUser.id, logged_at: iso(entry.t),
        note: null,
      }).select("id").single(), "insert log");
    if (ins) { entry.id = ins.id; save(); }
  }
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
    (l ? "last " + fmtDateTime(l.t) : "never logged");

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
  const desc = [...a.logs].sort((x, y) => y.t - x.t);
  desc.forEach((entry, i) => {
    const li = document.createElement("li");
    const prev = desc[i + 1];
    li.innerHTML = `
      <span><span class="h-date">${fmtDateTime(entry.t)}</span>
      ${prev != null ? `<span class="h-gap">${fmtGap(entry.t - prev.t)} after previous</span>` : `<span class="h-gap">first log</span>`}
      ${entry.n ? `<span class="h-note">“${esc(entry.n)}”</span>` : ""}</span>
      <span class="h-actions">
        <button title="Add note">📝</button>
        <button title="Edit">✏️</button>
        <button title="Delete">🗑️</button>
      </span>`;
    const [noteBtn, editBtn, delBtn] = li.querySelectorAll("button");
    noteBtn.onclick = () => openNoteModal(a.id, entry);
    editBtn.onclick = () => openLogEdit(a.id, entry);
    delBtn.onclick = async () => {
      if (!confirm("Delete this log entry?")) return;
      a.logs = a.logs.filter(x => x !== entry);
      if (sessionUser && db && entry.id) {
        await dbWrap(db.from("activity_logs").delete().eq("id", entry.id), "delete log");
      }
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
async function saveActivityForm(ev) {
  ev.preventDefault();
  const name = $("fName").value.trim();
  if (!name) return;
  const targetVal = parseFloat($("fTarget").value);
  const targetDays = Number.isFinite(targetVal) && targetVal > 0
    ? Math.round(targetVal * parseFloat($("fTargetUnit").value)) : null;
  const category = $("fCategory").value.trim();
  const fields = { name, emoji: pickedEmoji, color: $("fColor").value, category, targetDays };

  if (editingActivityId) {
    const a = state.activities.find(x => x.id === editingActivityId);
    if (a) {
      Object.assign(a, fields);
      if (sessionUser && db) {
        await dbWrap(db.from("activities").update({
          name, emoji: pickedEmoji, color: fields.color,
          category: category || null, target_days: targetDays,
        }).eq("id", a.id), "update activity");
      }
    }
    toast("Activity updated");
  } else {
    const a = Object.assign({ id: uid(), createdAt: Date.now(), logs: [] }, fields);
    state.activities.push(a);
    if (sessionUser && db) {
      const ins = await dbWrap(db.from("activities").insert({
        user_id: sessionUser.id, name, emoji: pickedEmoji, color: fields.color,
        category: category || null, target_days: targetDays,
      }).select("id").single(), "insert activity");
      if (ins) a.id = ins.id;
    }
    toast(`“${name}” added — log it to start the clock!`);
  }
  save();
  $("activityModal").classList.add("hidden");
  render();
}

/* ---- edit single log entry ---- */
function openLogEdit(activityId, entry) {
  editingLog = { activityId, entry };
  const d = new Date(entry.t);
  const pad = (n) => String(n).padStart(2, "0");
  $("logDateTime").value =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $("logModal").classList.remove("hidden");
}
async function saveLogEdit() {
  const v = $("logDateTime").value;
  if (!v || !editingLog) return;
  const a = state.activities.find(x => x.id === editingLog.activityId);
  if (!a) return;
  const newTs = new Date(v).getTime();
  if (!Number.isFinite(newTs)) { toast("Invalid date"); return; }
  const entry = editingLog.entry;
  entry.t = newTs;
  a.logs.sort((x, y) => x.t - y.t);
  if (sessionUser && db) {
    if (entry.id) {
      await dbWrap(db.from("activity_logs").update({ logged_at: iso(newTs) }).eq("id", entry.id), "update log");
    } else {
      const ins = await dbWrap(db.from("activity_logs").insert({
        activity_id: a.id, user_id: sessionUser.id, logged_at: iso(newTs),
        note: entry.n || null,
      }).select("id").single(), "insert log");
      if (ins) entry.id = ins.id;
    }
  }
  save();
  $("logModal").classList.add("hidden");
  render(); renderDetail(a.id);
  toast("Log entry updated");
}

/* ---- log notes ---- */
let editingNote = null;
function openNoteModal(activityId, entry) {
  editingNote = { activityId, entry };
  const a = state.activities.find(x => x.id === activityId);
  $("noteContext").textContent = (a ? a.name + " · " : "") + fmtDateTime(entry.t);
  $("noteText").value = entry.n || "";
  $("noteModal").classList.remove("hidden");
  setTimeout(() => $("noteText").focus(), 60);
}
async function saveNote() {
  if (!editingNote) return;
  const a = state.activities.find(x => x.id === editingNote.activityId);
  if (!a) return;
  const entry = editingNote.entry;
  entry.n = $("noteText").value.trim();
  if (sessionUser && db && entry.id) {
    await dbWrap(db.from("activity_logs").update({ note: entry.n || null }).eq("id", entry.id), "update note");
  }
  save();
  $("noteModal").classList.add("hidden");
  editingNote = null;
  render(); renderDetail(a.id);
  toast(entry.n ? "📝 Note saved" : "Note removed");
}

/* ---------------- year-in-review heatmap ---------------- */
const dayKey = (t) => {
  const d = new Date(t);
  return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
};
const fmtTime = (t) =>
  new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function openHeatmap() {
  buildHeatmap();
  $("heatmapModal").classList.remove("hidden");
}
function buildHeatmap() {
  const map = {};
  state.activities.forEach(a => a.logs.forEach(entry => {
    const k = dayKey(entry.t);
    (map[k] = map[k] || []).push({ a, entry });
  }));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (52 * 7 - 1) - start.getDay()); // align to Sunday
  const heat = $("heatmap");
  heat.innerHTML = "";
  let prevMonth = -1, total = 0;
  for (let w = 0; w < 53; w++) {
    const col = document.createElement("div");
    col.className = "hweek";
    const weekStart = new Date(start); weekStart.setDate(weekStart.getDate() + w * 7);
    const m = weekStart.getMonth();
    const label = document.createElement("span");
    label.className = "hmonth";
    label.textContent = m !== prevMonth ? weekStart.toLocaleString(undefined, { month: "short" }) : "";
    prevMonth = m;
    col.appendChild(label);
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start); dt.setDate(dt.getDate() + w * 7 + d);
      const cell = document.createElement("button");
      cell.type = "button";
      if (dt > today) {
        cell.className = "hcell future";
        cell.disabled = true;
      } else {
        const k = dayKey(dt.getTime());
        const items = map[k] || [];
        total += items.length;
        cell.className = "hcell lvl" + (items.length === 0 ? 0 : items.length === 1 ? 1 : items.length <= 3 ? 2 : 3);
        cell.dataset.t = dt.getTime();
        if (dt.getTime() === today.getTime()) cell.classList.add("today");
        cell.title = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) +
          ` — ${items.length} log${items.length === 1 ? "" : "s"}`;
        cell.onclick = () => selectHeatDay(dt.getTime(), items);
      }
      col.appendChild(cell);
    }
    heat.appendChild(col);
  }
  $("heatmapSub").textContent = `${total} log${total === 1 ? "" : "s"} in the last year`;
  const tk = dayKey(today.getTime());
  selectHeatDay(today.getTime(), map[tk] || []);
  const scroller = heat.parentElement;
  scroller.scrollLeft = scroller.scrollWidth;
}
function selectHeatDay(t, items) {
  document.querySelectorAll("#heatmap .hcell.selected").forEach(c => c.classList.remove("selected"));
  const cell = document.querySelector(`#heatmap .hcell[data-t="${t}"]`);
  if (cell) cell.classList.add("selected");
  const d = new Date(t);
  $("heatmapDayTitle").textContent =
    d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const ul = $("heatmapDayList");
  ul.innerHTML = "";
  if (!items.length) {
    ul.innerHTML = `<li class="empty-h">Nothing logged this day.</li>`;
    return;
  }
  [...items].sort((x, y) => x.entry.t - y.entry.t).forEach(({ a, entry }) => {
    const li = document.createElement("li");
    li.innerHTML = `<span><span class="h-date">${esc(a.emoji || "⏱️")} ${esc(a.name)}</span>` +
      `<span class="h-gap">${fmtTime(entry.t)}${entry.n ? " · “" + esc(entry.n) + "”" : ""}</span></span>`;
    ul.appendChild(li);
  });
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
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.activities)) throw new Error("bad shape");
      if (!confirm(`Import backup with ${parsed.activities.length} activities? This replaces your current data.`)) return;
      state = parsed;
      state.activities.forEach(a => {
        if (!a.id) a.id = uid();
        a.logs = normalizeLogs(a.logs);
        // imported entries become local-only until re-synced
        a.logs.forEach(l => { l.id = null; });
      });
      if (sessionUser && db) {
        // replace cloud data with the import
        const ids = state.activities.map(a => a.id);
        await dbWrap(db.from("activities").delete().in("id", ids), "clear activities");
        await syncOnSignIn(); // pushes local up since cloud is now empty
      } else {
        save(); render();
      }
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
  updateAuthUi();

  $("search").addEventListener("input", (e) => { ui.search = e.target.value; renderGrid(); });

  const fab = $("fab");
  if (fab) fab.onclick = () => openActivityModal(null);
  $("emptyAddBtn").onclick = () => openActivityModal(null);
  $("emptySampleBtn").onclick = loadSamples;
  $("activityForm").addEventListener("submit", saveActivityForm);
  $("cancelModal").onclick = () => $("activityModal").classList.add("hidden");

  $("closeDetail").onclick = () => $("detailModal").classList.add("hidden");
  $("dLogNow").onclick = () => { if (detailId) logNow(detailId); };
  $("dEdit").onclick = () => { if (detailId) { $("detailModal").classList.add("hidden"); openActivityModal(detailId); } };
  $("dDelete").onclick = async () => {
    const a = state.activities.find(x => x.id === detailId);
    if (!a) return;
    if (!confirm(`Delete “${a.name}” and all its logs?`)) return;
    if (sessionUser && db) {
      await dbWrap(db.from("activities").delete().eq("id", a.id), "delete activity");
    }
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

  /* auth UI */
  $("authBtn").onclick = () => {
    if (sessionUser) {
      if (confirm(`Signed in as ${sessionUser.email}.\nSign out?`)) signOut();
    } else {
      $("authStatus").textContent = "";
      $("authModal").classList.remove("hidden");
      setTimeout(() => $("authEmail").focus(), 50);
    }
  };
  $("cancelAuth").onclick = () => $("authModal").classList.add("hidden");
  $("magicLinkForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("authEmail").value.trim();
    if (email) sendMagicLink(email);
  });

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
  if (act === "heatmap") openHeatmap();
    if (act === "signout") signOut();
    if (act === "wipe") {
      if (confirm("Delete ALL activities and logs? This can't be undone.")) {
        (async () => {
          if (sessionUser && db) {
            const ids = state.activities.map(a => a.id);
            if (ids.length) await dbWrap(db.from("activities").delete().in("id", ids), "wipe");
          }
          state = { version: 1, activities: [] };
          save(); render();
          toast("Everything deleted");
        })();
      }
    }
  }));
  $("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });

  $("cancelNote").onclick = () => $("noteModal").classList.add("hidden");
  $("saveNote").onclick = saveNote;
  $("closeHeatmap").onclick = () => $("heatmapModal").classList.add("hidden");

  document.querySelectorAll(".modal-backdrop").forEach(bd => {
    bd.addEventListener("click", (e) => { if (e.target === bd) bd.classList.add("hidden"); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelectorAll(".modal-backdrop").forEach(bd => bd.classList.add("hidden"));
  });

  /* cloud sync (non-blocking) */
  initDb();
}

function loadSamples() {
  if (state.activities.length && !confirm("Load sample data? This replaces your current data.")) return;
  (async () => {
    if (sessionUser && db) {
      const ids = state.activities.map(a => a.id);
      if (ids.length) await dbWrap(db.from("activities").delete().in("id", ids), "clear");
    }
    state = sampleData();
    save(); render();
    if (sessionUser && db) await syncOnSignIn(); // pushes samples up
    toast("Sample data loaded");
  })();
}

document.addEventListener("DOMContentLoaded", init);
