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
  let AI = null, appCheckOn = false;
  return {
    onUser(cb) {
      return A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, name: u.displayName || "", email: u.email || "" } : null));
    },
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
  const save = () => { try { localStorage.setItem(key, JSON.stringify(st)); } catch (e) {} dataCbs.forEach(f => f(JSON.parse(JSON.stringify(st.docs)), false)); };
  return {
    onUser(cb) { userCbs.push(cb); setTimeout(() => cb(st.user), 50); },
    async signIn() { st.user = { uid: "test", name: "Test User", email: "test@example.com" }; save(); userCbs.forEach(f => f(st.user)); },
    async signOut() { st.user = null; save(); userCbs.forEach(f => f(null)); },
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
