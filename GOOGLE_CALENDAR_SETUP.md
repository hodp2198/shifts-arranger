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

## 4. Set the client ID

Edit:

```text
src/googleConfig.js
```

Replace:

```js
clientId: "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
```

with the client ID from Google Cloud.

## 5. Test

1. Generate a finalized schedule.
2. Create the employee calendar link.
3. Open the employee page.
4. Select an employee.
5. Click **התחבר עם Google**.
6. Approve calendar access.
7. Click **הוסף ליומן Google**.

Expected result:

- Events are created in the user's primary Google Calendar.
- Existing events are updated using the stable key instead of duplicated.
- If OAuth is not configured or fails, employees can still use **הורד קובץ יומן** as a fallback.
