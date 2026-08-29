import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, hasFirebaseConfig } from "../firebase-config.js";

let firestoreDb = null;
let debounceTimer = null;
let pendingSavePromiseResolve = null;

function getDb() {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase אינו מוגדר בקובץ firebase-config.js.");
  }
  if (!firestoreDb) {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    firestoreDb = getFirestore(app);
  }
  return firestoreDb;
}

export async function loadUserAppData(uid) {
  if (!uid || typeof uid !== "string") {
    throw new Error("מזהה משתמש (UID) אינו תקין.");
  }
  const db = getDb();
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
        console.error("Auto-save to Firestore failed:", err);
        reject(err);
      }
    }, debounceMs);
  });
}

async function executeSave(uid, data) {
  const db = getDb();
  const userDocRef = doc(db, "users", uid, "appData", "current");
  const payload = {
    ...data,
    updatedAt: serverTimestamp()
  };
  await setDoc(userDocRef, payload);
  return { success: true };
}

