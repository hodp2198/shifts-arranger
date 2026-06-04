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

  // Legacy fallback kept for manual calendar-file export if direct Google OAuth is unavailable.
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

  function googleDateTime(date, time) {
    return `${date}T${time}:00`;
  }

  function googleEventBody(event) {
    return {
      summary: event.title,
      description: `סידור משמרות - ${event.employeeName}`,
      start: {
        dateTime: googleDateTime(event.date, event.startTime),
        timeZone: event.timezone
      },
      end: {
        dateTime: googleDateTime(event.date, event.endTime),
        timeZone: event.timezone
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 30 }
        ]
      },
      extendedProperties: {
        private: {
          stableKey: event.key,
          scheduleId: event.scheduleId,
          employeeId: event.employeeId,
          role: event.role
        }
      }
    };
  }

  async function googleCalendarRequest(accessToken, path, options = {}) {
    const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(text || `Google Calendar request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }

  async function findExistingGoogleEvent(accessToken, stableKey) {
    const params = new URLSearchParams({
      privateExtendedProperty: `stableKey=${stableKey}`,
      maxResults: "1",
      singleEvents: "true"
    });
    const result = await googleCalendarRequest(accessToken, `/calendars/primary/events?${params.toString()}`);
    return result.items?.[0] || null;
  }

  async function upsertGoogleEvent(accessToken, event, createdEvents) {
    const body = googleEventBody(event);
    const stored = createdEvents[event.key];
    if (stored?.googleEventId) {
      try {
        return await googleCalendarRequest(accessToken, `/calendars/primary/events/${encodeURIComponent(stored.googleEventId)}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        });
      } catch (error) {
        if (error.status !== 404 && error.status !== 410) throw error;
      }
    }

    const existing = await findExistingGoogleEvent(accessToken, event.key);
    if (existing?.id) {
      return googleCalendarRequest(accessToken, `/calendars/primary/events/${encodeURIComponent(existing.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
    }

    return googleCalendarRequest(accessToken, "/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  async function createGoogleCalendarEvents({ schedule, employeeId, accessToken }) {
    if (!accessToken) {
      throw new Error("Google authorization failed. Please sign in again.");
    }
    const events = shiftsForEmployee(schedule, employeeId);
    if (!events.length) {
      throw new Error("No shifts found for this employee");
    }

    const createdEvents = readCreatedEvents();
    const existing = events.filter(event => createdEvents[event.key]);
    const results = [];

    for (const event of events) {
      const googleEvent = await upsertGoogleEvent(accessToken, event, createdEvents);
      createdEvents[event.key] = {
        eventId: event.key,
        googleEventId: googleEvent.id,
        scheduleId: event.scheduleId,
        employeeId: event.employeeId,
        date: event.date,
        role: event.role,
        calendarAccount: "primary",
        updatedAt: new Date().toISOString()
      };
      results.push(googleEvent);
    }
    writeCreatedEvents(createdEvents);

    return {
      events,
      googleEvents: results,
      existingCount: existing.length,
      createdCount: events.length - existing.length
    };
  }

  async function exportCalendarFile({ schedule, employeeId, calendarEmail }) {
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
    createGoogleCalendarEvents,
    exportCalendarFile
  };
})();
