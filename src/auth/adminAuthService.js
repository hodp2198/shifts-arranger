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

// רשימת אימיילים מורשים כמנהלי מערכת (ניתן להוסיף כתובות נוספות במידת הצורך)
export const ALLOWED_ADMIN_EMAILS = [
  "galp3er@gmail.com"
];

function getFirebaseAuth() {
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

export function isAuthorizedAdmin(email) {
  if (!ALLOWED_ADMIN_EMAILS || ALLOWED_ADMIN_EMAILS.length === 0) {
    // אם הרשימה ריקה זמנית, נאפשר כניסה ראשונית של המשתמש שיצר את הפרויקט
    return true;
  }
  return ALLOWED_ADMIN_EMAILS.map(e => e.toLowerCase().trim()).includes((email || "").toLowerCase().trim());
}

export function translateAuthError(error) {
  if (!error) return "אירעה שגיאה בלתי צפויה בהתחברות.";
  const code = error.code || "";

  switch (code) {
    case "auth/invalid-email":
      return "כתובת האימייל שהוזנה אינה תקינה.";
    case "auth/user-not-found":
      return "משתמש זה אינו קיים במערכת.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "אימייל או סיסמה שגויים. אנא נסה שוב.";
    case "auth/user-disabled":
      return "חשבון משתמש זה הושבת.";
    case "auth/too-many-requests":
      return "יותר מדי ניסיונות כושלים. אנא המתן מספר דקות ונסה שוב.";
    case "auth/network-request-failed":
      return "שגיאת תקשורת. אנא בדוק את חיבור האינטרנט שלך.";
    case "auth/operation-not-allowed":
      return "שיטת התחברות זו אינה מופעלת עדיין ב-Firebase Console.";
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
    const user = result.user;

    if (!isAuthorizedAdmin(user.email)) {
      await signOut(auth);
      const deniedErr = new Error(`גישה נדחתה: החשבון (${user.email}) אינו מורשה כמנהל מערכת.`);
      deniedErr.code = "auth/unauthorized-admin";
      throw deniedErr;
    }

    return user;
  } catch (error) {
    if (error.code === "auth/unauthorized-admin") {
      throw error;
    }
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
    const user = userCredential.user;

    if (!isAuthorizedAdmin(user.email)) {
      await signOut(auth);
      const deniedErr = new Error(`גישה נדחתה: החשבון (${user.email}) אינו מורשה כמנהל מערכת.`);
      deniedErr.code = "auth/unauthorized-admin";
      throw deniedErr;
    }

    return user;
  } catch (error) {
    if (error.code === "auth/unauthorized-admin") {
      throw error;
    }
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
  try {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, user => {
      if (user && !isAuthorizedAdmin(user.email)) {
        signOut(auth).then(() => callback(null));
        return;
      }
      callback(user);
    });
  } catch (error) {
    console.error("Auth initialization error:", error);
    callback(null);
    return () => {};
  }
}

export function getCurrentAdminUser() {
  if (!authInstance) return null;
  const user = authInstance.currentUser;
  return (user && isAuthorizedAdmin(user.email)) ? user : null;
}
