import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, hasFirebaseConfig } from "../firebase-config.js";

let firestoreDb = null;
let debounceTimer = null;
let pendingSavePromiseResolve = null;
let saveQueue = Promise.resolve();

function enqueueSave(operation) {
  const result = saveQueue.catch(() => {}).then(operation);
  saveQueue = result;
  return result;
}

function getDb() {
  if (typeof window !== "undefined") {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    window.runtimeEnvironment.assertProductionAccess();
  }
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
  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) {
    const raw = localStorage.getItem(`isolated_dev_appData_${uid}`);
    return raw ? JSON.parse(raw) : null;
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

function executeSave(uid, data) {
  return enqueueSave(() => executeSaveDirect(uid, data));
}

async function executeSaveDirect(uid, data) {
  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) {
    localStorage.setItem(`isolated_dev_appData_${uid}`, JSON.stringify(data));
    return { success: true };
  }
  const db = getDb();
  const userDocRef = doc(db, "users", uid, "appData", "current");
  const payload = {
    ...data,
    updatedAt: serverTimestamp()
  };
  await setDoc(userDocRef, payload);
  return { success: true };
}

// The backup and replacement commit together; a failed commit leaves current intact.
export async function replaceDraftWithBackup(uid, previousDraft, nextDraft) {
  if (!uid || !previousDraft || !nextDraft) throw new Error("נדרשות טיוטות תקינות ומזהה מנהל.");
  cancelPendingSave();
  return enqueueSave(() => commitDraftReplacement(uid, previousDraft, nextDraft));
}

async function commitDraftReplacement(uid, previousDraft, nextDraft) {
  const id = `draft-${crypto.randomUUID()}`;
  const backup = {
    id, savedAt: new Date().toISOString(),
    startDate: previousDraft.schedulePeriod?.startDate || previousDraft.startDate || "",
    draftJson: JSON.stringify(previousDraft)
  };
  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) {
    const backupKey = `isolated_dev_draftBackup_${uid}_${id}`;
    // If saving current fails, the old current and its new backup are both retained.
    localStorage.setItem(backupKey, JSON.stringify(backup));
    localStorage.setItem(`isolated_dev_appData_${uid}`, JSON.stringify(nextDraft));
    return backup;
  }
  const db = getDb();
  const batch = writeBatch(db);
  batch.set(doc(db, "users", uid, "draftBackups", id), { ...backup, createdAt: serverTimestamp() });
  batch.set(doc(db, "users", uid, "appData", "current"), { ...nextDraft, updatedAt: serverTimestamp() });
  await batch.commit();
  return backup;
}

export async function loadDraftBackups(uid) {
  if (!uid) throw new Error("נדרש מזהה מנהל.");
  let backups;
  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) {
    const prefix = `isolated_dev_draftBackup_${uid}_`;
    backups = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key.startsWith(prefix)) backups.push(JSON.parse(localStorage.getItem(key)));
    }
  } else {
    const snapshots = await getDocs(collection(getDb(), "users", uid, "draftBackups"));
    backups = snapshots.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }));
  }
  return backups.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

