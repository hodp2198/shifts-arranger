import {
  firebaseConfig,
  firestoreCollectionName,
  hasFirebaseConfig,
  isLocalEnvironment,
  EMULATOR_CONFIG,
  probeEmulator
} from "../firebase-config.js";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 10;
const MAX_PAYLOAD_LENGTH = 200000;
const MAX_CREATE_ATTEMPTS = 8;

let firestoreDb = null;
let isEmulatorConnected = false;

class IdCollisionError extends Error {
  constructor() {
    super("Generated Firestore id already exists.");
    this.name = "IdCollisionError";
  }
}

async function getDb() {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase לא מוגדר. יש להדביק את firebaseConfig בקובץ firebase-config.js.");
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
          console.info(`[ScheduleStore] Connected to local emulator at ${EMULATOR_CONFIG.firestore.host}:${EMULATOR_CONFIG.firestore.port}`);
        } catch (e) {}
      } else if (!emulatorActive) {
        if (typeof window !== "undefined") {
          window.__ISOLATED_DEV_MODE__ = true;
        }
      }
    }
  }
  return firestoreDb;
}

function assertValidPayload(payload) {
  if (typeof payload !== "string" || !payload.trim()) {
    throw new Error("אין נתוני סידור לשמירה.");
  }
  if (payload.length > MAX_PAYLOAD_LENGTH) {
    throw new Error("נתוני הסידור גדולים מדי לשיתוף.");
  }
}

function createDocumentId() {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) {
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return id;
}

function assertValidDocumentId(id) {
  if (!/^[A-Za-z0-9]{10}$/.test(id || "")) {
    throw new Error("מזהה הסידור בקישור אינו תקין.");
  }
}

export async function saveSchedulePayload(payload, uid = null) {
  assertValidPayload(payload);

  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  // FAIL-CLOSED SAFEGUARD:
  if (isLocal && (!emulatorActive || (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__))) {
    const id = createDocumentId();
    const storageKey = `isolated_dev_emp_${id}`;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(storageKey, JSON.stringify({
        payload,
        ownerUid: uid,
        createdAt: new Date().toISOString()
      }));
    }
    return { id, uid };
  }

  const db = await getDb();
  if (isLocal && !isEmulatorConnected) {
    throw new Error("FAIL-CLOSED: שמירת לוח עובדים לייצור חסומה מסביבת פיתוח מקומית ללא אימולטור.");
  }

  const { doc, runTransaction, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const id = createDocumentId();
    const scheduleRef = uid
      ? doc(db, "users", uid, "employeeSchedules", id)
      : doc(db, firestoreCollectionName, id);
    try {
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(scheduleRef);
        if (existing.exists()) {
          throw new IdCollisionError();
        }
        transaction.set(scheduleRef, {
          version: 1,
          createdAt: serverTimestamp(),
          ownerUid: uid || null,
          payload
        });
      });
      return { id, uid };
    } catch (error) {
      if (error instanceof IdCollisionError && attempt < MAX_CREATE_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("נכשלה יצירת מזהה ייחודי לסידור. אנא נסה שוב.");
}

export async function loadSchedulePayload(id, uid = null) {
  assertValidDocumentId(id);

  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  // FAIL-CLOSED SAFEGUARD:
  if (isLocal && (!emulatorActive || (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__))) {
    const storageKey = `isolated_dev_emp_${id}`;
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        try {
          return JSON.parse(raw).payload;
        } catch (e) {}
      }
    }
    throw new Error("לא נמצא סידור עבור הקישור הזה.");
  }

  const db = await getDb();
  const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");
  const scheduleRef = uid
    ? doc(db, "users", uid, "employeeSchedules", id)
    : doc(db, firestoreCollectionName, id);
  const snapshot = await getDoc(scheduleRef);

  if (!snapshot.exists()) {
    throw new Error("לא נמצא סידור עבור הקישור הזה.");
  }

  const data = snapshot.data();
  if (data?.version !== 1 || typeof data.payload !== "string" || !data.payload.trim()) {
    throw new Error("נתוני הסידור בקישור אינם תקינים.");
  }
  return data.payload;
}

export const readSchedulePayload = loadSchedulePayload;

