import {
  firebaseConfig,
  hasFirebaseConfig,
  isLocalEnvironment,
  EMULATOR_CONFIG,
  probeEmulator
} from "../firebase-config.js";

let firestoreDb = null;
let isEmulatorConnected = false;
let debounceTimer = null;
let pendingSavePromiseResolve = null;

async function getDb() {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase אינו מוגדר בקובץ firebase-config.js.");
  }
  if (!firestoreDb) {
    const { getApps, initializeApp, getApp } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js");
    const { getFirestore, connectFirestoreEmulator } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    firestoreDb = getFirestore(app);

    if (isLocalEnvironment()) {
      const emulatorActive = await probeEmulator();
      if (emulatorActive && !isEmulatorConnected) {
        try {
          connectFirestoreEmulator(firestoreDb, EMULATOR_CONFIG.firestore.host, EMULATOR_CONFIG.firestore.port);
          isEmulatorConnected = true;
          console.info(`[UserData] Connected to local emulator at ${EMULATOR_CONFIG.firestore.host}:${EMULATOR_CONFIG.firestore.port}`);
        } catch (e) {
          console.warn("[UserData] Emulator connection warning:", e);
        }
      } else if (!emulatorActive) {
        if (typeof window !== "undefined") {
          window.__ISOLATED_DEV_MODE__ = true;
        }
      }
    }
  }
  return firestoreDb;
}

export async function loadUserAppData(uid) {
  if (!uid || typeof uid !== "string") {
    throw new Error("מזהה משתמש (UID) אינו תקין.");
  }

  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  // FAIL-CLOSED SAFEGUARD:
  if (isLocal && (!emulatorActive || (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__))) {
    const storageKey = `isolated_dev_appData_${uid}`;
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try {
          return JSON.parse(raw);
        } catch (e) {}
      }
    }
    return null;
  }

  const db = await getDb();
  const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");
  const userDocRef = doc(db, "users", uid, "appData", "current");
  const snapshot = await getDoc(userDocRef);
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data();
}

export function cancelPendingSave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingSavePromiseResolve = null;
}

export async function saveUserAppData(uid, data, options = {}) {
  if (!uid || typeof uid !== "string") {
    return;
  }
  const immediate = Boolean(options.immediate);
  const debounceMs = options.debounceMs ?? 600;

  if (immediate) {
    cancelPendingSave();
    return executeSave(uid, data);
  }

  cancelPendingSave();
  return new Promise((resolve, reject) => {
    pendingSavePromiseResolve = resolve;
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      try {
        const res = await executeSave(uid, data);
        if (pendingSavePromiseResolve) {
          pendingSavePromiseResolve(res);
          pendingSavePromiseResolve = null;
        }
      } catch (err) {
        console.error("Auto-save failed:", err);
        reject(err);
      }
    }, debounceMs);
  });
}

async function executeSave(uid, data) {
  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  // FAIL-CLOSED SAFEGUARD:
  if (isLocal && (!emulatorActive || (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__))) {
    const storageKey = `isolated_dev_appData_${uid}`;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(storageKey, JSON.stringify({
        ...data,
        updatedAt: new Date().toISOString()
      }));
    }
    return { success: true, isolated: true };
  }

  const db = await getDb();

  if (isLocal && !isEmulatorConnected) {
    throw new Error("FAIL-CLOSED: שמירה לשרת הייצור חסומה מסביבת פיתוח מקומית ללא אימולטור.");
  }
  const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");
  const userDocRef = doc(db, "users", uid, "appData", "current");
  const payload = {
    ...data,
    updatedAt: serverTimestamp()
  };
  await setDoc(userDocRef, payload);
  return { success: true };
}
