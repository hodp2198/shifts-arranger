(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root && typeof root === "object") {
    root.calendarRules = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  const CALENDAR_WARNING = "ספריית החגים המקומית לא נטענה, הסידור נבנה לפי ימים רגילים בלבד.";

  function defaultIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function defaultDisplayDate(date) {
    return `${date.getDate()}.${date.getMonth() + 1}`;
  }

  function defaultAddDays(date, amount) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12);
  }

  function getHebcalCore(helpers) {
    return helpers?.hebcal || root?.hebcal || globalThis?.hebcal || null;
  }

  function calendarStatusLabel(status) {
    if (status === "holiday") return "חג";
    if (status === "holidayEve") return "ערב חג";
    if (status === "off") return "לא משובץ";
    return "";
  }

  function getHebcalEvents(date, state, helpers) {
    if (state?.calendar) state.calendar.warning = "";
    const core = getHebcalCore(helpers);
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
    const core = getHebcalCore(helpers);
    const isoDate = helpers?.isoDate || defaultIsoDate;
    const displayDate = helpers?.displayDate || defaultDisplayDate;
    let hebrew = "";
    try {
      hebrew = core?.HDate ? new core.HDate(date).render("he-x-NoNikud") : "";
    } catch (error) {
      hebrew = "";
    }
    console.info("[calendar]", {
      date: isoDate(date),
      gregorian: displayDate(date),
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

  function getDayType(date, helpers = {}) {
    const addDays = helpers.addDays || defaultAddDays;
    const state = helpers.state;
    const dayIndex = date.getDay();
    if (dayIndex === 5) {
      return calendarDebug(date, getHebcalEvents(date, state, helpers), { status: "off", isWorkday: false, reason: "יום שישי" }, helpers);
    }

    const core = getHebcalCore(helpers);
    const flags = core?.flags || {};
    const events = getHebcalEvents(date, state, helpers);
    const hasFlag = (event, flag) => Boolean(flag && event.getFlags && (event.getFlags() & flag));
    const getDesc = event => event.render?.("he-x-NoNikud") || event.getDesc?.() || "חג";
    const normalizeEventText = text => String(text || "")
      .normalize("NFKD")
      .replace(/[\u0591-\u05C7]/g, "")
      .replace(/[’‘`´״׳]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    const getEventText = event => normalizeEventText(`${event.getDesc?.() || ""} ${getDesc(event)}`);

    // Strict restrictive-holiday classification (only Yom Tov / Assur B'Melacha + Yom HaAtzma'ut).
    const isRestrictiveJewishHoliday = event => hasFlag(event, flags.CHAG);
    const isRestrictiveIsraeliHoliday = event => /Yom HaAtzma|יום העצמאות/i.test(getEventText(event));
    const isRestrictiveHoliday = event => isRestrictiveJewishHoliday(event) || isRestrictiveIsraeliHoliday(event);

    const nonRestrictiveMask = (flags.MINOR_HOLIDAY || 0)
      | (flags.CHANUKAH_CANDLES || 0)
      | (flags.MINOR_FAST || 0)
      | (flags.MAJOR_FAST || 0)
      | (flags.MODERN_HOLIDAY || 0);
    const isRestrictiveExplicitEve = event => (
      !hasFlag(event, nonRestrictiveMask)
      && hasFlag(event, flags.EREV)
      && hasFlag(event, flags.LIGHT_CANDLES)
    );
    const isFridayDerivedChagEve = event => (
      hasFlag(event, flags.CHOL_HAMOED)
      && hasFlag(event, flags.LIGHT_CANDLES)
      && /Hoshana Raba|הושענא רבה|Pesach VI|פסח ו/i.test(getEventText(event))
    );

    const isTishaBAv = event => /Tish'?a B'?Av|תשעה באב/i.test(getEventText(event));
    const informationalEventPriority = event => {
      if (isTishaBAv(event)) return 1;
      if (hasFlag(event, flags.CHANUKAH_CANDLES) || /Chanukah|חנוכה/i.test(getEventText(event))) return 2;
      if (/Purim|פורים/i.test(getEventText(event))) return 3;
      if (hasFlag(event, flags.CHOL_HAMOED)) return 4;
      if (hasFlag(event, flags.MODERN_HOLIDAY) && !isRestrictiveIsraeliHoliday(event)) return 5;
      if (hasFlag(event, flags.MINOR_HOLIDAY) && !/Chag HaBanot|Leil Selichot|Rosh Hashana LaBehemot|חג הבנות|סליחות|למעשר בהמה/i.test(getEventText(event))) return 6;
      if (hasFlag(event, flags.MINOR_FAST) && !hasFlag(event, (flags.YOM_KIPPUR_KATAN || 0) | (flags.BEHAB || 0))) return 7;
      if (hasFlag(event, flags.MINOR_HOLIDAY)) return 8;
      return 0;
    };

    const holidayEve = events.find(isRestrictiveExplicitEve);
    if (holidayEve) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(holidayEve) }, helpers);
    }

    const nextDayEvents = getHebcalEvents(addDays(date, 1), state, helpers);
    const nextDayIsraeliHoliday = nextDayEvents.find(isRestrictiveIsraeliHoliday);
    if (nextDayIsraeliHoliday) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(nextDayIsraeliHoliday) }, helpers);
    }

    const todayIsRestrictiveJewishHoliday = events.some(isRestrictiveJewishHoliday);
    const nextDayJewishHoliday = nextDayEvents.find(isRestrictiveJewishHoliday);
    if (!todayIsRestrictiveJewishHoliday && dayIndex !== 6 && nextDayJewishHoliday) {
      return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(nextDayJewishHoliday) }, helpers);
    }

    if (!todayIsRestrictiveJewishHoliday && dayIndex === 4) {
      const nextDayHolidayEve = nextDayEvents.find(isRestrictiveExplicitEve);
      if (nextDayHolidayEve) {
        return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(nextDayHolidayEve) }, helpers);
      }

      if (nextDayEvents.some(isFridayDerivedChagEve)) {
        const saturdayEvents = getHebcalEvents(addDays(date, 2), state, helpers);
        const saturdayJewishHoliday = saturdayEvents.find(isRestrictiveJewishHoliday);
        if (saturdayJewishHoliday) {
          return calendarDebug(date, events, { status: "holidayEve", isWorkday: false, reason: "ערב חג", title: getDesc(saturdayJewishHoliday) }, helpers);
        }
      }
    }

    const holiday = events.find(isRestrictiveHoliday);
    if (holiday) {
      const nextDayHasRestrictiveHoliday = nextDayEvents.some(isRestrictiveHoliday);
      if (nextDayHasRestrictiveHoliday) {
        return calendarDebug(date, events, { status: "holiday", isWorkday: false, reason: "חג", title: getDesc(holiday) }, helpers);
      }
      return calendarDebug(date, events, { status: "holiday", isWorkday: true, reason: "חג", title: getDesc(holiday) }, helpers);
    }

    const infoEvents = events
      .map(event => ({ event, priority: informationalEventPriority(event) }))
      .filter(item => item.priority > 0)
      .sort((a, b) => a.priority - b.priority);
    if (infoEvents.length) {
      const title = getDesc(infoEvents[0].event);
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
    if (dayType?.status === "holiday" && dayType?.isWorkday === false) {
      const holidayTitle = holidayShiftDisplayTitle(title);
      return `חג${holidayTitle ? ` ${holidayTitle}` : ""} אין משמרת`;
    }
    if (dayType?.status === "holidayEve") {
      const cleanTitle = holidayEveDisplayTitle(title);
      return `ערב${cleanTitle ? ` ${cleanTitle}` : " חג"} אין משמרת`;
    }
    if (dayType?.status === "off") return "אין משמרת";
    return "";
  }

  function closedDayReason(day) {
    if (day.dayType?.status === "holidayEve" || (day.dayType?.status === "holiday" && day.dayType?.isWorkday === false)) {
      return holidayClosedReason(day.dayType);
    }
    return day.label || "אין משמרת";
  }

  return {
    calendarStatusLabel,
    getDayType,
    holidayEveDisplayTitle,
    holidayShiftDisplayTitle,
    holidayClosedReason,
    closedDayReason
  };
});
