export const firebaseConfig = {
  apiKey: "AIzaSyBBJ45dmmkun7UH-YJuyQIGs2jl77Bymis",
  authDomain: "shift-arranger.firebaseapp.com",
  projectId: "shift-arranger",
  storageBucket: "shift-arranger.firebasestorage.app",
  messagingSenderId: "607788361402",
  appId: "1:607788361402:web:f7c681741fe4ba1cbf8483",
  measurementId: "G-12JYH21KZ2"
};

export const firestoreCollectionName = "employeeSchedules";

export const EMULATOR_CONFIG = {
  firestore: {
    host: "127.0.0.1",
    port: 8080
  },
  auth: {
    host: "127.0.0.1",
    port: 9099,
    url: "http://127.0.0.1:9099"
  }
};

/**
 * Determines whether the current runtime is a local development environment.
 * Any run on localhost, 127.0.0.1, [::1], local dev servers, file:// scheme, or automated test runners
 * is classified as local to activate isolation safeguards.
 */
export function isLocalEnvironment() {
  if (typeof window === "undefined") {
    return true; // Node.js / automated test runners
  }
  const hostname = window.location.hostname || "";
  const protocol = window.location.protocol || "";
  if (protocol === "file:" || hostname === "") {
    return true;
  }
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (window.location.port !== "" && !hostname.endsWith("web.app") && !hostname.endsWith("firebaseapp.com"))
  );
}

/**
 * Checks if the runtime is currently operating in isolated dev mode
 * (local environment without active emulators).
 */
export function isIsolatedDevMode() {
  if (!isLocalEnvironment()) return false;
  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) return true;
  return cachedProbe === false;
}

/**
 * Checks if the local Firebase Emulator is active and responding.
 */
let cachedProbe = null;
export async function probeEmulator(timeoutMs = 500) {
  if (cachedProbe !== null) return cachedProbe;
  if (!isLocalEnvironment() || typeof fetch === "undefined") {
    cachedProbe = false;
    return false;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    await fetch(`http://${EMULATOR_CONFIG.firestore.host}:${EMULATOR_CONFIG.firestore.port}`, {
      signal: controller.signal,
      mode: "no-cors"
    });
    clearTimeout(timer);
    cachedProbe = true;
    return true;
  } catch (e) {
    cachedProbe = false;
    return false;
  }
}

export function resetEmulatorProbe() {
  cachedProbe = null;
}

export function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId &&
    !firebaseConfig.apiKey.startsWith("PASTE_") &&
    !firebaseConfig.authDomain.startsWith("PASTE_") &&
    !firebaseConfig.projectId.startsWith("PASTE_") &&
    !firebaseConfig.appId.startsWith("PASTE_")
  );
}
