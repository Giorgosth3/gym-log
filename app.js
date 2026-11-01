import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import { firebaseBackend, mockBackend } from "./backend.js";

/* ---------- defaults ---------- */
const DEFAULT_DAYS = ["Push", "Pull", "Legs", "Shoulders"];
const BASE = {
  Push: ["Chest Press", "Pec machine elbows", "Rope Tricep extension Vertical", "Rope Tricep extension – entrance", "Rope Tricep extension - cables machine", "One hand tri extension - entrance", "One hand tri extension – double cables"],
  Pull: ["Lat pulldown straight grip", "Close grip", "Lat Pulldown Neutral Grip", "Lower back - freeweight", "Standing bicep curls", "Standing Hammer curls"],
  Legs: ["Hack squat", "Hamstring curls", "Leg extensions (aristera)", "Calves"],
  Shoulders: ["Shoulder press", "Lateral raises machine", "Face pulls"]
};
const DEFAULT_PREFS = { units: "kg", restOn: true, restSec: 90, goal: null, weekTarget: 4, keepAwake: true, celebrate: true };
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
// Set 1 starts from set 1 last time (to match it); later sets start from the set you just did today.
function prefillSet() {
  const ex = $("ex").value, note = $("filledNote"); note.hidden = true; if (!ex) return;
  const today = todaySets(ex), last = lastSession(ex);
  if (today.length) {
    const s = today[today.length - 1];
    $("w").value = trim(disp(s.w)); $("r").value = String(s.r);
    note.textContent = "Filled in from set " + today.length + " today. Adjust if needed."; note.hidden = false;
  } else if (last) {
    const s = last.sets[0];
    $("w").value = trim(disp(s.w)); $("r").value = String(s.r);
    note.textContent = "Filled in from set 1 last time (" + shortDate(last.date) + "). Adjust if needed."; note.hidden = false;
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
    b.type = "button"; b.dataset.ex = ex; b.setAttribute("aria-pressed", String(ex === cur));
    if (n) b.classList.add("done");
    const sub = n ? "✓ " + n + " set" + (n > 1 ? "s" : "") : last ? "Last: " + fmtW(last.sets[0].w) + " × " + last.sets[0].r : "Not done yet";
    b.append(el("span", null, ex), el("small", null, sub));
    b.onclick = () => { if (dragJustEnded) { dragJustEnded = false; return; } pickEx(ex); };
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
  const prevSets = working(allSets().filter(s => s.ex === ex));
  const prevBest = prevSets.length ? prevSets.reduce((a, s) => (s.w > a.w || (s.w === a.w && s.r > a.r)) ? s : a) : null;
  const firstOfDay = !working((sessions[date] || {}).sets || []).length;
  const s = sessions[date] || { date, sets: [] };
  const set = { day, ex, w, r, note: $("note").value.trim(), t }; if (wu) set.wu = true;
  const next = { date, sets: [...(s.sets || []), set] };
  sessions[date] = next;
  writeSession(date, next);
  const n = working(next.sets.filter(x => x.ex === ex)).length;
  // PB: heavier than ever, or more reps at your heaviest weight
  const isPB = !!prevBest && (w > prevBest.w || (w === prevBest.w && r > prevBest.r));
  toast((isPB ? "New personal best! " : "Saved: ") + ex + " set " + n + " — " + fmtW(w) + " × " + r + offlineNote());
  $("note").value = "";
  renderExercise(true);
  if (prefs.restOn) startRest(prefs.restSec);
  // big moments only
  if (isPB) celebrate("pb", { ex, w, r, prev: prevBest });
  checkDayDone(date);
  if (firstOfDay) checkWeek(date);
}

/* ---------- celebrations: personal best, workout complete, weekly target, goal ---------- */
const celeQueue = [];
function checkDayDone(date) {
  const list = exercisesFor(day); if (list.length < 2) return;
  const sets = working(((sessions[date] || {}).sets || []).filter(s => s.day === day));
  if (!list.every(ex => sets.some(s => s.ex === ex))) return;
  const key = "celeDay_" + date + "_" + day; if (mem.get(key)) return; mem.set(key, "1");
  // personal bests set today: heavier than before today, or more reps at that top weight
  let pbs = 0;
  list.forEach(ex => {
    const before = working(allSets().filter(s => s.ex === ex && s.date < date)); if (!before.length) return;
    const b = before.reduce((a, s) => (s.w > a.w || (s.w === a.w && s.r > a.r)) ? s : a);
    if (sets.some(s => s.ex === ex && (s.w > b.w || (s.w === b.w && s.r > b.r)))) pbs++;
  });
  celebrate("day", { day, exercises: list.length, sets: sets.length, pbs });
}
function checkWeek(date) {
  const [y, m, d] = date.split("-").map(Number), mon = mondayOf(new Date(y, m - 1, d)), a = isoOf(mon);
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6); const b = isoOf(sun);
  const tr = [...trainedDates()].filter(x => x >= a && x <= b);
  if (tr.length !== prefs.weekTarget) return;
  const key = "celeWeek_" + a; if (mem.get(key)) return; mem.set(key, "1");
  const dots = []; for (let i = 0; i < 7; i++) { const x = new Date(mon); x.setDate(x.getDate() + i); dots.push(tr.includes(isoOf(x))); }
  celebrate("week", { n: tr.length, dots });
}
function celebrate(type, data) {
  if (prefs.celebrate === false) return;
  celeQueue.push({ type, data }); if ($("cele").hidden) nextCele();
}
const CELE = {
  pb: { c: "#f5c542", icon: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>' },
  day: { c: "#3fc27a", icon: '<path d="M20 6L9 17l-5-5"/>' },
  week: { c: "#ff6a33", icon: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M9 15l2 2 4-4"/>' },
  goal: { c: "#5bc0eb", icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>' }
};
function nextCele() {
  const item = celeQueue.shift(); if (!item) return;
  const { type, data } = item, def = CELE[type], card = $("celeCard"); card.innerHTML = "";
  $("cele").style.setProperty("--c", def.c);
  const badge = el("div", "cbadge"); badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + def.icon + "</svg>";
  card.appendChild(badge);
  const add = (cls, text, id) => { const e = el("div", cls, text); if (id) e.id = id; card.appendChild(e); return e; };
  if (type === "pb") {
    add("ckick", "New personal best"); add("cbig", fmtW(data.w) + " × " + data.r, "celeTitle"); add("csub", data.ex);
    if (data.prev) add("cwas", "Previous best: " + fmtW(data.prev.w) + " × " + data.prev.r + " · " + shortDate(data.prev.date));
  } else if (type === "day") {
    add("ckick", "Workout complete"); add("cbig", data.day + " day done", "celeTitle");
    const nums = el("div", "cnums");
    [[data.exercises, "exercises"], [data.sets, "sets"], [data.pbs, data.pbs === 1 ? "personal best" : "personal bests"]].forEach(([v, l]) => { const d = el("div"); d.append(el("b", null, String(v)), el("span", null, l)); nums.appendChild(d); });
    card.appendChild(nums);
  } else if (type === "week") {
    add("ckick", "Weekly target reached"); add("cbig", data.n + " session" + (data.n === 1 ? "" : "s"), "celeTitle"); add("csub", "this week. Consistency wins.");
    const dots = el("div", "cdots"); dots.setAttribute("aria-label", "Days trained this week");
    data.dots.forEach((on, i) => { const d = el("i", on ? "" : "off"); d.title = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]; dots.appendChild(d); });
    card.appendChild(dots); add("small", "Mon – Sun");
  } else if (type === "goal") {
    add("ckick", "Goal reached"); add("cbig", fmtW(data.goal), "celeTitle"); add("csub", "You hit your goal weight");
    const weeks = Math.max(1, Math.round((Date.now() - new Date(data.since).getTime()) / (7 * 86400e3)));
    add("cwas", "Started at " + fmtW(data.start) + " · " + weeks + " week" + (weeks === 1 ? "" : "s") + " ago");
  }
  const btn = el("button", "cbtn", "Nice!"); btn.type = "button"; btn.onclick = closeCele; card.appendChild(btn);
  add("small", "Tap anywhere to keep going");
  $("cele").hidden = false; setTimeout(() => btn.focus(), 30);
  try { navigator.vibrate && navigator.vibrate([60, 40, 120]); } catch (e) {}
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) confetti(def.c);
}
function closeCele() { $("cele").hidden = true; stopConfetti(); setTimeout(nextCele, 150); }
let confRaf = null;
function stopConfetti() { cancelAnimationFrame(confRaf); confRaf = null; const cv = $("confetti"); cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); }
function confetti(main) {
  const cv = $("confetti"), dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr; const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = [main, main, "#ffffff", "#ff6a33", "#f5c542", "#3fc27a", "#5bc0eb", "#e86a92"];
  const P = Array.from({ length: 140 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4,
    w: 6 + Math.random() * 7, h: 3 + Math.random() * 5, a: Math.random() * 6.3, va: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)] }));
  const t0 = performance.now(); cancelAnimationFrame(confRaf);
  const step = now => {
    const t = (now - t0) / 1000; ctx.clearRect(0, 0, W, H);
    P.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 1.4) / .6); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); });
    if (t < 2) confRaf = requestAnimationFrame(step); else stopConfetti();
  };
  confRaf = requestAnimationFrame(step);
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
    const stats = el("div", "stats");
    stats.append(stat(String(dates.length), dates.length === 1 ? "session" : "sessions"), stat(fmtW(pb.w), "heaviest set"), stat(shortDate(dates[dates.length - 1]), "last session"));
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
  const ds0 = bodyDates(), start = ds0.length ? body.entries[ds0[0]] : null;
  body = { ...body, entries: { ...body.entries, [d]: toKg(v) } };
  saveBody(); renderBody(); toast((existed ? "Updated " : "Saved ") + longDate(d) + ": " + trim(v) + U() + offlineNote());
  // goal reached: crossed the goal, heading the right way from where you started
  const g = prefs.goal, kg = toKg(v);
  if (g != null && start != null && Math.abs(start - g) > 0.05) {
    const reached = start > g ? kg <= g + 0.05 : kg >= g - 0.05, key = "celeGoal_" + g;
    if (reached && !mem.get(key)) { mem.set(key, "1"); celebrate("goal", { goal: g, start, since: ds0[0] }); }
  }
}

/* ---------- settings ---------- */
function renderSettings() {
  $("restOn").checked = !!prefs.restOn;
  $("restSecLbl").textContent = fmtSec(prefs.restSec);
  $("weekLbl").textContent = String(prefs.weekTarget);
  $("awakeOn").checked = prefs.keepAwake !== false;
  $("celeOn").checked = prefs.celebrate !== false;
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
}
function moveDay(i, dir) { const a = [...days]; [a[i], a[i + dir]] = [a[i + dir], a[i]]; days = a; saveLists(); renderDayBtns(); renderSettings(); }
/* ---------- AI coach chat (Gemini via Firebase AI Logic) ---------- */
const CHAT_DAILY = 40;           // questions per person per day
const CHAT_KEEP = 12;            // earlier messages sent along for context
const APP_GUIDE = `How the Gym Log app works (use this to answer app questions; never invent buttons that are not listed here):
- Top bar: menu button (☰) opens Settings; the date button (top right) picks the day you're logging; a chat button opens this coach. After saving a set, a rest timer appears at the top: tap it for +30s or Skip.
- Under the top bar: workout day buttons (e.g. Push, Pull, Legs, Shoulders).
- Bottom tabs: Training, History, Progress, Body.
- Training tab: exercise buttons for the chosen day. Tap one, check weight and reps (− / + buttons or type), optional note, then Save set. Set 1 is filled in from set 1 of the last session of that exercise; later sets are filled in from the set just done today. "Last time" shows the previous session's sets; tap one to copy it. "Today so far" lists today's sets; tap a set, then Remove set to delete it.
- Reorder exercises: on the Training tab press and hold an exercise button until it lifts, then drag it.
- Add an exercise: "+ Add exercise" at the end of the exercise buttons. Rename or remove an exercise: History tab, open the exercise, Rename or Remove (renaming also updates past sets).
- Workout days (add, rename, reorder, remove): Settings → Workout days & exercises.
- Settings → Training: units kg/lbs, rest timer on/off and length, weekly session target, keep screen on, celebrations on/off. Settings → Colours: themes, including custom ones. Settings → Your data: Export to Excel, import sets from Excel. Settings → Account: sign out.
- Personal best = heavier weight than ever, or more reps at your heaviest weight. Celebrations show for personal bests, finishing every exercise of the day, hitting the weekly target and reaching your goal weight.
- Progress tab: Exercises view (estimated 1-rep max chart, personal best, plateau alerts) and Consistency view (calendar, weekly sessions).
- Body tab: log body weight, 7-day average, weekly rate, goal weight.
- Wrong day: remove the set, change the date at the top right, save it again.
- Sync: sign in with the same Google account on any phone; works offline at the gym and syncs later. Each person's data is private.
- Install: iPhone Safari → Share → Add to Home Screen. Android Chrome → ⋮ → Add to Home screen / Install app.`;
function coachSystem() {
  const plan = days.map(d => d + ": " + (exercisesFor(d).join(", ") || "no exercises yet")).join("\n");
  return `You are the coach inside "Gym Log", a phone app for logging gym sets. Answer only:
1) questions about using the Gym Log app, and
2) exercise and training questions: how to do an exercise with good form, sets, reps, progression, warm-ups, rest, training splits, general gym nutrition basics.
If a question is about anything else, say kindly that you can only help with the app and training.
Rules: be short and practical (usually under 120 words), use numbered steps for how-to answers, use the user's language (reply in Greek if they write in Greek or Greeklish). Use kg unless they use lbs (their setting: ${U()}). Do not diagnose injuries or give medical advice; for pain, injuries or health conditions tell them to stop and see a doctor or physiotherapist. Never claim the app can do something not described below.

${APP_GUIDE}

This user's workout days and exercises:
${plan}`;
}
let chatMsgs = [], chatBusy = false, chatReturn = null;
const chatKey = () => "chatCount_" + todayISO();
function chatLeft() { return CHAT_DAILY - (parseInt(mem.get(chatKey()) || "0", 10) || 0); }
function esc(t) { return t.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
// tiny, safe markdown: **bold**, numbered and bullet lists, paragraphs
function mdLite(t) {
  const lines = esc(t).split("\n"); let out = "", list = null;
  const close = () => { if (list) { out += "</" + list + ">"; list = null; } };
  lines.forEach(raw => {
    const l = raw.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^#+\s*/, "");
    let m;
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== "ol") { close(); out += "<ol>"; list = "ol"; } out += "<li>" + m[1] + "</li>"; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== "ul") { close(); out += "<ul>"; list = "ul"; } out += "<li>" + m[1] + "</li>"; }
    else if (!l.trim()) close();
    else { close(); out += "<p>" + l + "</p>"; }
  });
  close(); return out;
}
function openChat() {
  chatReturn = document.activeElement; $("chat").hidden = false; document.body.classList.add("menu-open");
  fitChat(); renderChat(); setTimeout(() => $("chatIn").focus({ preventScroll: true }), 60);
}
function closeChat() { $("chat").hidden = true; document.body.classList.remove("menu-open"); if (chatReturn && chatReturn.focus) chatReturn.focus(); }
// keep the input above the phone keyboard
function fitChat() { const v = window.visualViewport; $("chat").style.height = v ? v.height + "px" : ""; if (v) $("chat").style.top = v.offsetTop + "px"; }
function chatBubble(role, html) { const d = el("div", "msg " + role); d.innerHTML = html; return d; }
function renderChat() {
  const box = $("chatMsgs"); box.innerHTML = "";
  if (!chatMsgs.length) {
    const intro = el("div", "chatintro");
    intro.appendChild(chatBubble("ai", "<p>Hi! Ask me how to use the app, how to do an exercise properly, or anything about training.</p>"));
    const sug = el("div", "chatsug");
    const ex = exercisesFor(day)[0];
    [ex ? "How do I do " + ex + " with good form?" : "How do I do a chest press with good form?", "How do I change the order of my exercises?", "When should I increase the weight?"].forEach(q => {
      const b = el("button", "chip", q); b.type = "button"; b.onclick = () => sendChat(q); sug.appendChild(b);
    });
    intro.appendChild(sug); box.appendChild(intro);
  }
  chatMsgs.forEach(m => box.appendChild(chatBubble(m.role === "user" ? "me" : "ai", m.role === "user" ? "<p>" + esc(m.text).replace(/\n/g, "<br>") + "</p>" : mdLite(m.text) + (m.err ? "" : ""))));
  const left = chatLeft();
  $("chatNote").textContent = left <= 5 ? (left > 0 ? left + " question" + (left === 1 ? "" : "s") + " left today." : "You've reached today's limit. Back tomorrow!") : "AI answers can be wrong. For pain or injuries, see a professional.";
  $("chatSend").disabled = chatBusy || left <= 0; $("chatNew").hidden = !chatMsgs.length;
  box.scrollTop = box.scrollHeight;
}
function chatError(e) {
  const m = String((e && (e.message || e.code)) || e || "").toLowerCase();
  if (!navigator.onLine) return "You're offline. Connect to the internet to ask the coach.";
  if (e && e.status === 429 || /429|quota|exhausted|rate/.test(m)) return "The coach is busy right now. Please try again in a minute.";
  if (/403|disabled|not been used|permission|api key|ai logic/.test(m)) return "The coach isn't switched on yet. (App owner: enable Firebase AI Logic in the Firebase console.)";
  if (/safety|blocked/.test(m)) return "Sorry, I can't answer that one. Try asking another way.";
  return "Something went wrong. Please try again.";
}
async function sendChat(text) {
  text = (text || "").trim(); if (!text || chatBusy) return;
  if (chatLeft() <= 0) { renderChat(); return; }
  if (!navigator.onLine) { toast("You're offline. Connect to ask the coach.", true); return; }
  chatBusy = true; $("chatIn").value = ""; autoGrow();
  const history = chatMsgs.filter(m => !m.err).slice(-CHAT_KEEP);
  chatMsgs.push({ role: "user", text }); const ans = { role: "model", text: "" }; chatMsgs.push(ans);
  mem.set(chatKey(), String((parseInt(mem.get(chatKey()) || "0", 10) || 0) + 1));
  renderChat();
  const box = $("chatMsgs"), bub = box.lastElementChild; bub.classList.add("typing"); bub.innerHTML = "<span class='dots'><i></i><i></i><i></i></span>";
  try {
    const stream = await be.chatStream(history, text, coachSystem());
    for await (const chunk of stream) { ans.text += chunk; bub.classList.remove("typing"); bub.innerHTML = mdLite(ans.text); box.scrollTop = box.scrollHeight; }
    if (!ans.text.trim()) throw new Error("empty answer, blocked");
  } catch (e) {
    console.warn("coach:", e); ans.text = chatError(e); ans.err = true;
  }
  chatBusy = false; renderChat();
}
function autoGrow() { const t = $("chatIn"); t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }

/* ---------- press and hold an exercise button, then drag to reorder ---------- */
let drag = null, dragJustEnded = false;
function setupDrag() {
  const grid = $("exGrid");
  const end = (commit) => {
    if (!drag) return; const d = drag; drag = null; clearTimeout(d.timer);
    document.body.classList.remove("dragging-ex");
    if (!d.active) return;
    d.b.classList.remove("lifted"); d.b.style.transform = "";
    dragJustEnded = true; // swallows the click that follows the drop
    const order = [...grid.querySelectorAll(".exb[data-ex]")].map(x => x.dataset.ex);
    const before = exercisesFor(day);
    if (commit && order.join("\n") !== before.join("\n") && order.length === before.length) {
      lists = { ...lists, [day]: order }; saveLists(); toast("Order saved." + offlineNote());
      if (tab === "history") renderHistory();
    }
    renderExGrid();
  };
  const place = (x, y) => {
    const d = drag; d.b.style.transform = "";
    const r = d.b.getBoundingClientRect();
    d.b.style.transform = "translate(" + (x - d.gx - r.left) + "px," + (y - d.gy - r.top) + "px) scale(1.05)";
  };
  grid.addEventListener("pointerdown", e => {
    dragJustEnded = false;
    const b = e.target.closest(".exb[data-ex]"); if (!b || e.button > 0) return;
    const r = b.getBoundingClientRect();
    drag = { b, id: e.pointerId, sx: e.clientX, sy: e.clientY, gx: e.clientX - r.left, gy: e.clientY - r.top, active: false };
    drag.timer = setTimeout(() => {
      if (!drag) return; drag.active = true;
      b.classList.add("lifted"); document.body.classList.add("dragging-ex");
      try { b.setPointerCapture(drag.id); } catch (err) {}
      if (navigator.vibrate) try { navigator.vibrate(25); } catch (err) {}
    }, 400);
  });
  grid.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) { if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 10) { clearTimeout(drag.timer); drag = null; } return; }
    e.preventDefault();
    const over = [...grid.querySelectorAll(".exb[data-ex]")].find(x => {
      if (x === drag.b) return false; const q = x.getBoundingClientRect();
      return e.clientX >= q.left && e.clientX <= q.right && e.clientY >= q.top && e.clientY <= q.bottom;
    });
    if (over) {
      const all = [...grid.querySelectorAll(".exb[data-ex]")];
      if (all.indexOf(over) > all.indexOf(drag.b)) over.after(drag.b); else over.before(drag.b);
    }
    place(e.clientX, e.clientY);
  });
  grid.addEventListener("pointerup", () => end(true));
  grid.addEventListener("pointercancel", () => end(false));
  grid.addEventListener("contextmenu", e => { if (e.target.closest(".exb")) e.preventDefault(); });
  // stop the page scrolling while an exercise is being dragged (iPhone needs a non-passive listener)
  document.addEventListener("touchmove", e => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
}

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
    return { "Date": dt(s.date), "Day": s.day, "Exercise": s.ex, "Set #": count[k], "Weight (kg)": s.w, "Reps": s.r, "Warm-up": s.wu ? "Yes" : "", "Notes": s.note || "" };
  });
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ "Date": "", "Day": "", "Exercise": "", "Set #": "", "Weight (kg)": "", "Reps": "", "Warm-up": "", "Notes": "" }], { cellDates: true, dateNF: "dd-mmm-yy" });
  ws["!cols"] = [{ wch: 11 }, { wch: 10 }, { wch: 36 }, { wch: 6 }, { wch: 11 }, { wch: 6 }, { wch: 8 }, { wch: 20 }];
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
  $("celeOn").onchange = () => { prefs = { ...prefs, celebrate: $("celeOn").checked }; savePrefs(); };
  $("cele").addEventListener("click", e => { if (!e.target.closest(".cbtn")) closeCele(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("cele").hidden) closeCele(); });
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
    try { await be.signIn(); }
    catch (e) {
      const c = e && e.code || "";
      if (c === "auth/popup-blocked" || c === "auth/operation-not-supported-in-this-environment" || c === "auth/web-storage-unsupported") { showInApp(true); $("gateMsg").textContent = "This browser blocked the Google sign-in window."; }
      else if (c === "auth/network-request-failed") $("gateMsg").textContent = "No connection. Check your internet and try again.";
      else $("gateMsg").textContent = "Sign-in didn't work (" + (c || "unknown error") + "). Try again, or open the page in Safari or Chrome.";
    }
  };
  // In-app browsers (Instagram, Facebook, TikTok…) block Google sign-in: explain how to open the real browser.
  const appName = inAppBrowser();
  if (appName) showInApp(false, appName);
  $("copyLink").onclick = async () => {
    const url = location.href.split("#")[0].split("?")[0];
    try { await navigator.clipboard.writeText(url); $("copyLink").textContent = "Copied!"; }
    catch (e) { const r = document.createRange(); r.selectNodeContents($("inappUrl")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); $("copyLink").textContent = "Select and copy"; }
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
  setupDrag();
  // AI coach chat
  $("chatOpen").onclick = openChat; $("chatBack").onclick = closeChat;
  $("chatNew").onclick = () => { if (chatBusy) return; chatMsgs = []; renderChat(); $("chatIn").focus(); };
  $("chatForm").onsubmit = e => { e.preventDefault(); sendChat($("chatIn").value); };
  $("chatIn").oninput = autoGrow;
  $("chatIn").onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); sendChat($("chatIn").value); } };
  if (window.visualViewport) { visualViewport.addEventListener("resize", () => { if (!$("chat").hidden) { fitChat(); $("chatMsgs").scrollTop = $("chatMsgs").scrollHeight; } }); visualViewport.addEventListener("scroll", () => { if (!$("chat").hidden) fitChat(); }); }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("chat").hidden) closeChat(); });
  // no zooming: block pinch (iPhone gesture events + two-finger moves); double-tap zoom is off via CSS touch-action
  ["gesturestart", "gesturechange", "gestureend"].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener("touchmove", e => { if (e.touches.length > 1 || (e.scale && e.scale !== 1)) e.preventDefault(); }, { passive: false });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  // colours
  $("thSave").onclick = saveThemeEdit;
  $("thCancel").onclick = () => { themeEditing = null; $("themeEdit").hidden = true; paintTheme(); renderThemes(); };
  ["thBg", "thSurface", "thInk", "thAccent"].forEach(id => $(id).addEventListener("input", previewThemeEdit));
  paintTheme(); renderThemes();
  if (Number(mem.get("restEnd") || 0) > Date.now()) runRest();
}

function inAppBrowser() {
  const ua = navigator.userAgent || "";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return "Facebook";
  if (/Messenger/i.test(ua)) return "Messenger";
  if (/musical_ly|Bytedance|TikTok/i.test(ua)) return "TikTok";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/\bLine\//i.test(ua)) return "LINE";
  if (/Twitter/i.test(ua)) return "X";
  return null;
}
function showInApp(blocked, appName) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent), browser = ios ? "Safari" : "Chrome";
  $("inapp").hidden = false;
  $("inappHow").textContent = appName ? "You opened this inside " + appName + ", which blocks Google sign-in." : "This browser blocked the Google sign-in window.";
  const steps = appName
    ? ["Tap the <b>⋯</b> or <b>⋮</b> menu at the top of the screen.", "Choose <b>Open in external browser</b> (or <b>Open in " + browser + "</b>).", "Tap <b>Sign in with Google</b> there."]
    : ["Copy the link below.", "Open <b>" + browser + "</b> and paste it into the address bar.", "Tap <b>Sign in with Google</b> there."];
  $("inappSteps").innerHTML = steps.map(x => "<li>" + x + "</li>").join("");
  // one-tap jump to the real browser: Chrome via an Android intent, Safari via x-safari-https (iOS 17+)
  const url = location.href.split("#")[0].split("?")[0], btn = $("openReal");
  if (appName) {
    const rest = url.replace(/^https?:\/\//, "");
    btn.href = ios ? "x-safari-" + url.replace(/^http:/, "https:")
      : "intent://" + rest + "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
    btn.textContent = "Open in " + browser; btn.hidden = false; $("orLbl").hidden = false;
  } else { btn.hidden = true; $("orLbl").hidden = true; }
  $("inappUrl").textContent = location.href.split("#")[0].split("?")[0];
}

async function start() {
  wire();
  const mock = new URLSearchParams(location.search).has("mock");
  if (!mock && String(firebaseConfig.apiKey).startsWith("PASTE")) {
    show("gate"); $("signin").disabled = true;
    $("gateMsg").textContent = "Setup isn't finished: add your Firebase config to firebase-config.js.";
    return;
  }
  try { be = mock ? mockBackend() : await firebaseBackend(firebaseConfig, appCheckSiteKey); }
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
