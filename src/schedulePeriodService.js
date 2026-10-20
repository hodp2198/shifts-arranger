/* Date-only period rules. UTC arithmetic avoids dependence on the device's DST. */
(function (root) {
  const TIMEZONE = "Asia/Jerusalem";

  function parseDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1000 || year > 9998) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day ? date : null;
  }

  function addDays(value, count) {
    const date = parseDate(value);
    if (!date || !Number.isInteger(count)) throw new Error("תאריך לא תקין.");
    date.setUTCDate(date.getUTCDate() + count);
    const result = date.toISOString().slice(0, 10);
    if (!parseDate(result)) throw new Error("התאריך מחוץ לטווח הנתמך.");
    return result;
  }

  function today(now = new Date()) {
    const instant = new Date(now);
    if (!Number.isFinite(instant.getTime())) throw new Error("שעון לא תקין.");
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(instant);
    const get = type => parts.find(part => part.type === type).value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function createPeriod({ startDate, weekCount, weekStartsOn = 0, source = "manual", explanation = "" }) {
    const count = typeof weekCount === "string" && /^[1-8]$/.test(weekCount)
      ? Number(weekCount) : weekCount;
    const date = parseDate(startDate);
    if (!date) throw new Error("יש לבחור תאריך התחלה חוקי.");
    if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
      throw new Error("יום פתיחת השבוע אינו תקין.");
    }
    if (date.getUTCDay() !== weekStartsOn) throw new Error(weekStartsOn === 0
      ? "תאריך ההתחלה חייב להיות ביום ראשון." : "תאריך ההתחלה חייב להתאים ליום פתיחת השבוע.");
    if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("יש לבחור 1–8 שבועות שלמים.");
    addDays(startDate, count * 7 - 1);
    return { version: 1, startDate, weekCount: count, weekStartsOn, timezone: TIMEZONE, source, explanation };
  }

  function getWeeks(period) {
    const valid = createPeriod(period || {});
    return Array.from({ length: valid.weekCount }, (_, index) => {
      const start = addDays(valid.startDate, index * 7);
      return { start, end: addDays(start, 6) };
    });
  }

  function activeHistory(historyStatus, officialSchedules) {
    if (historyStatus !== "ready") throw new Error("היסטוריית הסידורים טרם נטענה בהצלחה. יש לנסות לטעון שוב.");
    if (!Array.isArray(officialSchedules)) throw new Error("היסטוריית הסידורים אינה תקינה.");
    if (officialSchedules.some(record => !record || typeof record !== "object")) {
      throw new Error("היסטוריית הסידורים אינה תקינה.");
    }
    const active = officialSchedules.filter(record => record.status !== "archived");
    for (const record of active) {
      if (!parseDate(record.startDate) || !parseDate(record.endDate) || record.startDate > record.endDate) {
        throw new Error("נמצא סידור רשמי עם טווח תאריכים לא תקין. נדרשת בדיקה לפני קביעת התקופה.");
      }
    }
    return active;
  }

  function findOverlaps(period, officialSchedules) {
    const weeks = getWeeks(period);
    const end = weeks[weeks.length - 1].end;
    return activeHistory("ready", officialSchedules).filter(record =>
      record.startDate <= end && record.endDate >= period.startDate);
  }

  function validate(period, { now = new Date(), historyStatus, officialSchedules, allowOverlap = false } = {}) {
    try {
      const valid = createPeriod(period || {});
      activeHistory(historyStatus, officialSchedules);
      if (valid.startDate <= today(now)) throw new Error("יש לבחור יום ראשון עתידי, אחרי היום לפי שעון ישראל.");
      const overlaps = findOverlaps(valid, officialSchedules);
      if (overlaps.length && !allowOverlap) throw new Error("התקופה חופפת לסידור רשמי. יש להשתמש בתהליך ההחלפה המפורש בעת השמירה.");
      return { valid: true, period: valid, overlaps };
    } catch (error) {
      return { valid: false, error: error.message, overlaps: [] };
    }
  }

  function propose({ now = new Date(), historyStatus, officialSchedules, weekCount = 2, weekStartsOn = 0 }) {
    const records = activeHistory(historyStatus, officialSchedules);
    const currentDate = today(now);
    const latest = records.reduce((best, record) => !best || record.endDate > best.endDate ? record : best, null);
    const boundary = latest && latest.endDate > currentDate ? latest.endDate : currentDate;
    let startDate = addDays(boundary, 1);
    // Strictly after the boundary, including when today or the previous end is Sunday.
    for (let offset = 0; offset < 7; offset++) {
      if (parseDate(startDate).getUTCDay() === weekStartsOn) {
        return createPeriod({ startDate, weekCount, weekStartsOn, source: "automatic",
          explanation: latest
            ? `יום ראשון העתידי הראשון אחרי היום (${currentDate}) ואחרי סוף הכיסוי הרשמי האחרון (${latest.endDate}).`
            : `אין סידורים רשמיים קודמים. נבחר יום ראשון הבא אחרי היום (${currentDate}).` });
      }
      startDate = addDays(startDate, 1);
    }
    throw new Error("יום פתיחת השבוע אינו תקין.");
  }

  function validateScheduleDates(period, schedule) {
    try {
      const weeks = getWeeks(period);
      if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) throw new Error();
      const seen = new Set();
      for (const [key, entries] of Object.entries(schedule)) {
        if (!/^(0|[1-9]\d*)$/.test(key) || !weeks[Number(key)] || !Array.isArray(entries)) throw new Error();
        const week = weeks[Number(key)];
        for (const entry of entries) {
          const day = entry?.day;
          const date = parseDate(day?.iso);
          if (!date || day.iso < week.start || day.iso > week.end || day.week !== Number(key)
            || day.dayIndex !== date.getUTCDay() || seen.has(day.iso)) throw new Error();
          if (!(day.date instanceof Date) || !Number.isFinite(day.date.getTime())) throw new Error();
          const localIso = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, "0")}-${String(day.date.getDate()).padStart(2, "0")}`;
          if (localIso !== day.iso) throw new Error();
          seen.add(day.iso);
        }
      }
      return { valid: true };
    } catch {
      return { valid: false, error: "תאריכי הלוח אינם תואמים לתקופה הנבחרת. הלוח הישן נשמר לעיון בטיוטה אך אינו מוצג, נשמר כרשמי או מיוצא. יש ליצור לוח מחדש לאחר בדיקת האילוצים." };
    }
  }

  const api = { TIMEZONE, parseDate, addDays, today, createPeriod, getWeeks, findOverlaps, validate, propose, validateScheduleDates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.schedulePeriodService = api;
})(typeof window !== "undefined" ? window : null);
