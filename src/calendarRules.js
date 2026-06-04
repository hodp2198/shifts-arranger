(function () {
  const CALENDAR_WARNING = "ספריית החגים המקומית לא נטענה, הסידור נבנה לפי ימים רגילים בלבד.";

  function calendarStatusLabel(status) {
    if (status === "holiday") return "חג";
    if (status === "holidayEve") return "ערב חג";
    if (status === "off") return "לא משובץ";
    return "";
  }

  function getHebcalEvents(date, state) {
    state.calendar.warning = "";
    const core = window.hebcal;
    if (!core?.getHolidaysOnDate || !core?.flags) {
      state.calendar.warning = CALENDAR_WARNING;
      return [];
    }
    try {
      return core.getHolidaysOnDate(date, true) || [];
    } catch (error) {
      state.calendar.warning = CALENDAR_WARNING;
      return [];
    }
  }

  function calendarDebug(date, events, result, helpers) {
    const core = window.hebcal;
    let hebrew = "";
    try {
      hebrew = core?.HDate ? new core.HDate(date).render("he-x-NoNikud") : "";
    } catch (error) {
      hebrew = "";
    }
    console.info("[calendar]", {
      date: helpers.isoDate(date),
      gregorian: helpers.displayDate(date),
      hebrew,
      events: (events || []).map(event => ({
        desc: event.getDesc?.() || "",
        hebrew: event.render?.("he-x-NoNikud") || "",
        flags: event.getFlags?.() || 0
      })),
      isHoliday: result.status === "holiday",
      isHolidayEve: result.status === "holidayEve",
      isClosed: !result.isWorkday,
      reason: result.title || result.reason || ""
    });
    return result;
  }

  function getDayType(date, helpers) {
    const dayIndex = date.getDay();
    if (dayIndex === 5) {
      return calendarDebug(date, getHebcalEvents(date, helpers.state), { status: "off", isWorkday: false, reason: "יום שישי" }, helpers);
    }

    const core = window.hebcal;
    const flags = core?.flags || {};
    const events = getHebcalEvents(date, helpers.state);
    const hasFlag = (event, flag) => Boolean(flag && event.getFlags && (event.getFlags() & flag));
    const getDesc = event => event.render?.("he-x-NoNikud") || event.getDesc?.() || "חג";
    const isEve = event => hasFlag(event, flags.EREV) || /^Erev\b/i.test(event.getDesc?.() || "") || /ערב/.test(getDesc(event));
    const isIsraeliHoliday = event => {
      const desc = `${event.getDesc?.() || ""} ${getDesc(event)}`;
      return hasFlag(event, flags.MODERN_HOLIDAY)
        || /Yom HaAtzma|יום העצמאות|Yom Yerushalayim|יום ירושלים/i.test(desc);
    };
    const isIsraeliClosedEveTarget = event => {
      const desc = `${event.getDesc?.() || ""} ${getDesc(event)}`;
      return /Yom HaAtzma|יום העצמאות|Yom Yerushalayim|יום ירושלים/i.test(desc);
    };
    const isJewishHoliday = event => hasFlag(event, flags.CHAG);
    const isHoliday = event => hasFlag(event, flags.CHAG) || isIsraeliHoliday(event);

    const holidayEve = events.find(isEve);
    if (holidayEve) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(holidayEve) }, helpers);
    }

    const nextDayEvents = getHebcalEvents(helpers.addDays(date, 1), helpers.state);
    const nextDayHolidayEve = dayIndex === 4 ? nextDayEvents.find(isEve) : null;
    if (nextDayHolidayEve) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(nextDayHolidayEve) }, helpers);
    }

    const nextDayHoliday = nextDayEvents.find(isIsraeliClosedEveTarget);
    if (nextDayHoliday) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(nextDayHoliday) }, helpers);
    }

    const todayIsJewishHoliday = events.some(isJewishHoliday);
    const nextDayJewishHoliday = nextDayEvents.find(isJewishHoliday);
    if (!todayIsJewishHoliday && dayIndex !== 6 && nextDayJewishHoliday) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(nextDayJewishHoliday) }, helpers);
    }

    const holiday = events.find(isHoliday);
    if (holiday) {
      return calendarDebug(date, events, { status: "holiday", isWorkday: true, reason: "חג", title: getDesc(holiday) }, helpers);
    }

    return calendarDebug(date, events, { status: "workday", isWorkday: true, reason: "יום רגיל" }, helpers);
  }

  function holidayEveDisplayTitle(title) {
    const cleanTitle = String(title || "")
      .replace(/^Erev\s+/i, "")
      .replace(/^ערב\s+(חג\s+)?/, "")
      .trim();
    if (/^Pesach VII\b/i.test(cleanTitle) || /^פסח\s+ז/.test(cleanTitle)) {
      return "שביעי של פסח";
    }
    return cleanTitle;
  }

  function holidayClosedReason(dayType) {
    const title = String(dayType?.title || "").trim();
    if (dayType?.status === "holidayEve") {
      const cleanTitle = holidayEveDisplayTitle(title);
      return `ערב${cleanTitle ? ` ${cleanTitle}` : " חג"} אין משמרת`;
    }
    if (dayType?.status === "off") return "אין משמרת";
    return "";
  }

  function closedDayReason(day) {
    if (day.dayType?.status === "holidayEve") {
      return holidayClosedReason(day.dayType);
    }
    return day.label || "אין משמרת";
  }

  window.calendarRules = {
    calendarStatusLabel,
    getDayType,
    holidayEveDisplayTitle,
    holidayClosedReason,
    closedDayReason
  };
})();
