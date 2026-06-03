(function () {
  const GOOGLE_CLIENT_ID = "GOOGLE_CLIENT_ID.apps.googleusercontent.com";
  const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

  window.googleCalendarConfig = {
    // Replace GOOGLE_CLIENT_ID in Google Cloud setup. See GOOGLE_CALENDAR_SETUP.md.
    clientId: GOOGLE_CLIENT_ID,
    scope: GOOGLE_CALENDAR_SCOPE
  };
})();
