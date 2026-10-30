import { firebaseConfig } from "./firebase-config.js";
import { firebaseBackend, mockBackend } from "./backend.js";

const DAYS = ["Push", "Pull", "Legs", "Shoulders"];
const BASE = {
  Push: ["Chest Press", "Pec machine elbows", "Rope Tricep extension Vertical", "Rope Tricep extension – entrance", "Rope Tricep extension - cables machine", "One hand tri extension - entrance", "One hand tri extension – double cables"],
  Pull: ["Lat pulldown straight grip", "Close grip", "Lat Pulldown Neutral Grip", "Lower back - freeweight", "Standing bicep curls", "Standing Hammer curls"],
  Legs: ["Hack squat", "Hamstring curls", "Leg extensions (aristera)", "Calves"],
  Shoulders: ["Shoulder press", "Lateral raises machine", "Face pulls"]
};

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const isoOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const todayISO = () => isoOf(new Date());
const mem = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const clone = o => JSON.parse(JSON.stringify(o));

let be = null, uid = null, unsub = null;
let sessions = {}, lists = clone(BASE), day = mem.get("day") || "Push", histDay = null, renaming = null, removing = null;
const expanded = new Set();

/* ---------- screens ---------- */
function show(which) { ["gate", "loading", "main"].forEach(id => { $(id).hidden = id !== which; }); }

/* ---------- rendering ---------- */
const exercisesFor = d => [...(lists[d] || [])];
const fmtDate = iso => { const [y, m, d] = iso.split("-"); return d + "/" + m + "/" + y.slice(2); };
function allSets() { const out = []; Object.values(sessions).forEach(s => (s.sets || []).forEach(x => out.push({ ...x, date: s.date }))); return out; }

function renderDays() { document.querySelectorAll("[data-day]").forEach(b => b.setAttribute("aria-pressed", b.dataset.day === day)); }
function renderSelect() {
  const sel = $("ex"), keep = mem.get("ex_" + day);
  sel.innerHTML = "";
  exercisesFor(day).forEach(n => { const o = document.createElement("option"); o.textContent = n; sel.appendChild(o); });
  if (keep && exercisesFor(day).includes(keep)) sel.value = keep;
  renderHint();
}
function renderHint() {
  const ex = $("ex").value, cur = $("date").value;
  const prev = allSets().filter(s => s.ex === ex && s.date < cur).sort((a, b) => a.date < b.date ? 1 : -1);
  if (!prev.length) { $("hint").textContent = "No earlier sets for this one yet."; return; }
  const last = prev[0].date, sets = prev.filter(s => s.date === last).sort((a, b) => a.t - b.t);
  $("hint").textContent = "Last time (" + fmtDate(last) + "): ";
  const b = document.createElement("b"); b.textContent = sets.map(s => s.w + " kg × " + s.r).join("  ·  "); $("hint").appendChild(b);
}
function renderHistory() {
  const hd = histDay || day;
  document.querySelectorAll("[data-hday]").forEach(b => b.setAttribute("aria-pressed", b.dataset.hday === hd));
  const box = $("history"); box.innerHTML = "";
  const all = allSets(), cur = $("date").value;
  const names = exercisesFor(hd);
  all.forEach(s => { if (s.day === hd && !names.includes(s.ex)) names.push(s.ex); });
  if (!names.length) { box.innerHTML = '<div class="empty">No exercises for this day yet. Add one at the bottom of the page.</div>'; return; }
  names.forEach(ex => {
    const byDate = {}; all.filter(s => s.ex === ex).forEach(s => { (byDate[s.date] = byDate[s.date] || []).push(s); });
    const dates = Object.keys(byDate).sort().reverse();
    const card = document.createElement("div"); card.className = "ex-card";
    const head = document.createElement("div"); head.className = "ex-head";
    if (renaming === hd + "|" + ex) {
      head.className = "ex-head renaming";
      const inp = document.createElement("input"); inp.type = "text"; inp.id = "rename-input"; inp.value = ex; inp.setAttribute("aria-label", "New name for " + ex);
      const ok = document.createElement("button"); ok.className = "use primary"; ok.textContent = "Save";
      const no = document.createElement("button"); no.className = "use"; no.textContent = "Cancel";
      ok.onclick = () => renameExercise(hd, ex, inp.value);
      no.onclick = () => { renaming = null; removing = null; renderHistory(); };
      inp.onkeydown = e => { if (e.key === "Enter") ok.click(); if (e.key === "Escape") no.click(); };
      head.append(inp, ok, no);
      card.appendChild(head);
      const nSets = all.filter(s => s.ex === ex && s.day === hd).length;
      const zone = document.createElement("div"); zone.className = "remove-zone";
      if (removing === hd + "|" + ex) {
        const msg = document.createElement("p"); msg.className = "small";
        msg.textContent = nSets ? "Remove " + ex + " and its " + nSets + " logged set" + (nSets > 1 ? "s" : "") + "? This can't be undone." : "Remove " + ex + " from your " + hd + " list?";
        const yes = document.createElement("button"); yes.className = "use danger"; yes.textContent = nSets ? "Remove exercise and sets" : "Remove exercise";
        const keep = document.createElement("button"); keep.className = "use"; keep.textContent = "Keep it";
        yes.onclick = () => removeExercise(hd, ex);
        keep.onclick = () => { removing = null; renderHistory(); };
        const row = document.createElement("div"); row.className = "btns"; row.append(yes, keep);
        zone.append(msg, row);
      } else {
        const link = document.createElement("button"); link.className = "more danger-link"; link.textContent = "Remove exercise…";
        link.onclick = () => { removing = hd + "|" + ex; renderHistory(); };
        zone.appendChild(link);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
      }
      card.appendChild(zone);
    } else {
      const h = document.createElement("h3"); h.textContent = ex;
      const btns = document.createElement("div"); btns.className = "btns";
      const ren = document.createElement("button"); ren.className = "use"; ren.textContent = "Rename";
      ren.onclick = () => { renaming = hd + "|" + ex; removing = null; renderHistory(); };
      const use = document.createElement("button"); use.className = "use"; use.textContent = "Log this";
      use.onclick = () => pickExercise(hd, ex, dates.length ? byDate[dates[0]].sort((a, b) => a.t - b.t).slice(-1)[0] : null);
      btns.append(ren, use); head.append(h, btns);
      card.appendChild(head);
    }
    if (!dates.length) { const n = document.createElement("div"); n.className = "none"; n.textContent = "No sets logged yet."; card.appendChild(n); }
    (expanded.has(ex) ? dates : dates.slice(0, 3)).forEach((d, idx) => {
      const row = document.createElement("div"); row.className = "sess" + (idx === 0 ? " latest" : "");
      const dl = document.createElement("span"); dl.className = "d"; dl.textContent = fmtDate(d);
      const chips = document.createElement("div"); chips.className = "chips";
      byDate[d].sort((a, b) => a.t - b.t).forEach(s => {
        const c = document.createElement("span"); c.className = "chip"; c.textContent = s.w + "×" + s.r;
        if (s.note) { const sm = document.createElement("small"); sm.textContent = s.note; c.appendChild(sm); }
        chips.appendChild(c);
      });
      const del = document.createElement("span");
      if (d === cur) {
        const b = document.createElement("button"); b.textContent = "Undo last"; b.setAttribute("aria-label", "Delete the last set of " + ex + " for this session");
        b.onclick = () => { const list = sessions[d].sets || []; let i = -1, tt = -1; list.forEach((s, k) => { if (s.ex === ex && s.t > tt) { tt = s.t; i = k; } }); if (i >= 0) removeSet(d, i); };
        del.appendChild(b);
      }
      row.append(dl, chips, del); card.appendChild(row);
    });
    if (dates.length > 3) {
      const m = document.createElement("button"); m.className = "more";
      m.textContent = expanded.has(ex) ? "Show fewer" : "Show all " + dates.length + " sessions";
      m.onclick = () => { expanded.has(ex) ? expanded.delete(ex) : expanded.add(ex); renderHistory(); };
      card.appendChild(m);
    }
    box.appendChild(card);
  });
}
function renderAll() { renderDays(); renderSelect(); if (!renaming) renderHistory(); }

function pickExercise(d, ex, last) {
  day = d; mem.set("day", day); histDay = null; renderDays(); renderSelect();
  if (!exercisesFor(day).includes(ex)) { const o = document.createElement("option"); o.textContent = ex; $("ex").appendChild(o); }
  $("ex").value = ex; mem.set("ex_" + day, ex);
  if (last) { $("w").value = last.w; $("r").value = last.r; }
  renderHint(); renderHistory();
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}
function toast(msg, err) { const t = $("drawer").classList.contains("open") ? $("drawerToast") : $("toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); clearTimeout(toast.h); toast.h = setTimeout(() => { t.textContent = ""; }, 3500); }
const offlineNote = () => navigator.onLine ? "" : " · syncs when you're back online";

/* ---------- writes (local first; Firestore syncs in the background) ---------- */
function writeSession(date, data) {
  const p = data.sets.length ? be.set(uid, "s_" + date, data) : be.del(uid, "s_" + date);
  p.catch(e => toast("Couldn't save to your account: " + (e && e.message || "try again"), true));
  return p;
}
function saveLists() {
  const p = be.set(uid, "exercises", { full: true, Push: lists.Push, Pull: lists.Pull, Legs: lists.Legs, Shoulders: lists.Shoulders });
  p.catch(() => toast("Couldn't save your exercise list.", true));
  return p;
}

function saveSet() {
  const w = parseFloat(String($("w").value).replace(",", ".")), r = parseInt($("r").value, 10);
  if (!(w >= 0) || !(r > 0)) { toast("Enter a weight and at least 1 rep.", true); return; }
  const date = $("date").value || todayISO(), ex = $("ex").value;
  if (!ex) { toast("Pick an exercise first.", true); return; }
  const s = sessions[date] || { date, sets: [] };
  const next = { date, sets: [...(s.sets || []), { day, ex, w, r, note: $("note").value.trim(), t: Date.now() }] };
  sessions[date] = next; renderHistory(); renderHint();
  writeSession(date, next);
  toast("Saved: " + ex + " set " + next.sets.filter(x => x.ex === ex).length + " — " + w + " kg × " + r + offlineNote());
  $("note").value = "";
}
function removeSet(date, i) {
  const s = sessions[date]; if (!s) return;
  const next = { date, sets: s.sets.filter((_, k) => k !== i) };
  if (next.sets.length) sessions[date] = next; else delete sessions[date];
  renderHistory(); renderHint();
  writeSession(date, next); toast("Set deleted." + offlineNote());
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
  expanded.delete(ex); renaming = null; removing = null;
  renderSelect(); renderHistory();
  saveLists(); changed.forEach(s => writeSession(s.date, s));
  toast("Removed " + ex + "." + offlineNote());
}
function renameExercise(d, oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) { renaming = null; renderHistory(); return; }
  if (exercisesFor(d).includes(newName)) { toast("There's already an exercise called " + newName + " in " + d + ".", true); return; }
  const idx = lists[d].indexOf(oldName);
  lists = { ...lists, [d]: idx >= 0 ? lists[d].map(n => n === oldName ? newName : n) : [...lists[d], newName] };
  const changed = [];
  Object.values(sessions).forEach(s => {
    if ((s.sets || []).some(x => x.ex === oldName && x.day === d)) {
      const next = { date: s.date, sets: s.sets.map(x => x.ex === oldName && x.day === d ? { ...x, ex: newName } : x) };
      sessions[s.date] = next; changed.push(next);
    }
  });
  if (mem.get("ex_" + d) === oldName) mem.set("ex_" + d, newName);
  if (expanded.has(oldName)) { expanded.delete(oldName); expanded.add(newName); }
  renaming = null; renderSelect(); renderHistory();
  saveLists(); changed.forEach(s => writeSession(s.date, s));
  toast("Renamed to " + newName + (changed.length ? " across " + changed.length + " session" + (changed.length > 1 ? "s" : "") : "") + "." + offlineNote());
}

/* ---------- Excel ---------- */
function exportExcel() {
  const rows = allSets().sort((a, b) => a.date === b.date ? a.t - b.t : (a.date < b.date ? -1 : 1));
  if (!rows.length) { toast("Nothing to export yet.", true); return; }
  if (typeof XLSX === "undefined") { toast("Excel export needs a connection the first time. Try again online.", true); return; }
  const count = {};
  const data = rows.map(s => {
    const k = s.date + "|" + s.ex; count[k] = (count[k] || 0) + 1;
    const [y, m, d] = s.date.split("-").map(Number);
    return { "Date": new Date(y, m - 1, d), "Day": s.day, "Exercise": s.ex, "Set #": count[k], "Weight (kg)": s.w, "Reps": s.r, "Volume (kg)": s.w * s.r, "Notes": s.note || "" };
  });
  const ws = XLSX.utils.json_to_sheet(data, { cellDates: true, dateNF: "dd-mmm-yy" });
  ws["!cols"] = [{ wch: 11 }, { wch: 10 }, { wch: 36 }, { wch: 6 }, { wch: 11 }, { wch: 6 }, { wch: 11 }, { wch: 20 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Log");
  const blob = new Blob([XLSX.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "Gym_Log_" + todayISO() + ".xlsx";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Exported " + rows.length + " sets.");
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return isoOf(new Date(v.getTime() + 12 * 3600e3)); // nudge to midday so time-zone offsets can't shift the day
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400e3)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  if (typeof v === "string") {
    const s = v.trim(); let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
    if ((m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3})[A-Za-z]*[-/ .](\d{2,4})$/)) && MONTHS[m[2].toLowerCase()]) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return y + "-" + pad(MONTHS[m[2].toLowerCase()]) + "-" + pad(+m[1]); }
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return y + "-" + pad(+m[2]) + "-" + pad(+m[1]); }
  }
  return null;
}
// Merge rows into existing sessions; returns {sessions, lists, added, skipped, bad}
export function mergeRows(rows, curSessions, curLists) {
  const S = clone(curSessions), L = clone(curLists); let added = 0, skipped = 0, bad = 0;
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
    let d = String(pick(r, "day") ?? "").trim(); d = DAYS.find(x => x.toLowerCase() === d.toLowerCase()) || DAYS.find(x => (L[x] || []).includes(ex)) || "Push";
    const k = date + "|" + ex + "|" + w + "|" + reps;
    if (remaining[k] > 0) { remaining[k]--; skipped++; return; }
    if (!(L[d] || []).includes(ex) && !DAYS.some(x => (L[x] || []).includes(ex))) L[d] = [...(L[d] || []), ex];
    const s = S[date] || (S[date] = { date, sets: [] });
    const [y, mo, dd] = date.split("-").map(Number);
    s.sets.push({ day: d, ex, w, r: reps, note: String(pick(r, "notes", "note") ?? "").trim(), t: new Date(y, mo - 1, dd, 12).getTime() + (seq++) });
    added++;
  });
  return { sessions: S, lists: L, added, skipped, bad };
}
async function importExcel(file) {
  if (typeof XLSX === "undefined") { toast("Import needs a connection. Try again online.", true); return; }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: "" });
    const before = clone(sessions), listsBefore = JSON.stringify(lists);
    const res = mergeRows(rows, sessions, lists);
    if (!res.added) { toast(res.skipped ? "Nothing new — all " + res.skipped + " sets are already in your log." : "Couldn't find any sets in that file.", true); return; }
    sessions = res.sessions; lists = res.lists;
    Object.keys(sessions).forEach(d => { if (JSON.stringify(sessions[d]) !== JSON.stringify(before[d])) writeSession(d, sessions[d]); });
    if (JSON.stringify(lists) !== listsBefore) saveLists();
    renderAll();
    toast("Imported " + res.added + " sets" + (res.skipped ? ", skipped " + res.skipped + " you already had" : "") + (res.bad ? ", " + res.bad + " rows unreadable" : "") + ".");
  } catch (e) { toast("Couldn't read that file. Use an .xlsx exported from Gym Log.", true); }
}

/* ---------- data from the backend ---------- */
function applyDocs(docs) {
  const next = {};
  Object.entries(docs).forEach(([id, v]) => {
    if (!v) return;
    if (id === "exercises") {
      const nl = {};
      DAYS.forEach(k => { const arr = Array.isArray(v[k]) ? v[k].filter(x => typeof x === "string") : []; nl[k] = v.full ? arr : [...BASE[k], ...arr.filter(x => !BASE[k].includes(x))]; });
      lists = nl;
    } else if (v.date) next[v.date] = v;
  });
  sessions = next;
  if (!renaming) renderAll(); else renderHint();
  const n = Object.keys(next).length;
  $("status").textContent = n + " session" + (n === 1 ? "" : "s") + " saved · private to you";
}

/* ---------- wiring ---------- */
function wire() {
  $("date").value = todayISO();
  document.querySelectorAll("[data-day]").forEach(b => b.onclick = () => { day = b.dataset.day; mem.set("day", day); histDay = null; renderAll(); });
  document.querySelectorAll("[data-hday]").forEach(b => b.onclick = () => { histDay = b.dataset.hday; renderHistory(); });
  $("ex").onchange = () => { mem.set("ex_" + day, $("ex").value); renderHint(); };
  $("date").onchange = () => { renderHistory(); renderHint(); };
  document.querySelectorAll("[data-step]").forEach(b => b.onclick = () => {
    const el = $(b.dataset.step), d = parseFloat(b.dataset.d), v = parseFloat(String(el.value).replace(",", ".")) || 0;
    el.value = Math.max(0, Math.round((v + d) * 10) / 10);
  });
  $("save").onclick = saveSet;
  $("addEx").onclick = () => {
    const n = $("newEx").value.trim(); if (!n) return;
    if (exercisesFor(day).includes(n)) { toast("That's already on the " + day + " list.", true); return; }
    lists = { ...lists, [day]: [...(lists[day] || []), n] };
    $("newEx").value = ""; mem.set("ex_" + day, n); renderAll();
    saveLists(); toast("Added " + n + " to " + day + "." + offlineNote());
  };
  $("export").onclick = exportExcel;
  $("importFile").onchange = e => { const f = e.target.files[0]; if (f) importExcel(f); e.target.value = ""; };
  $("signin").onclick = async () => {
    $("gateMsg").textContent = "";
    try { await be.signIn(); } catch (e) { $("gateMsg").textContent = "Sign-in didn't work: " + (e && (e.code || e.message) || "try again"); }
  };
  $("signout").onclick = () => { closeMenu(); be.signOut(); };
  const openMenu = () => {
    $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false");
    $("menuOpen").setAttribute("aria-expanded", "true"); setTimeout(() => $("menuClose").focus(), 50);
  };
  const closeMenu = () => {
    if (!$("drawer").classList.contains("open")) return;
    $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true");
    $("menuOpen").setAttribute("aria-expanded", "false"); $("drawerToast").textContent = ""; $("menuOpen").focus();
  };
  $("menuOpen").onclick = openMenu;
  $("menuClose").onclick = closeMenu;
  $("drawerBackdrop").onclick = closeMenu;
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  const paintTheme = () => {
    const t = mem.get("theme") || "auto";
    if (t === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", t);
    document.querySelectorAll("[data-theme-pick]").forEach(b => b.setAttribute("aria-pressed", b.dataset.themePick === t));
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => { if (t === "auto") m.content = m.media.includes("dark") ? "#121518" : "#f7f5f2"; else m.content = bg; });
  };
  document.querySelectorAll("[data-theme-pick]").forEach(b => b.onclick = () => { mem.set("theme", b.dataset.themePick); paintTheme(); });
  paintTheme();
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
    if (!u) { uid = null; sessions = {}; lists = clone(BASE); show("gate"); return; }
    uid = u.uid; $("who").textContent = "Signed in as " + (u.email || u.name);
    show("main"); renderAll();
    unsub = be.subscribe(uid, applyDocs, () => { $("status").textContent = "Lost connection to your log. Reopen the app to reconnect."; });
  });
  if (!mock && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
