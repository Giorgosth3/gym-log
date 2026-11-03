// Muscle ranks: the body map drawing and the points engine. Pure functions, no app state.

/* ---------- muscles ---------- */
export const MUSCLE_KEYS = ["chest", "back", "shoulders", "biceps", "triceps", "core", "quads", "hams", "calves"];
export const MUSCLE_NAMES = { chest: "Chest", back: "Back", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", core: "Core", quads: "Quads", hams: "Hamstrings & glutes", calves: "Calves" };
export const LIB_MUSCLE = { "Chest": "chest", "Back": "back", "Shoulders": "shoulders", "Biceps": "biceps", "Triceps": "triceps", "Core": "core", "Quads": "quads", "Hamstrings & glutes": "hams", "Calves": "calves" };
// guess the muscle from a typed name (the person confirms it)
const GUESS = [
  ["calves", /calf|calves/],
  ["hams", /\bhams?\b|hamstring|glute|hip thrust|leg curl|lying curl|seated curl|\brdl\b|romanian|deadlift|good morning|abduct|bridge/],
  ["quads", /quad|squat|leg press|leg ext|lunge|step ?up|\bhack|adduct|sissy/],
  ["triceps", /tricep|push ?down|skull|kickback|overhead ext|close grip|\bdips?\b/],
  ["biceps", /bicep|^(?!.*leg).*curl|hammer|preacher/],
  ["core", /\babs?\b|crunch|plank|core|oblique|sit ?up|leg raise|russian|wood ?chop|hollow/],
  ["shoulders", /shoulder|delt|lateral|overhead press|military|arnold|face pull|upright|rear/],
  ["back", /\brow|pull ?down|\blats?\b|pull ?up|\bchin|\bback\b|shrug|\btraps?\b|hyperext|pullover/],
  ["chest", /chest|\bpec|bench|\bfly|flye|cross ?over|push ?up/]
];
export function guessMuscle(name) { const n = String(name).toLowerCase(); for (const [m, re] of GUESS) if (re.test(n)) return m; return null; }

/* ---------- tiers ---------- */
// 16 steps: Bronze I..Diamond III (1-15), Legend (16). Points needed for each.
export const THR = [10, 40, 80, 130, 190, 260, 340, 430, 530, 640, 760, 890, 1030, 1180, 1340, 1500];
export const TIER_N = ["Untrained", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Legend"];
export const TIER_C = ["#6b7682", "#d48a52", "#cfd7df", "#f5c542", "#8fdcc6", "#5fd3ff", "#d27bff"];
const TIER_G = [["#2b3139", "#2b3139"], ["#d48a52", "#7a4422"], ["#f2f5f8", "#8c97a3"], ["#ffe27a", "#c99412"], ["#e8fff8", "#5fb39f"], ["#a6f0ff", "#1e9fe0"], ["#ff8ad8", "#6a2cff"]];
const ROMAN = ["", "I", "II", "III"];
export const stepIdx = pts => THR.filter(t => pts >= t).length;          // 0..16
export const tierOf = idx => idx <= 0 ? 0 : idx >= 16 ? 6 : Math.ceil(idx / 3);
export const stepOf = idx => idx <= 0 || idx >= 16 ? 0 : ((idx - 1) % 3) + 1;
export const stepName = idx => idx <= 0 ? "Untrained" : idx >= 16 ? "Legend" : TIER_N[tierOf(idx)] + " " + ROMAN[stepOf(idx)];
// overall level from total points: level L needs 40·(L−1)² points
export const levelOf = total => 1 + Math.floor(Math.sqrt(Math.max(0, total) / 40));
export const levelPts = L => 40 * (L - 1) * (L - 1);
export const levelTitle = L => L >= 16 ? "Legend" : L >= 12 ? "Titan" : L >= 8 ? "Steel" : L >= 5 ? "Iron" : L >= 3 ? "Regular" : "Rookie";

/* ---------- the engine ----------
   sets: [{ex, w, r, date, wu}], muscleOf(exName) -> key|null, today 'YYYY-MM-DD'
   +10 per muscle per training day (≥2 working sets), max 3 days a week.
   Personal best (estimated 1-rep max, after a 2-session baseline per exercise): 3 pts per 1% stronger, 3..15, max one per exercise per week.
   14 days without a muscle: drop one step, then another every 7 days (never below Bronze I). Double points while below your peak step.
   Legend also needs that muscle trained in 40 of the last 52 weeks. */
const e1 = s => s.r <= 1 ? s.w : s.w * (1 + s.r / 30);
const dayN = iso => { const [y, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const isoN = n => new Date(n * 864e5).toISOString().slice(0, 10);
const weekN = n => Math.floor((n + 3) / 7);    // weeks start Monday (1970-01-01 was a Thursday)
export function computeRanks(sets, muscleOf, today) {
  const T = dayN(today), work = sets.filter(s => !s.wu && s.w >= 0 && s.r > 0 && s.date <= today);
  // per day: sets per muscle; per exercise: best e1RM per day
  const byDay = new Map();
  work.forEach(s => { const n = dayN(s.date); if (!byDay.has(n)) byDay.set(n, []); byDay.get(n).push(s); });
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const st = {}; MUSCLE_KEYS.forEach(m => { st[m] = { pts: 0, peak: 0, last: null, trainedDays: [], weekCount: {}, weeks: new Set(), lastDrop: null, history: [] }; });
  const ex = {};      // exercise -> { sessions, best, lastBonusWeek }
  const events = [];  // {date, m, from, to}
  if (!days.length) return finish();
  let di = 0;
  for (let n = days[0]; n <= T; n++) {
    // fading (checked every day before training)
    MUSCLE_KEYS.forEach(m => {
      const s = st[m]; if (s.last == null) return;
      const gap = n - s.last; if (gap < 14 || (gap - 14) % 7 !== 0) return;
      const i = stepIdx(s.pts); if (i <= 1) return;
      const before = i; s.pts = THR[i - 2]; events.push({ n, m, from: before, to: stepIdx(s.pts), drop: true });
    });
    if (di < days.length && days[di] === n) {
      const list = byDay.get(n); di++;
      const gain = {}, setsPer = {};
      list.forEach(x => { const m = muscleOf(x.ex); if (m) setsPer[m] = (setsPer[m] || 0) + 1; });
      Object.entries(setsPer).forEach(([m, c]) => {
        if (c < 2) return; const s = st[m], w = weekN(n);
        s.weeks.add(w); s.trainedDays.push(n); s.last = n;
        if ((s.weekCount[w] || 0) < 3) { s.weekCount[w] = (s.weekCount[w] || 0) + 1; gain[m] = (gain[m] || 0) + 10; }
      });
      // personal bests
      const bestToday = {};
      list.forEach(x => { const v = e1(x); if (!(x.ex in bestToday) || v > bestToday[x.ex]) bestToday[x.ex] = v; });
      Object.entries(bestToday).forEach(([name, v]) => {
        const e = ex[name] = ex[name] || { sessions: 0, best: 0, bonusWeek: null }, m = muscleOf(name);
        e.sessions++;
        if (e.sessions <= 2) { e.best = Math.max(e.best, v); return; }
        if (v > e.best + 1e-9) {
          const pct = (v / e.best - 1) * 100, w = weekN(n);
          if (m && e.best > 0 && e.bonusWeek !== w) { gain[m] = (gain[m] || 0) + Math.max(3, Math.min(15, Math.round(pct * 3))); e.bonusWeek = w; }
          e.best = v;
        }
      });
      Object.entries(gain).forEach(([m, g]) => {
        const s = st[m], before = stepIdx(s.pts), mult = before < s.peak ? 2 : 1;
        s.pts += g * mult;
        // Legend needs 40 of the last 52 weeks
        if (stepIdx(s.pts) >= 16) { const w = weekN(n); let c = 0; for (let k = w - 51; k <= w; k++) if (s.weeks.has(k)) c++; if (c < 40) s.pts = Math.min(s.pts, THR[15] - 1); }
        const after = stepIdx(s.pts); s.peak = Math.max(s.peak, after);
        if (after !== before) events.push({ n, m, from: before, to: after });
      });
    }
  }
  return finish();
  function finish() {
    const out = {}; let total = 0;
    MUSCLE_KEYS.forEach(m => {
      const s = st[m], idx = stepIdx(s.pts); total += s.pts;
      const since = s.last == null ? null : T - s.last;
      let dropIn = null;
      if (since != null && idx > 1) dropIn = since < 14 ? 14 - since : 7 - ((since - 14) % 7);
      out[m] = { pts: s.pts, idx, tier: tierOf(idx), step: stepOf(idx), next: idx < 16 ? THR[idx] : null, prev: idx > 0 ? THR[idx - 1] : 0,
        last: s.last == null ? null : isoN(s.last), since, dropIn, days4w: s.trainedDays.filter(n => n > T - 28).length, comeback: idx < s.peak };
    });
    return { muscles: out, total, level: levelOf(total), events: events.map(e => ({ ...e, date: isoN(e.n) })) };
  }
}

/* ---------- body map drawing (front + back, male + female) ---------- */
const mirror = d => d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (m, x, y) => `${(200 - parseFloat(x)).toFixed(1)} ${y}`);
const NEUTRAL = "#20252c", EDGE = "#121518";
const FRONT = {
  back: ["M93 60 C88 65 80 68 70 71 C76 75 84 75 92 73 C95 70 96 66 96 62 Z"],
  shoulders: ["M67 72 C56 74 48 84 47 98 C47 106 49 112 52 116 C56 106 62 97 70 91 C73 86 73 78 67 72 Z"],
  chest: ["M74 79 C84 75 93 76 98 78 L98 111 C90 117 77 117 68 111 C65 104 66 95 71 89 Z"],
  biceps: ["M51 121 C47 133 45 146 47 159 C51 163 57 163 61 159 C63 145 63 132 59 121 C57 117 53 117 51 121 Z",
    "M46 166 C41 180 39 195 39 210 C43 214 49 214 51 210 C55 197 58 182 60 167 C56 170 50 170 46 166 Z"],
  core: ["M87 121 L98 121 L98 136 L87 136 Z", "M87 139 L98 139 L98 154 L87 154 Z", "M87 158 L98 158 L98 173 L87 173 Z", "M88 177 L98 177 L98 197 C93 196 90 192 88 188 Z",
    "M71 121 C76 123 81 125 84 129 L84 189 C80 195 75 195 71 189 C69 167 69 143 71 121 Z"],
  quads: ["M71 213 C63 240 61 270 65 299 C71 307 81 307 88 301 C94 276 96 246 96 222 C88 214 79 210 71 213 Z"],
  calves: ["M67 326 C63 349 64 372 68 391 C72 395 78 395 82 391 C87 371 89 348 87 326 C80 322 73 322 67 326 Z"]
};
const BACK = {
  back: ["M100 55 C92 61 80 67 67 72 C79 80 90 92 100 116 Z", "M71 93 C80 101 90 115 97 128 L97 168 C88 164 78 151 71 136 C67 121 67 105 71 93 Z",
    "M86 171 L97 172 L97 199 L85 199 C83 189 84 179 86 171 Z"],
  shoulders: ["M66 73 C56 75 48 84 47 98 C47 106 49 112 52 116 C56 106 62 97 69 91 C71 86 71 79 66 73 Z"],
  triceps: ["M51 121 C47 133 45 146 47 159 C51 163 57 163 61 159 C63 145 63 132 59 121 C57 117 53 117 51 121 Z",
    "M46 166 C41 180 39 195 39 210 C43 214 49 214 51 210 C55 197 58 182 60 167 C56 170 50 170 46 166 Z"],
  hams: ["M72 201 C82 197 93 199 98 203 L98 236 C90 243 77 242 71 232 C67 222 67 209 72 201 Z",
    "M71 247 C66 266 65 284 67 300 C73 307 82 307 88 301 C93 284 95 264 96 246 C88 242 79 242 71 247 Z"],
  calves: ["M67 326 C61 343 62 361 69 375 C75 380 83 378 87 370 C91 354 90 338 86 326 C80 322 73 322 67 326 Z"]
};
const DETAIL_FRONT = ["M70 106 C78 112 90 112 97 106", "M57 82 C55 92 54 102 56 110", "M83 230 C82 255 82 280 84 298", "M78 265 C84 280 86 292 87 300", "M74 340 C73 360 74 378 75 388", "M53 134 C53 144 54 152 56 158"];
const DETAIL_BACK = ["M84 110 C88 126 92 140 96 150", "M57 82 C55 92 54 102 56 110", "M83 255 C83 272 83 288 84 300", "M77 335 C76 350 77 362 80 372", "M80 210 C86 216 92 222 96 228", "M53 134 C53 144 54 152 56 158"];
const limb = (pts, w) => `<polyline points="${pts}" fill="none" stroke="${NEUTRAL}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const SIL_M = () => `<g fill="${NEUTRAL}">${limb("60 96 54 140 48 190 44 216", 15) + limb("140 96 146 140 152 190 156 216", 15) + limb("81 216 80 260 78 313 77 360 76 396", 22) + limb("119 216 120 260 122 313 123 360 124 396", 22)}
  <ellipse cx="100" cy="34" rx="17" ry="21"/><rect x="92" y="52" width="16" height="12" rx="3"/><path d="M68 112 C66 140 68 175 72 200 L128 200 C132 175 134 140 132 112 Z"/>
  <ellipse cx="43" cy="224" rx="6" ry="10"/><ellipse cx="157" cy="224" rx="6" ry="10"/><path d="M70 198 L130 198 L127 224 L100 230 L73 224 Z"/>
  <ellipse cx="78" cy="313" rx="10" ry="12"/><ellipse cx="122" cy="313" rx="10" ry="12"/><ellipse cx="74" cy="401" rx="9" ry="5"/><ellipse cx="126" cy="401" rx="9" ry="5"/>
  <path d="M66 70 C74 64 88 62 100 62 C112 62 126 64 134 70 L134 112 L66 112 Z"/></g>`;
const SIL_F = back => `<g fill="${NEUTRAL}">${limb("65 96 60 140 54 190 50 214", 12) + limb("135 96 140 140 146 190 150 214", 12) + limb("78 222 78 264 79 313 78 360 77 396", 21) + limb("122 222 122 264 121 313 122 360 123 396", 21)}
  <path d="M100 13 C${back ? "124 14 128 40 124 60 C130 72 128 92 120 104 C122 86 118 72 112 60" : "120 14 124 30 120 46 C124 56 124 66 118 74 C118 64 116 56 114 50"} Z"/>
  <ellipse cx="100" cy="34" rx="16" ry="20"/><rect x="93" y="52" width="14" height="12" rx="3"/><path d="M72 70 C79 64 89 62 100 62 C111 62 121 64 128 70 L128 112 L72 112 Z"/>
  <path d="M70 112 C69 132 75 156 75 176 C74 188 66 198 65 206 L135 206 C134 198 126 188 125 176 C125 156 131 132 130 112 Z"/><path d="M65 200 L135 200 L131 228 L100 234 L69 228 Z"/>
  <ellipse cx="49" cy="222" rx="5.5" ry="9"/><ellipse cx="151" cy="222" rx="5.5" ry="9"/><ellipse cx="79" cy="313" rx="9.5" ry="12"/><ellipse cx="121" cy="313" rx="9.5" ry="12"/>
  <ellipse cx="75" cy="401" rx="8" ry="5"/><ellipse cx="125" cy="401" rx="8" ry="5"/></g>`;
const F_ADJ = { shoulders: [5, 1, .84, .88], biceps: [5.5, 0, .82, 1], triceps: [5.5, 0, .82, 1], back: [2, 0, .88, 1], core: [2.5, 0, .86, 1], quads: [-3, 4, 1.08, 1], hams: [-3.5, 4, 1.13, 1.03], calves: [-1, 1, .9, 1] };
const CHEST_F = ["M75 82 C84 79 93 80 98 82 L98 104 C93 114 81 117 73 111 C68 104 69 92 75 82 Z"];
const center = d => { const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number); const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]; };
let uid = 0;
// tiers: {muscle: tier 0..6}; opts: {back, sex: "f"|"m", sel, label}
export function bodySVG(tiers, opts = {}) {
  const map = opts.back ? BACK : FRONT, fem = opts.sex === "f", g = "rk" + (++uid);
  let s = `<defs>${TIER_G.map((t, i) => `<linearGradient id="${g}${i}" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="${t[0]}"/><stop offset="1" stop-color="${t[1]}"/></linearGradient>`).join("")}<filter id="${g}w" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  s += fem ? SIL_F(opts.back) : SIL_M();
  Object.entries(map).forEach(([m, paths0]) => {
    const t = tiers[m] || 0, paths = fem && m === "chest" ? CHEST_F : paths0, adj = fem ? F_ADJ[m] : null, sel = opts.sel === m;
    paths.forEach(d => [d, mirror(d)].forEach(p => {
      let tf = "";
      if (adj) { const [x, y] = center(p), side = x < 100 ? 1 : -1; tf = ` transform="translate(${(x + adj[0] * side).toFixed(1)} ${y + adj[1]}) scale(${adj[2]} ${adj[3]}) translate(${-x} ${-y})"`; }
      s += `<path d="${p}"${tf} data-m="${m}" fill="url(#${g}${t})" stroke="${sel ? "#ffffff" : EDGE}" stroke-width="${sel ? 2.6 : 1.6}" stroke-linejoin="round"${t >= 5 ? ` filter="url(#${g}w)"` : ""}/>`;
    }));
  });
  if (!fem) s += `<g fill="none" stroke="rgba(0,0,0,.26)" stroke-width="1.3" stroke-linecap="round" pointer-events="none">${(opts.back ? DETAIL_BACK : DETAIL_FRONT).map(d => `<path d="${d}"/><path d="${mirror(d)}"/>`).join("")}</g>`;
  return `<svg viewBox="30 8 140 405" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${opts.label || "Muscle map"}">${s}</svg>`;
}
