(function () {
  const STORAGE_SCHEMA_VERSION = 4;
  const STORAGE_KEY = "shifts-arranger-v4";
  const LEGACY_STORAGE_KEYS = [
    "shifts-arranger-v1",
    "shifts-arranger-v2",
    "shifts-arranger-v3",
    "shifts-arranger-worker-settings-v1",
    "shifts-arranger-deleted-workers-v1",
    "cleared-default-start-date-v1"
  ];

  function storageKey(key) {
    if (!window.runtimeEnvironment) throw new Error("Data environment is not initialized.");
    return window.runtimeEnvironment.storageKey(key);
  }

  function clearLegacyStorage() {
    LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(storageKey(key)));
  }

  function readSavedData() {
    const raw = localStorage.getItem(storageKey(STORAGE_KEY));
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data?.schemaVersion !== STORAGE_SCHEMA_VERSION) {
        localStorage.removeItem(storageKey(STORAGE_KEY));
        return null;
      }
      return data;
    } catch (error) {
      localStorage.removeItem(storageKey(STORAGE_KEY));
      return null;
    }
  }

  function writeSavedData(data) {
    localStorage.setItem(storageKey(STORAGE_KEY), JSON.stringify(data));
  }

  function removeSavedData() {
    localStorage.removeItem(storageKey(STORAGE_KEY));
  }

  window.stateStorage = {
    STORAGE_SCHEMA_VERSION,
    STORAGE_KEY,
    clearLegacyStorage,
    readSavedData,
    writeSavedData,
    removeSavedData
  };
})();
