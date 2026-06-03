# Google Calendar OAuth setup

The employee calendar page creates events directly in the employee's primary Google Calendar.
This requires a Google Cloud OAuth client ID.

## 1. Enable Google Calendar API

1. Open Google Cloud Console.
2. Create or choose a project.
3. Enable **Google Calendar API**.

Official reference: https://developers.google.com/workspace/calendar/api/quickstart/js

## 2. Configure OAuth consent

1. Go to **Google Auth Platform**.
2. Configure the consent screen.
3. Add the required scope:

```text
https://www.googleapis.com/auth/calendar.events
```

This scope lets the app create and update calendar events.

For external users, publish or test the consent screen according to your Google Cloud project settings. If the app is in testing mode, add the users who should be allowed to authorize it.

## 3. Create OAuth client

1. Go to **Google Auth Platform > Clients**.
2. Create client.
3. Application type: **Web application**.
4. Add the site domain under **Authorized JavaScript origins**.

Examples:

```text
http://localhost:8000
https://hodp2198.github.io
```

Use the exact production origin where the app is hosted. Do not include a path such as `/shifts-arranger` in Authorized JavaScript origins.

Examples:

- If the page is opened from `https://hodp2198.github.io/shifts-arranger/employee-calendar.html`, add only `https://hodp2198.github.io`.
- If testing locally with `http://localhost:8000/employee-calendar.html`, add only `http://localhost:8000`.

## 4. Set the client ID

Edit:

```text
src/googleConfig.js
```

Replace the placeholder:

```js
const GOOGLE_CLIENT_ID = "GOOGLE_CLIENT_ID.apps.googleusercontent.com";
```

with the Web application client ID from Google Cloud, for example:

```js
const GOOGLE_CLIENT_ID = "1234567890-abc123.apps.googleusercontent.com";
```

Keep the required scope unchanged:

```text
https://www.googleapis.com/auth/calendar.events
```

## 5. Test

1. Generate a finalized schedule.
2. Create the employee calendar link.
3. Open the employee page.
4. Select an employee.
5. Click **התחבר עם Google**.
6. Approve calendar access with the Google account where the shifts should be created.
7. Click **הוסף ליומן Google**.

Expected result:

- Events are created in the user's primary Google Calendar.
- Existing events are updated using the stable key instead of duplicated.
- If every event already exists for the same finalized schedule, the page shows **המשמרות כבר נוספו ליומן.**
- If OAuth is not configured, the employee page disables **התחבר עם Google** and **הוסף ליומן Google** and shows an admin/developer setup message. This means the placeholder in `src/googleConfig.js` was not replaced or the updated file was not deployed.

## Notes

- Authorized JavaScript origins must include only the origin, not the path.
- The employee calendar page is separate from the admin scheduling page.
- Employees only see employee selection, shift preview, Google sign-in, and calendar export controls.
- The employee does not type a calendar email. Events are created in the primary calendar of the Google account that authorized access.
