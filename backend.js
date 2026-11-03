// Storage + sign-in. Real backend: Firebase (Google sign-in + Firestore, offline cache).
// Each person's data lives at users/{uid}/log/{docId}; Firestore rules restrict it to that person.
const V = "12.19.0";
const base = `https://www.gstatic.com/firebasejs/${V}/`;

export async function firebaseBackend(config, appCheckKey) {
  const { initializeApp } = await import(base + "firebase-app.js");
  const A = await import(base + "firebase-auth.js");
  const F = await import(base + "firebase-firestore.js");
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  let db;
  try {
    db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  } catch (e) { db = F.getFirestore(app); }
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const col = uid => F.collection(db, "users", uid, "log");
  const me = u => ({ uid: u.uid, name: u.displayName || "", email: u.email || (u.providerData.find(p => p.email) || {}).email || "", guest: u.isAnonymous });
  let AI = null, appCheckOn = false;
  return {
    onUser(cb) {
      return A.onAuthStateChanged(auth, u => cb(u ? me(u) : null));
    },
    current() { return auth.currentUser ? me(auth.currentUser) : null; },
    // Pop-up sign-in only. The redirect method breaks on iPhones and in-app browsers when the
    // app and its sign-in domain differ (GitHub Pages vs firebaseapp.com), so we don't fall back to it.
    async signIn() {
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        const c = e && e.code || "";
        if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
        throw e;
      }
    },
    signOut() { return A.signOut(auth); },
    // email + password and guest (anonymous) accounts
    signInEmail(email, pw) { return A.signInWithEmailAndPassword(auth, email, pw); },
    createEmail(email, pw) { return A.createUserWithEmailAndPassword(auth, email, pw); },
    resetPassword(email) { return A.sendPasswordResetEmail(auth, email); },
    signInGuest() { return A.signInAnonymously(auth); },
    // turn a guest into a real account; same user id, so every logged set stays
    async linkEmail(email, pw) { const r = await A.linkWithCredential(auth.currentUser, A.EmailAuthProvider.credential(email, pw)); return me(r.user); },
    async linkGoogle() { const r = await A.linkWithPopup(auth.currentUser, provider); return me(r.user); },
    subscribe(uid, cb, err) {
      return F.onSnapshot(col(uid), snap => {
        const out = {}; snap.docs.forEach(d => { out[d.id] = d.data(); });
        cb(out, snap.metadata.hasPendingWrites);
      }, err);
    },
    set(uid, id, data) { return F.setDoc(F.doc(col(uid), id), data); },
    // shared plans: plans/{CODE}, readable by any signed-in user who knows the code, writable only by its owner
    async getPlan(code) { const s = await F.getDoc(F.doc(db, "plans", code)); return s.exists() ? s.data() : null; },
    claimPlan(uid, code, data) {
      return F.runTransaction(db, async tx => {
        const ref = F.doc(db, "plans", code), s = await tx.get(ref);
        if (s.exists() && s.data().owner !== uid) { const e = new Error("taken"); e.code = "taken"; throw e; }
        tx.set(ref, { ...data, owner: uid });
      });
    },
    deletePlan(code) { return F.deleteDoc(F.doc(db, "plans", code)); },
    del(uid, id) { return F.deleteDoc(F.doc(col(uid), id)); },
    // friends groups: groups/{gid} (members, votes), groups/{gid}/bests/{uid} (each member's best sets),
    // groupCodes/{CODE} -> gid (so a code can be changed without moving the group)
    async groupByCode(code) {
      const c = await F.getDoc(F.doc(db, "groupCodes", code)); if (!c.exists()) return null;
      const gid = c.data().gid, g = await F.getDoc(F.doc(db, "groups", gid));
      return g.exists() ? { gid, data: g.data() } : null;
    },
    async getGroup(gid) { const g = await F.getDoc(F.doc(db, "groups", gid)); return g.exists() ? g.data() : null; },
    createGroup(gid, code, data) {
      return F.runTransaction(db, async tx => {
        const cref = F.doc(db, "groupCodes", code);
        if ((await tx.get(cref)).exists()) { const e = new Error("taken"); e.code = "taken"; throw e; }
        tx.set(F.doc(db, "groups", gid), data); tx.set(cref, { gid, by: data.leader });
      });
    },
    // read-modify-write in one transaction; fn gets the current data and returns the new data (or null: no change)
    mutateGroup(gid, fn) {
      return F.runTransaction(db, async tx => {
        const ref = F.doc(db, "groups", gid), s = await tx.get(ref);
        if (!s.exists()) { const e = new Error("gone"); e.code = "gone"; throw e; }
        const next = fn(JSON.parse(JSON.stringify(s.data()))); if (next) tx.set(ref, next); return next;
      });
    },
    changeGroupCode(gid, oldCode, newCode) {
      return F.runTransaction(db, async tx => {
        const nref = F.doc(db, "groupCodes", newCode), gref = F.doc(db, "groups", gid);
        if ((await tx.get(nref)).exists()) { const e = new Error("taken"); e.code = "taken"; throw e; }
        const g = await tx.get(gref);
        tx.set(nref, { gid, by: g.data().leader }); tx.update(gref, { code: newCode });
        if (oldCode) tx.delete(F.doc(db, "groupCodes", oldCode));
      });
    },
    async deleteGroup(gid, code) { if (code) await F.deleteDoc(F.doc(db, "groupCodes", code)).catch(() => {}); await F.deleteDoc(F.doc(db, "groups", gid)); },
    async getBests(gid) { const s = await F.getDocs(F.collection(db, "groups", gid, "bests")); const o = {}; s.docs.forEach(d => { o[d.id] = d.data(); }); return o; },
    setBests(gid, uid, data) { return F.setDoc(F.doc(db, "groups", gid, "bests", uid), data); },
    delBests(gid, uid) { return F.deleteDoc(F.doc(db, "groups", gid, "bests", uid)); },
    // AI coach: Gemini through Firebase AI Logic (no server needed). Loaded only when the chat is first used.
    async chatStream(history, text, system) {
      // App Check proves requests come from this app (loaded only when the coach is first used)
      if (!appCheckOn && appCheckKey && !/SITE_KEY/.test(appCheckKey)) {
        const AC = await import(base + "firebase-app-check.js");
        AC.initializeAppCheck(app, { provider: new AC.ReCaptchaEnterpriseProvider(appCheckKey), isTokenAutoRefreshEnabled: true });
        appCheckOn = true;
      }
      if (!AI) AI = await import(base + "firebase-ai.js");
      const ai = AI.getAI(app, { backend: new AI.GoogleAIBackend() });
      const model = AI.getGenerativeModel(ai, { model: CHAT_MODEL, systemInstruction: system,
        generationConfig: { maxOutputTokens: 700, temperature: 0.5 } });
      const chat = model.startChat({ history: history.map(m => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] })) });
      const res = await chat.sendMessageStream(text);
      return (async function* () { for await (const c of res.stream) { let t = ""; try { t = c.text(); } catch (e) {} if (t) yield t; } })();
    }
  };
}
export const CHAT_MODEL = "gemini-3.5-flash-lite";

// Test backend: same interface, stored in this browser only. Used with ?mock in the address.
export function mockBackend() {
  const key = "gymlog_mock";
  const load = () => { try { return JSON.parse(localStorage.getItem(key)) || { user: null, docs: {} }; } catch (e) { return { user: null, docs: {} }; } };
  let st = load(); const userCbs = [], dataCbs = [];
  const err = code => { const e = new Error(code); e.code = code; return e; };
  const check = (email, pw) => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err("auth/invalid-email");
    if (String(pw).length < 6) throw err("auth/weak-password");
    if ((st.accounts || {})[email]) throw err("auth/email-already-in-use");
  };
  const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {} dataCbs.forEach(f => f(JSON.parse(JSON.stringify(st.docs)), false)); };
  return {
    onUser(cb) { userCbs.push(cb); setTimeout(() => cb(st.user), 50); },
    async signIn() { st.user = { uid: "test", name: "Test User", email: "test@example.com", guest: false }; save(); userCbs.forEach(f => f(st.user)); },
    async signOut() { st.user = null; save(); userCbs.forEach(f => f(null)); },
    current() { return st.user; },
    async signInEmail(email, pw) { const a = (st.accounts || {})[email]; if (!a || a.pw !== pw) throw err("auth/invalid-credential"); st.user = { uid: a.uid, name: "", email, guest: false }; save(); userCbs.forEach(f => f(st.user)); },
    async createEmail(email, pw) { check(email, pw); st.accounts = st.accounts || {}; st.accounts[email] = { pw, uid: "e_" + email }; st.user = { uid: "e_" + email, name: "", email, guest: false }; save(); userCbs.forEach(f => f(st.user)); },
    async resetPassword(email) { if (!/@/.test(email)) throw err("auth/invalid-email"); st.lastReset = email; save(); },
    async signInGuest() { st.user = { uid: "guest", name: "", email: "", guest: true }; save(); userCbs.forEach(f => f(st.user)); },
    async linkEmail(email, pw) { check(email, pw); st.accounts = st.accounts || {}; st.accounts[email] = { pw, uid: st.user.uid }; st.user = { ...st.user, email, guest: false }; save(); return st.user; },
    async linkGoogle() { st.user = { ...st.user, email: "test@example.com", name: "Test User", guest: false }; save(); return st.user; },
    subscribe(uid, cb) { dataCbs.push(cb); setTimeout(() => cb(JSON.parse(JSON.stringify(st.docs)), false), 30); return () => {}; },
    async set(uid, id, data) { st.docs[id] = JSON.parse(JSON.stringify(data)); save(); },
    async del(uid, id) { delete st.docs[id]; save(); },
    // friends groups (shared between every test user, like plans)
    ...(() => {
      const G = () => JSON.parse(localStorage.getItem("gymlog_groups") || '{"groups":{},"codes":{},"bests":{}}');
      const W = g => localStorage.setItem("gymlog_groups", JSON.stringify(g));
      const taken = () => { const e = new Error("taken"); e.code = "taken"; return e; };
      return {
        async groupByCode(code) { const g = G(), gid = g.codes[code]; return gid && g.groups[gid] ? { gid, data: g.groups[gid] } : null; },
        async getGroup(gid) { return G().groups[gid] || null; },
        async createGroup(gid, code, data) { const g = G(); if (g.codes[code]) throw taken(); g.groups[gid] = data; g.codes[code] = gid; W(g); },
        async mutateGroup(gid, fn) { const g = G(); if (!g.groups[gid]) { const e = new Error("gone"); e.code = "gone"; throw e; } const n = fn(JSON.parse(JSON.stringify(g.groups[gid]))); if (n) { g.groups[gid] = n; W(g); } return n; },
        async changeGroupCode(gid, oldCode, newCode) { const g = G(); if (g.codes[newCode]) throw taken(); g.codes[newCode] = gid; delete g.codes[oldCode]; g.groups[gid].code = newCode; W(g); },
        async deleteGroup(gid, code) { const g = G(); delete g.groups[gid]; delete g.codes[code]; delete g.bests[gid]; W(g); },
        async getBests(gid) { return G().bests[gid] || {}; },
        async setBests(gid, uid, data) { const g = G(); (g.bests[gid] = g.bests[gid] || {})[uid] = data; W(g); },
        async delBests(gid, uid) { const g = G(); if (g.bests[gid]) delete g.bests[gid][uid]; W(g); }
      };
    })(),
    // shared plans live outside any one account (one list for every test user)
    async getPlan(code) { const all = JSON.parse(localStorage.getItem("gymlog_plans") || "{}"); return all[code] || null; },
    async claimPlan(uid, code, data) {
      const all = JSON.parse(localStorage.getItem("gymlog_plans") || "{}");
      if (all[code] && all[code].owner !== uid) { const e = new Error("taken"); e.code = "taken"; throw e; }
      all[code] = { ...data, owner: uid }; localStorage.setItem("gymlog_plans", JSON.stringify(all));
    },
    async deletePlan(code) { const all = JSON.parse(localStorage.getItem("gymlog_plans") || "{}"); delete all[code]; localStorage.setItem("gymlog_plans", JSON.stringify(all)); },
    // test coach: echoes a canned answer in chunks. "?fail=quota" / "?fail=setup" simulate errors.
    async chatStream(history, text) {
      const f = new URLSearchParams(location.search).get("fail");
      if (f === "quota") { const e = new Error("[429] Resource exhausted"); e.status = 429; throw e; }
      if (f === "setup") throw new Error("Firebase AI Logic API has not been used in project or it is disabled (403)");
      const ans = "Here's how to do **" + text.slice(0, 40) + "**:\n\n1. Set the seat at chest height.\n2. Keep your back on the pad.\n- Control the weight down.\n\n(turn " + (history.length / 2 + 1) + ")";
      return (async function* () { for (let i = 0; i < ans.length; i += 12) { await new Promise(r => setTimeout(r, 15)); yield ans.slice(i, i + 12); } })();
    }
  };
}
