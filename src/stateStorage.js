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

  function clearLegacyStorage() {
    LEGACY_STORAGE_KEYS.forEach(key => localStorage.removeItem(key));
  }

  function readSavedData() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data?.schemaVersion !== STORAGE_SCHEMA_VERSION) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return data;
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  function writeSavedData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function removeSavedData() {
    localStorage.removeItem(STORAGE_KEY);
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
