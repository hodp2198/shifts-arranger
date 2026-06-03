(function () {
  let tokenClient = null;
  let accessToken = "";

  function hasConfiguredClient() {
    const clientId = window.googleCalendarConfig?.clientId || "";
    return Boolean(clientId && !clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID"));
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
    if (!hasConfiguredClient()) {
      throw new Error("Google OAuth לא מוגדר. יש להגדיר Client ID בקובץ src/googleConfig.js.");
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
