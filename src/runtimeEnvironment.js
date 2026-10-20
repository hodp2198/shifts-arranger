/* Select the data environment once, before authentication or service startup. */
(function (root) {
  const isTestMode = new URLSearchParams(root.location.search).get("dev") === "true";
  const testUser = Object.freeze({ uid: "isolated-dev-manager", email: "dev-tester@shift-arranger.local", displayName: "TEST MODE — מנהל בדיקה" });
  const environment = Object.freeze({
    isTestMode, testUser,
    assertProductionAccess() {
      if (isTestMode) throw new Error("TEST MODE: גישה לשירותי ייצור חסומה בסביבת הבדיקות.");
    },
    storageKey(key) { return isTestMode ? `isolated_dev_${key}` : key; }
  });
  Object.defineProperty(root, "runtimeEnvironment", { value: environment, writable: false, configurable: false });
  // Existing local-storage adapters use this compatibility flag. It cannot be
  // toggled by logout, a remembered login, or a delayed write in this document.
  Object.defineProperty(root, "__ISOLATED_DEV_MODE__", { get: () => isTestMode, configurable: false });
  if (isTestMode && typeof document !== "undefined") {
    document.title = "TEST MODE — סידור משמרות";
    document.addEventListener("DOMContentLoaded", () => {
      document.title = "TEST MODE — סידור משמרות";
      const banner = document.getElementById("devIsolatedBanner");
      if (banner) banner.style.display = "flex";
      const subtitle = document.querySelector(".auth-subtitle");
      if (subtitle) subtitle.textContent = "TEST MODE — בדיקות מקומיות בלבד, ללא התחברות לייצור";
      for (const id of ["googleLoginBtn", "toggleRequestAccessBtn"]) {
        const button = document.getElementById(id);
        if (button) { button.disabled = true; button.style.display = "none"; }
      }
    });
  }
})(window);
