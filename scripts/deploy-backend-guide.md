# מדריך הגדרת Google Apps Script Backend (חינמי לחלוטין)

מדריך זה מסביר כיצד להגדיר את שירות ההתראות והאישורים החינמי ב-Google Apps Script (ללא תשלום, ללא כרטיס אשראי).

---

## שלב 1: יצירת פרויקט Google Apps Script

1. היכנס עם חשבון ה-Google שלך (`galp3er@gmail.com`) לכתובת:
   [https://script.google.com/home/start](https://script.google.com/home/start)
2. לחץ על **"New project"** (פרויקט חדש) בפינה העליונה.
3. שנה את שם הפרויקט ל-`Shift Arranger Backend`.

---

## שלב 2: הדבקת הקוד

1. מחק את כל הקוד הקיים בקובץ `Code.gs`.
2. פתח את הקובץ המקומי [scripts/google-apps-script-backend.js](file:///c:/Projects/Shift%20Arranger%20DEV/scripts/google-apps-script-backend.js).
3. העתק את כל תוכנו והדבק בתוך `Code.gs`.
4. לחץ על סמל השמירה (Ctrl + S או 💾).

---

## שלב 3: פריסת השירות כ-Web App

1. לחץ על כפתור **"Deploy"** (פריסה) הכחול בפינה העליונה ובחר **"New deployment"**.
2. לחץ על גלגל השיניים ⚙️ ליד "Select type" ובחר **"Web app"**.
3. הגדר את השדות:
   - **Description**: `Shift Arranger Production Webhook`
   - **Execute as**: `Me (galp3er@gmail.com)`
   - **Who has access**: `Anyone` *(כדי שדפדפן המבקש יוכל לשלוח בקשת התראה)*
4. לחץ **"Deploy"**.
5. אשר הרשאות גישה של חשבון Google שלך (MailApp, UrlFetchApp).
6. **העתק את ה-Web App URL** שנוצר (מבנה הקישור: `https://script.google.com/macros/s/.../exec`).

---

## שלב 4: הגדרת הקישור בסידור המשמרות

בממשק סידור המשמרות, כאשר אתה מחובר כ-`galp3er@gmail.com`:
- פתח את לשונית **"בקשות גישה"**.
- הדבק את ה-Web App URL בשדה ההגדרות ושמור.

---

## כיצד עובד המנגנון?

1. **בקשת גישה חדשה**: נשמרת ב-Firestore. נשלחת קריאת התראה ל-GAS -> נשלח אימייל יידוע ל-`galp3er@gmail.com`.
2. **אישור בקשה במערכת**:
   - אתה נכנס לסידור המשמרות ולוחץ על כפתור **"בקשות גישה"**.
   - לחיצה על **"אשר"** שולחת את ה-Firebase ID Token המאומת שלך ל-GAS.
   - GAS מוודא את זהותך מול Google, יוצר את המשתמש ב-Firebase Authentication ומעדכן את הסטטוס ב-Firestore.
   - המשתמש החדש יכול כעת להיכנס מיידית עם כפתור "התחבר עם Google"!
