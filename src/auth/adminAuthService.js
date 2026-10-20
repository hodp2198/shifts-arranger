import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { firebaseConfig, hasFirebaseConfig } from "../../firebase-config.js";

let authInstance = null;

export const UNAUTHORIZED_ERROR_MESSAGE = "החשבון הזה אינו מורשה להיכנס למערכת.";

export function isAuthorizedUser(user) {
  return Boolean(user && user.uid);
}

export function isAuthorizedAdmin(user) {
  return Boolean(user && (typeof user === "string" ? user.trim() : user.uid));
}

function getFirebaseAuth() {
  if (typeof window !== "undefined") {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    window.runtimeEnvironment.assertProductionAccess();
  }
  if (!hasFirebaseConfig()) {
    throw new Error("הגדרות Firebase אינן תקינות או חסרות ב-firebase-config.js");
  }
  if (!authInstance) {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    authInstance = getAuth(app);
    setPersistence(authInstance, browserLocalPersistence).catch(err => {
      console.warn("Could not set auth persistence:", err);
    });
  }
  return authInstance;
}

export function translateAuthError(error) {
  if (!error) return "אירעה שגיאה בלתי צפויה בהתחברות.";
  const code = error.code || "";
  const msg = error.message || "";

  if (
    code === "auth/admin-restricted-operation" ||
    code === "auth/user-not-found" ||
    code === "auth/unauthorized-account" ||
    code === "auth/operation-not-allowed" ||
    msg.includes("admin-restricted-operation") ||
    msg.includes("Sign up is disabled")
  ) {
    return UNAUTHORIZED_ERROR_MESSAGE;
  }

  switch (code) {
    case "auth/invalid-email":
      return "כתובת האימייל שהוזנה אינה תקינה.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "אימייל או סיסמה שגויים. אנא נסה שוב.";
    case "auth/user-disabled":
      return "חשבון משתמש זה הושבת על ידי מנהל המערכת.";
    case "auth/too-many-requests":
      return "יותר מדי ניסיונות כושלים. אנא המתן מספר דקות ונסה שוב.";
    case "auth/network-request-failed":
      return "שגיאת תקשורת. אנא בדוק את חיבור האינטרנט שלך.";
    case "auth/popup-closed-by-user":
      return "חלון ההתחברות של Google נסגר לפני השלמת התהליך.";
    case "auth/popup-blocked":
      return "הדפדפן חסם את החלון הקופץ. אנא אשר פתיחת חלונות קופצים ונסה שוב.";
    default:
      return error.message || "שגיאה בהתחברות למערכת.";
  }
}

export async function loginWithGoogle() {
  const auth = getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    const hebrewMsg = translateAuthError(error);
    const customErr = new Error(hebrewMsg);
    customErr.originalError = error;
    customErr.code = error.code;
    throw customErr;
  }
}

export async function loginAdmin(email, password) {
  if (!email || !email.trim()) {
    throw new Error("יש להזין כתובת אימייל.");
  }
  if (!password || !password.trim()) {
    throw new Error("יש להזין סיסמה.");
  }

  const auth = getFirebaseAuth();
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
    return userCredential.user;
  } catch (error) {
    const hebrewMsg = translateAuthError(error);
    const customErr = new Error(hebrewMsg);
    customErr.originalError = error;
    customErr.code = error.code;
    throw customErr;
  }
}

export async function logoutAdmin() {
  const auth = getFirebaseAuth();
  return await signOut(auth);
}

export function onAdminAuthStateChanged(callback) {
  if (typeof window !== "undefined" && window.runtimeEnvironment?.isTestMode) {
    callback(window.runtimeEnvironment.testUser);
    return () => {};
  }
  try {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, user => {
      callback(user || null);
    });
  } catch (error) {
    console.error("Auth initialization error:", error);
    callback(null);
    return () => {};
  }
}

export function getCurrentAdminUser() {
  if (!authInstance) return null;
  return authInstance.currentUser || null;
}
