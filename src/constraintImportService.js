/* Interpret Excel submissions without changing the authoritative scheduling period. */
(function (root) {
  const DAYS = ["א", "ב", "ג", "ד", "ה", "ו", "שבת"];
  const normalizeName = value => String(value || "").normalize("NFKC")
    .replace(/[\u0591-\u05C7\u200e\u200f\u202a-\u202e]/g, "").replace(/[׳״'".]/g, "").replace(/\s+/g, "").toLowerCase();
  const clean = value => String(value ?? "").replace(/[\u200e\u200f\u202a-\u202e]/g, "").replace(/[–—−]/g, "-").trim();

  function parseTsv(text) {
    const rows = []; let row = [], cell = "", quoted = false;
    const value = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let index = 0; index < value.length; index++) {
      const char = value[index];
      if (char === '"' && (quoted || !cell)) {
        if (quoted && value[index + 1] === '"') { cell += '"'; index++; }
        else quoted = !quoted;
      } else if (!quoted && (char === "\t" || char === "\n")) {
        row.push(cell); cell = "";
        if (char === "\n") { rows.push(row); row = []; }
      } else cell += char;
    }
    row.push(cell); rows.push(row);
    return rows;
  }

  function dayNumber(value) {
    const text = clean(value).replace(/[׳״'"]/g, "").replace(/^יום\s*/, "").trim();
    const names = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
    if (text === "ש") return 6;
    return names.includes(text) ? names.indexOf(text) : DAYS.indexOf(text);
  }

  function classify(text) {
    const value = clean(text).replace(/[.!]+$/g, "").replace(/\s+/g, " ").trim();
    if (!value || value === "-") return { status: "available" };
    if (/^אין\s+(?:לי\s+)?(?:שום\s+)?(?:בעיה|בעיות|מניעה|מגבלה|מגבלות|אילוץ|אילוצים|העדפה|העדפות|קושי)$/.test(value)) return { status: "available" };
    if (/^(?:לא\s*(?:יכול(?:ה)?|יוכלה|פנוי(?:ה)?|זמין(?:ה)?)|חסום(?:ה)?|אין(?:\s+(?:לי\s+)?(?:אפשרות|מצב|זמינות|יכולת))?)$/.test(value)) return { status: "unavailable" };
    if (/^(?:(?:יכול(?:ה)?|פנוי(?:ה)?|זמין(?:ה)?)\s*(?:ו\s*)?)?(?:רוצה|מעדיף|מעדיפה|עדיפות)$/.test(value)) return { status: "preferred" };
    if (/^(?:יכול(?:ה)?|פנוי(?:ה)?|זמין(?:ה)?)$/.test(value)) return { status: "available" };
    return null;
  }

  function interpret({ sources, workers, period, resolutions = {} }, dates) {
    const canonical = dates.createPeriod(period);
    const weeks = dates.getWeeks(canonical);
    const start = weeks[0].start, end = weeks.at(-1).end;
    const registry = workers.map(worker => ({ ...worker, aliases: worker.aliases || [] }));
    const employees = new Map(), records = [], issues = new Map(), skipped = [], coverage = new Set(), notes = [];
    const issue = (id, type, reason, location, extra = {}) => {
      if (!issues.has(id)) issues.set(id, { ...location, ...extra, id, type, reason });
      return resolutions[id];
    };
    const makeDate = (day, month, year) => {
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return dates.parseDate(iso) ? iso : null;
    };
    // Headers delimit blocks; their written dates/numbers are informational only.
    const isHeader = text => /^(?:תאריכים|תאריך|מתאריך|שבוע)(?:\s|:|$)/.test(text)
      || (/^\d{1,4}\s*[./-]\s*\d/.test(text) && !text.includes(":"));
    const restrictionLanguage = text => /(?:לא\s|אין(?:\s|$)|אולי|רק|אחרי|לפני|עד\s|יכול|יכולה|פנוי|פנויה|זמין|זמינה|נייט|משמרת|אסור|מוגבל|חסום|חופש|מחלה|מילואים|\d{1,2}:\d{2})/.test(text);
    function dailyMeaning(text) {
      const known = classify(text);
      if (known) return { ...known, note: null };
      const annotated = text.match(/^(.+?)\s*[-,:;]\s*(.+)$/);
      const annotatedStatus = annotated && classify(annotated[1]);
      if (annotatedStatus && !restrictionLanguage(annotated[2])) return { ...annotatedStatus, note: annotated[2] };
      const negative = text.match(/^(לא\s*(?:יכול(?:ה)?|יוכלה|פנוי(?:ה)?|זמין(?:ה)?)|חסום(?:ה)?|אין\s+(?:לי\s+)?(?:אפשרות|מצב|זמינות|יכולת))\s+(.+)$/);
      if (negative && !restrictionLanguage(negative[2])) return { status: "unavailable", note: negative[2] };
      if (!restrictionLanguage(text)) return { status: "available", note: text };
      return null;
    }

    function addRecord(workerName, date, status, location) {
      const record = { ...location, workerName, date, dayIndex: dates.parseDate(date).getUTCDay(), status };
      records.push(record);
      if (date < start || date > end) skipped.push(record);
    }

    sources.forEach((source, sourceIndex) => {
      const originalRows = JSON.parse(source.rowsJson);
      const notesRow = originalRows.findIndex(row => clean(row[0]) === "הערות" && row.slice(1).every(cell => !clean(cell)));
      const rows = notesRow < 0 ? originalRows : originalRows.slice(0, notesRow);
      const anchor = dates.createPeriod(source.anchorPeriod || canonical);
      const headerRow = rows.findIndex(row => row.some(cell => clean(cell)));
      if (headerRow < 0) return;
      const width = Math.max(...rows.map(row => row.length));
      for (let column = 0; column < width; column++) {
        const rawName = clean(rows[headerRow]?.[column]);
        const cells = rows.slice(headerRow + 1).map(row => clean(row[column]));
        if (!rawName && !cells.some(Boolean)) continue;
        const matchId = `s${sourceIndex}:c${column}:employee`;
        const location = { sourceIndex, column: column + 1, row: headerRow + 1, raw: rawName };
        let candidates = registry.filter(worker => [worker.name, ...worker.aliases].some(name => normalizeName(name) === normalizeName(rawName)));
        const explicit = resolutions[matchId];
        let workerName = explicit?.employee && registry.some(worker => worker.name === explicit.employee) ? explicit.employee : candidates.length === 1 ? candidates[0].name : null;
        if (explicit?.action === "defer") continue;
        if (!workerName && candidates.length === 0 && /^[\p{L}][\p{L}\p{N}\s'׳״"().\-]*$/u.test(rawName) && !/^(תאריך|שבוע|הערות)/.test(rawName)) {
          workerName = rawName;
          registry.push({ name: rawName, aliases: [] });
        }
        if (!workerName) {
          issue(matchId, "employee", rawName ? "שם העובד מתאים ליותר מעובד אחד או שאינו שם תקין." : "לעמודה יש אילוצים אך חסר שם עובד.", location);
          continue;
        }
        if (!employees.has(workerName)) employees.set(workerName, { name: workerName, isNew: !workers.some(worker => worker.name === workerName), columns: [], hasInput: false, submittedBlockNumbers: [] });
        const employee = employees.get(workerName);
        employee.columns.push(column + 1); employee.hasInput ||= cells.some(Boolean);
        let blockNumber = 0, block = null, separated = false;
        const beginBlock = number => {
          blockNumber = number;
          block = { number, seen: new Set(), lastDay: -1, entries: 0 };
          coverage.add(number);
          if (!employee.submittedBlockNumbers.includes(number)) employee.submittedBlockNumbers.push(number);
          return block;
        };
        for (let index = headerRow + 1; index < rows.length; index++) {
          const rawCell = String(rows[index]?.[column] ?? "");
          const lines = rawCell.split(/\r?\n/);
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const text = clean(lines[lineIndex]);
            if (!text) { separated = true; continue; }
            const id = 's' + sourceIndex + ':c' + column + ':r' + index + ':l' + lineIndex;
            const at = { id, sourceIndex, column: column + 1, row: index + 1, line: lineIndex + 1, workerName, raw: lines[lineIndex] };
            if (isHeader(text)) {
              if (block && !block.entries && block.labelOnly) { block.labelOnly = false; continue; }
              if (block && !block.entries && !separated) {
                const choice = resolutions[id + ":boundary"];
                if (!Number.isInteger(Number(choice?.blockNumber)) || Number(choice.blockNumber) < 1 || Number(choice.blockNumber) > 8) {
                  issue(id + ":boundary", "block", "רצף כותרות ללא ימי שבוע: יש לבחור את מספר הבלוק הבא, בלי להסתמך על התאריכים.", at);
                  block.ambiguous = true; continue;
                }
                beginBlock(Number(choice.blockNumber));
              } else beginBlock(blockNumber + 1);
              block.headerCell = index;
              block.labelOnly = /^(?:תאריכים|תאריך|מתאריך|שבוע)\s*:?$/.test(text);
              separated = false;
              continue;
            }
            const dayLine = text.match(/^(?:יום\s*)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת|[אבגדהוש])['׳״"]?\s*(?:[-:]|\s)\s*(.*)$/);
            let day = dayLine ? dayNumber(dayLine[1]) : -1;
            const boundaryId = id + ":boundary", boundary = resolutions[boundaryId];
            if (boundary?.action === "defer") {
              issue(boundaryId, "block", "גבול בלוקים לא פתור מחייב בחירת מספר בלוק לפני יצירה.", at);
              block && (block.ambiguous = true);
              continue;
            }
            if (boundary?.blockNumber && Number.isInteger(Number(boundary.blockNumber)) && Number(boundary.blockNumber) >= 1 && Number(boundary.blockNumber) <= 8) beginBlock(Number(boundary.blockNumber));
            if (!block) beginBlock(1);
            if (day >= 0 && (block.seen.has(day) || (block.headerCell === undefined && day < block.lastDay)) && !boundary?.blockNumber) {
              if (day === 0 && (block.lastDay === 6 || separated)) beginBlock(blockNumber + 1);
              else {
                issue(boundaryId, "block", "יום שבוע חוזר ללא גבול ברור בין בלוקים. יש לבחור מספר בלוק.", at);
                block.ambiguous = true;
              }
            }
            if (block.ambiguous) continue;
            block.entries++; separated = false;
            if (day >= 0) { block.seen.add(day); block.lastDay = day; }
            at.blockNumber = block.number;
            const blockStart = dates.addDays(canonical.startDate, (block.number - 1) * 7);
            const weeklyBody = text.replace(/^כל\s+השבוע\s*[-:]?\s*/, "").replace(/\s+כל\s+השבוע$/, "");
            const weekly = classify(weeklyBody);
            if (weekly && day < 0) {
              for (let d = 0; d < 7; d++) addRecord(workerName, dates.addDays(blockStart, d), weekly.status, at);
              continue;
            }
            const exclusive = text.match(/^(?:יכול(?:ה)?|פנוי(?:ה)?|זמין(?:ה)?)\s+רק\s+(?:ביום\s*)?(.+)$/);
            if (exclusive && dayNumber(exclusive[1]) >= 0) {
              for (let d = 0; d < 7; d++) addRecord(workerName, dates.addDays(blockStart, d), d === dayNumber(exclusive[1]) ? "available" : "unavailable", at);
              continue;
            }
            const choice = resolutions[id + ":meaning"];
            if (choice?.action === "defer") continue;
            if (day < 0 && choice?.weekday !== "" && Number.isInteger(Number(choice?.weekday)) && Number(choice.weekday) >= 0 && Number(choice.weekday) <= 6) day = Number(choice.weekday);
            const body = dayLine ? dayLine[2] : text;
            let meaning = dailyMeaning(body);
            if (["available", "unavailable", "preferred"].includes(choice?.status)) meaning = { status: choice.status, note: body };
            if (day < 0 || !meaning) {
              issue(id + ":meaning", day < 0 ? "entry" : "meaning", day < 0 ? "לא זוהה יום שבוע. נדרשת בחירת יום מפורשת." : "מגבלת זמינות שאינה חד משמעית. נדרשת הכרעת מנהל.", at);
              continue;
            }
            const date = dates.addDays(blockStart, day);
            if (meaning.note) notes.push({ ...at, date, text: meaning.note });
            addRecord(workerName, date, meaning.status, at);
          }
        }
      }
      if (notesRow >= 0) originalRows.slice(notesRow + 1).forEach((row, offset) => row.forEach((cell, column) => {
        const text = clean(cell);
        if (!text) return;
        const id = `s${sourceIndex}:note:${notesRow + offset + 1}:${column}`;
        const at = { sourceIndex, row: notesRow + offset + 2, column: column + 1, raw: String(cell) };
        const named = registry.filter(worker => text.startsWith(worker.name + " "));
        const choice = resolutions[id];
        if (choice?.action === "defer") return;
        const workerName = choice?.employee || (named.length === 1 ? named[0].name : null);
        const match = text.match(/(?:^|\s)(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?=\s|$)/);
        let date = choice?.date;
        let meaning = ["available", "unavailable", "preferred"].includes(choice?.status) ? { status: choice.status } : null;
        if (workerName && match) {
          const month = Number(match[2]);
          const year = match[3] ? Number(match[3]) + (Number(match[3]) < 100 ? 2000 : 0)
            : Number(anchor.startDate.slice(0, 4)) + (anchor.startDate.slice(5, 7) === "12" && month === 1 ? 1 : anchor.startDate.slice(5, 7) === "01" && month === 12 ? -1 : 0);
          date ||= makeDate(Number(match[1]), month, year);
          meaning ||= dailyMeaning(text.slice(workerName.length).replace(match[0], "").trim());
        }
        if (!workerName || !registry.some(worker => worker.name === workerName) || !dates.parseDate(date) || !meaning) {
          issue(id, "note", "הערה חד פעמית דורשת עובד, תאריך ופירוש מפורשים.", { ...at, workerName });
          return;
        }
        if (!employees.has(workerName)) employees.set(workerName, { name: workerName, isNew: false, columns: [], hasInput: true, submittedBlockNumbers: [] });
        if (meaning.note) notes.push({ ...at, workerName, date, text: meaning.note });
        addRecord(workerName, date, meaning.status, { ...at, id });
      }));
    });
    const byDate = new Map();
    records.filter(record => record.date >= start && record.date <= end).forEach(record => {
      const key = `${record.workerName}|${record.date}`;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(record);
    });
    const applied = [];
    for (const [key, entries] of byDate) {
      const blocked = entries.some(entry => entry.status === "unavailable");
      const open = entries.some(entry => entry.status !== "unavailable");
      const conflictId = `conflict:${key}`;
      const choice = resolutions[conflictId];
      const evidenceKey = entries.map(entry => `${entry.id}:${entry.status}`).sort().join("|");
      let status = blocked ? "unavailable" : entries.some(entry => entry.status === "preferred") ? "preferred" : "available";
      if (blocked && open) {
        if (choice?.evidenceKey === evidenceKey && ["available", "unavailable", "preferred"].includes(choice.status)) status = choice.status;
        else { issue(conflictId, "conflict", "אותו עובד ויום מסומנים גם כזמינים וגם כחסומים. נדרשת הכרעת מנהל.", entries[0], { date: entries[0].date, evidenceKey }); continue; }
      }
      applied.push({ workerName: entries[0].workerName, date: entries[0].date, status, sourceIds: entries.map(entry => entry.id) });
    }
    const unresolved = [...issues.values()];
    return { version: 3, mappingMode: "block-sequence", periodKey: JSON.stringify([canonical.startDate, canonical.weekCount, canonical.weekStartsOn]),
      sources, resolutions, employees: [...employees.values()], records, applied, skipped,
      issues: unresolved, notes, detectedWeekCount: Math.max(0, ...coverage) };
  }

  const api = { normalizeName, parseTsv, classify, interpret };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.constraintImportService = api;
})(typeof window !== "undefined" ? window : null);
