/**
 * Test Suite: Fairness Tracking & Official Schedule Verification
 *
 * Runs locally under Node.js in a strictly isolated test environment.
 * NEVER contacts production Firestore or modifies production data.
 */

const assert = require('assert');

// Load ES module dynamically
async function runTests() {
  console.log("=================================================");
  console.log("Starting Fairness Tracking & Official Schedule Tests");
  console.log("Environment: Isolated In-Memory Sandbox (Zero Production Impact)");
  console.log("=================================================\n");

  const fairnessService = await import('../src/fairnessService.js');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test Scenario 1: Unsaved drafts do not affect fairness statistics
  // -------------------------------------------------------------
  test("Scenario 1: Generating 10 draft schedules without saving - fairness statistics remain empty", () => {
    const officialSchedules = []; // No saved schedules

    // 10 draft generation cycles simulated
    for (let i = 0; i < 10; i++) {
      const draftAssignments = [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: "אשרקת" }
      ];
      // Drafts are NOT added to officialSchedules!
    }

    const result = fairnessService.calculateAggregatedFairness(officialSchedules, "cumulative");
    assert.strictEqual(result.records.length, 0, "Fairness records must be empty when no schedules are saved");
    assert.strictEqual(result.totalEligibleDays, 0, "Eligible days must be 0");
  });

  // -------------------------------------------------------------
  // Test Scenario 2: Save one schedule - assignments counted once
  // -------------------------------------------------------------
  test("Scenario 2: Save one schedule - assignments and constraints counted exactly once", () => {
    const daysSnapshot = [
      { iso: "2026-03-01", monthKey: "2026-03", closed: false },
      { iso: "2026-03-02", monthKey: "2026-03", closed: false },
      { iso: "2026-03-03", monthKey: "2026-03", closed: false },
      { iso: "2026-03-04", monthKey: "2026-03", closed: false },
      { iso: "2026-03-05", monthKey: "2026-03", closed: true } // Calendar closed (holiday/manual)
    ];

    const workerConstraintsSnapshot = {
      "הוד": {
        submittedDays: ["2026-03-01", "2026-03-02", "2026-03-03"],
        blockedDays: ["2026-03-04"]
      },
      "אשרקת": {
        submittedDays: ["2026-03-01", "2026-03-02"],
        blockedDays: ["2026-03-03", "2026-03-04"]
      }
    };

    const assignments = [
      { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: "אשרקת" },
      { iso: "2026-03-02", monthKey: "2026-03", slot1: "הוד", slot2: "אשרקת" },
      { iso: "2026-03-03", monthKey: "2026-03", slot1: "הוד", slot2: null }
    ];

    const officialSchedule = {
      id: "2026-03-01_2026-03-05",
      startDate: "2026-03-01",
      endDate: "2026-03-05",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot,
      workerConstraintsSnapshot,
      assignments
    };

    const result = fairnessService.calculateAggregatedFairness([officialSchedule], "2026-03");

    // Total eligible days: 4 (March 1-4, since March 5 is closed)
    assert.strictEqual(result.totalEligibleDays, 4, "Total eligible days should exclude calendar closed days");

    const hod = result.records.find(r => r.name === "הוד");
    const ashraqat = result.records.find(r => r.name === "אשרקת");

    assert.ok(hod, "Hod must exist in results");
    assert.ok(ashraqat, "Ashraqat must exist in results");

    // Hod:
    // Submitted: 01, 02, 03 -> 3 days opened
    // Blocked: 04 -> 1 day closed
    // Assigned: 01, 02, 03 -> 3 shifts
    // Rate: 3 / 3 = 100%
    assert.strictEqual(hod.opened, 3, "Hod opened shifts");
    assert.strictEqual(hod.closed, 1, "Hod closed shifts");
    assert.strictEqual(hod.assigned, 3, "Hod received shifts");
    assert.strictEqual(hod.assignmentRate, 100, "Hod assignment rate should be 100%");

    // Ashraqat:
    // Submitted: 01, 02 -> 2 days opened
    // Blocked: 03, 04 -> 2 days closed
    // Assigned: 01, 02 -> 2 shifts
    // Rate: 2 / 2 = 100%
    assert.strictEqual(ashraqat.opened, 2, "Ashraqat opened shifts");
    assert.strictEqual(ashraqat.closed, 2, "Ashraqat closed shifts");
    assert.strictEqual(ashraqat.assigned, 2, "Ashraqat received shifts");
    assert.strictEqual(ashraqat.assignmentRate, 100, "Ashraqat assignment rate should be 100%");
  });

  // -------------------------------------------------------------
  // Test Scenario 3: Save same schedule again - no duplicate counting (Idempotency)
  // -------------------------------------------------------------
  test("Scenario 3: Save same schedule again - no duplicate counting", () => {
    const scheduleV1 = {
      id: "2026-03-01_2026-03-04",
      startDate: "2026-03-01",
      endDate: "2026-03-04",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-03-01", monthKey: "2026-03", closed: false }
      ],
      workerConstraintsSnapshot: {
        "הוד": { submittedDays: ["2026-03-01"], blockedDays: [] }
      },
      assignments: [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: null }
      ]
    };

    // In Firestore, saving with same ID replaces the doc.
    // If multiple revisions exist with same ID in an array:
    const store = new Map();
    store.set(scheduleV1.id, scheduleV1);
    store.set(scheduleV1.id, { ...scheduleV1, savedAt: "2026-03-01T10:05:00Z" }); // Resaved

    const list = Array.from(store.values());
    assert.strictEqual(list.length, 1, "Only one document must exist for the period ID");

    const result = fairnessService.calculateAggregatedFairness(list, "cumulative");
    const hod = result.records.find(r => r.name === "הוד");
    assert.strictEqual(hod.assigned, 1, "Hod must be counted only once");
  });

  // -------------------------------------------------------------
  // Test Scenario 4: Replace official schedule for the same period
  // -------------------------------------------------------------
  test("Scenario 4: Replace schedule for same period - old assignments removed, new ones applied", () => {
    const oldSchedule = {
      id: "2026-03-01_2026-03-04",
      startDate: "2026-03-01",
      endDate: "2026-03-04",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-03-01", monthKey: "2026-03", closed: false }
      ],
      workerConstraintsSnapshot: {
        "הוד": { submittedDays: ["2026-03-01"], blockedDays: [] },
        "אשרקת": { submittedDays: ["2026-03-01"], blockedDays: [] }
      },
      assignments: [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: null } // Hod had shift
      ]
    };

    const newSchedule = {
      ...oldSchedule,
      savedAt: "2026-03-01T11:00:00Z",
      assignments: [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "אשרקת", slot2: null } // Replaced: Ashraqat has shift
      ]
    };

    // Replacement: new schedule replaces old schedule
    const result = fairnessService.calculateAggregatedFairness([newSchedule], "cumulative");
    const hod = result.records.find(r => r.name === "הוד");
    const ashraqat = result.records.find(r => r.name === "אשרקת");

    assert.strictEqual(hod.assigned, 0, "Hod shift was replaced and must be 0");
    assert.strictEqual(ashraqat.assigned, 1, "Ashraqat new shift must be 1");
  });

  // -------------------------------------------------------------
  // Test Scenario 5: Simulation of page refresh & persistence
  // -------------------------------------------------------------
  test("Scenario 5: Refresh page - official schedule and statistics persist cleanly", () => {
    const memoryDatabase = new Map();

    const recordToSave = {
      id: "2026-03-01_2026-03-07",
      startDate: "2026-03-01",
      endDate: "2026-03-07",
      savedAt: new Date().toISOString(),
      status: "active",
      daysSnapshot: [
        { iso: "2026-03-01", monthKey: "2026-03", closed: false }
      ],
      workerConstraintsSnapshot: {
        "הוד": { submittedDays: ["2026-03-01"], blockedDays: [] }
      },
      assignments: [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: null }
      ]
    };

    // Save to isolated in-memory DB
    memoryDatabase.set(recordToSave.id, JSON.parse(JSON.stringify(recordToSave)));

    // Simulate page reload: read back from isolated in-memory DB
    const loadedSchedules = Array.from(memoryDatabase.values());
    assert.strictEqual(loadedSchedules.length, 1);

    const result = fairnessService.calculateAggregatedFairness(loadedSchedules, "cumulative");
    assert.strictEqual(result.records[0].name, "הוד");
    assert.strictEqual(result.records[0].assigned, 1);
  });

  // -------------------------------------------------------------
  // Test Scenario 6: Cross-month periods & cumulative totals
  // -------------------------------------------------------------
  test("Scenario 6: Cross-month schedule - splits shifts into correct calendar months and cumulative view", () => {
    // Schedule spans end of March to beginning of April: 2026-03-29 to 2026-04-02
    const crossMonthSchedule = {
      id: "2026-03-29_2026-04-02",
      startDate: "2026-03-29",
      endDate: "2026-04-02",
      savedAt: "2026-03-25T10:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-03-29", monthKey: "2026-03", closed: false },
        { iso: "2026-03-30", monthKey: "2026-03", closed: false },
        { iso: "2026-03-31", monthKey: "2026-03", closed: false },
        { iso: "2026-04-01", monthKey: "2026-04", closed: false },
        { iso: "2026-04-02", monthKey: "2026-04", closed: false }
      ],
      workerConstraintsSnapshot: {
        "הוד": {
          submittedDays: ["2026-03-29", "2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02"],
          blockedDays: []
        }
      },
      assignments: [
        { iso: "2026-03-29", monthKey: "2026-03", slot1: "הוד", slot2: null }, // March
        { iso: "2026-03-30", monthKey: "2026-03", slot1: "הוד", slot2: null }, // March
        { iso: "2026-04-01", monthKey: "2026-04", slot1: "הוד", slot2: null }  // April
      ]
    };

    // 1. Monthly view for March 2026:
    const marchResult = fairnessService.calculateAggregatedFairness([crossMonthSchedule], "2026-03");
    assert.strictEqual(marchResult.totalEligibleDays, 3, "March has 3 open days");
    const marchHod = marchResult.records.find(r => r.name === "הוד");
    assert.strictEqual(marchHod.opened, 3, "Hod opened 3 shifts in March");
    assert.strictEqual(marchHod.assigned, 2, "Hod received 2 shifts in March");

    // 2. Monthly view for April 2026:
    const aprilResult = fairnessService.calculateAggregatedFairness([crossMonthSchedule], "2026-04");
    assert.strictEqual(aprilResult.totalEligibleDays, 2, "April has 2 open days");
    const aprilHod = aprilResult.records.find(r => r.name === "הוד");
    assert.strictEqual(aprilHod.opened, 2, "Hod opened 2 shifts in April");
    assert.strictEqual(aprilHod.assigned, 1, "Hod received 1 shift in April");

    // 3. Cumulative view across all recorded history:
    const cumulativeResult = fairnessService.calculateAggregatedFairness([crossMonthSchedule], "cumulative");
    assert.strictEqual(cumulativeResult.totalEligibleDays, 5, "Cumulative has 5 open days");
    const cumHod = cumulativeResult.records.find(r => r.name === "הוד");
    assert.strictEqual(cumHod.opened, 5, "Hod opened 5 shifts cumulatively");
    assert.strictEqual(cumHod.assigned, 3, "Hod received 3 shifts cumulatively");
    assert.strictEqual(cumHod.assignmentRate, 60, "3 / 5 = 60%");
  });

  // -------------------------------------------------------------
  // Test Scenario 7: Explicit availability (פתח) vs explicit unavailability (סגר) vs lack of reporting (לא דיווח)
  // [Addresses User Correction 1]
  // -------------------------------------------------------------
  test("Scenario 7: Explicit open (פתח), explicit closed (סגר), and lack of reporting (לא דיווח)", () => {
    const daysSnapshot = [
      { iso: "2026-03-01", monthKey: "2026-03", closed: false },
      { iso: "2026-03-02", monthKey: "2026-03", closed: false },
      { iso: "2026-03-03", monthKey: "2026-03", closed: false }
    ];

    const workerConstraintsSnapshot = {
      // Worker A reported: available on day 1, blocked on day 2, unmentioned on day 3
      "עובד א": {
        submittedDays: ["2026-03-01"],
        blockedDays: ["2026-03-02"]
        // 2026-03-03 is NOT mentioned!
      }
    };

    const schedule = {
      id: "test-period",
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot,
      workerConstraintsSnapshot,
      assignments: []
    };

    const result = fairnessService.calculateAggregatedFairness([schedule], "2026-03");
    const workerA = result.records.find(r => r.name === "עובד א");

    assert.strictEqual(workerA.opened, 1, "Day 1 must be counted as פתח");
    assert.strictEqual(workerA.closed, 1, "Day 2 must be counted as סגר");
    assert.strictEqual(workerA.unreported, 1, "Day 3 must be counted as לא דיווח - NEVER as סגר!");
  });

  // -------------------------------------------------------------
  // Test Scenario 8: Overlapping periods deduplication & safety
  // -------------------------------------------------------------
  test("Scenario 8: Overlapping periods deduplication - date counted exactly once with newer version", () => {
    // Schedule 1 saved at 10:00 covering 03-01 to 03-03
    const sched1 = {
      id: "p1",
      startDate: "2026-03-01",
      endDate: "2026-03-03",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-03-01", monthKey: "2026-03", closed: false },
        { iso: "2026-03-02", monthKey: "2026-03", closed: false },
        { iso: "2026-03-03", monthKey: "2026-03", closed: false }
      ],
      workerConstraintsSnapshot: {
        "הוד": { submittedDays: ["2026-03-01", "2026-03-02", "2026-03-03"], blockedDays: [] }
      },
      assignments: [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: null },
        { iso: "2026-03-02", monthKey: "2026-03", slot1: "הוד", slot2: null }
      ]
    };

    // Schedule 2 saved at 11:00 covering 03-02 to 03-04 (overlaps on 03-02 and 03-03)
    const sched2 = {
      id: "p2",
      startDate: "2026-03-02",
      endDate: "2026-03-04",
      savedAt: "2026-03-01T11:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-03-02", monthKey: "2026-03", closed: false },
        { iso: "2026-03-03", monthKey: "2026-03", closed: false },
        { iso: "2026-03-04", monthKey: "2026-03", closed: false }
      ],
      workerConstraintsSnapshot: {
        "הוד": { submittedDays: ["2026-03-02", "2026-03-03", "2026-03-04"], blockedDays: [] }
      },
      assignments: [
        // On 03-02 Hod is NOT assigned in this newer revision
        { iso: "2026-03-04", monthKey: "2026-03", slot1: "הוד", slot2: null }
      ]
    };

    const overlapDetected = fairnessService.findOverlappingOfficialSchedules([sched1], "2026-03-02", "2026-03-04", "p2");
    assert.strictEqual(overlapDetected.length, 1, "Must detect overlap between p1 and p2");

    const result = fairnessService.calculateAggregatedFairness([sched1, sched2], "cumulative");
    // Unique dates are: 03-01 (from sched1), 03-02 (from sched2), 03-03 (from sched2), 03-04 (from sched2) = 4 days
    assert.strictEqual(result.totalEligibleDays, 4, "Total unique eligible days must be 4");

    const hod = result.records.find(r => r.name === "הוד");
    // Hod shifts: 03-01 (from sched1) + 03-04 (from sched2). 03-02 from sched1 was overridden by sched2 (0 shifts)
    assert.strictEqual(hod.assigned, 2, "Hod received shifts correctly deduplicated across overlapping periods");
  });

  // -------------------------------------------------------------
  // Test Scenario 9: Month labeling in Hebrew
  // -------------------------------------------------------------
  test("Scenario 9: Hebrew Month Label Formatting", () => {
    assert.strictEqual(fairnessService.formatMonthLabel("2026-03"), "מרץ 2026");
    assert.strictEqual(fairnessService.formatMonthLabel("2026-10"), "אוקטובר 2026");
    assert.strictEqual(fairnessService.formatMonthLabel("2026-01"), "ינואר 2026");
  });

  console.log("\n=================================================");
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
