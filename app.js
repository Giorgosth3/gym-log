import { firebaseConfig } from "./firebase-config.js";
import { firebaseBackend, mockBackend } from "./backend.js";

/* ---------- defaults ---------- */
const DEFAULT_DAYS = ["Push", "Pull", "Legs", "Shoulders"];
const BASE = {
  Push: ["Chest Press", "Pec machine elbows", "Rope Tricep extension Vertical", "Rope Tricep extension – entrance", "Rope Tricep extension - cables machine", "One hand tri extension - entrance", "One hand tri extension – double cables"],
  Pull: ["Lat pulldown straight grip", "Close grip", "Lat Pulldown Neutral Grip", "Lower back - freeweight", "Standing bicep curls", "Standing Hammer curls"],
  Legs: ["Hack squat", "Hamstring curls", "Leg extensions (aristera)", "Calves"],
  Shoulders: ["Shoulder press", "Lateral raises machine", "Face pulls"]
};
const DEFAULT_PREFS = { units: "kg", restOn: true, restSec: 90, goal: null, weekTarget: 4, keepAwake: true };
const KG_LB = 2.20462;

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayISO = () => isoOf(new Date());
const mem = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const clone = o => JSON.parse(JSON.stringify(o));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmtDate = iso => { const [y, m, d] = iso.split("-"); return d + "/" + m + "/" + y.slice(2); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shortDate = iso => { const [y, m, d] = iso.split("-").map(Number); return d + " " + MON[m - 1]; };
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return WD[new Date(y, m - 1, d).getDay()] + " " + d + " " + MON[m - 1]; };
const r1 = n => Math.round(n * 10) / 10;
const trim = n => String(r1(n)).replace(/\.0$/, "");
const fmtSec = s => Math.floor(s / 60) + ":" + pad(Math.max(0, Math.round(s % 60)));

/* ---------- state ---------- */
let be = null, uid = null, unsub = null;
let sessions = {}, days = [...DEFAULT_DAYS], lists = clone(BASE), prefs = { ...DEFAULT_PREFS }, body = { entries: {} };
let day = mem.get("day") || "Push", tab = mem.get("tab") || "training";
let renaming = null, armed = null, adding = null, dayEditing = null, selSet = null;
const expanded = new Set();

/* ---------- units ---------- */
const U = () => prefs.units === "lbs" ? "lbs" : "kg";
const disp = kg => U() === "lbs" ? r1(kg * KG_LB) : r1(kg);         // number in display units
const fmtW = kg => trim(disp(kg)) + U();                              // "30kg" / "66.1lbs"
const toKg = v => U() === "lbs" ? Math.round(v / KG_LB * 100) / 100 : v;
const wStep = () => U() === "lbs" ? 5 : 2.5;

/* ---------- screens ---------- */
function show(which) { ["gate", "loading", "main"].forEach(id => { $(id).hidden = id !== which; }); }
const exercisesFor = d => [...(lists[d] || [])];
function allSets() { const out = []; Object.values(sessions).forEach(s => (s.sets || []).forEach(x => out.push({ ...x, date: s.date }))); return out; }
const working = sets => sets.filter(s => !s.wu);
const e1rm = s => s.r <= 1 ? s.w : s.w * (1 + s.r / 30);   // Epley estimate of a 1-rep max
function namesFor(d) { const n = exercisesFor(d); allSets().forEach(s => { if (s.day === d && !n.includes(s.ex)) n.push(s.ex); }); return n; }

function toast(msg, err) {
  const t = $("toast"); t.textContent = msg; t.className = err ? "err" : "";
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.textContent = ""; }, 3200);
}
const offlineNote = () => navigator.onLine ? "" : " · syncs when you're back online";

/* ---------- tabs + day buttons ---------- */
function renderTabs() {
  ["training", "history", "progress", "body"].forEach(t => { $("pane-" + t).hidden = t !== tab; });
  document.querySelectorAll("[data-tab]").forEach(b => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  $("dayBtns").hidden = !(tab === "training" || tab === "history");
}
function setTab(t) { tab = t; mem.set("tab", t); if (t !== "history") adding = null; renaming = null; armed = null; selSet = null; renderTabs(); renderPane(); window.scrollTo(0, 0); syncWake(); }
function renderDayBtns() {
  if (!days.includes(day)) day = days[0] || "";
  const box = $("dayBtns"); box.innerHTML = "";
  days.forEach(d => {
    const b = el("button", null, d); b.setAttribute("aria-pressed", d === day);
    b.onclick = () => { day = d; mem.set("day", d); adding = null; renaming = null; armed = null; selSet = null; renderDayBtns(); renderSelect(); renderPane(); };
    box.appendChild(b);
  });
}
function renderPane() {
  if (tab === "training") renderExercise(false);
  if (tab === "history") renderHistory();
  if (tab === "progress") renderProgress();
  if (tab === "body") renderBody();
}
function renderAll() { renderDayBtns(); renderSelect(); renderUnits(); renderSettings(); if (!renaming && !adding) renderPane(); else renderHint(); }

/* ---------- training ---------- */
function renderSelect() {
  const sel = $("ex"), keep = mem.get("ex_" + day);
  sel.innerHTML = "";
  namesFor(day).forEach(n => sel.appendChild(el("option", null, n)));
  if (keep && namesFor(day).includes(keep)) sel.value = keep;
  renderExercise(true);
}
// Everything on the logging card for the chosen exercise. prefill=true fills weight/reps.
function renderExercise(prefill) {
  renderExGrid(); renderHint(); renderToday();
  const ex = $("ex").value; $("logCard").hidden = !ex; $("exTitle").textContent = ex;
  const done = todaySets(ex).length; $("setNo").textContent = ex ? "Set " + (done + 1) : "";
  if (prefill) prefillSet();
}
function todaySets(ex) { const cur = $("date").value; return working(((sessions[cur] || {}).sets || []).filter(s => s.ex === ex && s.day === day)).sort((a, b) => a.t - b.t); }
function lastSession(ex) {
  const prev = working(allSets().filter(s => s.ex === ex && s.date < $("date").value));
  if (!prev.length) return null;
  const d = prev.reduce((a, s) => s.date > a ? s.date : a, "");
  return { date: d, sets: prev.filter(s => s.date === d).sort((a, b) => a.t - b.t) };
}
// #1 match set numbers: set N today starts from set N last time (or the last one if you do more sets)
function prefillSet() {
  const ex = $("ex").value, note = $("filledNote"); note.hidden = true; if (!ex) return;
  const n = todaySets(ex).length + 1, last = lastSession(ex);
  if (last) {
    const pick = last.sets[n - 1] || last.sets[last.sets.length - 1];
    $("w").value = trim(disp(pick.w)); $("r").value = String(pick.r);
    note.textContent = last.sets[n - 1] ? "Filled in from set " + n + " last time. Adjust if needed." : "Filled in from your last set last time. Adjust if needed.";
    note.hidden = false;
  } else {
    const today = todaySets(ex); if (today.length) { const s = today[today.length - 1]; $("w").value = trim(disp(s.w)); $("r").value = String(s.r); }
  }
}
function pickEx(ex) {
  $("ex").value = ex; mem.set("ex_" + day, ex); renderExercise(true);
  // bring the logging card (with Save) into view
  $("logCard").scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function renderExGrid() {
  const grid = $("exGrid"), cur = $("ex").value; grid.innerHTML = "";
  namesFor(day).forEach(ex => {
    const b = el("button", "exb"), n = todaySets(ex).length, last = n ? null : lastSession(ex);
    b.type = "button"; b.setAttribute("aria-pressed", String(ex === cur));
    if (n) b.classList.add("done");
    const sub = n ? "✓ " + n + " set" + (n > 1 ? "s" : "") : last ? "Last: " + fmtW(last.sets[last.sets.length - 1].w) + " × " + last.sets[last.sets.length - 1].r : "Not done yet";
    b.append(el("span", null, ex), el("small", null, sub));
    b.onclick = () => pickEx(ex);
    grid.appendChild(b);
  });
  const add = el("button", "exb add", "+ Add exercise"); add.type = "button";
  add.onclick = () => { adding = day; setTab("history"); setTimeout(() => { const i = $("newEx"); if (i) i.scrollIntoView({ block: "center" }); }, 60); };
  grid.appendChild(add);
}
// sets: chips; when `rerender` is given, chips are tappable and tapping one offers "Remove set"
function chipsInto(box, sets, rerender) {
  sets.forEach(s => {
    const label = fmtW(s.w) + " × " + s.r;
    const c = el(rerender ? "button" : "span", "chip" + (s.wu ? " wu" : ""), label);
    if (s.rir != null) c.appendChild(el("span", "rir", s.rir >= 3 ? "3+ left" : s.rir + " left"));
    if (s.note) c.appendChild(el("small", null, s.note));
    if (rerender) {
      const key = s.date + "|" + s.t, on = selSet === key;
      c.type = "button"; c.classList.add("tap"); if (on) c.classList.add("sel");
      c.setAttribute("aria-pressed", on); c.setAttribute("aria-label", (s.wu ? "Warm-up " : "") + label + (s.note ? ", " + s.note : "") + ", " + longDate(s.date) + ". Tap for options");
      c.onclick = () => { selSet = on ? null : key; rerender(); };
    }
    box.appendChild(c);
  });
}
// The bar shown under a tapped set: second tap removes it.
function setBar(sets, rerender) {
  const s = sets.find(x => selSet === x.date + "|" + x.t); if (!s) return null;
  const bar = el("div", "setbar"), yes = el("button", "use danger", "Remove set"), no = el("button", "use", "Cancel");
  bar.appendChild(el("span", null, fmtW(s.w) + " × " + s.r + " · " + shortDate(s.date)));
  yes.onclick = () => { selSet = null; removeSetByT(s.date, s.t); };
  no.onclick = () => { selSet = null; rerender(); };
  const b = el("div", "btns"); b.append(yes, no); bar.appendChild(b);
  return bar;
}
function renderHint() {
  const ex = $("ex").value, h = $("hint"); h.innerHTML = "";
  if (!ex) return;
  const last = lastSession(ex);
  if (!last) { h.textContent = "No earlier sets for this one yet."; return; }
  h.appendChild(el("span", null, "Last time · " + shortDate(last.date) + " (tap to copy):"));
  last.sets.forEach(s => {
    const b = el("button", "chip copy", fmtW(s.w) + " × " + s.r); b.type = "button";
    b.setAttribute("aria-label", "Copy " + fmtW(s.w) + " × " + s.r);
    b.onclick = () => { $("w").value = trim(disp(s.w)); $("r").value = String(s.r); h.querySelectorAll(".copied").forEach(x => x.classList.remove("copied")); b.classList.add("copied"); $("filledNote").hidden = true; };
    h.appendChild(b);
  });
}
function renderToday() {
  const ex = $("ex").value, cur = $("date").value;
  const sets = ((sessions[cur] || {}).sets || []).filter(s => s.ex === ex).sort((a, b) => a.t - b.t);
  $("todayBox").hidden = !sets.length;
  $("todayBox").querySelector(".lbl").textContent = cur === todayISO() ? "Today so far" : "Sets on " + longDate(cur);
  const box = $("todayChips"); box.innerHTML = ""; chipsInto(box, sets.map(s => ({ ...s, date: cur })), renderToday);
  const bar = setBar(sets.map(s => ({ ...s, date: cur })), renderToday); if (bar) box.appendChild(bar);
}
function renderDateLbl() { const d = $("date").value; $("dateLbl").textContent = d === todayISO() ? "Today" : longDate(d); }
function renderUnits() {
  $("wLbl").textContent = "Weight (" + U() + ")";
  $("bwLbl").textContent = "Weigh-in · " + longDate($("date").value) + " (" + U() + ")";
  $("goalLbl").textContent = "Goal weight (" + U() + ")";
  document.querySelectorAll("[data-unit]").forEach(b => b.setAttribute("aria-pressed", b.dataset.unit === U()));
}

function saveSet() {
  const v = parseFloat(String($("w").value).replace(",", ".")), r = parseInt($("r").value, 10);
  if (!(v >= 0) || !(r > 0)) { toast("Enter a weight and at least 1 rep.", true); return; }
  const date = $("date").value || todayISO(), ex = $("ex").value;
  if (!ex) { toast("Pick an exercise first.", true); return; }
  const w = toKg(v), wu = false, t = Date.now();
  const prevMax = Math.max(-1, ...working(allSets().filter(s => s.ex === ex)).map(s => s.w));
  const s = sessions[date] || { date, sets: [] };
  const set = { day, ex, w, r, note: $("note").value.trim(), t }; if (wu) set.wu = true;
  const next = { date, sets: [...(s.sets || []), set] };
  sessions[date] = next;
  writeSession(date, next);
  const n = working(next.sets.filter(x => x.ex === ex)).length;
  toast(wu ? "Warm-up saved: " + fmtW(w) + " × " + r + offlineNote()
    : (prevMax >= 0 && w > prevMax ? "New personal best! " : "Saved: ") + ex + " set " + n + " — " + fmtW(w) + " × " + r + offlineNote());
  $("note").value = "";
  renderExercise(true);
  if (prefs.restOn) startRest(prefs.restSec);
}

/* ---------- rest timer: a pill in the top bar, visible on every tab ---------- */
let restTick = null, doneTimer = null;
function startRest(sec) { mem.set("restEnd", String(Date.now() + sec * 1000)); runRest(); }
function stopRest() {
  mem.set("restEnd", ""); clearInterval(restTick); restTick = null; clearTimeout(doneTimer);
  $("timerPill").hidden = true; $("timerPill").classList.remove("done"); closeTimerMenu(); document.body.classList.remove("resting");
}
function closeTimerMenu() { $("timerMenu").hidden = true; $("timerPill").setAttribute("aria-expanded", "false"); }
function runRest() {
  clearInterval(restTick); clearTimeout(doneTimer);
  const pill = $("timerPill"); pill.hidden = false; pill.classList.remove("done"); document.body.classList.add("resting");
  const tick = () => {
    const end = Number(mem.get("restEnd") || 0), left = (end - Date.now()) / 1000;
    if (!end) { stopRest(); return; }
    if (left <= 0) {
      clearInterval(restTick); restTick = null; mem.set("restEnd", ""); closeTimerMenu();
      pill.classList.add("done"); $("timerTime").textContent = "Go!"; pill.setAttribute("aria-label", "Rest over");
      toast("Rest over. Next set!");
      try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) {}
      doneTimer = setTimeout(() => { if (!mem.get("restEnd")) { pill.hidden = true; pill.classList.remove("done"); document.body.classList.remove("resting"); } }, 6000);
      return;
    }
    $("timerTime").textContent = fmtSec(Math.ceil(left)); pill.setAttribute("aria-label", "Rest timer " + fmtSec(Math.ceil(left)) + ". Tap for options");
  };
  tick(); restTick = setInterval(tick, 250);
}

/* ---------- keep the screen on while on Training ---------- */
let wakeLock = null;
async function syncWake() {
  const want = prefs.keepAwake !== false && tab === "training" && document.visibilityState === "visible" && !$("main").hidden;
  if (want && !wakeLock && "wakeLock" in navigator) {
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; $("awakeLine").hidden = true; }); } catch (e) { wakeLock = null; }
  } else if (!want && wakeLock) { try { await wakeLock.release(); } catch (e) {} wakeLock = null; }
  $("awakeLine").hidden = !(want && wakeLock);
}

/* ---------- history ---------- */
function renderHistory() {
  const hd = day, box = $("history"); box.innerHTML = "";
  const all = allSets(), cur = $("date").value, names = namesFor(hd);
  if (!names.length) box.appendChild(el("div", "empty", "No exercises for " + hd + " yet. Add your first one below."));
  else if (all.some(s => s.day === hd)) box.appendChild(el("p", "small tip", "Tap any set to remove it."));
  names.forEach(ex => {
    const byDate = {}; all.filter(s => s.ex === ex && s.day === hd).forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
    const dates = Object.keys(byDate).sort().reverse();
    const card = el("div", "ex-card"), head = el("div", "ex-head");
    const nSets = all.filter(s => s.ex === ex && s.day === hd).length, key = hd + "|" + ex;
    if (renaming === key) {
      head.className = "ex-head renaming";
      const inp = el("input"); inp.type = "text"; inp.id = "rename-input"; inp.value = ex; inp.setAttribute("aria-label", "New name for " + ex);
      const ok = el("button", "use primary", "Save"), no = el("button", "use", "Cancel");
      ok.onclick = () => renameExercise(hd, ex, inp.value);
      no.onclick = () => { renaming = null; renderHistory(); };
      inp.onkeydown = e => { if (e.key === "Enter") ok.click(); if (e.key === "Escape") no.click(); };
      head.append(inp, ok, no); card.appendChild(head);
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    } else {
      const btns = el("div", "btns");
      if (armed === key) {
        // second step: confirm or cancel
        const no = el("button", "use", "Cancel"), yes = el("button", "use danger", "Remove");
        yes.setAttribute("aria-label", "Confirm: remove " + ex);
        no.onclick = () => { armed = null; renderHistory(); };
        yes.onclick = () => { armed = null; removeExercise(hd, ex); };
        btns.append(no, yes);
      } else {
        const ren = el("button", "use", "Rename"), rm = el("button", "use", "Remove");
        rm.setAttribute("aria-label", "Remove " + ex);
        ren.onclick = () => { renaming = key; armed = null; adding = null; renderHistory(); };
        rm.onclick = () => { armed = key; renaming = null; renderHistory(); };
        btns.append(ren, rm);
      }
      head.append(el("h3", null, ex), btns); card.appendChild(head);
      if (armed === key) card.appendChild(el("p", "small warn", nSets ? "This deletes " + ex + " and its " + nSets + " logged set" + (nSets > 1 ? "s" : "") + "." : "This removes " + ex + " from " + hd + "."));
    }
    if (!dates.length) card.appendChild(el("div", "none", "No sets logged yet."));
    (expanded.has(ex) ? dates : dates.slice(0, 3)).forEach((d, idx) => {
      const row = el("div", "sess" + (idx === 0 ? " latest" : "")), chips = el("div", "chips"), list = byDate[d].sort((a, b) => a.t - b.t);
      chipsInto(chips, list, renderHistory);
      row.append(el("span", "d", fmtDate(d)), chips); card.appendChild(row);
      const bar = setBar(list, renderHistory); if (bar) card.appendChild(bar);
    });
    if (dates.length > 3) {
      const m = el("button", "more", expanded.has(ex) ? "Show fewer" : "Show all " + dates.length + " sessions");
      m.onclick = () => { expanded.has(ex) ? expanded.delete(ex) : expanded.add(ex); renderHistory(); };
      card.appendChild(m);
    }
    box.appendChild(card);
  });
  box.appendChild(addCard(hd));
}
function addCard(hd) {
  const card = el("div", "ex-card add-card");
  if (adding === hd) {
    const head = el("div", "ex-head renaming"), inp = el("input");
    inp.type = "text"; inp.id = "newEx"; inp.placeholder = "New " + hd + " exercise"; inp.setAttribute("aria-label", "New " + hd + " exercise name");
    const ok = el("button", "use primary", "Add"), no = el("button", "use", "Cancel");
    ok.onclick = () => addExercise(hd, inp.value); no.onclick = () => { adding = null; renderHistory(); };
    inp.onkeydown = e => { if (e.key === "Enter") ok.click(); if (e.key === "Escape") no.click(); };
    head.append(inp, ok, no); card.appendChild(head); setTimeout(() => inp.focus(), 0);
  } else {
    const b = el("button", "add-btn", "+ Add an exercise to " + hd);
    b.onclick = () => { adding = hd; renaming = null; renderHistory(); };
    card.appendChild(b);
  }
  return card;
}
function pickExercise(d, ex, last) {
  day = d; mem.set("day", day); renderDayBtns(); renderSelect();
  $("ex").value = ex; mem.set("ex_" + day, ex);
  if (last) { $("w").value = trim(disp(last.w)); $("r").value = last.r; }
  setTab("training");
}

/* ---------- progress ---------- */
function niceTicks(lo, hi) {
  const span = hi - lo || 1, raw = span / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const build = st => { const out = []; for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + 1e-9; v += st) out.push(r1(v)); return out; };
  let out = build(step);
  while (out.length < 2 && step > 0.1) { step /= 2; out = build(step); }
  return out;
}
// Line chart as SVG. pts: [{label, v}], opts.goal draws a dashed target line.
function lineChart(pts, opts = {}) {
  const W = 340, H = 180, L = 36, R = 12, T = 14, B = 26;
  const vals = pts.map(p => p.v).concat(opts.goal != null ? [opts.goal] : [], opts.avg || []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) { lo -= 1; hi += 1; }
  const padv = (hi - lo) * 0.12; lo -= padv; hi += padv;
  const ticks = niceTicks(lo, hi).filter(t => t >= lo && t <= hi);
  const x = i => pts.length === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (pts.length - 1);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", opts.label || "Chart");
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text != null) n.textContent = text; svg.appendChild(n); return n; };
  const muted = "var(--muted)";
  ticks.forEach(t => { add("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: "var(--line)" }); add("text", { x: L - 6, y: y(t) + 4, "text-anchor": "end", "font-size": 11, fill: muted, "font-family": "Rubik, sans-serif" }, trim(t)); });
  const every = Math.max(1, Math.ceil(pts.length / 5));
  pts.forEach((p, i) => { if (i % every === 0 || i === pts.length - 1) add("text", { x: x(i), y: H - 6, "text-anchor": i === 0 && pts.length > 1 ? "start" : i === pts.length - 1 && pts.length > 1 ? "end" : "middle", "font-size": 11, fill: muted, "font-family": "Rubik, sans-serif" }, p.label); });
  if (opts.goal != null) {
    add("line", { x1: L, x2: W - R, y1: y(opts.goal), y2: y(opts.goal), stroke: "var(--ok)", "stroke-dasharray": "5 4", "stroke-width": 1.5 });
    add("text", { x: W - R, y: y(opts.goal) - 6, "text-anchor": "end", "font-size": 11, fill: "var(--ok)", "font-family": "Rubik, sans-serif" }, "Goal " + trim(opts.goal));
  }
  if (opts.avg) { // raw values as faint dots, the average as the line
    pts.forEach((p, i) => add("circle", { cx: x(i), cy: y(p.v), r: 2.8, fill: muted, opacity: .75 }));
    if (pts.length > 1) add("path", { d: opts.avg.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" "), fill: "none", stroke: "var(--accent)", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" });
    const li = pts.length - 1; add("circle", { cx: x(li), cy: y(opts.avg[li]), r: 5.5, fill: "var(--accent)" });
    return svg;
  }
  if (pts.length > 1) {
    const d = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
    if (opts.area) add("path", { d: d + ` L ${x(pts.length - 1)} ${H - B} L ${x(0)} ${H - B} Z`, fill: "var(--accent)", opacity: .12 });
    add("path", { d, fill: "none", stroke: "var(--accent)", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" });
  }
  pts.forEach((p, i) => { const last = i === pts.length - 1; add("circle", { cx: x(i), cy: y(p.v), r: last ? 6 : 4, fill: last ? "var(--accent)" : "var(--surface)", stroke: "var(--accent)", "stroke-width": 2 }); });
  return svg;
}
function stat(value, label, cls) { const s = el("div", "stat"), b = el("b", cls || null, value); s.append(b, el("span", null, label)); return s; }
function renderProgress() {
  const view = mem.get("pView") === "cons" ? "cons" : "ex";
  document.querySelectorAll("[data-pview]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.pview === view)));
  $("pvEx").hidden = view !== "ex"; $("pvCons").hidden = view !== "cons";
  if (view === "cons") { renderConsistency(); return; }
  const pDay = $("pDay"), pEx = $("pEx");
  let pd = mem.get("pDay"); if (!days.includes(pd)) pd = day;
  pDay.innerHTML = ""; days.forEach(d => pDay.appendChild(el("option", null, d))); pDay.value = pd;
  const names = namesFor(pd); let pe = mem.get("pEx_" + pd); if (!names.includes(pe)) pe = names[0] || "";
  pEx.innerHTML = ""; names.forEach(n => pEx.appendChild(el("option", null, n))); pEx.value = pe;
  const box = $("progBody"); box.innerHTML = "";
  if (!pe) { box.appendChild(el("div", "empty", "No exercises in " + pd + " yet.")); return; }
  const sets = working(allSets().filter(s => s.ex === pe && s.day === pd));
  if (!sets.length) { box.appendChild(el("div", "empty", "No working sets logged for " + pe + " yet. Log one in Training and your progress will show here.")); }
  else {
    // personal best: heaviest working weight, then most reps
    const pb = sets.reduce((a, s) => (s.w > a.w || (s.w === a.w && s.r > a.r)) ? s : a);
    const pbCard = el("div", "card"), pbRow = el("div", "pb"), left = el("div");
    left.append(el("span", "lbl", "Personal best"), el("b", null, fmtW(pb.w) + " × " + pb.r));
    pbRow.append(left, el("span", "badge", "PB · " + shortDate(pb.date))); pbCard.appendChild(pbRow); box.appendChild(pbCard);
    // #3 chart: estimated max (default) or top weight
    const metric = mem.get("pMetric") === "top" ? "top" : "est";
    const per = {}; sets.forEach(s => { const v = metric === "est" ? e1rm(s) : s.w; per[s.date] = Math.max(per[s.date] ?? -1, v); });
    const dates = Object.keys(per).sort(), first = disp(per[dates[0]]), lastV = disp(per[dates[dates.length - 1]]), change = lastV - first;
    const chart = el("div", "card chart"); chart.style.gap = "8px";
    const seg = el("div", "seg");
    [["est", "Est. max"], ["top", "Top weight"]].forEach(([k, n]) => { const b = el("button", null, n); b.setAttribute("aria-pressed", String(k === metric)); b.onclick = () => { mem.set("pMetric", k); renderProgress(); }; seg.appendChild(b); });
    const head = el("span", "lbl", metric === "est" ? "Estimated 1-rep max" : "Top weight per session");
    const big = el("div", "bigstat", trim(lastV) + U());
    if (dates.length > 1) big.appendChild(el("small", change > 0 ? "good" : "", (change > 0 ? "+" : "") + trim(change) + U() + " since " + shortDate(dates[0])));
    chart.append(seg, head, big, lineChart(dates.map(d => ({ label: shortDate(d), v: disp(per[d]) })), { area: true, label: (metric === "est" ? "Estimated max" : "Top weight") + " per session for " + pe }));
    if (metric === "est") chart.appendChild(el("span", "small", "Estimated from your weight and reps, so you see progress even when you add reps instead of weight."));
    box.appendChild(chart);
    const weekAgo = isoOf(new Date(Date.now() - 6 * 86400e3));
    const vol = sets.filter(s => s.date >= weekAgo && s.date <= todayISO()).reduce((a, s) => a + disp(s.w) * s.r, 0);
    const stats = el("div", "stats");
    stats.append(stat(String(dates.length), dates.length === 1 ? "session" : "sessions"), stat(fmtW(pb.w), "heaviest set"), stat(Math.round(vol).toLocaleString("en-GB") + U(), "volume last 7 days"));
    box.appendChild(stats);
  }
  // #8 plateau alerts for every exercise in this workout
  plateausFor(pd).forEach(ex => {
    const a = el("div", "alert"); const tags = el("div", "tags");
    ["Aim for +1 rep", "Drop about 10% and build back up", "Swap to a similar exercise"].forEach(t => tags.appendChild(el("span", null, t)));
    a.append(el("b", null, ex + " has stalled"), el("span", null, "No improvement in your last 3 sessions. Try one of these:"), tags);
    box.appendChild(a);
  });
}
// An exercise has stalled when its last 3 sessions beat none of the sessions before them.
function plateausFor(d) {
  const out = [];
  namesFor(d).forEach(ex => {
    const per = {}; working(allSets().filter(s => s.ex === ex && s.day === d)).forEach(s => { per[s.date] = Math.max(per[s.date] ?? 0, e1rm(s)); });
    const ds = Object.keys(per).sort(); if (ds.length < 4) return;
    const recent = ds.slice(-3).map(k => per[k]), before = ds.slice(0, -3).map(k => per[k]);
    if (Math.max(...recent) <= Math.max(...before) + 0.01) out.push(ex);
  });
  return out;
}
// #5 consistency: calendar, sessions per week, weekly target
let calMonth = null;
function trainedDates() { const set = new Set(); Object.values(sessions).forEach(s => { if (working(s.sets || []).length) set.add(s.date); }); return set; }
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function renderConsistency() {
  const box = $("pvCons"); box.innerHTML = "";
  const tr = trainedDates(), now = new Date();
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), daysIn = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const card = el("div", "card"), head = el("div", "calhead"), prev = el("button", null, "‹"), next = el("button", null, "›");
  prev.setAttribute("aria-label", "Previous month"); next.setAttribute("aria-label", "Next month");
  prev.onclick = () => { calMonth = new Date(y, m - 1, 1); renderConsistency(); };
  next.onclick = () => { calMonth = new Date(y, m + 1, 1); renderConsistency(); };
  next.disabled = y === now.getFullYear() && m === now.getMonth();
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m] + " " + y;
  head.append(prev, el("span", "lbl", monthName), next);
  const cal = el("div", "cal"); cal.setAttribute("role", "grid"); cal.setAttribute("aria-label", "Training days in " + monthName);
  ["M", "T", "W", "T", "F", "S", "S"].forEach(d => cal.appendChild(el("span", "wd", d)));
  for (let i = 0; i < lead; i++) cal.appendChild(el("span", "blank"));
  let inMonth = 0;
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + "-" + pad(m + 1) + "-" + pad(d), hit = tr.has(iso); if (hit) inMonth++;
    const c = el("span", (hit ? "t" : "") + (iso === todayISO() ? " today" : ""), String(d));
    c.setAttribute("aria-label", d + (hit ? ", trained" : "")); cal.appendChild(c);
  }
  card.append(head, cal); box.appendChild(card);
  // last 8 weeks
  const target = prefs.weekTarget, weeks = [], m0 = mondayOf(now);
  for (let i = 7; i >= 0; i--) {
    const start = new Date(m0); start.setDate(start.getDate() - i * 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const a = isoOf(start), b = isoOf(end); let n = 0; tr.forEach(d => { if (d >= a && d <= b) n++; });
    weeks.push({ label: start.getDate() + " " + MON[start.getMonth()], n, current: i === 0 });
  }
  const wc = el("div", "card"), wh = el("div", "calhead"); wh.append(el("span", "lbl", "Sessions per week"), el("span", "lbl", "Target " + target + " / week"));
  const bars = el("div", "weeks"), maxN = Math.max(target, ...weeks.map(w => w.n), 1);
  weeks.forEach(w => { const d = el("div"), i = el("i", w.n >= target ? "" : "low"); i.style.height = (w.n / maxN * 52 + 2) + "px"; d.append(el("span", "n", String(w.n)), i, el("span", null, w.label)); d.setAttribute("aria-label", "Week of " + w.label + ": " + w.n + " sessions"); bars.appendChild(d); });
  wc.append(wh, bars); box.appendChild(wc);
  const full = weeks.filter(w => !w.current), onTarget = full.filter(w => w.n >= target).length, avg = full.reduce((a, w) => a + w.n, 0) / full.length;
  const stats = el("div", "stats");
  stats.append(stat(String(inMonth), "sessions in " + MON[m]), stat(trim(avg), "avg / week"), stat(onTarget + " of " + full.length, "weeks on target"));
  box.appendChild(stats);
  if (!tr.size) box.appendChild(el("p", "small center", "Your training days will fill in here as you log sets."));
}

/* ---------- body weight ---------- */
function bodyDates() { return Object.keys(body.entries || {}).sort(); }
function renderBody() {
  const cur = $("date").value, ents = body.entries || {}, ds = bodyDates();
  renderUnits();
  if (document.activeElement !== $("bw")) {
    const base = ents[cur] ?? (ds.length ? ents[ds[ds.length - 1]] : (U() === "lbs" ? 165 / KG_LB : 75));
    $("bw").value = trim(disp(base));
  }
  $("bwSave").textContent = ents[cur] != null ? "Update" : "Save";
  if (document.activeElement !== $("goalIn")) $("goalIn").value = prefs.goal != null ? trim(disp(prefs.goal)) : "";
  $("goalClear").hidden = prefs.goal == null;
  const box = $("bodyBody"); box.innerHTML = "";
  if (!ds.length) { box.appendChild(el("div", "empty", "Save your first weigh-in above to start your chart.")); return; }
  const goal = prefs.goal, dayMs = 86400e3, toDate = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
  // 7-day average for each weigh-in
  const avg = ds.map(d => { const t = toDate(d), w = ds.filter(x => toDate(x) <= t && toDate(x) > t - 7 * dayMs).map(x => ents[x]); return w.reduce((a, v) => a + v, 0) / w.length; });
  const nowAvg = avg[avg.length - 1];
  // weekly rate: trend line through the last 4 weeks of weigh-ins
  const lastT = toDate(ds[ds.length - 1]), recent = ds.filter(d => toDate(d) > lastT - 28 * dayMs);
  let rate = null;
  if (recent.length >= 3 && (toDate(recent[recent.length - 1]) - toDate(recent[0])) >= 7 * dayMs) {
    const xs = recent.map(d => (toDate(d) - lastT) / (7 * dayMs)), ys = recent.map(d => ents[d]);
    const mx = xs.reduce((a, v) => a + v, 0) / xs.length, my = ys.reduce((a, v) => a + v, 0) / ys.length;
    const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0), den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    rate = den ? num / den : null;
  }
  const toward = goal != null && rate != null && Math.sign(rate) === Math.sign(goal - nowAvg) && Math.abs(rate) > 0.02;
  const stats = el("div", "stats");
  const rateStat = rate == null ? stat("—", "per week (needs 1 week+)") : stat((rate > 0 ? "+" : "") + trim(disp(rate)) + U(), "per week · " + trim(Math.abs(rate) / nowAvg * 100) + "%", toward ? "good" : "");
  stats.append(stat(fmtW(nowAvg), "7-day average"), rateStat,
    goal != null ? stat(trim(Math.abs(disp(nowAvg) - disp(goal))) + U(), Math.abs(nowAvg - goal) < 0.25 ? "goal reached!" : "to goal") : stat("—", "no goal set"));
  box.appendChild(stats);
  const chart = el("div", "card chart"); chart.style.gap = "6px";
  const hd = el("div", "calhead"); hd.append(el("span", "lbl", "Body weight (" + U() + ")"), el("span", "small", "● daily · line = 7-day average"));
  chart.append(hd, lineChart(ds.map(d => ({ label: shortDate(d), v: disp(ents[d]) })), { goal: goal != null ? disp(goal) : null, avg: avg.map(disp), label: "Body weight over time with 7-day average" }));
  box.appendChild(chart);
  if (rate != null) {
    const pct = Math.abs(rate) / nowAvg * 100;
    if (pct > 1) { const a = el("div", "alert"); a.append(el("b", null, "Fast pace"), el("span", null, "You're changing by more than 1% of your body weight per week. A slower pace is easier to sustain and helps keep muscle.")); box.appendChild(a); }
    else if (pct >= 0.25) { const a = el("div", "alert okay"); a.append(el("b", null, "Steady pace"), el("span", null, "About " + trim(pct) + "% of your body weight per week. Around 0.5–1% a week is a sustainable rate for most people.")); box.appendChild(a); }
  }
  const rows = el("div", "rows");
  ds.slice().reverse().slice(0, 10).forEach(d => {
    const r = el("div", "rowi"), del = el("button", null, "Delete");
    del.setAttribute("aria-label", "Delete weigh-in for " + longDate(d));
    del.onclick = () => { const e = { ...body.entries }; delete e[d]; body = { ...body, entries: e }; saveBody(); renderBody(); toast("Weigh-in deleted." + offlineNote()); };
    r.append(el("span", null, longDate(d)), el("b", null, fmtW(ents[d])), del); rows.appendChild(r);
  });
  box.appendChild(rows);
  if (ds.length > 10) box.appendChild(el("p", "small", "Showing your last 10 weigh-ins. All of them are in the chart and the Excel export."));
}
function saveWeighIn() {
  const v = parseFloat(String($("bw").value).replace(",", "."));
  if (!(v > 0)) { toast("Enter your weight first.", true); return; }
  const d = $("date").value || todayISO(), existed = body.entries[d] != null;
  body = { ...body, entries: { ...body.entries, [d]: toKg(v) } };
  saveBody(); renderBody(); toast((existed ? "Updated " : "Saved ") + longDate(d) + ": " + trim(v) + U() + offlineNote());
}

/* ---------- settings ---------- */
function renderSettings() {
  $("restOn").checked = !!prefs.restOn;
  $("restSecLbl").textContent = fmtSec(prefs.restSec);
  $("weekLbl").textContent = String(prefs.weekTarget);
  $("awakeOn").checked = prefs.keepAwake !== false;
  $("sumTr").textContent = U() + " · rest " + (prefs.restOn ? fmtSec(prefs.restSec) : "off");
  $("sumDays").textContent = days.length + " day" + (days.length === 1 ? "" : "s");
  // workout days
  const dl = $("dayList"); dl.innerHTML = "";
  days.forEach((d, i) => {
    const it = el("div", "oitem");
    if (dayEditing === d) {
      const inp = el("input"); inp.type = "text"; inp.value = d; inp.setAttribute("aria-label", "New name for " + d);
      const ok = el("button", null, "Save"), no = el("button", null, "✕"); no.setAttribute("aria-label", "Cancel");
      ok.onclick = () => renameDay(d, inp.value); no.onclick = () => { dayEditing = null; renderSettings(); };
      inp.onkeydown = e => { if (e.key === "Enter") ok.click(); if (e.key === "Escape") no.click(); };
      it.append(inp, ok, no); setTimeout(() => inp.focus(), 0);
    } else {
      const up = el("button", null, "▲"), dn = el("button", null, "▼"), ren = el("button", null, "Rename"), rm = el("button", null, "✕");
      up.setAttribute("aria-label", "Move " + d + " up"); dn.setAttribute("aria-label", "Move " + d + " down"); rm.setAttribute("aria-label", "Remove " + d);
      up.disabled = i === 0; dn.disabled = i === days.length - 1;
      up.onclick = () => moveDay(i, -1); dn.onclick = () => moveDay(i, 1);
      ren.onclick = () => { dayEditing = d; renderSettings(); }; rm.onclick = () => removeDay(d);
      it.append(el("span", "nm", d), up, dn, ren, rm);
    }
    dl.appendChild(it);
  });
  // exercise order for the selected day
  $("orderLbl").textContent = "Exercise order · " + day;
  const ol = $("exOrder"); ol.innerHTML = ""; const ex = exercisesFor(day);
  if (!ex.length) ol.appendChild(el("div", "oitem", "No exercises in " + day + " yet."));
  ex.forEach((n, i) => {
    const it = el("div", "oitem"), up = el("button", null, "▲"), dn = el("button", null, "▼");
    up.setAttribute("aria-label", "Move " + n + " up"); dn.setAttribute("aria-label", "Move " + n + " down");
    up.disabled = i === 0; dn.disabled = i === ex.length - 1;
    up.onclick = () => moveEx(i, -1); dn.onclick = () => moveEx(i, 1);
    it.append(el("span", "nm", n), up, dn); ol.appendChild(it);
  });
}
function moveDay(i, dir) { const a = [...days]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; days = a; saveLists(); renderDayBtns(); renderSettings(); }
function moveEx(i, dir) { const a = exercisesFor(day); [a[i], a[i + dir]] = [a[i + dir], a[i]]; lists = { ...lists, [day]: a }; saveLists(); renderSelect(); renderSettings(); if (tab === "history") renderHistory(); }
function addDay() {
  const n = $("newDay").value.trim(); if (!n) return;
  if (days.some(d => d.toLowerCase() === n.toLowerCase())) { toast("You already have a day called " + n + ".", true); return; }
  days = [...days, n]; lists = { ...lists, [n]: [] }; $("newDay").value = "";
  saveLists(); renderDayBtns(); renderSettings(); toast("Added " + n + "." + offlineNote());
}
function renameDay(oldName, newName) {
  newName = newName.trim(); dayEditing = null;
  if (!newName || newName === oldName) { renderSettings(); return; }
  if (days.some(d => d !== oldName && d.toLowerCase() === newName.toLowerCase())) { toast("You already have a day called " + newName + ".", true); renderSettings(); return; }
  days = days.map(d => d === oldName ? newName : d);
  const nl = {}; Object.entries(lists).forEach(([k, v]) => { nl[k === oldName ? newName : k] = v; }); lists = nl;
  const changed = [];
  Object.values(sessions).forEach(s => { if ((s.sets || []).some(x => x.day === oldName)) { const n = { date: s.date, sets: s.sets.map(x => x.day === oldName ? { ...x, day: newName } : x) }; sessions[s.date] = n; changed.push(n); } });
  const k = mem.get("ex_" + oldName); if (k) mem.set("ex_" + newName, k);
  if (day === oldName) { day = newName; mem.set("day", day); }
  if (mem.get("pDay") === oldName) mem.set("pDay", newName);
  saveLists(); changed.forEach(s => writeSession(s.date, s));
  renderAll(); toast("Renamed to " + newName + "." + offlineNote());
}
function removeDay(d) {
  if (days.length <= 1) { toast("Keep at least one workout day.", true); return; }
  const n = allSets().filter(s => s.day === d).length;
  if (n) { toast(d + " has " + n + " logged set" + (n > 1 ? "s" : "") + ". Remove its exercises in History first.", true); return; }
  days = days.filter(x => x !== d); const nl = { ...lists }; delete nl[d]; lists = nl;
  saveLists(); renderAll(); toast("Removed " + d + "." + offlineNote());
}

/* ---------- colours: built-in and your own themes ---------- */
const BUILTIN = [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"], ["ael", "AEL Blue"], ["ael-yellow", "AEL Yellow"], ["ael-soft", "AEL Soft"]];
const VAR_KEYS = ["--bg", "--surface", "--ink", "--muted", "--line", "--accent", "--accent-ink", "--ok", "--chip", "--danger", "--warn", "--pressed", "--pressed-ink", "color-scheme"];
let themeEditing = null, themeArmed = null;
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbHex = c => "#" + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
// Four picked colours become the full palette.
function themeVars(t) {
  const dark = lum(t.bg) < 0.3, inkOnAccent = contrast("#ffffff", t.accent) >= contrast("#111111", t.accent) ? "#ffffff" : "#111111";
  return {
    "--bg": t.bg, "--surface": t.surface, "--ink": t.ink,
    "--muted": mix(t.ink, t.bg, 0.4), "--line": mix(t.ink, t.surface, 0.82), "--chip": mix(t.ink, t.surface, 0.9),
    "--accent": t.accent, "--accent-ink": inkOnAccent,
    "--ok": dark ? "#3fc27a" : "#1f8a4c", "--danger": dark ? "#e5484d" : "#c62828", "--warn": dark ? "#f5b041" : "#b26a00",
    "--pressed": t.accent, "--pressed-ink": inkOnAccent, "color-scheme": dark ? "dark" : "light"
  };
}
function customThemes() { return Array.isArray(prefs.customThemes) ? prefs.customThemes : []; }
function paintTheme(previewVars) {
  const r = document.documentElement, t = mem.get("theme") || "auto";
  VAR_KEYS.forEach(k => r.style.removeProperty(k));
  let vars = previewVars || null;
  if (!vars && t.startsWith("custom:")) {
    const th = customThemes().find(x => "custom:" + x.id === t);
    if (th) vars = themeVars(th); else { try { vars = JSON.parse(mem.get("themeVars") || "null"); } catch (e) {} }
  }
  if (vars) { r.setAttribute("data-theme", "custom"); Object.entries(vars).forEach(([k, v]) => r.style.setProperty(k, v)); if (!previewVars) mem.set("themeVars", JSON.stringify(vars)); }
  else if (t === "auto" || t.startsWith("custom:")) r.removeAttribute("data-theme"); else r.setAttribute("data-theme", t);
  const bg = getComputedStyle(r).getPropertyValue("--bg").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = (t === "auto" && !vars) ? (m.media.includes("dark") ? "#121518" : "#f7f5f2") : bg; });
}
function pickTheme(id) { mem.set("theme", id); themeArmed = null; paintTheme(); renderThemes(); }
function renderThemes() {
  const grid = $("themeGrid"), cur = mem.get("theme") || "auto"; grid.innerHTML = "";
  BUILTIN.forEach(([id, n]) => { const b = el("button", null, n); b.setAttribute("aria-pressed", String(cur === id)); b.onclick = () => pickTheme(id); grid.appendChild(b); });
  customThemes().forEach(th => {
    const b = el("button", "custom", th.name), id = "custom:" + th.id;
    b.style.background = th.bg; b.style.color = th.ink; b.style.borderColor = th.accent;
    b.setAttribute("aria-pressed", String(cur === id)); b.setAttribute("aria-label", th.name + " (your theme)");
    b.onclick = () => pickTheme(id); grid.appendChild(b);
  });
  const curName = (BUILTIN.find(x => x[0] === cur) || [])[1] || (customThemes().find(x => "custom:" + x.id === cur) || {}).name || "Auto";
  $("sumCol").textContent = curName;
  const nb = el("button", "newth", "+ New theme"); nb.onclick = () => openThemeEdit(null); grid.appendChild(nb);
  // edit / delete for the selected custom theme
  const tools = $("themeTools"); tools.innerHTML = "";
  const sel = customThemes().find(x => "custom:" + x.id === cur);
  if (sel && !themeEditing) {
    if (themeArmed === sel.id) {
      tools.append(el("span", "small warn", "Delete " + sel.name + "?"));
      const no = el("button", "use", "Cancel"), yes = el("button", "use danger", "Delete");
      no.onclick = () => { themeArmed = null; renderThemes(); };
      yes.onclick = () => { prefs = { ...prefs, customThemes: customThemes().filter(x => x.id !== sel.id) }; savePrefs(); themeArmed = null; mem.set("theme", "auto"); paintTheme(); renderThemes(); toast("Deleted " + sel.name + "."); };
      tools.append(no, yes);
    } else {
      const ed = el("button", "use", "Edit " + sel.name), del = el("button", "use", "Delete");
      ed.onclick = () => openThemeEdit(sel); del.onclick = () => { themeArmed = sel.id; renderThemes(); };
      tools.append(ed, del);
    }
  }
}
function openThemeEdit(th) {
  const cs = getComputedStyle(document.documentElement), get = k => { const v = cs.getPropertyValue(k).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : null; };
  const base = th || { name: "", bg: get("--bg") || "#121518", surface: get("--surface") || "#1b2026", ink: get("--ink") || "#eef1f4", accent: get("--accent") || "#ff6a33" };
  themeEditing = th ? th.id : "new";
  $("thName").value = th ? th.name : "My theme " + (customThemes().length + 1);
  $("thBg").value = base.bg; $("thSurface").value = base.surface; $("thInk").value = base.ink; $("thAccent").value = base.accent;
  $("themeEdit").hidden = false; $("themeTools").innerHTML = ""; document.querySelector('[data-grp="col"]').open = true; previewThemeEdit(); $("thName").focus();
}
function editValues() { return { bg: $("thBg").value, surface: $("thSurface").value, ink: $("thInk").value, accent: $("thAccent").value }; }
function previewThemeEdit() {
  const v = editValues(); paintTheme(themeVars(v));
  const c = contrast(v.ink, v.bg), c2 = contrast(v.ink, v.surface);
  $("thWarn").textContent = Math.min(c, c2) < 4.5 ? "Text may be hard to read on this background. Try a lighter or darker text colour." : "";
}
function saveThemeEdit() {
  const name = $("thName").value.trim() || "My theme", v = editValues();
  let list = customThemes(), id = themeEditing;
  if (id === "new") { id = Date.now().toString(36); list = [...list, { id, name, ...v }]; }
  else list = list.map(x => x.id === id ? { ...x, name, ...v } : x);
  prefs = { ...prefs, customThemes: list }; savePrefs();
  themeEditing = null; $("themeEdit").hidden = true;
  mem.set("theme", "custom:" + id); paintTheme(); renderThemes(); toast("Saved " + name + ".");
}

/* ---------- writes (local first; Firestore syncs in the background) ---------- */
function writeSession(date, data) {
  const p = data.sets.length ? be.set(uid, "s_" + date, data) : be.del(uid, "s_" + date);
  p.catch(e => toast("Couldn't save to your account: " + (e && e.message || "try again"), true));
  return p;
}
function saveLists() {
  const out = { full: true, v: 2, days, lists: {} };
  days.forEach(d => { out.lists[d] = lists[d] || []; });
  const p = be.set(uid, "exercises", out); p.catch(() => toast("Couldn't save your exercise list.", true)); return p;
}
function savePrefs() { const p = be.set(uid, "prefs", prefs); p.catch(() => toast("Couldn't save your settings.", true)); return p; }
function saveBody() { const p = be.set(uid, "body", body); p.catch(() => toast("Couldn't save your weigh-in.", true)); return p; }

function removeSetByT(date, t) {
  const s = sessions[date]; if (!s) return;
  const next = { date, sets: s.sets.filter(x => x.t !== t) };
  if (next.sets.length) sessions[date] = next; else delete sessions[date];
  renderPane(); writeSession(date, next); toast("Set deleted." + offlineNote());
}
function addExercise(d, name) {
  const n = name.trim(); if (!n) return;
  if (exercisesFor(d).includes(n)) { toast("That's already on the " + d + " list.", true); return; }
  lists = { ...lists, [d]: [...(lists[d] || []), n] }; adding = null;
  if (d === day) mem.set("ex_" + day, n);
  renderSelect(); renderHistory(); renderSettings(); saveLists(); toast("Added " + n + " to " + d + "." + offlineNote());
}
function removeExercise(d, ex) {
  lists = { ...lists, [d]: (lists[d] || []).filter(n => n !== ex) };
  const changed = [];
  Object.values(sessions).forEach(s => {
    if ((s.sets || []).some(x => x.ex === ex && x.day === d)) {
      const next = { date: s.date, sets: s.sets.filter(x => !(x.ex === ex && x.day === d)) };
      if (next.sets.length) sessions[s.date] = next; else delete sessions[s.date];
      changed.push(next);
    }
  });
  if (mem.get("ex_" + d) === ex) mem.set("ex_" + d, "");
  expanded.delete(ex); renaming = null; armed = null;
  renderSelect(); renderHistory(); renderSettings(); saveLists(); changed.forEach(s => writeSession(s.date, s));
  toast("Removed " + ex + "." + offlineNote());
}
function renameExercise(d, oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) { renaming = null; renderHistory(); return; }
  if (exercisesFor(d).includes(newName)) { toast("There's already an exercise called " + newName + " in " + d + ".", true); return; }
  const idx = (lists[d] || []).indexOf(oldName);
  lists = { ...lists, [d]: idx >= 0 ? lists[d].map(n => n === oldName ? newName : n) : [...(lists[d] || []), newName] };
  const changed = [];
  Object.values(sessions).forEach(s => {
    if ((s.sets || []).some(x => x.ex === oldName && x.day === d)) {
      const next = { date: s.date, sets: s.sets.map(x => x.ex === oldName && x.day === d ? { ...x, ex: newName } : x) };
      sessions[s.date] = next; changed.push(next);
    }
  });
  if (mem.get("ex_" + d) === oldName) mem.set("ex_" + d, newName);
  if (mem.get("pEx_" + d) === oldName) mem.set("pEx_" + d, newName);
  if (expanded.has(oldName)) { expanded.delete(oldName); expanded.add(newName); }
  renaming = null; renderSelect(); renderHistory(); renderSettings();
  saveLists(); changed.forEach(s => writeSession(s.date, s));
  toast("Renamed to " + newName + (changed.length ? " across " + changed.length + " session" + (changed.length > 1 ? "s" : "") : "") + "." + offlineNote());
}

/* ---------- Excel ---------- */
function exportExcel() {
  const rows = allSets().sort((a, b) => a.date === b.date ? a.t - b.t : (a.date < b.date ? -1 : 1));
  const bds = bodyDates();
  if (!rows.length && !bds.length) { toast("Nothing to export yet.", true); return; }
  if (typeof XLSX === "undefined") { toast("Excel export needs a connection the first time. Try again online.", true); return; }
  const dt = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const wb = XLSX.utils.book_new(), count = {};
  const data = rows.map(s => {
    const k = s.date + "|" + s.day + "|" + s.ex; count[k] = (count[k] || 0) + 1;
    return { "Date": dt(s.date), "Day": s.day, "Exercise": s.ex, "Set #": count[k], "Weight (kg)": s.w, "Reps": s.r, "Volume (kg)": r1(s.w * s.r), "Warm-up": s.wu ? "Yes" : "", "Notes": s.note || "" };
  });
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "Date": "", "Day": "", "Exercise": "", "Set #": "", "Weight (kg)": "", "Reps": "", "Volume (kg)": "", "Warm-up": "", "Notes": "" }], { cellDates: true, dateNF: "dd-mmm-yy" });
  ws["!cols"] = [{ wch: 11 }, { wch: 10 }, { wch: 36 }, { wch: 6 }, { wch: 11 }, { wch: 6 }, { wch: 11 }, { wch: 8 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, "Log");
  if (bds.length) {
    const bws = XLSX.utils.json_to_sheet(bds.map(d => ({ "Date": dt(d), "Body weight (kg)": r1(body.entries[d]) })), { cellDates: true, dateNF: "dd-mmm-yy" });
    bws["!cols"] = [{ wch: 11 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, bws, "Body weight");
  }
  const blob = new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "Gym_Log_" + todayISO() + ".xlsx";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Exported " + rows.length + " sets" + (bds.length ? " and " + bds.length + " weigh-ins" : "") + ".");
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return isoOf(new Date(v.getTime() + 12 * 3600e3)); // nudge to midday so time zones can't shift the day
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400e3)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  if (typeof v === "string") {
    const s = v.trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    if ((m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3})[A-Za-z]*[-/ .](\d{2,4})$/)) && MONTHS[m[2].toLowerCase()]) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return y + "-" + pad(MONTHS[m[2].toLowerCase()]) + "-" + pad(+m[1]); }
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return y + "-" + pad(+m[2]) + "-" + pad(+m[1]); }
  }
  return null;
}
// Merge rows into existing data. Weights in the file are kg.
export function mergeRows(rows, curSessions, curLists, curDays) {
  const S = clone(curSessions), L = clone(curLists), D = [...curDays]; let added = 0, skipped = 0, bad = 0;
  const pick = (r, ...keys) => { for (const k of Object.keys(r)) { const n = k.toLowerCase().replace(/[^a-z]/g, ""); if (keys.includes(n)) return r[k]; } return undefined; };
  const remaining = {};
  Object.values(S).forEach(s => (s.sets || []).forEach(x => { const k = s.date + "|" + x.ex + "|" + x.w + "|" + x.r; remaining[k] = (remaining[k] || 0) + 1; }));
  let seq = 0;
  rows.forEach(r => {
    const date = parseDate(pick(r, "date"));
    const ex = String(pick(r, "exercise") ?? "").trim();
    const w = parseFloat(String(pick(r, "weightkg", "weight") ?? "").replace(",", "."));
    const reps = parseInt(pick(r, "reps"), 10);
    if (!date || !ex || !(w >= 0) || !(reps > 0)) { bad++; return; }
    const raw = String(pick(r, "day") ?? "").trim();
    let d = D.find(x => x.toLowerCase() === raw.toLowerCase());
    if (!d && raw) { d = raw; D.push(d); L[d] = L[d] || []; }
    if (!d) d = D.find(x => (L[x] || []).includes(ex)) || D[0];
    const k = date + "|" + ex + "|" + w + "|" + reps;
    if (remaining[k] > 0) { remaining[k]--; skipped++; return; }
    if (!(L[d] || []).includes(ex)) L[d] = [...(L[d] || []), ex];
    const s = S[date] || (S[date] = { date, sets: [] });
    const [y, mo, dd] = date.split("-").map(Number);
    const set = { day: d, ex, w, r: reps, note: String(pick(r, "notes", "note") ?? "").trim(), t: new Date(y, mo - 1, dd, 12).getTime() + (seq++) };
    if (/^y/i.test(String(pick(r, "warmup") ?? ""))) set.wu = true;
    const rl = String(pick(r, "repsleft") ?? "").trim(); if (rl !== "") { const n = parseInt(rl, 10); if (n >= 0) set.rir = Math.min(3, n); }
    s.sets.push(set);
    added++;
  });
  return { sessions: S, lists: L, days: D, added, skipped, bad };
}
async function importExcel(file) {
  if (typeof XLSX === "undefined") { toast("Import needs a connection. Try again online.", true); return; }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: "" });
    // body weight sheet, if present
    let bAdded = 0;
    const bsName = wb.SheetNames.find(n => n.toLowerCase().includes("body"));
    if (bsName) {
      const e = { ...body.entries };
      XLSX.utils.sheet_to_json(wb.Sheets[bsName], { raw: true, defval: "" }).forEach(r => {
        const d = parseDate(r["Date"]), v = parseFloat(String(r["Body weight (kg)"] ?? "").replace(",", "."));
        if (d && v > 0 && e[d] == null) { e[d] = v; bAdded++; }
      });
      if (bAdded) { body = { ...body, entries: e }; saveBody(); }
    }
    const before = clone(sessions), listsBefore = JSON.stringify([days, lists]);
    const res = mergeRows(rows, sessions, lists, days);
    if (!res.added && !bAdded) { toast(res.skipped ? "Nothing new — all " + res.skipped + " sets are already in your log." : "Couldn't find any sets in that file.", true); return; }
    const S = res.sessions; sessions = S; lists = res.lists; days = res.days;
    const toWrite = Object.keys(S).filter(d => JSON.stringify(S[d]) !== JSON.stringify(before[d]));
    if (JSON.stringify([days, lists]) !== listsBefore) saveLists();
    toWrite.forEach(d => writeSession(d, S[d]));
    renderAll();
    toast("Imported " + res.added + " sets" + (bAdded ? " and " + bAdded + " weigh-ins" : "") + (res.skipped ? ", skipped " + res.skipped + " you already had" : "") + (res.bad ? ", " + res.bad + " rows unreadable" : "") + ".");
  } catch (e) { toast("Couldn't read that file. Use an .xlsx exported from Gym Log.", true); }
}

/* ---------- data from the backend ---------- */
function applyDocs(docs) {
  const next = {};
  Object.entries(docs).forEach(([id, v]) => {
    if (!v) return;
    if (id === "exercises") {
      if (v.v === 2 && Array.isArray(v.days)) {
        days = v.days.filter(x => typeof x === "string");
        const nl = {}; days.forEach(d => { nl[d] = Array.isArray(v.lists?.[d]) ? v.lists[d].filter(x => typeof x === "string") : []; }); lists = nl;
      } else { // older format: one key per default day
        days = [...DEFAULT_DAYS];
        const nl = {}; DEFAULT_DAYS.forEach(k => { const arr = Array.isArray(v[k]) ? v[k].filter(x => typeof x === "string") : []; nl[k] = v.full ? arr : [...BASE[k], ...arr.filter(x => !BASE[k].includes(x))]; }); lists = nl;
      }
    } else if (id === "prefs") { prefs = { ...DEFAULT_PREFS, ...v }; if (!Array.isArray(prefs.customThemes)) prefs.customThemes = []; }
    else if (id === "body") body = { entries: { ...(v.entries || {}) }, ...v, entries: { ...(v.entries || {}) } };
    else if (v.date) next[v.date] = v;
  });
  if (!docs.prefs) prefs = { ...DEFAULT_PREFS };
  if (!docs.body) body = { entries: {} };
  sessions = next;
  // keep any day that has sets but isn't in the list
  allSets().forEach(s => { if (!days.includes(s.day)) { days = [...days, s.day]; lists = { ...lists, [s.day]: lists[s.day] || [] }; } });
  if (!renaming && !adding && !dayEditing) renderAll(); else renderHint();
  if (!themeEditing) { paintTheme(); renderThemes(); }
  syncWake();
  const n = Object.keys(next).length, b = bodyDates().length;
  $("status").textContent = n + " session" + (n === 1 ? "" : "s") + (b ? " and " + b + " weigh-in" + (b === 1 ? "" : "s") : "") + " saved · private to you";
  $("sumData").textContent = n + " session" + (n === 1 ? "" : "s");
}

/* ---------- wiring ---------- */
function wire() {
  $("date").value = todayISO();
  document.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $("date").onchange = () => { if (!$("date").value) $("date").value = todayISO(); renderDateLbl(); renderUnits(); renderPane(); };
  renderDateLbl();
  document.querySelectorAll("[data-pview]").forEach(b => b.onclick = () => { mem.set("pView", b.dataset.pview); renderProgress(); });

  document.querySelectorAll("[data-step]").forEach(b => b.onclick = () => {
    const f = $(b.dataset.step), dir = Number(b.dataset.dir), v = parseFloat(String(f.value).replace(",", ".")) || 0;
    const step = b.dataset.step === "w" ? wStep() : 1;
    f.value = trim(Math.max(0, v + dir * step));
  });
  $("save").onclick = saveSet;
  $("timerPill").onclick = e => {
    e.stopPropagation();
    if ($("timerPill").classList.contains("done")) { stopRest(); return; }
    const open = $("timerMenu").hidden; $("timerMenu").hidden = !open; $("timerPill").setAttribute("aria-expanded", String(open));
  };
  $("restMore").onclick = e => { e.stopPropagation(); const end = Number(mem.get("restEnd") || 0) || Date.now(); mem.set("restEnd", String(end + 30000)); runRest(); };
  $("restSkip").onclick = e => { e.stopPropagation(); stopRest(); toast("Rest skipped."); };
  document.addEventListener("click", e => { if (!$("timerMenu").hidden && !e.target.closest(".timerwrap")) closeTimerMenu(); });
  document.addEventListener("visibilitychange", syncWake);
  // settings sections: only one open at a time
  document.querySelectorAll(".grp").forEach(d => d.addEventListener("toggle", () => { if (d.open) document.querySelectorAll(".grp").forEach(o => { if (o !== d) o.open = false; }); }));
  // body weight
  const bwStep = dir => { const v = parseFloat(String($("bw").value).replace(",", ".")) || 0; $("bw").value = trim(Math.max(0, v + dir * 0.1)); };
  $("bwMinus").onclick = () => bwStep(-1); $("bwPlus").onclick = () => bwStep(1);
  $("bwSave").onclick = saveWeighIn;
  // progress selectors
  $("pDay").onchange = () => { mem.set("pDay", $("pDay").value); renderProgress(); };
  $("pEx").onchange = () => { mem.set("pEx_" + $("pDay").value, $("pEx").value); renderProgress(); };
  // settings
  document.querySelectorAll("[data-unit]").forEach(b => b.onclick = () => {
    if (prefs.units === b.dataset.unit) return;
    const wkg = toKg(parseFloat($("w").value) || 0), bkg = toKg(parseFloat($("bw").value) || 0);
    prefs = { ...prefs, units: b.dataset.unit }; savePrefs();
    $("w").value = trim(disp(wkg)); $("bw").value = trim(disp(bkg));
    renderUnits(); renderSettings(); renderPane(); toast("Showing weights in " + U() + ".");
  });
  $("restOn").onchange = () => { prefs = { ...prefs, restOn: $("restOn").checked }; savePrefs(); if (!prefs.restOn) stopRest(); };
  const prefAdj = (k, d, lo, hi) => { prefs = { ...prefs, [k]: Math.min(hi, Math.max(lo, prefs[k] + d)) }; savePrefs(); renderSettings(); };
  $("weekDown").onclick = () => prefAdj("weekTarget", -1, 1, 7); $("weekUp").onclick = () => prefAdj("weekTarget", 1, 1, 7);
  $("awakeOn").onchange = () => { prefs = { ...prefs, keepAwake: $("awakeOn").checked }; savePrefs(); syncWake(); };
  const restAdj = d => { prefs = { ...prefs, restSec: Math.min(600, Math.max(15, prefs.restSec + d)) }; $("restSecLbl").textContent = fmtSec(prefs.restSec); savePrefs(); };
  $("restDown").onclick = () => restAdj(-15); $("restUp").onclick = () => restAdj(15);
  $("goalSave").onclick = () => {
    const v = parseFloat(String($("goalIn").value).replace(",", "."));
    if (!(v > 0)) { toast("Enter a goal weight, e.g. 78.", true); return; }
    prefs = { ...prefs, goal: toKg(v) }; savePrefs(); $("goalIn").blur(); renderBody();
    toast("Goal set to " + trim(v) + U() + ".");
  };
  $("goalClear").onclick = () => { prefs = { ...prefs, goal: null }; savePrefs(); renderBody(); toast("Goal cleared."); };
  $("goalIn").onkeydown = e => { if (e.key === "Enter") $("goalSave").click(); };
  $("addDay").onclick = addDay;
  $("newDay").onkeydown = e => { if (e.key === "Enter") addDay(); };
  $("export").onclick = exportExcel;
  $("importFile").onchange = e => { const f = e.target.files[0]; if (f) importExcel(f); e.target.value = ""; };
  $("signin").onclick = async () => {
    $("gateMsg").textContent = "";
    try { await be.signIn(); } catch (e) { $("gateMsg").textContent = "Sign-in didn't work: " + (e && (e.code || e.message) || "try again"); }
  };
  // side menu
  const openMenu = () => {
    renderSettings();
    $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false"); document.body.classList.add("menu-open");
    $("menuOpen").setAttribute("aria-expanded", "true"); setTimeout(() => $("menuClose").focus(), 50);
  };
  const closeMenu = () => {
    if (!$("drawer").classList.contains("open")) return;
    dayEditing = null;
    if (themeEditing) { themeEditing = null; $("themeEdit").hidden = true; paintTheme(); renderThemes(); }
    $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true"); document.body.classList.remove("menu-open");
    $("menuOpen").setAttribute("aria-expanded", "false"); $("menuOpen").focus();
  };
  $("signout").onclick = () => { closeMenu(); stopRest(); be.signOut(); };
  $("menuOpen").onclick = openMenu; $("menuClose").onclick = closeMenu; $("drawerBackdrop").onclick = closeMenu;
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  // colours
  $("thSave").onclick = saveThemeEdit;
  $("thCancel").onclick = () => { themeEditing = null; $("themeEdit").hidden = true; paintTheme(); renderThemes(); };
  ["thBg", "thSurface", "thInk", "thAccent"].forEach(id => $(id).addEventListener("input", previewThemeEdit));
  paintTheme(); renderThemes();
  if (Number(mem.get("restEnd") || 0) > Date.now()) runRest();
}

async function start() {
  wire();
  const mock = new URLSearchParams(location.search).has("mock");
  if (!mock && String(firebaseConfig.apiKey).startsWith("PASTE")) {
    show("gate"); $("signin").disabled = true;
    $("gateMsg").textContent = "Setup isn't finished: add your Firebase config to firebase-config.js.";
    return;
  }
  try { be = mock ? mockBackend() : await firebaseBackend(firebaseConfig); }
  catch (e) { show("gate"); $("signin").disabled = true; $("gateMsg").textContent = "Couldn't load. Check your connection and reopen the app."; return; }
  be.onUser(u => {
    if (unsub) { unsub(); unsub = null; }
    if (!u) { uid = null; sessions = {}; days = [...DEFAULT_DAYS]; lists = clone(BASE); prefs = { ...DEFAULT_PREFS }; body = { entries: {} }; show("gate"); return; }
    uid = u.uid; $("who").textContent = "Signed in as " + (u.email || u.name); $("sumAcc").textContent = u.email || u.name || "";
    show("main"); renderTabs(); renderAll();
    unsub = be.subscribe(uid, applyDocs, () => { $("status").textContent = "Lost connection to your log. Reopen the app to reconnect."; });
  });
  if (!mock && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
