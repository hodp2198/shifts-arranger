const assert = require('assert');
const WorkerAvailability = require('../src/workerAvailability.js');
const ConstraintParser = require('../src/constraintParser.js');

/**
 * Automated Verification Suite for Employee Availability Toggles
 */
function runAvailabilityToggleTests() {
  console.log("===============================================================================");
  console.log("STARTING TEST SUITE: Employee Availability Daily & Weekly Toggles");
  console.log("===============================================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // Fixture: Schedule days across 2 weeks (Week 0: Nov 1 - Nov 7, Week 1: Nov 8 - Nov 14, 2026)
  // Schedule days: 0 (Sun), 1 (Mon), 2 (Tue), 3 (Wed), 4 (Thu), 6 (Sat)
  const week0Days = [
    { date: new Date(2026, 10, 1, 12), iso: "2026-11-01", dayIndex: 0, dayName: "א", week: 0, closed: false },
    { date: new Date(2026, 10, 2, 12), iso: "2026-11-02", dayIndex: 1, dayName: "ב", week: 0, closed: false },
    { date: new Date(2026, 10, 3, 12), iso: "2026-11-03", dayIndex: 2, dayName: "ג", week: 0, closed: false },
    { date: new Date(2026, 10, 4, 12), iso: "2026-11-04", dayIndex: 3, dayName: "ד", week: 0, closed: false },
    { date: new Date(2026, 10, 5, 12), iso: "2026-11-05", dayIndex: 4, dayName: "ה", week: 0, closed: false },
    { date: new Date(2026, 10, 7, 12), iso: "2026-11-07", dayIndex: 6, dayName: "שבת", week: 0, closed: false }
  ];

  const week1Days = [
    { date: new Date(2026, 10, 8, 12), iso: "2026-11-08", dayIndex: 0, dayName: "א", week: 1, closed: false },
    { date: new Date(2026, 10, 9, 12), iso: "2026-11-09", dayIndex: 1, dayName: "ב", week: 1, closed: false },
    { date: new Date(2026, 10, 10, 12), iso: "2026-11-10", dayIndex: 2, dayName: "ג", week: 1, closed: false },
    { date: new Date(2026, 10, 11, 12), iso: "2026-11-11", dayIndex: 3, dayName: "ד", week: 1, closed: false },
    { date: new Date(2026, 10, 12, 12), iso: "2026-11-12", dayIndex: 4, dayName: "ה", week: 1, closed: false },
    { date: new Date(2026, 10, 14, 12), iso: "2026-11-14", dayIndex: 6, dayName: "שבת", week: 1, closed: false }
  ];

  const allScheduleDays = [...week0Days, ...week1Days];
  const weekConfigs = [
    { start: new Date(2026, 10, 1, 12), end: new Date(2026, 10, 7, 12) },
    { start: new Date(2026, 10, 8, 12), end: new Date(2026, 10, 14, 12) }
  ];

  console.log("--- Group 1: Pasted Constraints -> Employee Assignment -> Correct Daily States ---");

  test("1.1 Pasting constraints parses correctly and populates daily open/closed states", () => {
    const rawText = "א - לא יכול\nב - רוצה\nג - מעדיף שלא\nד - יכול";
    const parsed = ConstraintParser.parseWorkerConstraints(rawText, {
      weekConfigs,
      baseStart: weekConfigs[0].start,
      workerName: "דני"
    });

    const availability = WorkerAvailability.createWorkerAvailability({ workerName: "דני" });
    WorkerAvailability.populateAvailabilityFromParsed(availability, parsed, allScheduleDays);

    // Sunday (2026-11-01): Blocked -> Closed
    assert.strictEqual(WorkerAvailability.isDayOpen(availability, "2026-11-01"), false, "Sunday should be closed");
    assert.strictEqual(WorkerAvailability.getDayAvailabilityState(availability, "2026-11-01"), "CLOSED");
    assert.strictEqual(availability.blocked.has("2026-11-01"), true);

    // Monday (2026-11-02): Preferred -> Open
    assert.strictEqual(WorkerAvailability.isDayOpen(availability, "2026-11-02"), true, "Monday should be open");
    assert.strictEqual(WorkerAvailability.getDayAvailabilityState(availability, "2026-11-02"), "PREFERRED");
    assert.strictEqual(availability.preferred.has("2026-11-02"), true);

    // Tuesday (2026-11-03): Soft negative (avoid) -> Open (schedulable!)
    assert.strictEqual(WorkerAvailability.isDayOpen(availability, "2026-11-03"), true, "Tuesday (avoid) should be open");
    assert.strictEqual(WorkerAvailability.getDayAvailabilityState(availability, "2026-11-03"), "AVOID");
    assert.strictEqual(availability.avoid.has("2026-11-03"), true);
    assert.strictEqual(availability.blocked.has("2026-11-03"), false, "Tuesday must NOT be blocked");

    // Wednesday (2026-11-04): Submitted -> Open
    assert.strictEqual(WorkerAvailability.isDayOpen(availability, "2026-11-04"), true, "Wednesday should be open");
    assert.strictEqual(WorkerAvailability.getDayAvailabilityState(availability, "2026-11-04"), "OPEN");

    // Thursday (2026-11-05): Unmentioned workday in active period -> Open
    assert.strictEqual(WorkerAvailability.isDayOpen(availability, "2026-11-05"), true, "Thursday should be open");

    // Has submitted flag is true
    assert.strictEqual(availability.hasSubmitted, true);
    assert.strictEqual(availability.source, "submitted");
  });

  console.log("\n--- Group 2: Unsubmitted Worker vs Explicit Manual Entry ---");

  test("2.1 Unsubmitted worker has unknown state, is NOT open, and has 0 blocked/submitted days", () => {
    const unsubmittedWorker = WorkerAvailability.createWorkerAvailability({ workerName: "סיוואר" });

    assert.strictEqual(unsubmittedWorker.hasSubmitted, false);
    assert.strictEqual(unsubmittedWorker.source, "unsubmitted");
    assert.strictEqual(unsubmittedWorker.blocked.size, 0, "Must NOT convert days to hard blocks");
    assert.strictEqual(unsubmittedWorker.submitted.size, 0, "Must NOT count days as submitted");

    // All days report UNSUBMITTED and not open
    for (const day of allScheduleDays) {
      assert.strictEqual(WorkerAvailability.isDayOpen(unsubmittedWorker, day.iso), false, `${day.iso} must not be open`);
      assert.strictEqual(WorkerAvailability.getDayAvailabilityState(unsubmittedWorker, day.iso), "UNSUBMITTED");
    }

    // Weekly status is UNSUBMITTED
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(unsubmittedWorker, week0Days), "UNSUBMITTED");
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(unsubmittedWorker, week1Days), "UNSUBMITTED");
  });

  test("2.2 Explicit manual entry starts with all days closed and source = manual", () => {
    const worker = WorkerAvailability.createWorkerAvailability({ workerName: "סיוואר" });
    assert.strictEqual(worker.hasSubmitted, false);

    // User clicks "הזנת זמינות ידנית"
    WorkerAvailability.startManualAvailability(worker, allScheduleDays);

    assert.strictEqual(worker.hasSubmitted, true);
    assert.strictEqual(worker.source, "manual");
    assert.strictEqual(worker.blocked.size, allScheduleDays.length, "All schedule days must initially be closed");
    assert.strictEqual(worker.submitted.size, 0, "No days initially open");

    // All days report CLOSED
    for (const day of allScheduleDays) {
      assert.strictEqual(WorkerAvailability.isDayOpen(worker, day.iso), false);
      assert.strictEqual(WorkerAvailability.getDayAvailabilityState(worker, day.iso), "CLOSED");
    }

    // Weekly status is CLOSED
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(worker, week0Days), "CLOSED");
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(worker, week1Days), "CLOSED");

    // User opens Day 1 (2026-11-01)
    WorkerAvailability.toggleDayAvailability(worker, "2026-11-01", true);
    assert.strictEqual(WorkerAvailability.isDayOpen(worker, "2026-11-01"), true);
    assert.strictEqual(WorkerAvailability.getDayAvailabilityState(worker, "2026-11-01"), "OPEN");
    assert.strictEqual(worker.blocked.has("2026-11-01"), false);
    assert.strictEqual(worker.submitted.has("2026-11-01"), true);

    // Week 0 is now PARTIAL
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(worker, week0Days), "PARTIAL");
  });

  console.log("\n--- Group 3: Weekly Master Toggle & Partial State Determinism ---");

  test("3.1 All days open -> Master shows OPEN; clicking it closes all days in that week", () => {
    const availability = WorkerAvailability.createWorkerAvailability({ workerName: "רוני", hasSubmitted: true });
    // All days open
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(availability, week0Days), "OPEN");

    // Click master toggle -> Closes all
    const statusAfterClick = WorkerAvailability.handleMasterToggleClick(availability, week0Days);
    assert.strictEqual(statusAfterClick, "CLOSED");
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(availability, week0Days), "CLOSED");

    // Every day in week 0 is now closed
    for (const day of week0Days) {
      assert.strictEqual(WorkerAvailability.isDayOpen(availability, day.iso), false, `Day ${day.iso} must be closed`);
    }
  });

  test("3.2 All days closed -> Master shows CLOSED; clicking it opens all days in that week", () => {
    const availability = WorkerAvailability.createWorkerAvailability({ workerName: "רוני", hasSubmitted: true });
    WorkerAvailability.setWeekAvailability(availability, week0Days, false);
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(availability, week0Days), "CLOSED");

    // Click master toggle -> Opens all
    const statusAfterClick = WorkerAvailability.handleMasterToggleClick(availability, week0Days);
    assert.strictEqual(statusAfterClick, "OPEN");
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(availability, week0Days), "OPEN");

    // Every day in week 0 is now open
    for (const day of week0Days) {
      assert.strictEqual(WorkerAvailability.isDayOpen(availability, day.iso), true, `Day ${day.iso} must be open`);
    }
  });

  test("3.3 Mixed availability shows PARTIAL; deterministic click: opens all, next click closes all", () => {
    const availability = WorkerAvailability.createWorkerAvailability({ workerName: "מאיה", hasSubmitted: true });
    // Close 1 day in week 0
    WorkerAvailability.toggleDayAvailability(availability, "2026-11-02", false);

    // Status is PARTIAL ("חלקי")
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(availability, week0Days), "PARTIAL");

    // First click on PARTIAL -> OPENS ALL
    const firstClickStatus = WorkerAvailability.handleMasterToggleClick(availability, week0Days);
    assert.strictEqual(firstClickStatus, "OPEN");
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(availability, week0Days), "OPEN");
    for (const day of week0Days) {
      assert.strictEqual(WorkerAvailability.isDayOpen(availability, day.iso), true);
    }

    // Second click -> CLOSES ALL
    const secondClickStatus = WorkerAvailability.handleMasterToggleClick(availability, week0Days);
    assert.strictEqual(secondClickStatus, "CLOSED");
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(availability, week0Days), "CLOSED");
    for (const day of week0Days) {
      assert.strictEqual(WorkerAvailability.isDayOpen(availability, day.iso), false);
    }
  });

  console.log("\n--- Group 4: Isolation Between Employees & Between Weeks ---");

  test("4.1 Changes to Employee A do NOT affect Employee B", () => {
    const workerA = WorkerAvailability.createWorkerAvailability({ workerName: "עובד א", hasSubmitted: true });
    const workerB = WorkerAvailability.createWorkerAvailability({ workerName: "עובד ב", hasSubmitted: true });

    // Close week 0 for Worker A
    WorkerAvailability.setWeekAvailability(workerA, week0Days, false);

    // Worker A week 0 is closed
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(workerA, week0Days), "CLOSED");

    // Worker B week 0 remains OPEN
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(workerB, week0Days), "OPEN");
    for (const day of week0Days) {
      assert.strictEqual(WorkerAvailability.isDayOpen(workerB, day.iso), true);
    }
  });

  test("4.2 Changes to Week 0 do NOT affect Week 1 for the same employee", () => {
    const worker = WorkerAvailability.createWorkerAvailability({ workerName: "יוסי", hasSubmitted: true });

    // Close Week 0
    WorkerAvailability.setWeekAvailability(worker, week0Days, false);

    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(worker, week0Days), "CLOSED");
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(worker, week1Days), "OPEN");

    // Week 1 days remain open
    for (const day of week1Days) {
      assert.strictEqual(WorkerAvailability.isDayOpen(worker, day.iso), true);
    }
  });

  test("4.3 Distinct dates across weeks with same weekday name are correctly isolated", () => {
    const worker = WorkerAvailability.createWorkerAvailability({ workerName: "מיכל", hasSubmitted: true });
    // Week 0 Sunday is 2026-11-01, Week 1 Sunday is 2026-11-08
    WorkerAvailability.toggleDayAvailability(worker, "2026-11-01", false);

    assert.strictEqual(WorkerAvailability.isDayOpen(worker, "2026-11-01"), false, "Week 0 Sunday should be closed");
    assert.strictEqual(WorkerAvailability.isDayOpen(worker, "2026-11-08"), true, "Week 1 Sunday must remain open");
  });

  console.log("\n--- Group 5: Non-Submitters, Month/Year Rollover, & Serialization ---");

  test("5.1 Non-submitter is marked hasSubmitted = false, source = unsubmitted", () => {
    const worker = WorkerAvailability.createWorkerAvailability({ workerName: "לא הגיש" });
    assert.strictEqual(worker.hasSubmitted, false, "Fresh worker must have hasSubmitted = false");
    assert.strictEqual(worker.source, "unsubmitted");
  });

  test("5.2 Genuine submitted week with blank day entries vs empty text", () => {
    // Case A: Worker submitted text with day lines (even if blank entries)
    const textWithDays = "ראשון:\nשני:\nשלישי:";
    const parsedDays = ConstraintParser.parseWorkerConstraints(textWithDays, { weekConfigs, workerName: "עובד א" });
    const availA = WorkerAvailability.createWorkerAvailability({ workerName: "עובד א" });
    WorkerAvailability.populateAvailabilityFromParsed(availA, parsedDays, allScheduleDays);
    assert.strictEqual(availA.hasSubmitted, true, "Worker with day entries is considered submitted");
    assert.strictEqual(availA.source, "submitted");

    // Case B: Worker with no input at all
    const emptyText = "";
    const parsedEmpty = ConstraintParser.parseWorkerConstraints(emptyText, { weekConfigs, workerName: "עובד ב" });
    const availB = WorkerAvailability.createWorkerAvailability({ workerName: "עובד ב" });
    WorkerAvailability.populateAvailabilityFromParsed(availB, parsedEmpty, allScheduleDays);
    assert.strictEqual(availB.hasSubmitted, false, "Worker with empty text is unsubmitted");
    assert.strictEqual(availB.source, "unsubmitted");
  });

  test("5.3 Cross-month boundary (28/10 - 03/11) is correctly parsed and isolated by ISO date", () => {
    const crossMonthDays = [
      { iso: "2026-10-28", dayIndex: 3, week: 0 },
      { iso: "2026-10-29", dayIndex: 4, week: 0 },
      { iso: "2026-10-31", dayIndex: 6, week: 0 },
      { iso: "2026-11-01", dayIndex: 0, week: 0 },
      { iso: "2026-11-02", dayIndex: 1, week: 0 },
      { iso: "2026-11-03", dayIndex: 2, week: 0 }
    ];

    const worker = WorkerAvailability.createWorkerAvailability({ workerName: "חודש כפול", hasSubmitted: true });
    WorkerAvailability.toggleDayAvailability(worker, "2026-10-28", false);
    WorkerAvailability.toggleDayAvailability(worker, "2026-11-01", true);

    assert.strictEqual(WorkerAvailability.isDayOpen(worker, "2026-10-28"), false);
    assert.strictEqual(WorkerAvailability.isDayOpen(worker, "2026-11-01"), true);
    assert.strictEqual(WorkerAvailability.getWeekAvailabilityStatus(worker, crossMonthDays), "PARTIAL");
  });

  test("5.4 Serialization and Deserialization survives JSON round-trip for unsubmitted, manual, and submitted", () => {
    // 1. Unsubmitted worker
    const unsubmitted = WorkerAvailability.createWorkerAvailability({ workerName: "ללא הגשה" });
    const s1 = WorkerAvailability.serializeAvailability(unsubmitted);
    const r1 = WorkerAvailability.deserializeAvailability(JSON.parse(JSON.stringify(s1)), allScheduleDays);
    assert.strictEqual(r1.hasSubmitted, false);
    assert.strictEqual(r1.source, "unsubmitted");
    assert.strictEqual(r1.blocked.size, 0);
    assert.strictEqual(r1.submitted.size, 0);

    // 2. Manual worker with 1 open day
    const manual = WorkerAvailability.createWorkerAvailability({ workerName: "ידני" });
    WorkerAvailability.startManualAvailability(manual, allScheduleDays);
    WorkerAvailability.toggleDayAvailability(manual, "2026-11-01", true); // open 1 day
    const s2 = WorkerAvailability.serializeAvailability(manual);
    const r2 = WorkerAvailability.deserializeAvailability(JSON.parse(JSON.stringify(s2)), allScheduleDays);
    assert.strictEqual(r2.hasSubmitted, true);
    assert.strictEqual(r2.source, "manual");
    assert.strictEqual(r2.blocked.has("2026-11-01"), false);
    assert.strictEqual(r2.submitted.has("2026-11-01"), true);
    assert.strictEqual(r2.blocked.has("2026-11-02"), true);

    // 3. Submitted worker from parsed text
    const submitted = WorkerAvailability.createWorkerAvailability({ workerName: "הגיש" });
    submitted.blocked.add("2026-11-01");
    submitted.avoid.add("2026-11-02");
    submitted.hasSubmitted = true;
    submitted.source = "submitted";
    const s3 = WorkerAvailability.serializeAvailability(submitted);
    const r3 = WorkerAvailability.deserializeAvailability(JSON.parse(JSON.stringify(s3)), allScheduleDays);
    assert.strictEqual(r3.hasSubmitted, true);
    assert.strictEqual(r3.source, "submitted");
    assert.strictEqual(r3.blocked.has("2026-11-01"), true);
    assert.strictEqual(r3.avoid.has("2026-11-02"), true);
    assert.strictEqual(WorkerAvailability.isDayOpen(r3, "2026-11-01"), false);
    assert.strictEqual(WorkerAvailability.isDayOpen(r3, "2026-11-02"), true);
  });

  console.log("\n--- Group 6: Guard against Inventing Submissions Outside Genuinely Submitted Weeks ---");

  test("6.1 Partial week submission populates only genuinely submitted weeks in submitted set", () => {
    // 2-week schedule (Week 0 and Week 1)
    const text = "01/11-07/11:\nא - לא יכול";
    const parsed = ConstraintParser.parseWorkerConstraints(text, {
      weekConfigs,
      baseStart: new Date("2026-11-01")
    });

    assert.deepStrictEqual(parsed.submittedWeeks, [0], "Only Week 0 should be marked as submitted week");

    const availability = WorkerAvailability.createWorkerAvailability({ workerName: "עובד שבוע 1 בלבד" });
    WorkerAvailability.populateAvailabilityFromParsed(availability, parsed, allScheduleDays);

    // Week 0: Sunday is blocked, other 5 workdays are submitted
    assert.strictEqual(availability.blocked.has("2026-11-01"), true);
    for (const day of week0Days) {
      if (day.iso === "2026-11-01") {
        assert.strictEqual(availability.submitted.has(day.iso), false);
      } else {
        assert.strictEqual(availability.submitted.has(day.iso), true, `Week 0 day ${day.iso} should be submitted`);
      }
    }

    // Week 1: was NEVER submitted! None of Week 1 days should be invented in submitted
    for (const day of week1Days) {
      assert.strictEqual(
        availability.submitted.has(day.iso),
        false,
        `Week 1 day ${day.iso} MUST NOT be invented in submitted set`
      );
    }
  });

  test("6.2 Deserialization does not inflate submitted set to unsubmitted weeks or non-submitters", () => {
    const rawData = {
      workerName: "שמירה",
      hasSubmitted: true,
      source: "submitted",
      blocked: ["2026-11-01"],
      avoid: [],
      preferred: [],
      submitted: ["2026-11-02", "2026-11-03"] // Only 2 specific days were submitted
    };

    const deserialized = WorkerAvailability.deserializeAvailability(rawData, allScheduleDays);

    // Exact count preserved: must NOT add all unblocked days in allScheduleDays to submitted
    assert.strictEqual(deserialized.submitted.size, 2, "Deserialized submitted size must match saved data");
    assert.strictEqual(deserialized.submitted.has("2026-11-02"), true);
    assert.strictEqual(deserialized.submitted.has("2026-11-03"), true);
    assert.strictEqual(deserialized.submitted.has("2026-11-04"), false, "Unsubmitted day must not be added to submitted");
  });

  console.log("\n===============================================================================");
  console.log(`Test Execution Summary:`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log("===============================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runAvailabilityToggleTests();
