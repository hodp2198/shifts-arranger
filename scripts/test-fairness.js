/**
 * Comprehensive Automated Tests: Fairness Tracking & Official Schedule Verification
 * Runs locally in Node.js - 100% isolated, zero production network or Firestore access.
 */

const assert = require('assert');

async function runTests() {
  console.log("=================================================");
  console.log("Starting Fairness Tracking & Official Schedule Tests");
  console.log("=================================================\n");

  const fairness = await import('../src/fairnessService.js');

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

  // Test 1: Empty schedules
  test("1. Empty schedules returns 0 eligible days and empty records", () => {
    const res = fairness.calculateAggregatedFairness([]);
    assert.strictEqual(res.records.length, 0);
    assert.strictEqual(res.totalEligibleDays, 0);
    assert.strictEqual(res.periodFilter, "cumulative");
  });

  // Test 2: Single schedule calculation with accurate metrics, ranking, and non-submitter distinction
  test("2. Single schedule: accurate availability %, assignment rate, and ranking", () => {
    // 24 days total, 4 closed -> 20 eligible days
    const daysSnapshot = [];
    for (let i = 1; i <= 24; i++) {
      const dayStr = i < 10 ? `0${i}` : `${i}`;
      const iso = `2026-03-${dayStr}`;
      const closed = i > 20; // Days 21-24 are closed
      daysSnapshot.push({ iso, monthKey: "2026-03", closed });
    }

    // Constraints:
    // Worker A: submitted, blocked on day 1 and 2 (2 closed, 18 opened)
    // Worker B: submitted, blocked on days 1..10 (10 closed, 10 opened)
    // Worker C: did NOT submit constraints (0 opened, 0 closed)
    const workerConstraintsSnapshot = {
      "עובד א": {
        hasSubmitted: true,
        submittedDays: daysSnapshot.filter(d => !d.closed && d.iso > "2026-03-02").map(d => d.iso),
        blockedDays: ["2026-03-01", "2026-03-02"]
      },
      "עובד ב": {
        hasSubmitted: true,
        submittedDays: daysSnapshot.filter((d, idx) => !d.closed && idx >= 10).map(d => d.iso),
        blockedDays: daysSnapshot.slice(0, 10).map(d => d.iso)
      },
      "עובד ג": {
        hasSubmitted: false,
        submittedDays: [],
        blockedDays: []
      }
    };

    // Assignments:
    // Worker A: 6 assignments
    // Worker B: 5 assignments
    // Worker C: 0 assignments
    const assignments = [];
    for (let i = 3; i <= 8; i++) {
      const dayStr = i < 10 ? `0${i}` : `${i}`;
      assignments.push({ iso: `2026-03-${dayStr}`, monthKey: "2026-03", slot1: "עובד א", slot2: null });
    }
    for (let i = 11; i <= 15; i++) {
      const dayStr = i < 10 ? `0${i}` : `${i}`;
      assignments.push({ iso: `2026-03-${dayStr}`, monthKey: "2026-03", slot1: "עובד ב", slot2: null });
    }

    const officialSchedule = {
      id: "2026-03-01_2026-03-24",
      startDate: "2026-03-01",
      endDate: "2026-03-24",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot,
      workerConstraintsSnapshot,
      assignments
    };

    const res = fairness.calculateAggregatedFairness([officialSchedule], "2026-03");

    // Total eligible days must be 20
    assert.strictEqual(res.totalEligibleDays, 20);

    const a = res.records.find(r => r.name === "עובד א");
    const b = res.records.find(r => r.name === "עובד ב");
    const c = res.records.find(r => r.name === "עובד ג");

    assert.ok(a);
    assert.ok(b);
    assert.ok(c);

    // Worker A: opened = 18, closed = 2, assigned = 6
    // Availability %: 18 / 20 = 90%
    // Assignment rate: 6 / 18 = 33%
    assert.strictEqual(a.opened, 18);
    assert.strictEqual(a.closed, 2);
    assert.strictEqual(a.assigned, 6);
    assert.strictEqual(a.availabilityPercentage, 90);
    assert.strictEqual(a.assignmentRate, 33);
    assert.strictEqual(a.hasSubmitted, true);
    assert.strictEqual(a.submissionStatus, "הוגש");

    // Worker B: opened = 10, closed = 10, assigned = 5
    // Availability %: 10 / 20 = 50%
    // Assignment rate: 5 / 10 = 50%
    assert.strictEqual(b.opened, 10);
    assert.strictEqual(b.closed, 10);
    assert.strictEqual(b.assigned, 5);
    assert.strictEqual(b.availabilityPercentage, 50);
    assert.strictEqual(b.assignmentRate, 50);
    assert.strictEqual(b.hasSubmitted, true);
    assert.strictEqual(b.submissionStatus, "הוגש");

    // Worker C: unsubmitted constraints -> opened = 0, closed = 0, assigned = 0
    // Availability %: 0%
    // Status: "לא הוגש"
    assert.strictEqual(c.opened, 0);
    assert.strictEqual(c.closed, 0);
    assert.strictEqual(c.assigned, 0);
    assert.strictEqual(c.availabilityPercentage, 0);
    assert.strictEqual(c.assignmentRateFormatted, "-");
    assert.strictEqual(c.hasSubmitted, false);
    assert.strictEqual(c.submissionStatus, "לא הוגש");

    // Default ranking must be by availability percentage descending: A (90%) > B (50%) > C (0%)
    assert.strictEqual(res.records[0].name, "עובד א");
    assert.strictEqual(res.records[1].name, "עובד ב");
    assert.strictEqual(res.records[2].name, "עובד ג");
  });

  // Test 3: Overlapping schedule replacement preserves historical non-overlapping dates and avoids double-counting
  test("3. Overlapping schedule replacement: preserves non-overlapping historical dates and prevents double counting", () => {
    // Schedule 1: March 1 - March 14 (saved at 10:00)
    const days1 = [];
    for (let i = 1; i <= 14; i++) {
      const dayStr = i < 10 ? `0${i}` : `${i}`;
      days1.push({ iso: `2026-03-${dayStr}`, monthKey: "2026-03", closed: false });
    }
    const schedule1 = {
      id: "2026-03-01_2026-03-14",
      startDate: "2026-03-01",
      endDate: "2026-03-14",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot: days1,
      workerConstraintsSnapshot: {
        "עובד א": { hasSubmitted: true, submittedDays: days1.map(d => d.iso), blockedDays: [] }
      },
      // Worker A was assigned on days 1, 2, 8
      assignments: [
        { iso: "2026-03-01", monthKey: "2026-03", slot1: "עובד א", slot2: null },
        { iso: "2026-03-02", monthKey: "2026-03", slot1: "עובד א", slot2: null },
        { iso: "2026-03-08", monthKey: "2026-03", slot1: "עובד א", slot2: null }
      ]
    };

    // Schedule 2: March 8 - March 21 (saved later at 12:00, overlapping on days 8-14)
    const days2 = [];
    for (let i = 8; i <= 21; i++) {
      const dayStr = i < 10 ? `0${i}` : `${i}`;
      days2.push({ iso: `2026-03-${dayStr}`, monthKey: "2026-03", closed: false });
    }
    const schedule2 = {
      id: "2026-03-08_2026-03-21",
      startDate: "2026-03-08",
      endDate: "2026-03-21",
      savedAt: "2026-03-08T12:00:00Z",
      status: "active",
      daysSnapshot: days2,
      workerConstraintsSnapshot: {
        "עובד א": { hasSubmitted: true, submittedDays: days2.map(d => d.iso), blockedDays: [] },
        "עובד ב": { hasSubmitted: true, submittedDays: days2.map(d => d.iso), blockedDays: [] }
      },
      // In Schedule 2, day 8 was given to Worker B instead of Worker A!
      assignments: [
        { iso: "2026-03-08", monthKey: "2026-03", slot1: "עובד ב", slot2: null },
        { iso: "2026-03-15", monthKey: "2026-03", slot1: "עובד ב", slot2: null }
      ]
    };

    const res = fairness.calculateAggregatedFairness([schedule1, schedule2], "cumulative");

    // Total unique eligible days: March 1 to 21 = 21 days!
    assert.strictEqual(res.totalEligibleDays, 21, "Total eligible days must deduplicate overlap (21 days)");

    const a = res.records.find(r => r.name === "עובד א");
    const b = res.records.find(r => r.name === "עובד ב");

    // Worker A:
    // Days 1..7 come from Schedule 1 -> 7 opened days, 2 assigned (days 1, 2)
    // Days 8..21 come from Schedule 2 -> 14 opened days, 0 assigned (day 8 was superseded by Worker B)
    // Total opened = 7 + 14 = 21. Total assigned = 2.
    assert.strictEqual(a.opened, 21);
    assert.strictEqual(a.assigned, 2, "Day 8 assignment was replaced by schedule2");

    // Worker B:
    // Only in schedule 2 (14 days, days 8..21). Assigned on day 8 and 15 -> 2 assignments
    assert.strictEqual(b.opened, 14);
    assert.strictEqual(b.assigned, 2);
  });

  // Test 4: Monthly filter vs Cumulative view
  test("4. Monthly filter isolates correct month while cumulative aggregates both", () => {
    const marchDay = { iso: "2026-03-15", monthKey: "2026-03", closed: false };
    const aprilDay = { iso: "2026-04-10", monthKey: "2026-04", closed: false };

    const marchSchedule = {
      id: "march",
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      savedAt: "2026-03-01T10:00:00Z",
      status: "active",
      daysSnapshot: [marchDay],
      workerConstraintsSnapshot: {
        "דן": { hasSubmitted: true, submittedDays: [marchDay.iso], blockedDays: [] }
      },
      assignments: [{ iso: marchDay.iso, monthKey: "2026-03", slot1: "דן", slot2: null }]
    };

    const aprilSchedule = {
      id: "april",
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      savedAt: "2026-04-01T10:00:00Z",
      status: "active",
      daysSnapshot: [aprilDay],
      workerConstraintsSnapshot: {
        "דן": { hasSubmitted: true, submittedDays: [aprilDay.iso], blockedDays: [] }
      },
      assignments: [{ iso: aprilDay.iso, monthKey: "2026-04", slot1: "דן", slot2: null }]
    };

    const schedules = [marchSchedule, aprilSchedule];

    // March view
    const marchRes = fairness.calculateAggregatedFairness(schedules, "2026-03");
    assert.strictEqual(marchRes.totalEligibleDays, 1);
    assert.strictEqual(marchRes.records[0].opened, 1);
    assert.strictEqual(marchRes.records[0].assigned, 1);

    // April view
    const aprilRes = fairness.calculateAggregatedFairness(schedules, "2026-04");
    assert.strictEqual(aprilRes.totalEligibleDays, 1);
    assert.strictEqual(aprilRes.records[0].opened, 1);
    assert.strictEqual(aprilRes.records[0].assigned, 1);

    // Cumulative view
    const cumRes = fairness.calculateAggregatedFairness(schedules, "cumulative");
    assert.strictEqual(cumRes.totalEligibleDays, 2);
    assert.strictEqual(cumRes.records[0].opened, 2);
    assert.strictEqual(cumRes.records[0].assigned, 2);

    // Available months helper
    const availableMonths = fairness.getAvailableMonths(schedules);
    assert.deepStrictEqual(availableMonths, ["2026-03", "2026-04"]);
    assert.strictEqual(fairness.formatMonthLabel("2026-03"), "מרץ 2026");
    assert.strictEqual(fairness.formatMonthLabel("2026-04"), "אפריל 2026");
  });

  // Test 5: Overlap detection helper
  test("5. findOverlappingOfficialSchedules finds overlapping ranges correctly", () => {
    const list = [
      { id: "p1", startDate: "2026-03-01", endDate: "2026-03-14", status: "active" },
      { id: "p2", startDate: "2026-03-15", endDate: "2026-03-28", status: "active" },
      { id: "p3", startDate: "2026-04-01", endDate: "2026-04-14", status: "archived" }
    ];

    const overlaps = fairness.findOverlappingOfficialSchedules(list, "2026-03-10", "2026-03-20");
    assert.strictEqual(overlaps.length, 2, "Should find p1 and p2");
    assert.strictEqual(overlaps[0].id, "p1");
    assert.strictEqual(overlaps[1].id, "p2");

    const nonOverlap = fairness.findOverlappingOfficialSchedules(list, "2026-03-29", "2026-03-31");
    assert.strictEqual(nonOverlap.length, 0);
  });

  // Test 6: Official schedule exact matching regression tests
  test("6. isScheduleMatchingOfficial: exact assignment matching vs drafts and edits", () => {
    const mockSchedule = {
      0: [
        { day: { iso: "2026-03-01" }, first: { name: "הוד" }, second: { name: "אשרקת" } },
        { day: { iso: "2026-03-02" }, first: { name: "דני" }, second: { name: "-" } }
      ]
    };

    const savedOfficialRecord = {
      id: "2026-03-01_2026-03-02",
      status: "active",
      assignments: [
        { iso: "2026-03-01", slot1: "הוד", slot2: "אשרקת" },
        { iso: "2026-03-02", slot1: "דני", slot2: null }
      ]
    };

    // Exact match -> true
    assert.strictEqual(fairness.isScheduleMatchingOfficial(mockSchedule, savedOfficialRecord), true, "Identical schedule must match");

    // Edit slot 1 -> false
    const editedSchedule1 = {
      0: [
        { day: { iso: "2026-03-01" }, first: { name: "רוני" }, second: { name: "אשרקת" } },
        { day: { iso: "2026-03-02" }, first: { name: "דני" }, second: { name: "-" } }
      ]
    };
    assert.strictEqual(fairness.isScheduleMatchingOfficial(editedSchedule1, savedOfficialRecord), false, "Edited slot1 must not match");

    // Edit slot 2 -> false
    const editedSchedule2 = {
      0: [
        { day: { iso: "2026-03-01" }, first: { name: "הוד" }, second: { name: "רוני" } },
        { day: { iso: "2026-03-02" }, first: { name: "דני" }, second: { name: "-" } }
      ]
    };
    assert.strictEqual(fairness.isScheduleMatchingOfficial(editedSchedule2, savedOfficialRecord), false, "Edited slot2 must not match");

    // Different draft schedule for same period -> false
    const newDraftSchedule = {
      0: [
        { day: { iso: "2026-03-01" }, first: { name: "מיכל" }, second: { name: "דני" } },
        { day: { iso: "2026-03-02" }, first: { name: "הוד" }, second: { name: "אשרקת" } }
      ]
    };
    assert.strictEqual(fairness.isScheduleMatchingOfficial(newDraftSchedule, savedOfficialRecord), false, "New draft with different assignments must not match");

    // Null or undefined schedule -> false
    assert.strictEqual(fairness.isScheduleMatchingOfficial(null, savedOfficialRecord), false, "Null schedule must return false");

    // Archived record -> false
    const archivedRecord = { ...savedOfficialRecord, status: "archived" };
    assert.strictEqual(fairness.isScheduleMatchingOfficial(mockSchedule, archivedRecord), false, "Archived record must return false");
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
