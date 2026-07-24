import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, firestoreCollectionName, hasFirebaseConfig } from "../firebase-config.js";

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 10;
const MAX_PAYLOAD_LENGTH = 200000;
const MAX_CREATE_ATTEMPTS = 8;

let firestoreDb = null;

class IdCollisionError extends Error {
  constructor() {
    super("Generated Firestore id already exists.");
    this.name = "IdCollisionError";
  }
}

function getDb() {
  if (!hasFirebaseConfig()) {
    throw new Error("Firebase לא מוגדר. יש להדביק את firebaseConfig בקובץ firebase-config.js.");
  }
  if (!firestoreDb) {
    firestoreDb = getFirestore(initializeApp(firebaseConfig));
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

export async function saveSchedulePayload(payload) {
  assertValidPayload(payload);
  const db = getDb();

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const id = createDocumentId();
    const scheduleRef = doc(db, firestoreCollectionName, id);
    try {
      await runTransaction(db, async transaction => {
        const existing = await transaction.get(scheduleRef);
        if (existing.exists()) {
          throw new IdCollisionError();
        }
        transaction.set(scheduleRef, {
          version: 1,
          createdAt: serverTimestamp(),
          payload
        });
      });
      return { id };
    } catch (error) {
      if (error instanceof IdCollisionError) continue;
      throw error;
    }
  }

  throw new Error("לא ניתן היה ליצור מזהה ייחודי לסידור. נסו שוב.");
}

export async function readSchedulePayload(id) {
  assertValidDocumentId(id);
  const scheduleRef = doc(getDb(), firestoreCollectionName, id);
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
