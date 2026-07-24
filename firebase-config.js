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
