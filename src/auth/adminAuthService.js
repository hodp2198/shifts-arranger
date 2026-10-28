import {
  firebaseConfig,
  hasFirebaseConfig,
  isLocalEnvironment,
  EMULATOR_CONFIG,
  probeEmulator
} from "../../firebase-config.js";

let authInstance = null;
let isAuthEmulatorConnected = false;
const localAuthListeners = new Set();

// רשימת אימיילים מורשים כמנהלי מערכת (ניתן להוסיף כתובות נוספות במידת הצורך)
export const ALLOWED_ADMIN_EMAILS = [
  "galp3er@gmail.com"
];

export const LOCAL_DEV_ADMIN_USER = {
  uid: "dev-local-admin",
  email: "dev-admin@shift-arranger.local",
  displayName: "מנהל פיתוח מקומי",
  isAnonymous: false,
  emailVerified: true
};

function getLocalStoredUser() {
  if (typeof localStorage === "undefined") return null;
  const isLogged = localStorage.getItem("isolated_dev_auth_logged_in");
  return isLogged === "true" ? LOCAL_DEV_ADMIN_USER : null;
}

function notifyLocalAuthListeners(user) {
  for (const listener of localAuthListeners) {
    try {
      listener(user);
    } catch (e) {
      console.error("[LocalAuth] Error in listener:", e);
    }
  }
}

export async function getFirebaseAuth() {
  if (!hasFirebaseConfig()) {
    throw new Error("הגדרות Firebase אינן תקינות או חסרות ב-firebase-config.js");
  }

  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  if (isLocal && !emulatorActive) {
    throw new Error("FAIL-CLOSED: התחברות לשרת הייצור חסומה מסביבת פיתוח מקומית ללא אימולטור.");
  }

  if (!authInstance) {
    const { initializeApp, getApps, getApp } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js");
    const {
      getAuth,
      connectAuthEmulator,
      setPersistence,
      browserLocalPersistence
    } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js");

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    authInstance = getAuth(app);

    if (isLocal && emulatorActive && !isAuthEmulatorConnected) {
      try {
        connectAuthEmulator(authInstance, EMULATOR_CONFIG.auth.url, { disableWarnings: true });
        isAuthEmulatorConnected = true;
        console.info(`[Auth] Connected to local emulator at ${EMULATOR_CONFIG.auth.url}`);
      } catch (e) {
        console.warn("[Auth] Emulator connection warning:", e);
      }
    }

    try {
      await setPersistence(authInstance, browserLocalPersistence);
    } catch (err) {
      console.warn("Could not set auth persistence:", err);
    }
  }

  return authInstance;
}

export function isAuthorizedAdmin(email) {
  // Allow all authenticated users; each user receives their own isolated workspace by UID
  return Boolean(email && email.trim());
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
  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  // FAIL-CLOSED SAFEGUARD for localhost:
  if (isLocal && (!emulatorActive || (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__))) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("isolated_dev_auth_logged_in", "true");
    }
    notifyLocalAuthListeners(LOCAL_DEV_ADMIN_USER);
    return LOCAL_DEV_ADMIN_USER;
  }

  const auth = await getFirebaseAuth();
  const { GoogleAuthProvider, signInWithPopup, signOut } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js");

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  if (!user || !user.email) {
    await signOut(auth);
    throw new Error("לא התקבלו פרטי משתמש תקינים מ-Google.");
  }

  if (!isAuthorizedAdmin(user.email)) {
    await signOut(auth);
    throw new Error(`המשתמש ${user.email} אינו מורשה לנהל סידורי משמרות.`);
  }

  return user;
}

export const loginLocalDev = loginWithGoogle;

export async function loginWithEmailPassword(email, password) {
  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  if (isLocal && (!emulatorActive || (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__))) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("isolated_dev_auth_logged_in", "true");
    }
    notifyLocalAuthListeners(LOCAL_DEV_ADMIN_USER);
    return LOCAL_DEV_ADMIN_USER;
  }

  const auth = await getFirebaseAuth();
  const { signInWithEmailAndPassword, signOut } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js");

  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  const user = result.user;

  if (!user || !user.email) {
    await signOut(auth);
    throw new Error("לא התקבלו פרטי משתמש תקינים.");
  }

  if (!isAuthorizedAdmin(user.email)) {
    await signOut(auth);
    throw new Error(`המשתמש ${user.email} אינו מורשה לנהל סידורי משמרות.`);
  }

  return user;
}

export async function logoutAdmin() {
  const isLocal = isLocalEnvironment();
  const emulatorActive = isLocal ? await probeEmulator() : false;

  if (isLocal && (!emulatorActive || (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__))) {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("isolated_dev_auth_logged_in");
    }
    notifyLocalAuthListeners(null);
    return;
  }

  const auth = await getFirebaseAuth();
  const { signOut } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js");
  await signOut(auth);
}

export function getCurrentAdminUser() {
  if (isLocalEnvironment()) {
    return getLocalStoredUser();
  }
  return authInstance?.currentUser || null;
}

export function onAdminAuthStateChanged(callback) {
  const isLocal = isLocalEnvironment();

  if (isLocal) {
    // Synchronously register listener immediately to prevent any race condition
    localAuthListeners.add(callback);

    // Asynchronously dispatch current local state
    const currentUser = getLocalStoredUser();
    setTimeout(() => {
      if (localAuthListeners.has(callback)) {
        callback(currentUser);
      }
    }, 0);

    // If emulator becomes active and not in forced isolated mode, connect emulator listener
    probeEmulator().then(async emulatorActive => {
      if (emulatorActive && typeof window !== "undefined" && !window.__ISOLATED_DEV_MODE__) {
        try {
          const auth = await getFirebaseAuth();
          const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js");
          onAuthStateChanged(auth, user => {
            if (user && user.email && isAuthorizedAdmin(user.email)) {
              callback(user);
            } else {
              callback(null);
            }
          });
        } catch (e) {
          console.warn("[Auth] Emulator auth listener notice:", e);
        }
      }
    }).catch(() => {});

    return () => {
      localAuthListeners.delete(callback);
    };
  }

  // Production path
  let unsubscribeFn = () => {};
  getFirebaseAuth().then(async auth => {
    const { onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js");
    unsubscribeFn = onAuthStateChanged(auth, user => {
      if (user && user.email && isAuthorizedAdmin(user.email)) {
        callback(user);
      } else {
        callback(null);
      }
    });
  }).catch(err => {
    console.error("[Auth] Error setting up auth state listener:", err);
    callback(null);
  });

  return () => unsubscribeFn();
}
