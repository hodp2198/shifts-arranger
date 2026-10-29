/**
 * Deterministic Hebrew Date, Week & Employee Constraint Parser for Shift Arranger
 *
 * Provides:
 * - Robust Hebrew weekday tokenization and normalization (including prefixes, abbreviations, slang)
 * - Flexible delimiter and spacing support
 * - Comprehensive sentiment classification: Hard Block, Soft Negative (Avoid), Positive Preference, Submitted
 * - Schedule-contextual week and date math with month and year boundary transitions
 * - Day/date mismatch validation (never guesses)
 * - Informational Friday isolation
 *
 * Runs in both Node.js (CommonJS/ESM) and browser (window.ConstraintParser).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ConstraintParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_NAMES = ["א", "ב", "ג", "ד", "ה", "ו", "שבת"];
  const SCHEDULE_DAYS = [0, 1, 2, 3, 4, 6]; // Friday (5) is normally nonworking

  // Map Hebrew day expressions to canonical day index 0..6 (0=Sun..6=Sat)
  const DAY_NAME_TO_INDEX = {
    // Single letter
    "א": 0, "ב": 1, "ג": 2, "ד": 3, "ה": 4, "ו": 5, "ש": 6,
    // Full names
    "ראשון": 0, "שני": 1, "שלישי": 2, "רביעי": 3, "חמישי": 4, "שישי": 5, "שבת": 6,
    // Colloquial Saturday
    "מוצש": 6, "מוצאי שבת": 6
  };

  /**
   * Cleans punctuation and quotes:
   * Strips gershayim (״, "), geresh (׳, '), quotes, backticks, dashes, and periods.
   */
  function cleanToken(token) {
    return String(token || "")
      .replace(/[\u0591-\u05C7]/g, "") // Hebrew niqqud
      .replace(/['׳`´״"]/g, "")
      .trim();
  }

  /**
   * Normalizes a Hebrew day string to its canonical index (0..6) or null if unrecognized.
   * Handles:
   * - Full names: ראשון, שני, שלישי, רביעי, חמישי, שישי, שבת
   * - Abbreviations: א, ב, ג, ד, ה, ו, ש, א', ב', מוצ"ש
   * - Prepositions: בא', ב-א', ביום א', בשני, בראשון, במוצש, בשישי
   */
  function normalizeDayToken(token) {
    if (!token) return null;
    let raw = String(token).trim();

    // Specific check for Saturday night colloquialisms
    if (/מוצ['׳"״]?ש|מוצאי\s+שבת/i.test(raw)) {
      return 6;
    }

    // Strip common prepositions: 'ביום', 'יום', 'ב-', 'ל-', 'מ-', 'ב', 'ל', 'מ'
    raw = raw.replace(/^(?:ביום|יום)\s+/i, "");
    raw = raw.replace(/^[בלמ]-/i, "");
    if (/^[בלמ][א-ת]/i.test(raw) && raw.length > 1) {
      // e.g. בא, בשני, בראשון, בחמישי
      const withoutPrefix = raw.slice(1);
      const cleanedWithoutPrefix = cleanToken(withoutPrefix);
      if (DAY_NAME_TO_INDEX[cleanedWithoutPrefix] !== undefined) {
        return DAY_NAME_TO_INDEX[cleanedWithoutPrefix];
      }
    }

    const clean = cleanToken(raw);
    if (DAY_NAME_TO_INDEX[clean] !== undefined) {
      return DAY_NAME_TO_INDEX[clean];
    }

    return null;
  }

  /**
   * Compatibility wrapper for legacy code:
   * Returns canonical single letter or "שבת".
   */
  function normalizeDayName(text) {
    const idx = normalizeDayToken(text);
    if (idx === null) return "";
    return DAY_NAMES[idx];
  }

  /**
   * Compatibility wrapper for dayIndexFromText.
   */
  function dayIndexFromText(text) {
    return normalizeDayToken(text);
  }

  /**
   * Helper to format Date to YYYY-MM-DD
   */
  function toIsoDate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Helper to format Date to D.M
   */
  function toDisplayDate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return "";
    return `${date.getDate()}.${date.getMonth() + 1}`;
  }

  /**
   * Helper to add days to a Date
   */
  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  /**
   * Sentiment & Availability Classifier
   * Distinguishes:
   * - 'BLOCKED': Hard block (cannot work)
   * - 'AVOID': Soft negative preference (prefer not to work, assignable if desperate)
   * - 'PREFERRED': Positive preference (wants to work)
   * - 'SUBMITTED': Standard availability (open for shifts)
   * - 'AMBIGUOUS': Unrecognized / uninterpretable text
   * - 'EMPTY': No constraint specified (standard availability)
   */
  function classifyAvailability(valueText) {
    const text = String(valueText || "").trim();
    if (!text) {
      return { status: "EMPTY", reason: "" };
    }

    // 1. Soft Negative Preferences (Must NOT create hard blocks!)
    // e.g. "מעדיף שלא", "מעדיפה שלא לעבוד", "עדיף לי שלא", "לא רוצה", "מעדיף להימנע"
    const softNegativeRegex = /(?:מעדיף|מעדיפה|עדיף|עדיפות)\s+(?:\S+\s+)?(?:שלא|לא)|לא\s+רוצה|לא\s+מעדיף|לא\s+מעדיפה|מעדיף\s+להימנע|מעדיפה\s+להימנע/;
    if (softNegativeRegex.test(text)) {
      return { status: "AVOID", reason: text };
    }

    // 2. Hard Unavailability (Blocked)
    // Keywords: לא יכול, לא יכולה, לא פנוי, חסום, מילואים, חופש, מבחן, מחלה
    const hardBlockedRegex = /לא\s*(?:יכול|יכולה|יוכלה|יוכל|תוכל|פנוי|פנויה|זמין|זמינה|אפשרי)|חסום|אין\s*אפשרות|סגור|מילואים|חופש|חופשה|מבחן|לימודים|אירוע|מחלה|חולה|בדיקה|חג\b/i;
    if (hardBlockedRegex.test(text)) {
      return { status: "BLOCKED", reason: text };
    }

    // 3. Positive Preferences (Preferred)
    // Keywords: רוצה, מעדיף, מעדיפה, עדיפות
    const preferredRegex = /רוצה|מעדיף|מעדיפה|עדיפות|העדפה|מעדיף\s+לעבוד|מעדיפה\s+לעבוד/i;
    if (preferredRegex.test(text)) {
      return { status: "PREFERRED", reason: text };
    }

    // 4. Standard Open Availability (Submitted)
    // Keywords: יכול, יכולה, זמין, זמינה, פנוי, פנויה, אפשרי, פתוח, בסדר, מתאים
    const availableRegex = /^(?:יכול|יכולה|זמין|זמינה|פנוי|פנויה|פתוח|אפשרי|בסדר|מתאים|פנוי\s+לגמרי|זמין\s+לגמרי)$/i;
    if (availableRegex.test(text) || text === "-" || text === "--" || text === "v" || text === "V") {
      return { status: "SUBMITTED", reason: text };
    }

    // 5. If it's a known non-blocking note (e.g. "מוצש פנוי", "זמין לבוקר")
    if (/פנוי|זמין|יכול|אפשרי/i.test(text) && !/לא/i.test(text)) {
      return { status: "SUBMITTED", reason: text };
    }

    // 6. Otherwise: Unrecognized / Ambiguous line
    return { status: "AMBIGUOUS", reason: text };
  }

  /**
   * Helper to check if text looks like a constraint day line
   */
  function isConstraintDayLine(line) {
    const raw = String(line || "").trim();
    if (!raw) return false;
    return parseDayLine(raw) !== null;
  }

  /**
   * Splits a day line into { dayToken, dayIndex, valueText, embeddedDate }
   */
  function parseDayLine(line) {
    const raw = String(line || "").trim();
    if (!raw) return null;

    // Check for Saturday night expressions
    const motsashMatch = raw.match(/^(?:ב-?|ל-?|מ-?)?(מוצ['׳"״]?ש|מוצאי\s+שבת)(?:\s*[-:.]\s*|\s+)(.*)$/i);
    if (motsashMatch) {
      return {
        dayToken: motsashMatch[1].trim(),
        dayIndex: 6,
        valueText: motsashMatch[2].trim()
      };
    }

    // Pattern 1: Day token followed by standard delimiter (-, :, .)
    // e.g. "א - לא יכול", "יום ראשון: רוצה", "יום שלישי 04/11 - לא יכול", "שלישי 4.11: חופש"
    let match = raw.match(/^([א-ת0-9./'׳"״\s-]+?)\s*[-:.]\s*(.*)$/);
    if (match) {
      const leftPart = match[1].trim();
      const rightPart = (match[2] || "").trim();

      // Check if leftPart contains a date (e.g. "יום שלישי 04/11" or "שלישי 4.11")
      const embeddedDate = extractDateParts(leftPart);
      const textWithoutDate = leftPart.replace(/\d{1,2}[./-]\d{1,2}/, "").trim();

      const dayIndex = normalizeDayToken(textWithoutDate || leftPart);
      if (dayIndex !== null) {
        return {
          dayToken: textWithoutDate || leftPart,
          dayIndex,
          valueText: rightPart,
          embeddedDate: embeddedDate || extractDateParts(rightPart)
        };
      }
    }

    // Pattern 2: Parentheses e.g. "שלישי (לא יכול)"
    match = raw.match(/^([א-ת'׳"״\s-]+?)\s*\(([^)]+)\)$/);
    if (match) {
      const dayIndex = normalizeDayToken(match[1]);
      if (dayIndex !== null) {
        return {
          dayToken: match[1].trim(),
          dayIndex,
          valueText: match[2].trim(),
          embeddedDate: extractDateParts(match[2])
        };
      }
    }

    // Pattern 3: Space delimiter e.g. "א לא יכול" or "יום ראשון לא יכול"
    // Order matters! Check compound prefixes 'ביום X', 'יום X' BEFORE single word
    match = raw.match(/^(?:(ביום\s+[א-ת'׳"״]+|יום\s+[א-ת'׳"״]+)|([א-ת'׳"״]+))\s+(.*)$/);
    if (match) {
      const dayStr = match[1] || match[2];
      const dayIndex = normalizeDayToken(dayStr);
      if (dayIndex !== null) {
        return {
          dayToken: dayStr.trim(),
          dayIndex,
          valueText: match[3].trim(),
          embeddedDate: extractDateParts(match[3])
        };
      }
    }

    return null;
  }

  /**
   * Validates whether a day name and an explicit date within the same text match.
   * If both are present and conflict (e.g. יום שלישי 04/11 when Nov 4 is Wednesday):
   * Returns { valid: false, error: "..." }
   */
  function extractDateParts(text) {
    const match = String(text || "").match(/(\d{1,2})[./-](\d{1,2})/);
    return match ? { day: Number(match[1]), month: Number(match[2]) } : null;
  }

  /**
   * Checks whether a line matches a week header format:
   * e.g. "01/11-07/11", "תאריך: 01/11-07/11", "שבוע של 01/11", "שבוע 1", "01.11 - 07.11"
   */
  function isConstraintWeekHeader(line) {
    const text = String(line || "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
    if (!text) return false;
    return /^תאריך\s*[:\-/]?/i.test(text)
      || /^שבוע\s+(?:של\s+)?\d{1,2}[./]\d{1,2}/i.test(text)
      || /^שבוע\s+\d+/i.test(text)
      || /^\d{1,2}[./]\d{1,2}\s*[-–]\s*\d{1,2}(?:[./]\d{1,2})?/.test(text)
      || /^\d{1,2}\s*[-–]\s*\d{1,2}[./]\d{1,2}/.test(text)
      || /^\d{1,2}\s*[-–]\s*\d{1,2}$/.test(text);
  }

  /**
   * Safe Date construction handling month rollovers
   */
  function safeCreateDate(day, month, year) {
    if (!day || !month || day < 1 || day > 31) return null;
    let y = year || new Date().getFullYear();
    let m = month;
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    return new Date(y, m - 1, day, 12);
  }

  /**
   * Parses week header text to { start, end } Date range.
   * Handles:
   * - "01/11-07/11" or "01.11 - 07.11"
   * - "28/10 - 03/11" (month rollover)
   * - "28 - 03/11" (start month inferred from end month)
   * - Contextual row matching with fallbackYear
   * - Year rollover awareness (e.g. schedule starting Dec transitioning to Jan)
   */
  function parseWeekLabelToRange(text, options = {}) {
    const rowContext = options.rowContext || null;
    const baseStart = options.baseStart || null;
    const fallbackYear = options.fallbackYear || (baseStart ? baseStart.getFullYear() : new Date().getFullYear());

    const line = String(text || "")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) return null;

    // 1) Full range: "01/11 - 07/11" or "01.11 - 07.11" or "28/10-03/11"
    const fullRange = line.match(/(\d{1,2})[./](\d{1,2})\s*-\s*(\d{1,2})(?:[./](\d{1,2}))?/);
    if (fullRange) {
      const startDay = Number(fullRange[1]);
      const startMonth = Number(fullRange[2]);
      const endDay = Number(fullRange[3]);
      let endMonth = fullRange[4] ? Number(fullRange[4]) : (endDay < startDay ? startMonth + 1 : startMonth);

      let startYear = fallbackYear;
      // If baseStart is in late December (e.g. month 12) and this week starts in Jan (month 1), increment year!
      if (baseStart && baseStart.getMonth() === 11 && startMonth < 6) {
        startYear += 1;
      }

      let endYear = startYear;
      if (endMonth < startMonth || (endMonth === 1 && startMonth === 12)) {
        endYear += 1;
      }

      const start = safeCreateDate(startDay, startMonth, startYear);
      const end = safeCreateDate(endDay, endMonth, endYear);
      return start && end ? { start, end } : null;
    }

    // 2) Range with end month only: "28 - 03/11" or "1 - 7/11"
    const startWithEndMonth = line.match(/(?:^|[^\d])(\d{1,2})\s*-\s*(\d{1,2})[./](\d{1,2})(?![./\d])/);
    if (startWithEndMonth) {
      const startDay = Number(startWithEndMonth[1]);
      const endDay = Number(startWithEndMonth[2]);
      const endMonth = Number(startWithEndMonth[3]);
      const startMonth = startDay > endDay ? (endMonth === 1 ? 12 : endMonth - 1) : endMonth;

      let startYear = fallbackYear;
      if (baseStart && baseStart.getMonth() === 11 && startMonth < 6) {
        startYear += 1;
      }
      let endYear = startYear;
      if (endMonth < startMonth) {
        endYear += 1;
      }

      const start = safeCreateDate(startDay, startMonth, startYear);
      const end = safeCreateDate(endDay, endMonth, endYear);
      return start && end ? { start, end } : null;
    }

    // 3) Single date header: "01/11" or "שבוע של 01/11"
    const startOnly = line.match(/(\d{1,2})[./](\d{1,2})/);
    if (startOnly) {
      const startDay = Number(startOnly[1]);
      const startMonth = Number(startOnly[2]);
      let startYear = fallbackYear;
      if (baseStart && baseStart.getMonth() === 11 && startMonth < 6) {
        startYear += 1;
      }
      const start = safeCreateDate(startDay, startMonth, startYear);
      return start ? { start, end: addDays(start, 6) } : null;
    }

    // 4) Simple day range with rowContext: "1-7" where rowContext has start/end dates
    const simpleRange = line.match(/(?:^|[^\d])(\d{1,2})\s*-\s*(\d{1,2})(?![./\d])/);
    if (simpleRange && rowContext) {
      const startDay = Number(simpleRange[1]);
      const endDay = Number(simpleRange[2]);
      if (startDay === rowContext.start.getDate() && endDay === rowContext.end.getDate()) {
        return { start: new Date(rowContext.start), end: new Date(rowContext.end) };
      }
    }

    // 5) Numbered week e.g. "שבוע 1", "שבוע 2"
    const numberedWeekMatch = line.match(/^שבוע\s+(\d+)$/);
    if (numberedWeekMatch && baseStart) {
      const weekIndex = Number(numberedWeekMatch[1]) - 1;
      if (weekIndex >= 0) {
        const start = addDays(baseStart, weekIndex * 7);
        return { start, end: addDays(start, 6) };
      }
    }

    return null;
  }

  /**
   * Resolves week offset for a header line in worker constraints text.
   */
  function resolveConstraintWeekOffset(line, currentOffset, sawDate, weekConfigs, baseStart) {
    const parsed = parseWeekLabelToRange(line, { baseStart });
    if (parsed && Array.isArray(weekConfigs) && weekConfigs.length) {
      const parsedStartIso = toIsoDate(parsed.start);
      const parsedEndIso = toIsoDate(parsed.end);

      const matchedWeek = weekConfigs.findIndex(w => (
        toIsoDate(w.start) === parsedStartIso && toIsoDate(w.end) === parsedEndIso
      ));
      if (matchedWeek >= 0) return matchedWeek;

      const matchedStart = weekConfigs.findIndex(w => toIsoDate(w.start) === parsedStartIso);
      if (matchedStart >= 0) return matchedStart;

      return null; // Explicit date range that falls outside active schedule!
    }

    // Header without specific date range (e.g. "תאריך:" or "שבוע 2")
    const numberedMatch = String(line || "").match(/^שבוע\s+(\d+)/);
    if (numberedMatch) {
      return Number(numberedMatch[1]) - 1;
    }

    const baseOffset = Number.isInteger(currentOffset) ? currentOffset : -1;
    return sawDate ? baseOffset + 1 : 0;
  }

  /**
   * Parses an entire worker's constraint text into structured constraints:
   * - blocked: Set<string> (hard unavailable dates in ISO format)
   * - avoid: Set<string> (soft negative preference dates in ISO format)
   * - preferred: Set<string> (positive preference dates in ISO format)
   * - submitted: Set<string> (available dates in ISO format)
   * - warnings: Array<string> (informational warnings)
   * - criticalErrors: Array<string> (issues that MUST block schedule generation)
   */
  function parseWorkerConstraints(text, options = {}) {
    const weekConfigs = options.weekConfigs || [];
    const baseStart = options.baseStart || (weekConfigs[0]?.start) || null;
    const workerName = options.workerName || "עובד";

    const blocked = new Set();
    const avoid = new Set();
    const preferred = new Set();
    const submitted = new Set();
    const warnings = [];
    const criticalErrors = [];

    const lines = String(text || "").split(/\r?\n/);
    let weekOffset = 0;
    let sawDate = false;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex].trim();
      if (!line) continue;

      // Check if line is a week header
      if (isConstraintWeekHeader(line)) {
        const nextOffset = resolveConstraintWeekOffset(line, weekOffset, sawDate, weekConfigs, baseStart);
        if (nextOffset === null) {
          warnings.push(`שבוע '${line}' אינו נמצא בטווח התאריכים של הסידור הנוכחי.`);
        }
        weekOffset = nextOffset;
        sawDate = true;
        continue;
      }

      // Check if line is a day line
      const dayParsed = parseDayLine(line);
      if (!dayParsed) {
        // Line does not start with a recognized day name.
        // If it looks like meaningful text, flag as unrecognized warning/error
        if (line.length > 1 && !line.startsWith("#")) {
          criticalErrors.push(`שורה ${lineIndex + 1} אצל ${workerName} לא זוהתה: '${line}'`);
        }
        continue;
      }

      const { dayToken, dayIndex, valueText } = dayParsed;

      // Check Friday (index 5)
      if (dayIndex === 5) {
        // Friday is isolated as nonworking: do not assign to schedule workdays
        if (valueText) {
          warnings.push(`הערת יום שישי עבור ${workerName} לא נכללה בסידור (יום ללא משמרות): '${line}'`);
        }
        continue;
      }

      // Validate day index belongs to schedule days [0, 1, 2, 3, 4, 6]
      if (!SCHEDULE_DAYS.includes(dayIndex)) {
        continue;
      }

      if (weekOffset === null) {
        // Line belongs to a week header that was outside schedule bounds
        continue;
      }

      // Resolve calendar date for this day
      const activeWeek = weekConfigs[weekOffset];
      const weekStart = activeWeek?.start || (baseStart ? addDays(baseStart, weekOffset * 7) : null);
      if (!weekStart) {
        continue;
      }

      const date = addDays(weekStart, dayIndex);
      const iso = toIsoDate(date);

      // Validate explicit date if present in day token or value text (e.g. "יום שלישי 04/11 - לא יכול")
      const dateParts = dayParsed.embeddedDate || extractDateParts(valueText);
      if (dateParts) {
        const expectedDay = date.getDate();
        const expectedMonth = date.getMonth() + 1;
        if (dateParts.day !== expectedDay || dateParts.month !== expectedMonth) {
          criticalErrors.push(
            `אי-התאמה בין יום לתאריך אצל ${workerName}: נכתב '${dayToken}' עם התאריך ${dateParts.day}/${dateParts.month}, אך התאריך המחושב ליום זה הוא ${toDisplayDate(date)}.`
          );
          // Safety: Do NOT guess or auto-assign on conflict
          continue;
        }
      }

      // Classify the constraint value text
      const classification = classifyAvailability(valueText);

      switch (classification.status) {
        case "BLOCKED":
          blocked.add(iso);
          submitted.delete(iso);
          avoid.delete(iso);
          preferred.delete(iso);
          break;

        case "AVOID":
          // Soft negative preference: must NOT be in blocked!
          // Add to submitted (so canAssign allows it if needed) and to avoid (so workerScore penalizes it).
          if (!blocked.has(iso)) {
            avoid.add(iso);
            submitted.add(iso);
            preferred.delete(iso);
          }
          break;

        case "PREFERRED":
          if (!blocked.has(iso)) {
            preferred.add(iso);
            submitted.add(iso);
            avoid.delete(iso);
          }
          break;

        case "SUBMITTED":
        case "EMPTY":
          if (!blocked.has(iso) && !avoid.has(iso)) {
            submitted.add(iso);
          }
          break;

        case "AMBIGUOUS":
          // Unrecognized text on a workday: flag as critical error to prevent incorrect schedule generation
          criticalErrors.push(
            `אילוץ לא מזוהה עבור יום ${DAY_NAMES[dayIndex]}' אצל ${workerName}: '${valueText}'.`
          );
          break;
      }
    }

    return {
      blocked,
      avoid,
      preferred,
      submitted,
      warnings,
      criticalErrors,
      hasCriticalErrors: criticalErrors.length > 0
    };
  }

  /**
   * Compatibility wrapper for parseConstraints(text)
   */
  function parseConstraints(text, options = {}) {
    return parseWorkerConstraints(text, options);
  }

  /**
   * Legacy text classification wrappers for compatibility
   */
  function isUnavailableText(text) {
    const classification = classifyAvailability(text);
    return classification.status === "BLOCKED";
  }

  function isPreferredText(text) {
    const classification = classifyAvailability(text);
    return classification.status === "PREFERRED";
  }

  function isAvoidText(text) {
    const classification = classifyAvailability(text);
    return classification.status === "AVOID";
  }

  return {
    DAY_NAMES,
    SCHEDULE_DAYS,
    cleanToken,
    normalizeDayToken,
    normalizeDayName,
    dayIndexFromText,
    toIsoDate,
    toDisplayDate,
    addDays,
    classifyAvailability,
    isConstraintDayLine,
    parseDayLine,
    isConstraintWeekHeader,
    parseWeekLabelToRange,
    resolveConstraintWeekOffset,
    parseWorkerConstraints,
    parseConstraints,
    isUnavailableText,
    isPreferredText,
    isAvoidText
  };
});
