(function () {
  const AUTH_TIMEOUT_MS = 120000;
  const AUTH_ERROR = "לא ניתן להתחבר ליומן Google. אפשר לנסות שוב.";
  const PERMISSION_ERROR = "לא ניתנה הרשאה ליומן Google. אפשר להתחבר שוב ולאשר גישה.";
  let checkExportAllowed;
  let pendingSignIn;
  let accessToken = "";
  let expiresAt = 0;

  function hasConfiguredClient() {
    const clientId = window.googleCalendarConfig?.clientId || "";
    return Boolean(
      clientId &&
      !clientId.includes("GOOGLE_CLIENT_ID") &&
      !clientId.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")
    );
  }

  function waitForGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const fail = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error("טעינת ההתחברות ל-Google נכשלה. אפשר לנסות שוב."));
      };
      const timer = setTimeout(fail, 10000);
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        if (!window.google?.accounts?.oauth2) {
          fail();
          return;
        }
        clearTimeout(timer);
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  async function initialize() {
    const { assertCalendarExportAllowed } = await import("../calendarIsolation.js");
    assertCalendarExportAllowed();
    if (!hasConfiguredClient()) {
      throw new Error("Google OAuth לא מוגדר. יש להגדיר Client ID בקובץ src/googleConfig.js.");
    }
    await waitForGoogleIdentity();
    checkExportAllowed = assertCalendarExportAllowed;
  }

  async function signIn() {
    if (!checkExportAllowed) {
      const { assertCalendarExportAllowed } = await import("../calendarIsolation.js");
      assertCalendarExportAllowed();
      throw new Error(AUTH_ERROR);
    }
    checkExportAllowed();
    if (pendingSignIn) return pendingSignIn;

    const prompt = isAuthorized() ? "" : "consent";
    accessToken = "";
    pendingSignIn = new Promise((resolve, reject) => {
      let finished = false;
      const finish = (message, response, lifetimeSeconds) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (message) {
          reject(new Error(message));
        } else {
          accessToken = response.access_token;
          expiresAt = Date.now() + lifetimeSeconds * 1000;
          resolve({ accessToken, expiresAt });
        }
      };
      const timer = setTimeout(() => finish("תם הזמן להתחברות ל-Google. אפשר לנסות שוב."), AUTH_TIMEOUT_MS);

      try {
        // Each attempt owns its callbacks so a late response cannot affect a retry.
        const scope = window.googleCalendarConfig.scope;
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: window.googleCalendarConfig.clientId,
          scope,
          callback: response => {
            const lifetimeSeconds = Number(response?.expires_in);
            if (response?.error === "access_denied") {
              finish(PERMISSION_ERROR);
            } else if (response?.error || !response?.access_token || !Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) {
              finish(AUTH_ERROR);
            } else if (typeof response.scope !== "string" || !response.scope.split(/\s+/).includes(scope)) {
              finish(PERMISSION_ERROR);
            } else {
              finish("", response, lifetimeSeconds);
            }
          },
          error_callback: error => {
            if (error?.type === "popup_closed") {
              finish("חלון ההתחברות נסגר לפני קבלת ההרשאה. אפשר לנסות שוב.");
            } else if (error?.type === "popup_failed_to_open") {
              finish("לא ניתן לפתוח את חלון ההתחברות. יש לאפשר חלונות קופצים ולנסות שוב.");
            } else {
              finish(AUTH_ERROR);
            }
          }
        });
        tokenClient.requestAccessToken({ prompt });
      } catch {
        finish(AUTH_ERROR);
      }
    });
    try {
      return await pendingSignIn;
    } finally {
      pendingSignIn = null;
    }
  }

  function getAccessToken() {
    return Date.now() < expiresAt ? accessToken : "";
  }

  function isAuthorized() {
    return Boolean(getAccessToken());
  }

  window.googleOAuthService = {
    hasConfiguredClient,
    initialize,
    signIn,
    getAccessToken,
    isAuthorized
  };
})();
