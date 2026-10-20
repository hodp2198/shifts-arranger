import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { firebaseConfig, hasFirebaseConfig } from "../firebase-config.js";

let firestoreDb = null;

// The Google Apps Script Web App URL
export const DEFAULT_GAS_BACKEND_URL = "https://script.google.com/macros/s/AKfycbxT1w9cSUVkRKNS7KeQEZJB9yUXXh3LWchwN5nrqwl4Z8fIeKcS4cUWX7sDX3l9bh0k/exec";

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

export function getGasBackendUrl() {
  return localStorage.getItem(backendStorageKey()) || (window.runtimeEnvironment.isTestMode ? "" : DEFAULT_GAS_BACKEND_URL);
}

function backendStorageKey() {
  if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
  return window.runtimeEnvironment.storageKey("gasBackendUrl");
}

export function setGasBackendUrl(url) {
  if (url && typeof url === "string") {
    localStorage.setItem(backendStorageKey(), url.trim());
  } else {
    localStorage.removeItem(backendStorageKey());
  }
}

/**
 * Computes a deterministic SHA-256 hash ID for the given email
 * Example: req_a1b2c3d4...
 */
export async function computeRequestId(email) {
  const normalized = (email || "").trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return `req_${hexHash}`;
}

/**
 * Validates the request fields locally before attempting submission
 */
export function validateAccessRequestInput(name, email) {
  const cleanName = (name || "").trim();
  const cleanEmail = (email || "").trim().toLowerCase();

  if (!cleanName || cleanName.length < 2) {
    return { valid: false, message: "יש להזין שם מלא (לפחות 2 תווים)." };
  }
  if (cleanName.length > 80) {
    return { valid: false, message: "השם שהוזן ארוך מדי (עד 80 תווים)." };
  }

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!cleanEmail || !emailRegex.test(cleanEmail)) {
    return { valid: false, message: "יש להזין כתובת אימייל תקינה של Google." };
  }
  if (cleanEmail.length > 100) {
    return { valid: false, message: "כתובת האימייל ארוכה מדי." };
  }

  return { valid: true, cleanName, cleanEmail };
}

/**
 * Submits a new access request to Firestore
 */
export async function submitAccessRequest(name, email) {
  if (typeof window !== "undefined") {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    window.runtimeEnvironment.assertProductionAccess();
  }
  const validation = validateAccessRequestInput(name, email);
  if (!validation.valid) {
    return { success: false, message: validation.message };
  }

  const { cleanName, cleanEmail } = validation;
  const requestId = await computeRequestId(cleanEmail);
  const db = getDb();
  const requestDocRef = doc(db, "accessRequests", requestId);

  const payload = {
    name: cleanName,
    email: cleanEmail,
    status: "pending",
    createdAt: serverTimestamp()
  };

  try {
    await setDoc(requestDocRef, payload);
  } catch (err) {
    // Document already exists in Firestore or unauthenticated client cannot overwrite.
    // Delegate server-side existence check & reopening to privileged GAS backend:
    const gasUrl = getGasBackendUrl();
    if (!gasUrl) {
      return {
        success: false,
        duplicate: true,
        message: "בקשת גישה כבר קיימת עבור כתובת זו."
      };
    }

    try {
      const resp = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "retryAccessRequest",
          requestId,
          name: cleanName
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (data.success) {
        return {
          success: true,
          message: data.message || "בקשת הגישה נשלחה לאישור."
        };
      }
      return {
        success: false,
        alreadyPending: data.alreadyPending || false,
        alreadyApproved: data.alreadyApproved || false,
        message: data.message || "בקשת גישה כבר קיימת עבור כתובת זו."
      };
    } catch (retryErr) {
      console.warn("GAS retryAccessRequest error:", retryErr);
      return {
        success: false,
        duplicate: true,
        message: "בקשת גישה כבר קיימת עבור כתובת זו."
      };
    }
  }

  // Trigger GAS notification webhook in the background
  const gasUrl = getGasBackendUrl();
  if (gasUrl) {
    fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "notify",
        requestId
      })
    }).catch(err => {
      console.warn("GAS notification webhook dispatch error:", err);
    });
  }

  return {
    success: true,
    message: "בקשת הגישה נשלחה לאישור."
  };
}

/**
 * Fetches all pending access requests for the Super Admin
 */
export async function fetchPendingAccessRequests() {
  if (typeof window !== "undefined") {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    window.runtimeEnvironment.assertProductionAccess();
  }
  const db = getDb();
  const colRef = collection(db, "accessRequests");
  const q = query(colRef, where("status", "==", "pending"));

  const snapshot = await getDocs(q);
  const requests = [];
  snapshot.forEach(docSnap => {
    requests.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  // Sort by createdAt descending
  requests.sort((a, b) => {
    const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return tB - tA;
  });

  return requests;
}

/**
 * Admin approves an access request via secure GAS backend
 */
export async function approveAccessRequest(requestDoc, adminUser) {
  if (typeof window !== "undefined") {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    window.runtimeEnvironment.assertProductionAccess();
  }
  if (!requestDoc || !requestDoc.id) {
    throw new Error("נתוני בקשה אינם תקינים.");
  }
  if (!adminUser) {
    throw new Error("משתמש מנהל אינו מחובר.");
  }

  const gasUrl = getGasBackendUrl();
  if (!gasUrl) {
    throw new Error("כתובת שרת Google Apps Script אינה מוגדרת.");
  }

  const idToken = await adminUser.getIdToken(true);
  const response = await fetch(gasUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action: "approve",
      requestId: requestDoc.id,
      idToken
    })
  });

  const respText = await response.text().catch(() => "{}");
  let respData = {};
  try {
    respData = JSON.parse(respText);
  } catch (e) {}

  if (!response.ok || respData.error) {
    throw new Error(respData.error || `שגיאה באישור מול השרת (${response.status})`);
  }

  return {
    success: true,
    message: respData.message || "המשתמש אושר ונוצר בהצלחה ב-Firebase Authentication."
  };
}

/**
 * Admin rejects an access request via secure GAS backend
 */
export async function rejectAccessRequest(requestDoc, adminUser, reason = "") {
  if (typeof window !== "undefined") {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    window.runtimeEnvironment.assertProductionAccess();
  }
  if (!requestDoc || !requestDoc.id) {
    throw new Error("נתוני בקשה אינם תקינים.");
  }
  if (!adminUser) {
    throw new Error("משתמש מנהל אינו מחובר.");
  }

  const gasUrl = getGasBackendUrl();
  if (!gasUrl) {
    throw new Error("כתובת שרת Google Apps Script אינה מוגדרת.");
  }

  const idToken = await adminUser.getIdToken(true);
  const response = await fetch(gasUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify({
      action: "reject",
      requestId: requestDoc.id,
      idToken,
      reason
    })
  });

  const respText = await response.text().catch(() => "{}");
  let respData = {};
  try {
    respData = JSON.parse(respText);
  } catch (e) {}

  if (!response.ok || respData.error) {
    throw new Error(respData.error || `שגיאה בדחיית הבקשה (${response.status})`);
  }

  return {
    success: true,
    message: respData.message || "הבקשה נדחתה בהצלחה."
  };
}
