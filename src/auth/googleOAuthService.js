(function () {
  const AUTH_TIMEOUT_MS = 120000;
  const AUTH_ERROR = "לא ניתן להתחבר ליומן Google. אפשר לנסות שוב.";
  const PERMISSION_ERROR = "לא ניתנה הרשאה ליומן Google. אפשר להתחבר שוב ולאשר גישה.";
  let checkExportAllowed;
  let tokenClient = null;
  let pendingInit = null;
  let activeAttempt = 0;
  let cancelPendingAttempt = null;
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
    if (pendingInit) return pendingInit;
    pendingInit = (async () => {
      const { assertCalendarExportAllowed } = await import("../calendarIsolation.js");
      assertCalendarExportAllowed();
      if (!hasConfiguredClient()) {
        throw new Error("Google OAuth לא מוגדר. יש להגדיר Client ID בקובץ src/googleConfig.js.");
      }
      await waitForGoogleIdentity();
      checkExportAllowed = assertCalendarExportAllowed;
      if (!tokenClient) {
        tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: window.googleCalendarConfig.clientId,
          scope: window.googleCalendarConfig.scope,
          callback: () => {}
        });
      }
    })();
    try {
      return await pendingInit;
    } finally {
      pendingInit = null;
    }
  }

  async function signIn() {
    if (!checkExportAllowed || !tokenClient) {
      const { assertCalendarExportAllowed } = await import("../calendarIsolation.js");
      assertCalendarExportAllowed();
      throw new Error(AUTH_ERROR);
    }
    checkExportAllowed();

    const prompt = isAuthorized() ? "" : "consent";
    accessToken = "";
    expiresAt = 0;

    const attempt = ++activeAttempt;
    cancelPendingAttempt?.();

    return new Promise((resolve, reject) => {
      let finished = false;
      let timer;

      const finish = (message, response, lifetimeSeconds) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (cancelPendingAttempt === cancel) {
          cancelPendingAttempt = null;
        }
        if (attempt !== activeAttempt) {
          reject(new Error(AUTH_ERROR));
          return;
        }
        if (message) {
          reject(new Error(message));
        } else {
          accessToken = response.access_token;
          expiresAt = Date.now() + lifetimeSeconds * 1000;
          resolve({ accessToken, expiresAt });
        }
      };

      const cancel = () => {
        finish(AUTH_ERROR);
      };
      cancelPendingAttempt = cancel;

      timer = setTimeout(() => {
        finish("תם הזמן להתחברות ל-Google. אפשר לנסות שוב.");
      }, AUTH_TIMEOUT_MS);

      try {
        const scope = window.googleCalendarConfig.scope;
        tokenClient.callback = response => {
          if (attempt !== activeAttempt) return;
          const lifetimeSeconds = Number(response?.expires_in);
          const tokenReceived = Boolean(response?.access_token);
          const lifetimeValid = Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 0;
          const requiredScopeGranted = typeof response?.scope === "string" && response.scope.split(/\s+/).includes(scope);
          if (response?.error === "access_denied") {
            finish(PERMISSION_ERROR);
          } else if (response?.error || !tokenReceived || !lifetimeValid) {
            finish(AUTH_ERROR);
          } else if (!requiredScopeGranted) {
            finish(PERMISSION_ERROR);
          } else {
            finish("", response, lifetimeSeconds);
          }
        };
        tokenClient.requestAccessToken({ prompt });
      } catch {
        finish(AUTH_ERROR);
      }
    });
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
