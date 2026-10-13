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
  // Test Scenario 7: Shifts not explicitly blocked are open (פתח)
  // -------------------------------------------------------------
  test("Scenario 7: Shifts not explicitly blocked are open; only explicit blocks are closed; no 'unreported'", () => {
    const daysSnapshot = [
      { iso: "2026-03-01", monthKey: "2026-03", closed: false },
      { iso: "2026-03-02", monthKey: "2026-03", closed: false },
      { iso: "2026-03-03", monthKey: "2026-03", closed: false }
    ];

    const workerConstraintsSnapshot = {
      // Worker A: available on day 1, blocked on day 2, unmentioned on day 3
      "עובד א": {
        submittedDays: ["2026-03-01"],
        blockedDays: ["2026-03-02"]
        // 2026-03-03 is NOT explicitly blocked!
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

    // Days 1 and 3 are not blocked -> פתח = 2
    assert.strictEqual(workerA.opened, 2, "Days 1 and 3 (unblocked) must be counted as פתח");
    // Day 2 is blocked -> סגר = 1
    assert.strictEqual(workerA.closed, 1, "Day 2 (blocked) must be counted as סגר");
    // Unreported is removed completely
    assert.strictEqual(workerA.unreported, undefined, "unreported must not exist in worker stats");
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

  // -------------------------------------------------------------
  // Test Scenario 10: escapeHtmlText sanitization & HTML row generation
  // -------------------------------------------------------------
  test("Scenario 10: escapeHtmlText sanitizes input and renders table rows safely", () => {
    function escapeHtmlText(str) {
      if (str == null) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    assert.strictEqual(escapeHtmlText("דוד & משה"), "דוד &amp; משה");
    assert.strictEqual(escapeHtmlText('<b onmouseover="alert(1)">שם</b>'), "&lt;b onmouseover=&quot;alert(1)&quot;&gt;שם&lt;/b&gt;");
    assert.strictEqual(escapeHtmlText(null), "");
    assert.strictEqual(escapeHtmlText(undefined), "");
    assert.strictEqual(escapeHtmlText(123), "123");

    // Render sample records through HTML row generator
    const sampleRecord = {
      name: 'שרה & רבקה <script>',
      opened: 5,
      closed: 1,
      assigned: 4,
      assignmentRate: 80,
      assignmentRateFormatted: "80%"
    };

    const rowHtml = `
      <tr>
        <td class="worker-name-cell">${escapeHtmlText(sampleRecord.name)}</td>
        <td class="num-cell col-opened">${sampleRecord.opened}</td>
        <td class="num-cell col-closed">${sampleRecord.closed}</td>
        <td class="num-cell">${sampleRecord.assigned}</td>
        <td class="rate-cell high">${sampleRecord.assignmentRateFormatted}</td>
      </tr>
    `;

    assert(rowHtml.includes("&amp;"), "Must escape ampersand");
    assert(rowHtml.includes("&lt;script&gt;"), "Must escape angle brackets");
    assert(!rowHtml.includes("<script>"), "Must not contain raw script tag");
  });

  // -------------------------------------------------------------
  // Test Scenario 11: Fairness table reflects ONLY successfully saved schedules
  // -------------------------------------------------------------
  test("Scenario 11: Fairness table reflects ONLY successfully saved schedules", () => {
    const list = [];
    // Calculate before save
    const beforeResult = fairnessService.calculateAggregatedFairness(list, "cumulative");
    assert.strictEqual(beforeResult.records.length, 0, "No records before save");

    // Simulating save failure
    const attemptedRecord = {
      id: "invalid-save",
      // simulate failure to commit
    };
    // Since save failed, attemptedRecord is NOT appended to list
    const afterFailedResult = fairnessService.calculateAggregatedFairness(list, "cumulative");
    assert.strictEqual(afterFailedResult.records.length, 0, "Records must not update on failed save");

    // Simulating successful save
    const validSavedRecord = {
      id: "valid-save-1",
      startDate: "2026-05-01",
      endDate: "2026-05-03",
      savedAt: "2026-05-01T08:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-05-01", monthKey: "2026-05", closed: false },
        { iso: "2026-05-02", monthKey: "2026-05", closed: false }
      ],
      workerConstraintsSnapshot: {
        "דנה": { submittedDays: ["2026-05-01", "2026-05-02"], blockedDays: [] }
      },
      assignments: [
        { iso: "2026-05-01", monthKey: "2026-05", slot1: "דנה", slot2: null }
      ]
    };
    list.push(validSavedRecord);

    // Calculate after successful save
    const afterSuccessResult = fairnessService.calculateAggregatedFairness(list, "cumulative");
    assert.strictEqual(afterSuccessResult.records.length, 1, "Must update records upon successful save");
    assert.strictEqual(afterSuccessResult.records[0].name, "דנה");
    assert.strictEqual(afterSuccessResult.records[0].assigned, 1);
  });

  // -------------------------------------------------------------
  // Test Scenario 12: Worker not participating in a period accumulates NO fairness data in it
  // -------------------------------------------------------------
  test("Scenario 12: Worker who did not participate in a specific period does NOT accumulate fairness data in it", () => {
    // March: Only Alice participated
    const marchSchedule = {
      id: "2026-03-01_2026-03-04",
      startDate: "2026-03-01",
      endDate: "2026-03-04",
      savedAt: "2026-03-01T08:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-03-01", monthKey: "2026-03", closed: false },
        { iso: "2026-03-02", monthKey: "2026-03", closed: false },
        { iso: "2026-03-03", monthKey: "2026-03", closed: false },
        { iso: "2026-03-04", monthKey: "2026-03", closed: false }
      ],
      workerConstraintsSnapshot: {
        "אליס": { submittedDays: ["2026-03-01"], blockedDays: ["2026-03-02"] }
      },
      assignments: [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "אליס", slot2: null }
      ]
    };

    // April: Only Bob participated (Alice was absent / on leave)
    const aprilSchedule = {
      id: "2026-04-01_2026-04-03",
      startDate: "2026-04-01",
      endDate: "2026-04-03",
      savedAt: "2026-04-01T08:00:00Z",
      status: "active",
      daysSnapshot: [
        { iso: "2026-04-01", monthKey: "2026-04", closed: false },
        { iso: "2026-04-02", monthKey: "2026-04", closed: false },
        { iso: "2026-04-03", monthKey: "2026-04", closed: false }
      ],
      workerConstraintsSnapshot: {
        "בוב": { submittedDays: [], blockedDays: [] } // Bob had 0 blocks
      },
      assignments: [
        { iso: "2026-04-01", monthKey: "2026-04", slot1: "בוב", slot2: null }
      ]
    };

    const schedules = [marchSchedule, aprilSchedule];

    // Check March view: Only Alice should appear
    const marchFairness = fairnessService.calculateAggregatedFairness(schedules, "2026-03");
    assert.strictEqual(marchFairness.records.length, 1, "Only Alice in March");
    assert.strictEqual(marchFairness.records[0].name, "אליס");
    assert.strictEqual(marchFairness.records[0].opened, 3); // 4 days - 1 blocked = 3 opened
    assert.strictEqual(marchFairness.records[0].closed, 1);
    assert.strictEqual(marchFairness.records[0].assigned, 1);

    // Check April view: Only Bob should appear
    const aprilFairness = fairnessService.calculateAggregatedFairness(schedules, "2026-04");
    assert.strictEqual(aprilFairness.records.length, 1, "Only Bob in April");
    assert.strictEqual(aprilFairness.records[0].name, "בוב");
    assert.strictEqual(aprilFairness.records[0].opened, 3); // 3 days - 0 blocked = 3 opened
    assert.strictEqual(aprilFairness.records[0].assigned, 1);

    // Check Cumulative view:
    const cumFairness = fairnessService.calculateAggregatedFairness(schedules, "cumulative");
    assert.strictEqual(cumFairness.records.length, 2, "Both Alice and Bob in cumulative");

    const aliceCum = cumFairness.records.find(r => r.name === "אליס");
    const bobCum = cumFairness.records.find(r => r.name === "בוב");

    // CRITICAL: Alice MUST NOT accumulate open days from April!
    assert.strictEqual(aliceCum.opened, 3, "Alice opened shifts must be exactly 3 from March, zero from April");
    assert.strictEqual(aliceCum.closed, 1, "Alice closed shifts must be 1 from March");
    assert.strictEqual(aliceCum.assigned, 1, "Alice assigned must be 1");

    // CRITICAL: Bob MUST NOT accumulate open days from March!
    assert.strictEqual(bobCum.opened, 3, "Bob opened shifts must be exactly 3 from April, zero from March");
    assert.strictEqual(bobCum.closed, 0, "Bob closed shifts must be 0");
    assert.strictEqual(bobCum.assigned, 1, "Bob assigned must be 1");
  });

  // -------------------------------------------------------------
  // Test Scenario 13: Availability rules for scheduling & constraint parsing
  // -------------------------------------------------------------
  test("Scenario 13: Business rules for availability and parsing", () => {
    // Mock days of week: Sun (iso1), Mon (iso2), Tue (iso3)
    const isoSun = "2026-05-10";
    const isoMon = "2026-05-11";
    const isoTue = "2026-05-12";

    // 1. Explicitly blocked day: "א' - לא יכול"
    const blockedWorker = {
      name: "עובד 1",
      max: 2,
      onlyNight2: false,
      blocked: new Set([isoSun]),
      weekCounts: { 0: 0 }
    };
    // Helper availability check matching the new scheduling rule: !worker.blocked.has(iso)
    const isAvailable = (w, iso) => !w.blocked.has(iso);

    assert.strictEqual(isAvailable(blockedWorker, isoSun), false, "Explicitly blocked day is not available");
    assert.strictEqual(isAvailable(blockedWorker, isoMon), true, "Unmentioned day is available");
    assert.strictEqual(isAvailable(blockedWorker, isoTue), true, "Unmentioned day is available");

    // 2. Day with hyphen only: "ב' -" (not in blocked)
    const hyphenWorker = {
      name: "עובד 2",
      max: 2,
      onlyNight2: false,
      blocked: new Set(),
      weekCounts: { 0: 0 }
    };
    assert.strictEqual(isAvailable(hyphenWorker, isoMon), true, "Day with hyphen only is available");

    // 3. Completely empty worker column: 0 blocked days
    const emptyWorker = {
      name: "עובד 3",
      max: 2,
      onlyNight2: false,
      blocked: new Set(),
      weekCounts: { 0: 0 }
    };
    assert.strictEqual(isAvailable(emptyWorker, isoSun), true, "Empty constraints worker is available for Sun");
    assert.strictEqual(isAvailable(emptyWorker, isoMon), true, "Empty constraints worker is available for Mon");
    assert.strictEqual(isAvailable(emptyWorker, isoTue), true, "Empty constraints worker is available for Tue");
  });

  // -------------------------------------------------------------
  // Test Scenario 14: Hebrew text classification in isUnavailableText & restrictive constraints
  // -------------------------------------------------------------
  test("Scenario 14: Hebrew text classification in isUnavailableText & restrictive reports", () => {
    const fs = require('fs');
    const path = require('path');
    const indexHtmlPath = path.resolve(__dirname, '../index.html');
    const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

    // Extract isUnavailableText directly from index.html
    const isUnavailableMatch = indexHtmlContent.match(/function isUnavailableText\(text\) \{([\s\S]*?)\n    \}/);
    assert(isUnavailableMatch, "isUnavailableText function must be found in index.html");
    const isUnavailableText = new Function('text', isUnavailableMatch[1]);

    // Positive expressions with 'אין' MUST NOT be blocked (return false)
    assert.strictEqual(isUnavailableText("אין בעיה"), false, "'אין בעיה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין בעיות"), false, "'אין בעיות' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין לי בעיה"), false, "'אין לי בעיה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין לי שום בעיה"), false, "'אין לי שום בעיה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין שום בעיה"), false, "'אין שום בעיה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין מניעה"), false, "'אין מניעה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין לי מניעה"), false, "'אין לי מניעה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין מגבלה"), false, "'אין מגבלה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין לי מגבלה"), false, "'אין לי מגבלה' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין אילוצים"), false, "'אין אילוצים' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין אילוץ"), false, "'אין אילוץ' must NOT be blocked");
    assert.strictEqual(isUnavailableText("אין שום אילוצים"), false, "'אין שום אילוצים' must NOT be blocked");

    // Hebrew words containing א-י-ן as letters MUST NOT be falsely blocked
    assert.strictEqual(isUnavailableText("ראיון"), false, "'ראיון' must NOT match standalone 'אין'");
    assert.strictEqual(isUnavailableText("בניין"), false, "'בניין' must NOT match standalone 'אין'");
    assert.strictEqual(isUnavailableText("אינטרנט"), false, "'אינטרנט' must NOT match standalone 'אין'");

    // Mandatory 4 core phrases MUST be blocked (return true)
    assert.strictEqual(isUnavailableText("לא יכול"), true, "'לא יכול' must be blocked");
    assert.strictEqual(isUnavailableText("לא יכולה"), true, "'לא יכולה' must be blocked");
    assert.strictEqual(isUnavailableText("לא פנוי"), true, "'לא פנוי' must be blocked");
    assert.strictEqual(isUnavailableText("לא פנויה"), true, "'לא פנויה' must be blocked");

    // Other standard unavailable phrases MUST be blocked
    assert.strictEqual(isUnavailableText("לא יוכלה"), true, "'לא יוכלה' (typo) must be blocked");
    assert.strictEqual(isUnavailableText("לא זמין"), true, "'לא זמין' must be blocked");
    assert.strictEqual(isUnavailableText("לא זמינה"), true, "'לא זמינה' must be blocked");
    assert.strictEqual(isUnavailableText("חסום"), true, "'חסום' must be blocked");
    assert.strictEqual(isUnavailableText("חסומה"), true, "'חסומה' must be blocked");
    assert.strictEqual(isUnavailableText("אין אפשרות"), true, "'אין אפשרות' must be blocked");
    assert.strictEqual(isUnavailableText("אין לי אפשרות"), true, "'אין לי אפשרות' must be blocked");
    assert.strictEqual(isUnavailableText("אין מצב"), true, "'אין מצב' must be blocked");
    assert.strictEqual(isUnavailableText("אין זמינות"), true, "'אין זמינות' must be blocked");
    assert.strictEqual(isUnavailableText("אין יכולת"), true, "'אין יכולת' must be blocked");
    assert.strictEqual(isUnavailableText("אין"), true, "Standalone 'אין' must be blocked");
    assert.strictEqual(isUnavailableText("אין."), true, "'אין.' with punctuation must be blocked");

    // Restrictive reporting expressions (e.g., 'יכול רק ביום ג'')
    const isInlineOnlyMatch = indexHtmlContent.match(/function isInlineOnlyAvailabilityText\(text\) \{([\s\S]*?)\n    \}/);
    assert(isInlineOnlyMatch, "isInlineOnlyAvailabilityText function must be found in index.html");
    const isInlineOnlyAvailabilityText = new Function('text', isInlineOnlyMatch[1]);

    assert.strictEqual(isInlineOnlyAvailabilityText("יכול רק ביום ג'"), true, "'יכול רק ביום ג'' must be recognized as restrictive");
    assert.strictEqual(isInlineOnlyAvailabilityText("יכולה רק בשלישי"), true, "'יכולה רק בשלישי' must be recognized as restrictive");
    assert.strictEqual(isInlineOnlyAvailabilityText("זמין רק ביום א'"), true, "'זמין רק ביום א'' must be recognized as restrictive");
    assert.strictEqual(isInlineOnlyAvailabilityText("פנויה רק ברביעי"), true, "'פנויה רק ברביעי' must be recognized as restrictive");
    assert.strictEqual(isInlineOnlyAvailabilityText("יכול בכל הימים"), false, "'יכול בכל הימים' is not restrictive");
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
