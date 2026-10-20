import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, hasFirebaseConfig } from "../firebase-config.js";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 10;
const EXPIRATION_DAYS = 14;

let firestoreDb = null;

function getDb() {
  if (typeof window !== "undefined") {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    window.runtimeEnvironment.assertProductionAccess();
  }
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase לא מוגדר. יש להדביק את firebaseConfig בקובץ firebase-config.js.");
  }
  if (!firestoreDb) {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    firestoreDb = getFirestore(app);
  }
  return firestoreDb;
}

/**
 * Generates a cryptographically secure 10-character URL-safe random ID
 * Example: UaLzs4Gei4
 */
export function createShortDocumentId() {
  const bytes = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const byte of bytes) {
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return id;
}

export function assertValidDocumentId(id) {
  if (!id || typeof id !== "string" || !/^[A-Za-z0-9]{8,24}$/.test(id)) {
    throw new Error("מזהה הסידור בקישור אינו תקין.");
  }
}

/**
 * Saves a minimal public schedule snapshot into /publicSchedules/{randomId}
 * with an explicit 14-day expiration timestamp.
 */
export async function saveSchedulePayload(schedule, uid) {
  if (!schedule || typeof schedule !== "object") {
    throw new Error("אין נתוני סידור תקינים לשמירה.");
  }
  if (!uid || typeof uid !== "string") {
    throw new Error("נדרש מזהה מנהל (UID) ליצירת קישור יומן ציבורי.");
  }

  if (typeof window !== "undefined" && window.runtimeEnvironment?.isTestMode) {
    const id = createShortDocumentId();
    localStorage.setItem(`isolated_dev_publicSchedule_${id}`, JSON.stringify({
      ownerUid: uid, expiresAt: Date.now() + EXPIRATION_DAYS * 86400000, schedule
    }));
    return { id };
  }

  const db = getDb();
  const id = createShortDocumentId();
  const scheduleRef = doc(db, "publicSchedules", id);

  // 14 days expiration timestamp
  const expirationDate = new Date(Date.now() + EXPIRATION_DAYS * 24 * 60 * 60 * 1000);
  const expiresAt = Timestamp.fromDate(expirationDate);

  const documentData = {
    version: 2,
    ownerUid: uid,
    createdAt: serverTimestamp(),
    expiresAt: expiresAt,
    schedule: {
      scheduleId: schedule.scheduleId || `schedule-${id}`,
      createdAt: schedule.createdAt || new Date().toISOString(),
      timezone: schedule.timezone || "Asia/Jerusalem",
      weeks: Array.isArray(schedule.weeks) ? schedule.weeks : [],
      employees: Array.isArray(schedule.employees) ? schedule.employees : [],
      entries: Array.isArray(schedule.entries) ? schedule.entries : []
    }
  };

  await setDoc(scheduleRef, documentData);
  return { id };
}

/**
 * Reads a public schedule from /publicSchedules/{id}
 * Unauthenticated employees can read if the link is not expired.
 */
export async function readSchedulePayload(id) {
  assertValidDocumentId(id);
  if (typeof window !== "undefined" && window.runtimeEnvironment?.isTestMode) {
    const raw = localStorage.getItem(`isolated_dev_publicSchedule_${id}`);
    const data = raw ? JSON.parse(raw) : null;
    if (!data?.schedule || data.expiresAt <= Date.now()) {
      throw new Error("TEST MODE: קישור הבדיקה אינו קיים בדפדפן זה או שפג תוקפו. אין פנייה לייצור.");
    }
    return data.schedule;
  }
  const db = getDb();
  const scheduleRef = doc(db, "publicSchedules", id);

  let snapshot;
  try {
    snapshot = await getDoc(scheduleRef);
  } catch (err) {
    const errMsg = err.message || "";
    if (errMsg.includes("permission-denied") || errMsg.includes("Missing or insufficient permissions")) {
      throw new Error("הקישור לסידור זה פג תוקף או אינו זמין עוד.");
    }
    throw err;
  }

  if (!snapshot.exists()) {
    throw new Error("לא נמצא סידור עבור הקישור הזה.");
  }

  const data = snapshot.data();
  if (!data || !data.schedule) {
    throw new Error("נתוני הסידור בקישור אינם תקינים.");
  }

  return data.schedule;
}
