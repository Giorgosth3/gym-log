// Storage + sign-in. Real backend: Firebase (Google sign-in + Firestore, offline cache).
// Each person's data lives at users/{uid}/log/{docId}; Firestore rules restrict it to that person.
const V = "10.12.2";
const base = `https://www.gstatic.com/firebasejs/${V}/`;

export async function firebaseBackend(config) {
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
    del(uid, id) { return F.deleteDoc(F.doc(col(uid), id)); }
  };
}

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
    async del(uid, id) { delete st.docs[id]; save(); }
  };
}
