(function () {
  const AUTH_TIMEOUT_MS = 120000;
  const POPUP_CLOSE_GRACE_MS = 1000;
  const AUTH_ERROR = "לא ניתן להתחבר ליומן Google. אפשר לנסות שוב.";
  const PERMISSION_ERROR = "לא ניתנה הרשאה ליומן Google. אפשר להתחבר שוב ולאשר גישה.";
  const OAUTH_ERROR_CATEGORIES = new Set([
    "access_denied", "invalid_request", "invalid_client", "invalid_scope",
    "unauthorized_client", "interaction_required", "login_required",
    "consent_required", "server_error", "temporarily_unavailable"
  ]);
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

  async function signIn(onDiagnostic) {
    if (!checkExportAllowed) {
      const { assertCalendarExportAllowed } = await import("../calendarIsolation.js");
      assertCalendarExportAllowed();
      throw new Error(AUTH_ERROR);
    }
    checkExportAllowed();
    if (pendingSignIn) return pendingSignIn;

    const report = (event, details) => {
      try {
        onDiagnostic?.(event, details);
      } catch {
        // Diagnostics must never change the outcome of authorization.
      }
    };
    const prompt = isAuthorized() ? "" : "consent";
    accessToken = "";
    pendingSignIn = new Promise((resolve, reject) => {
      let finished = false;
      let popupCloseTimer;
      const finish = (message, response, lifetimeSeconds) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearTimeout(popupCloseTimer);
        if (message) {
          report("authorization_rejected");
          reject(new Error(message));
        } else {
          accessToken = response.access_token;
          expiresAt = Date.now() + lifetimeSeconds * 1000;
          report("token_accepted");
          resolve({ accessToken, expiresAt });
        }
      };
      const timer = setTimeout(() => {
        report("timeout");
        finish("תם הזמן להתחברות ל-Google. אפשר לנסות שוב.");
      }, AUTH_TIMEOUT_MS);

      try {
        // Each attempt owns its callbacks so a late response cannot affect a retry.
        const scope = window.googleCalendarConfig.scope;
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: window.googleCalendarConfig.clientId,
          scope,
          callback: response => {
            const lifetimeSeconds = Number(response?.expires_in);
            const tokenReceived = Boolean(response?.access_token);
            const lifetimeValid = Number.isFinite(lifetimeSeconds) && lifetimeSeconds > 0;
            const requiredScopeGranted = typeof response?.scope === "string" && response.scope.split(/\s+/).includes(scope);
            if (onDiagnostic) {
              const error = response?.error;
              report("token_callback", {
                tokenReceived,
                requiredScopeGranted,
                lifetimeValid,
                oauthError: OAUTH_ERROR_CATEGORIES.has(error) ? error : error ? "other" : "none",
                attemptFinished: finished
              });
            }
            if (response?.error === "access_denied") {
              finish(PERMISSION_ERROR);
            } else if (response?.error || !tokenReceived || !lifetimeValid) {
              finish(AUTH_ERROR);
            } else if (!requiredScopeGranted) {
              finish(PERMISSION_ERROR);
            } else {
              finish("", response, lifetimeSeconds);
            }
          },
          error_callback: error => {
            const type = error?.type;
            report(type === "popup_closed" || type === "popup_failed_to_open" ? type : "popup_error_unknown", {
              attemptFinished: finished
            });
            if (finished) return;
            if (type === "popup_closed") {
              // The token callback can arrive just after the popup closes.
              popupCloseTimer ??= setTimeout(() => {
                report("popup_close_grace_elapsed");
                finish("חלון ההתחברות נסגר לפני קבלת ההרשאה. אפשר לנסות שוב.");
              }, POPUP_CLOSE_GRACE_MS);
            } else if (type === "popup_failed_to_open") {
              finish("לא ניתן לפתוח את חלון ההתחברות. יש לאפשר חלונות קופצים ולנסות שוב.");
            } else {
              finish(AUTH_ERROR);
            }
          }
        });
        report("popup_requested");
        tokenClient.requestAccessToken({ prompt });
      } catch {
        report("oauth_client_exception");
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
