(function () {
  const CALENDAR_WARNING = "ספריית החגים המקומית לא נטענה, הסידור נבנה לפי ימים רגילים בלבד.";

  function calendarStatusLabel(status) {
    if (status === "holiday") return "חג";
    if (status === "holidayEve") return "ערב חג";
    if (status === "off") return "לא משובץ";
    return "";
  }

  function getHebcalEvents(date, state) {
    if (state?.calendar) state.calendar.warning = "";
    const core = window.hebcal;
    if (!core?.getHolidaysOnDate || !core?.flags) {
      if (state?.calendar) state.calendar.warning = CALENDAR_WARNING;
      return [];
    }
    try {
      return core.getHolidaysOnDate(date, true) || [];
    } catch (error) {
      if (state?.calendar) state.calendar.warning = CALENDAR_WARNING;
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

  function isDeliveryDay(date, state) {
    const dayIndex = date.getDay();
    if (dayIndex === 6) return false;

    const core = window.hebcal;
    const flags = core?.flags || {};
    const events = getHebcalEvents(date, state);
    const hasFlag = (event, flag) => Boolean(flag && event.getFlags && (event.getFlags() & flag));
    const getDesc = event => event.render?.("he-x-NoNikud") || event.getDesc?.() || "חג";
    const normalizeEventText = text => String(text || "")
      .normalize("NFKD")
      .replace(/[\u0591-\u05C7]/g, "")
      .replace(/[’‘`´״׳]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    const getEventText = event => normalizeEventText(`${event.getDesc?.() || ""} ${getDesc(event)}`);
    const isTishaBAv = event => /Tish'?a B'?Av|תשעה באב/i.test(getEventText(event));
    const isWorkdayHolidayEvent = event => isTishaBAv(event);
    const isIsraeliHoliday = event => {
      const desc = getEventText(event);
      return /Yom HaAtzma|יום העצמאות|Yom Yerushalayim|יום ירושלים/i.test(desc);
    };
    const isHoliday = event => (hasFlag(event, flags.CHAG) || isIsraeliHoliday(event)) && !isWorkdayHolidayEvent(event);

    const holiday = events.find(isHoliday);
    return !holiday;
  }

  function getDayType(date, helpers) {
    const dayIndex = date.getDay();
    const core = window.hebcal;
    const flags = core?.flags || {};
    const events = getHebcalEvents(date, helpers.state);
    const hasFlag = (event, flag) => Boolean(flag && event.getFlags && (event.getFlags() & flag));
    const getDesc = event => event.render?.("he-x-NoNikud") || event.getDesc?.() || "חג";
    const normalizeEventText = text => String(text || "")
      .normalize("NFKD")
      .replace(/[\u0591-\u05C7]/g, "")
      .replace(/[’‘`´״׳]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    const getEventText = event => normalizeEventText(`${event.getDesc?.() || ""} ${getDesc(event)}`);
    const isEve = event => hasFlag(event, flags.EREV) || /^Erev\b/i.test(event.getDesc?.() || "") || /ערב/.test(getDesc(event));
    const isTishaBAv = event => /Tish'?a B'?Av|תשעה באב/i.test(getEventText(event));
    const isWorkdayHolidayEvent = event => isTishaBAv(event);
    const isIsraeliHoliday = event => {
      const desc = getEventText(event);
      return /Yom HaAtzma|יום העצמאות|Yom Yerushalayim|יום ירושלים/i.test(desc);
    };
    const isHoliday = event => (hasFlag(event, flags.CHAG) || isIsraeliHoliday(event)) && !isWorkdayHolidayEvent(event);

    const todayHoliday = events.find(isHoliday);
    const todayHolidayEve = events.find(event => isEve(event) && !isWorkdayHolidayEvent(event));
    const todayWorkdayHoliday = events.find(isWorkdayHolidayEvent);

    const nextDate = helpers.addDays(date, 1);
    const hasNextDayDelivery = isDeliveryDay(nextDate, helpers.state);
    const nextDayEvents = getHebcalEvents(nextDate, helpers.state);
    const nextDayHoliday = nextDayEvents.find(isHoliday);

    if (dayIndex === 5) {
      if (todayHolidayEve) {
        return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(todayHolidayEve) }, helpers);
      }
      if (todayHoliday) {
        return calendarDebug(date, events, { status: "holiday", isWorkday: false, reason: "חג", title: getDesc(todayHoliday) }, helpers);
      }
      return calendarDebug(date, events, { status: "off", isWorkday: false, reason: "יום שישי" }, helpers);
    }

    if (hasNextDayDelivery) {
      if (todayHoliday) {
        return calendarDebug(date, events, { status: "holiday", isWorkday: true, reason: "חג", title: getDesc(todayHoliday) }, helpers);
      }
      if (todayWorkdayHoliday) {
        const title = getDesc(todayWorkdayHoliday);
        return calendarDebug(date, events, {
          status: "workday",
          isWorkday: true,
          reason: "יום רגיל",
          title,
          infoLabel: title,
          isCalendarInfoOnly: true
        }, helpers);
      }
      return calendarDebug(date, events, { status: "workday", isWorkday: true, reason: "יום רגיל" }, helpers);
    }

    if (todayHoliday) {
      return calendarDebug(date, events, { status: "holiday", isWorkday: false, reason: "חג", title: getDesc(todayHoliday) }, helpers);
    }
    if (todayHolidayEve) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(todayHolidayEve) }, helpers);
    }
    if (nextDayHoliday) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(nextDayHoliday) }, helpers);
    }

    return calendarDebug(date, events, { status: "off", isWorkday: false, reason: "אין משמרת" }, helpers);
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

  function holidayShiftDisplayTitle(title) {
    const cleanTitle = String(title || "")
      .normalize("NFKD")
      .replace(/[\u0591-\u05C7]/g, "")
      .replace(/[’‘`´״׳]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (/^Rosh Hashana\b/i.test(cleanTitle) || /^ראש השנה/.test(cleanTitle)) return "ראש השנה";
    if (/^Yom Kippur\b/i.test(cleanTitle) || /^יום כיפור|^יום הכיפורים/.test(cleanTitle)) return "יום כיפור";
    if (/^Sukkot\b/i.test(cleanTitle) || /^סוכות/.test(cleanTitle)) return "סוכות";
    if (/^Pesach VII\b/i.test(cleanTitle) || /^פסח\s+ז/.test(cleanTitle)) return "שביעי של פסח";
    if (/^Pesach\b/i.test(cleanTitle) || /^פסח/.test(cleanTitle)) return "פסח";
    if (/^Shavuot\b/i.test(cleanTitle) || /^שבועות/.test(cleanTitle)) return "שבועות";
    if (/^Shmini Atzeret\b/i.test(cleanTitle) || /^שמיני עצרת/.test(cleanTitle)) return "שמיני עצרת";
    if (/^Simchat Torah\b/i.test(cleanTitle) || /^שמחת תורה/.test(cleanTitle)) return "שמחת תורה";
    return cleanTitle;
  }

  function holidayClosedReason(dayType) {
    const title = String(dayType?.title || "").trim();
    if (dayType?.status === "holidayEve") {
      const cleanTitle = holidayEveDisplayTitle(title);
      return `ערב${cleanTitle ? ` ${cleanTitle}` : " חג"} אין משמרת`;
    }
    if (dayType?.status === "holiday") {
      const cleanTitle = holidayShiftDisplayTitle(title);
      return `${cleanTitle || "חג"} אין משמרת`;
    }
    if (dayType?.status === "off") return "אין משמרת";
    return "";
  }

  function closedDayReason(day) {
    if (day.dayType?.status === "holidayEve" || day.dayType?.status === "holiday") {
      return holidayClosedReason(day.dayType);
    }
    return day.label || "אין משמרת";
  }

  window.calendarRules = {
    calendarStatusLabel,
    isDeliveryDay,
    getDayType,
    holidayEveDisplayTitle,
    holidayShiftDisplayTitle,
    holidayClosedReason,
    closedDayReason
  };
})();
