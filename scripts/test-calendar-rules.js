const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const WorkerAvailability = require("../src/workerAvailability.js");
const ConstraintParser = require("../src/constraintParser.js");
const calendarRules = require("../src/calendarRules.js");

const hebcalCode = fs.readFileSync(path.join(__dirname, "..", "vendor", "hebcal-core.min.js"), "utf8");
global.window = global;
vm.runInThisContext(`${hebcalCode}; window.hebcal = hebcal;`);

const isoDate = date => (
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
);
const displayDate = date => `${date.getDate()}.${date.getMonth() + 1}`;
const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12);
const localNoon = (year, month, day) => new Date(year, month - 1, day, 12);

function evaluateDate(year, month, day) {
  const state = { calendar: { warning: "" } };
  const origInfo = console.info;
  console.info = () => {};
  try {
    return calendarRules.getDayType(localNoon(year, month, day), {
      state,
      isoDate,
      displayDate,
      addDays,
      hebcal: window.hebcal
    });
  } finally {
    console.info = origInfo;
  }
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (error) {
    console.error(`  [FAIL] ${name}`);
    console.error(error);
    failed++;
  }
}

if (process.argv[2] === "--tz-probe") {
  const probes = [
    [2026, 12, 3],
    [2026, 12, 4],
    [2026, 12, 5],
    [2026, 3, 27],
    [2026, 3, 29],
    [2026, 4, 1],
    [2026, 4, 2],
    [2026, 10, 1],
    [2026, 10, 3],
    [2026, 10, 25]
  ].map(([y, m, d]) => ({
    iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    res: evaluateDate(y, m, d)
  }));
  process.stdout.write(JSON.stringify(probes));
  process.exit(0);
}

console.log("===============================================================================");
console.log("STARTING TEST SUITE: Holiday & Hebrew/Gregorian Calendar Rules");
console.log("===============================================================================\n");

console.log("--- Group 1: December 2026 Hanukkah Regression ---");

test("1.1 Thursday Dec 3, 2026 (23 Kislev) is a regular open workday", () => {
  const res = evaluateDate(2026, 12, 3);
  assert.strictEqual(res.status, "workday");
  assert.strictEqual(res.isWorkday, true);
  assert.strictEqual(res.reason, "יום רגיל");
  assert.strictEqual(Boolean(res.isCalendarInfoOnly), false);
});

test("1.2 Friday Dec 4, 2026 (24 Kislev, Hanukkah 1st candle) is closed solely as Friday", () => {
  const res = evaluateDate(2026, 12, 4);
  assert.strictEqual(res.status, "off");
  assert.strictEqual(res.isWorkday, false);
  assert.strictEqual(res.reason, "יום שישי");
});

test("1.3 Hanukkah Dec 5-12, 2026 remains open on all non-Friday days with info badges", () => {
  for (let day = 5; day <= 12; day++) {
    const dt = localNoon(2026, 12, day);
    const res = evaluateDate(2026, 12, day);
    if (dt.getDay() === 5) {
      assert.strictEqual(res.status, "off", `2026-12-${day} is Friday`);
      assert.strictEqual(res.isWorkday, false);
    } else {
      assert.strictEqual(res.status, "workday", `2026-12-${day} must be open workday`);
      assert.strictEqual(res.isWorkday, true);
      assert.strictEqual(res.isCalendarInfoOnly, true);
      assert.ok(res.infoLabel && res.infoLabel.includes("חנוכה"), `2026-12-${day} infoLabel should mention חנוכה, got ${res.infoLabel}`);
    }
  }
});

test("1.4 Non-Friday 24 Kislev (Hanukkah 1st candle) in 2023-2025 remains open with info badge", () => {
  for (const [y, m, d] of [[2023, 12, 7], [2024, 12, 25], [2025, 12, 14]]) {
    const res = evaluateDate(y, m, d);
    assert.strictEqual(res.status, "workday", `${y}-${m}-${d} must be workday`);
    assert.strictEqual(res.isWorkday, true);
    assert.strictEqual(res.isCalendarInfoOnly, true);
    assert.ok(res.infoLabel.includes("חנוכה"));
  }
});

console.log("\n--- Group 2: Purim, Jerusalem Day, and Non-Restrictive Holidays ---");

test("2.1 Erev Purim, Purim, Shushan Purim, and Purim Katan stay open with info badges", () => {
  for (const [y, m, d] of [[2026, 3, 2], [2026, 3, 3], [2026, 3, 4], [2027, 3, 22], [2027, 2, 21]]) {
    const res = evaluateDate(y, m, d);
    assert.strictEqual(res.status, "workday", `${y}-${m}-${d} must be workday`);
    assert.strictEqual(res.isWorkday, true);
    assert.strictEqual(res.isCalendarInfoOnly, true);
    assert.ok(res.infoLabel.includes("פורים"));
  }
});

test("2.2 Jerusalem Day and its preceding day never close shifts", () => {
  // 2026-05-15 is Friday -> closed as Friday; 2026-05-14 Thu must stay open!
  const thuBefore2026 = evaluateDate(2026, 5, 14);
  assert.strictEqual(thuBefore2026.status, "workday");
  assert.strictEqual(thuBefore2026.isWorkday, true);

  const fri2026 = evaluateDate(2026, 5, 15);
  assert.strictEqual(fri2026.status, "off");
  assert.strictEqual(fri2026.reason, "יום שישי");

  // 2027-06-03 Thu before Fri 2027-06-04 Yom Yerushalayim
  const thuBefore2027 = evaluateDate(2027, 6, 3);
  assert.strictEqual(thuBefore2027.status, "workday");
  assert.strictEqual(thuBefore2027.isWorkday, true);

  // 2024-06-04 Tue before Wed 2024-06-05 Yom Yerushalayim
  const eve2024 = evaluateDate(2024, 6, 4);
  assert.strictEqual(eve2024.status, "workday");
  assert.strictEqual(eve2024.isWorkday, true);

  const day2024 = evaluateDate(2024, 6, 5);
  assert.strictEqual(day2024.status, "workday");
  assert.strictEqual(day2024.isWorkday, true);
  assert.strictEqual(day2024.isCalendarInfoOnly, true);
  assert.strictEqual(day2024.infoLabel, "יום ירושלים");
});

test("2.3 Tish'a B'Av, minor fasts, Tu BiShvat, Lag BaOmer, Chol HaMoed, and Yom HaShoah remain open", () => {
  const cases = [
    [2026, 2, 2, "ט״ו בשבט"],
    [2026, 4, 5, "פסח"],
    [2026, 4, 14, "יום השואה"],
    [2026, 5, 5, "ל״ג בעומר"],
    [2026, 7, 22, "תשעה באב"],
    [2026, 7, 23, "תשעה באב"],
    [2026, 12, 20, "עשרה בטבת"]
  ];
  for (const [y, m, d, expected] of cases) {
    const res = evaluateDate(y, m, d);
    assert.strictEqual(res.status, "workday", `${y}-${m}-${d} must remain workday`);
    assert.strictEqual(res.isWorkday, true);
    assert.strictEqual(res.isCalendarInfoOnly, true);
    assert.ok(res.infoLabel.includes(expected), `${y}-${m}-${d} expected '${expected}' in '${res.infoLabel}'`);
  }
});

test("2.4 Strict eve predicate ignores arbitrary EREV flag or 'ערב' text on minor events", () => {
  const fakeMinorErev = {
    getDesc: () => "Erev Something Minor",
    render: () => "ערב משהו קל",
    getFlags: () => window.hebcal.flags.EREV | window.hebcal.flags.MINOR_HOLIDAY
  };
  const mockHebcal = {
    flags: window.hebcal.flags,
    HDate: window.hebcal.HDate,
    getHolidaysOnDate: date => (isoDate(date) === "2026-08-10" ? [fakeMinorErev] : [])
  };
  const origInfo = console.info;
  console.info = () => {};
  try {
    const res = calendarRules.getDayType(localNoon(2026, 8, 10), {
      state: { calendar: { warning: "" } },
      isoDate,
      displayDate,
      addDays,
      hebcal: mockHebcal
    });
    assert.strictEqual(res.isWorkday, true);
    assert.strictEqual(res.status, "workday");
  } finally {
    console.info = origInfo;
  }
});

console.log("\n--- Group 3: Informational Badges Do Not Affect Availability or Shift Generation ---");

test("3.1 Informational holiday days stay open in availability & schedule day building", () => {
  const weekConfigs = [{ start: localNoon(2026, 11, 29), end: localNoon(2026, 12, 5) }];
  const scheduleDays = [0, 1, 2, 3, 4, 6].map(dayIndex => {
    const date = addDays(weekConfigs[0].start, dayIndex);
    const dayType = evaluateDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return {
      date,
      iso: isoDate(date),
      dayIndex,
      week: 0,
      dayType,
      closed: !dayType.isWorkday
    };
  });

  // Dec 3 (Thu) and Dec 5 (Sat, Hanukkah 2 Candles) must both be open for scheduling
  const dec3 = scheduleDays.find(d => d.iso === "2026-12-03");
  const dec5 = scheduleDays.find(d => d.iso === "2026-12-05");
  assert.strictEqual(dec3.closed, false);
  assert.strictEqual(dec5.closed, false);
  assert.strictEqual(dec5.dayType.isCalendarInfoOnly, true);

  const parsed = ConstraintParser.parseWorkerConstraints("א - יכול\nה - יכול\nשבת - יכולה", {
    weekConfigs,
    workerName: "דני"
  });
  const availability = WorkerAvailability.createWorkerAvailability({ workerName: "דני" });
  WorkerAvailability.populateAvailabilityFromParsed(availability, parsed, scheduleDays);

  assert.strictEqual(WorkerAvailability.isDayOpen(availability, "2026-12-03"), true);
  assert.strictEqual(WorkerAvailability.isDayOpen(availability, "2026-12-05"), true);
  assert.strictEqual(availability.blocked.has("2026-12-03"), false);
  assert.strictEqual(availability.blocked.has("2026-12-05"), false);
});

console.log("\n--- Group 4: Restrictive Holidays, Eves, Consecutive Holidays & Lookahead ---");

test("4.1 Pesach, Shavuot, and Yom Kippur follow delivery-based eve closure and holiday workday", () => {
  const erevPesach = evaluateDate(2026, 4, 1);
  assert.strictEqual(erevPesach.status, "holidayEve");
  assert.strictEqual(erevPesach.isWorkday, false);

  const pesach1 = evaluateDate(2026, 4, 2);
  assert.strictEqual(pesach1.status, "holiday");
  assert.strictEqual(pesach1.isWorkday, true);
  assert.strictEqual(calendarRules.holidayShiftDisplayTitle(pesach1.title), "פסח");

  const pesach6 = evaluateDate(2026, 4, 7);
  assert.strictEqual(pesach6.status, "holidayEve");
  assert.strictEqual(pesach6.isWorkday, false);
  assert.strictEqual(calendarRules.holidayClosedReason(pesach6), "ערב שביעי של פסח אין משמרת");

  const pesach7 = evaluateDate(2026, 4, 8);
  assert.strictEqual(pesach7.status, "holiday");
  assert.strictEqual(pesach7.isWorkday, true);
  assert.strictEqual(calendarRules.holidayShiftDisplayTitle(pesach7.title), "שביעי של פסח");

  const erevYomKippur = evaluateDate(2026, 9, 20);
  assert.strictEqual(erevYomKippur.status, "holidayEve");
  assert.strictEqual(erevYomKippur.isWorkday, false);

  const yomKippur = evaluateDate(2026, 9, 21);
  assert.strictEqual(yomKippur.status, "holiday");
  assert.strictEqual(yomKippur.isWorkday, true);

  const erevShavuot = evaluateDate(2026, 5, 21);
  assert.strictEqual(erevShavuot.status, "holidayEve");
  assert.strictEqual(erevShavuot.isWorkday, false);
  const shavuotFri = evaluateDate(2026, 5, 22);
  assert.strictEqual(shavuotFri.status, "off");
  assert.strictEqual(shavuotFri.isWorkday, false);
});

test("4.2 Yom HaAtzma'ut and Yom HaZikaron preserve restrictive Independence Day rules", () => {
  const zikaron = evaluateDate(2026, 4, 21);
  assert.strictEqual(zikaron.status, "holidayEve");
  assert.strictEqual(zikaron.isWorkday, false);
  assert.strictEqual(calendarRules.holidayClosedReason(zikaron), "ערב יום העצמאות אין משמרת");

  const atzmaut = evaluateDate(2026, 4, 22);
  assert.strictEqual(atzmaut.status, "holiday");
  assert.strictEqual(atzmaut.isWorkday, true);
});

test("4.3 Consecutive restrictive holidays (Rosh Hashana I -> II and generic pairs) follow next-day delivery rules", () => {
  // Mon/Tue (2025): Mon Erev RH closed -> Tue RH I closed (no delivery Wed) -> Wed RH II open (delivers Thu)
  assert.strictEqual(evaluateDate(2025, 9, 22).status, "holidayEve");
  const rh1Tue = evaluateDate(2025, 9, 23);
  assert.strictEqual(rh1Tue.status, "holiday");
  assert.strictEqual(rh1Tue.isWorkday, false);
  assert.strictEqual(calendarRules.holidayClosedReason(rh1Tue), "חג ראש השנה אין משמרת");
  assert.notStrictEqual(rh1Tue.status, "holidayEve");
  const rh2Wed = evaluateDate(2025, 9, 24);
  assert.strictEqual(rh2Wed.status, "holiday");
  assert.strictEqual(rh2Wed.isWorkday, true);

  // Sat/Sun (2026): Sat RH I closed (no delivery Sun RH II) -> Sun RH II open (delivers Mon)
  const rh1Sat = evaluateDate(2026, 9, 12);
  assert.strictEqual(rh1Sat.status, "holiday");
  assert.strictEqual(rh1Sat.isWorkday, false);
  assert.strictEqual(calendarRules.closedDayReason({ dayType: rh1Sat }), "חג ראש השנה אין משמרת");
  const rh2Sun = evaluateDate(2026, 9, 13);
  assert.strictEqual(rh2Sun.status, "holiday");
  assert.strictEqual(rh2Sun.isWorkday, true);

  // Thu/Fri (2024): Wed Erev RH closed -> Thu RH I closed (no delivery Fri RH II) -> Fri RH II off (Friday)
  assert.strictEqual(evaluateDate(2024, 10, 2).status, "holidayEve");
  const rh1Thu = evaluateDate(2024, 10, 3);
  assert.strictEqual(rh1Thu.status, "holiday");
  assert.strictEqual(rh1Thu.isWorkday, false);
  assert.strictEqual(calendarRules.holidayClosedReason(rh1Thu), "חג ראש השנה אין משמרת");
  const rh2Fri = evaluateDate(2024, 10, 4);
  assert.strictEqual(rh2Fri.status, "off");
  assert.strictEqual(rh2Fri.isWorkday, false);
  assert.strictEqual(rh2Fri.reason, "יום שישי");

  // Generic consecutive restrictive holidays (not hardcoded to Rosh Hashana)
  const makeChag = (desc, he) => ({
    getDesc: () => desc,
    render: () => he,
    getFlags: () => window.hebcal.flags.CHAG
  });
  const mockHebcal = {
    flags: window.hebcal.flags,
    HDate: window.hebcal.HDate,
    getHolidaysOnDate: date => {
      const iso = isoDate(date);
      if (iso === "2026-06-15") return [makeChag("Pesach I", "פסח א׳")];
      if (iso === "2026-06-16") return [makeChag("Shavuot", "שבועות")];
      return [];
    }
  };
  const origInfo = console.info;
  console.info = () => {};
  try {
    const day1 = calendarRules.getDayType(localNoon(2026, 6, 15), { state: { calendar: { warning: "" } }, isoDate, displayDate, addDays, hebcal: mockHebcal });
    const day2 = calendarRules.getDayType(localNoon(2026, 6, 16), { state: { calendar: { warning: "" } }, isoDate, displayDate, addDays, hebcal: mockHebcal });
    assert.strictEqual(day1.status, "holiday");
    assert.strictEqual(day1.isWorkday, false);
    assert.strictEqual(calendarRules.holidayClosedReason(day1), "חג פסח אין משמרת");
    assert.strictEqual(day2.status, "holiday");
    assert.strictEqual(day2.isWorkday, true);
  } finally {
    console.info = origInfo;
  }
});

test("4.4 Thursday-to-Friday lookahead closes Thu for Friday Erev Chag AND Friday Hoshana Raba / Pesach VI", () => {
  // Thu before Fri Erev Rosh Hashana
  const thuBeforeRH = evaluateDate(2026, 9, 10);
  assert.strictEqual(thuBeforeRH.status, "holidayEve");
  assert.strictEqual(thuBeforeRH.isWorkday, false);

  // Thu before Fri Erev Sukkot
  const thuBeforeSukkot = evaluateDate(2026, 9, 24);
  assert.strictEqual(thuBeforeSukkot.status, "holidayEve");
  assert.strictEqual(thuBeforeSukkot.isWorkday, false);

  // Thu before Fri Hoshana Raba -> Sat Shmini Atzeret (2026-10-01 -> 2026-10-02 -> 2026-10-03)
  const thuBeforeHoshana = evaluateDate(2026, 10, 1);
  assert.strictEqual(thuBeforeHoshana.status, "holidayEve");
  assert.strictEqual(thuBeforeHoshana.isWorkday, false);
  assert.strictEqual(calendarRules.holidayClosedReason(thuBeforeHoshana), "ערב שמיני עצרת אין משמרת");

  // Thu before Fri Pesach VI -> Sat Pesach VII (2025-04-17 -> 2025-04-18 -> 2025-04-19)
  const thuBeforePesachVI = evaluateDate(2025, 4, 17);
  assert.strictEqual(thuBeforePesachVI.status, "holidayEve");
  assert.strictEqual(thuBeforePesachVI.isWorkday, false);
  assert.strictEqual(calendarRules.holidayClosedReason(thuBeforePesachVI), "ערב שביעי של פסח אין משמרת");

  // Thu before Fri Hanukkah 1st Candle stays open!
  assert.strictEqual(evaluateDate(2026, 12, 3).isWorkday, true);
  assert.strictEqual(evaluateDate(2027, 12, 23).isWorkday, true);
  assert.strictEqual(evaluateDate(2033, 12, 15).isWorkday, true);
});

test("4.5 Saturday scheduling rules preserved (open normally, closed on Sat Erev Chag, holiday on Sat Chag)", () => {
  const regularSat = evaluateDate(2026, 11, 28);
  assert.strictEqual(regularSat.status, "workday");
  assert.strictEqual(regularSat.isWorkday, true);

  const satErevPesach = evaluateDate(2021, 3, 27);
  assert.strictEqual(satErevPesach.status, "holidayEve");
  assert.strictEqual(satErevPesach.isWorkday, false);

  const satErevShavuot = evaluateDate(2022, 6, 4);
  assert.strictEqual(satErevShavuot.status, "holidayEve");
  assert.strictEqual(satErevShavuot.isWorkday, false);

  const satShminiAtzeret = evaluateDate(2026, 10, 3);
  assert.strictEqual(satShminiAtzeret.status, "holiday");
  assert.strictEqual(satShminiAtzeret.isWorkday, true);
});

console.log("\n--- Group 5: DST Transitions, Browser Timezones & 2020-2039 Full Audit ---");

test("5.1 Calendar dates remain identical across Asia/Jerusalem, UTC, America/New_York, Australia/Sydney and DST boundaries", () => {
  const probeForTz = tz => JSON.parse(
    execFileSync(process.execPath, [__filename, "--tz-probe"], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8"
    })
  );

  const baseline = probeForTz("Asia/Jerusalem");
  for (const tz of ["UTC", "America/New_York", "Australia/Sydney"]) {
    const actual = probeForTz(tz);
    assert.deepStrictEqual(actual, baseline, `Mismatch under TZ=${tz}`);
  }
});

test("5.2 Full 2020-2039 (20-year) audit: only restrictive holiday eves and Fridays close", () => {
  const flags = window.hebcal.flags;
  let dt = localNoon(2020, 1, 1);
  let checkedDays = 0;

  while (dt.getFullYear() <= 2039) {
    checkedDays++;
    const res = evaluateDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    const dow = dt.getDay();

    if (dow === 5) {
      assert.strictEqual(res.status, "off", `${isoDate(dt)} Friday must be off`);
      assert.strictEqual(res.isWorkday, false);
    } else if (!res.isWorkday) {
      const todayEvents = window.hebcal.getHolidaysOnDate(dt, true) || [];
      const tomorrow = addDays(dt, 1);
      const tomorrowEvents = window.hebcal.getHolidaysOnDate(tomorrow, true) || [];
      const dayAfterEvents = window.hebcal.getHolidaysOnDate(addDays(dt, 2), true) || [];

      if (res.status === "holiday") {
        // Closed restrictive holiday must be immediately followed by another restrictive holiday
        const todayChag = todayEvents.some(e => e.getFlags() & flags.CHAG);
        const tomorrowChag = tomorrowEvents.some(e => e.getFlags() & flags.CHAG);
        assert.ok(todayChag && tomorrowChag, `Unexpected closed holiday on ${isoDate(dt)}: ${JSON.stringify(res)}`);
      } else {
        assert.strictEqual(res.status, "holidayEve", `${isoDate(dt)} closed non-Friday must be holidayEve or consecutive holiday`);
        const validTodayEve = todayEvents.some(e => (e.getFlags() & flags.EREV) && (e.getFlags() & flags.LIGHT_CANDLES));
        const validTomorrowChag = dow !== 6 && tomorrowEvents.some(e => e.getFlags() & flags.CHAG);
        const validTomorrowAtzmaut = tomorrowEvents.some(e => /Yom HaAtzma/i.test(e.getDesc()));
        const validThuBeforeFriEve = dow === 4 && tomorrowEvents.some(e => (e.getFlags() & flags.EREV) && (e.getFlags() & flags.LIGHT_CANDLES));
        const validThuBeforeFriCholHaMoedEve = dow === 4
          && tomorrowEvents.some(e => (e.getFlags() & flags.CHOL_HAMOED) && (e.getFlags() & flags.LIGHT_CANDLES))
          && dayAfterEvents.some(e => e.getFlags() & flags.CHAG);

        assert.ok(
          validTodayEve || validTomorrowChag || validTomorrowAtzmaut || validThuBeforeFriEve || validThuBeforeFriCholHaMoedEve,
          `Unexpected non-Friday closure on ${isoDate(dt)}: ${JSON.stringify(res)}`
        );
      }
      assert.ok(
        !/חנוכה|פורים|ירושלים|תשעה באב/.test(res.title || ""),
        `Forbidden closure title on ${isoDate(dt)}: ${res.title}`
      );
    }
    dt = addDays(dt, 1);
  }

  assert.strictEqual(checkedDays, 7305);
});

console.log("\n===============================================================================");
console.log("Test Execution Summary:");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log("===============================================================================");

if (failed > 0) {
  process.exit(1);
}
