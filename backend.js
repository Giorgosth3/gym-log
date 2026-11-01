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
    del(uid, id) { return F.deleteDoc(F.doc(col(uid), id)); },
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
