(function () {
  const STORAGE_KEY = "shifts-arranger-calendar-events-v1";
  const TIMEZONE = "Asia/Jerusalem";

  function eventKey(scheduleId, employeeId, date, role) {
    return `${scheduleId}:${employeeId}:${date}:${role}`;
  }

  function readCreatedEvents() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
      return {};
    }
  }

  function writeCreatedEvents(events) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events || {}));
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function shiftsForEmployee(schedule, employeeId) {
    const employee = schedule.employees.find(item => item.id === employeeId);
    if (!employee) return [];
    return schedule.entries.flatMap(entry => entry.assignments
      .filter(assignment => assignment.employeeName === employee.name)
      .map(assignment => ({
        key: eventKey(schedule.scheduleId, employee.id, entry.date, assignment.role),
        scheduleId: schedule.scheduleId,
        employeeId: employee.id,
        employeeName: employee.name,
        date: entry.date,
        dayName: entry.dayName,
        role: assignment.role,
        title: assignment.title,
        timezone: schedule.timezone || TIMEZONE,
        startTime: "14:30",
        endTime: "15:30"
      })));
  }

  function icsTimestamp(date, time) {
    return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
  }

  function escapeIcs(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function foldIcsLine(line) {
    if (line.length <= 72) return line;
    const parts = [];
    let current = line;
    while (current.length > 72) {
      parts.push(current.slice(0, 72));
      current = ` ${current.slice(72)}`;
    }
    parts.push(current);
    return parts.join("\r\n");
  }

  function buildIcs(events, calendarEmail) {
    const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Shifts Arranger//Finalized Schedule//HE",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:סידור משמרות"
    ];

    events.forEach(event => {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${escapeIcs(event.key)}@shifts-arranger`,
        `DTSTAMP:${now}`,
        `DTSTART;TZID=${event.timezone}:${icsTimestamp(event.date, event.startTime)}`,
        `DTEND;TZID=${event.timezone}:${icsTimestamp(event.date, event.endTime)}`,
        `SUMMARY:${escapeIcs(event.title)}`,
        `DESCRIPTION:${escapeIcs(`סידור משמרות - ${event.employeeName}`)}`,
        `ORGANIZER;CN=${escapeIcs(event.employeeName)}:mailto:${calendarEmail}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:תזכורת למשמרת",
        "TRIGGER:-PT30M",
        "END:VALARM",
        "END:VEVENT"
      );
    });

    lines.push("END:VCALENDAR");
    return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
  }

  function downloadIcs(events, calendarEmail, scheduleId) {
    const blob = new Blob([buildIcs(events, calendarEmail)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scheduleId}-google-calendar.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function addToGoogleCalendar({ schedule, employeeId, calendarEmail }) {
    if (!isValidEmail(calendarEmail)) {
      throw new Error("Invalid email address");
    }
    const events = shiftsForEmployee(schedule, employeeId);
    if (!events.length) {
      throw new Error("No shifts found for this employee");
    }

    const createdEvents = readCreatedEvents();
    const existing = events.filter(event => createdEvents[event.key]);
    downloadIcs(events, calendarEmail, schedule.scheduleId);

    events.forEach(event => {
      createdEvents[event.key] = {
        eventId: event.key,
        scheduleId: event.scheduleId,
        employeeId: event.employeeId,
        date: event.date,
        role: event.role,
        calendarEmail,
        updatedAt: new Date().toISOString()
      };
    });
    writeCreatedEvents(createdEvents);

    return {
      events,
      existingCount: existing.length,
      createdCount: events.length - existing.length
    };
  }

  window.calendarService = {
    eventKey,
    readCreatedEvents,
    isValidEmail,
    shiftsForEmployee,
    addToGoogleCalendar
  };
})();
