(function () {
  let tokenClient = null;
  let accessToken = "";

  function hasConfiguredClient() {
    const clientId = window.googleCalendarConfig?.clientId || "";
    return Boolean(
      clientId &&
      !clientId.includes("GOOGLE_CLIENT_ID") &&
      !clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")
    );
  }

  function waitForGoogleIdentity() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
          return;
        }
        if (Date.now() - startedAt > 10000) {
          clearInterval(timer);
          reject(new Error("טעינת Google OAuth נכשלה. אפשר לנסות שוב."));
        }
      }, 100);
    });
  }

  async function initialize() {
    const { assertCalendarExportAllowed } = await import("../calendarIsolation.js");
    assertCalendarExportAllowed();
    if (!hasConfiguredClient()) {
      throw new Error("Google OAuth לא מוגדר. יש להגדיר Client ID בקובץ src/googleConfig.js.");
    }
    if (!document.querySelector('script[src="https://accounts.google.com/gsi/client"]')) {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      document.head.appendChild(script);
    }
    await waitForGoogleIdentity();
    if (tokenClient) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.googleCalendarConfig.clientId,
      scope: window.googleCalendarConfig.scope,
      callback: () => {}
    });
  }

  async function signIn() {
    await initialize();
    const { assertCalendarExportAllowed } = await import("../calendarIsolation.js");
    assertCalendarExportAllowed();
    return new Promise((resolve, reject) => {
      tokenClient.callback = response => {
        if (response?.error) {
          reject(new Error(response.error_description || response.error || "Google authorization failed."));
          return;
        }
        accessToken = response.access_token || "";
        if (!accessToken) {
          reject(new Error("Google authorization failed."));
          return;
        }
        resolve({ accessToken });
      };
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
  }

  function getAccessToken() {
    return accessToken;
  }

  function isAuthorized() {
    return Boolean(accessToken);
  }

  window.googleOAuthService = {
    hasConfiguredClient,
    initialize,
    signIn,
    getAccessToken,
    isAuthorized
  };
})();
