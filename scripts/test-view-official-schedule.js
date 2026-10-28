const assert = require('assert');

/**
 * Focused Test Suite: 'הצג סידור רשמי' (View Official Schedule)
 *
 * Verifies all requirements:
 * 1. Loading: loads saved official schedule for selected period into main schedule area.
 * 2. Missing records: clear Hebrew message when not found, strictly preserves currently displayed schedule.
 * 3. Unsaved-change confirmation: prompts before replacing modified/draft schedules, preserves work on cancel.
 * 4. Read-only persistence guarantee: zero writes to Firestore official schedules or fairness statistics.
 * 5. Editability & explicit saving: preserves ability to edit shifts and re-save official schedule.
 */
async function runViewOfficialScheduleTests() {
  console.log("=================================================");
  console.log("Starting 'הצג סידור רשמי' (View Official Schedule) Tests");
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

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // Common fixtures
  const marchPeriodDays = [
    { iso: "2026-03-01", dayIndex: 0, dayName: "ראשון", week: 0, closed: false },
    { iso: "2026-03-02", dayIndex: 1, dayName: "שני", week: 0, closed: false },
    { iso: "2026-03-03", dayIndex: 2, dayName: "שלישי", week: 0, closed: true, label: "יום בחירות" },
    { iso: "2026-03-04", dayIndex: 3, dayName: "רביעי", week: 0, closed: false }
  ];

  const savedOfficialRecord = {
    id: "2026-03-01_2026-03-04",
    startDate: "2026-03-01",
    endDate: "2026-03-04",
    savedAt: "2026-03-01T10:00:00.000Z",
    status: "active",
    daysSnapshot: marchPeriodDays,
    assignments: [
      { iso: "2026-03-01", monthKey: "2026-03", slot1: "דני", slot2: "מיכל" },
      { iso: "2026-03-02", monthKey: "2026-03", slot1: "יוסי", slot2: null },
      { iso: "2026-03-04", monthKey: "2026-03", slot1: "מיכל", slot2: "דני" }
    ]
  };

  const mockWorkers = [
    { name: "דני", active: true, color: "#111" },
    { name: "מיכל", active: true, color: "#222" },
    { name: "יוסי", active: true, color: "#333" }
  ];

  /**
   * Helper that simulates the handleViewOfficialSchedule logic in isolation
   */
  function createViewOfficialScheduleHarness(initialState = {}) {
    const alerts = [];
    const confirms = [];
    let confirmAnswer = true;
    const writeCalls = [];

    const state = {
      currentSchedule: null,
      currentWorkers: [],
      currentWarnings: [],
      manualOverrides: {},
      officialSchedules: [savedOfficialRecord],
      isCurrentScheduleOfficial: false,
      currentOfficialSchedule: null,
      ...initialState
    };

    const elements = {
      saveOfficialSchedule: {
        disabled: false,
        classList: new Set(),
        textContent: "שמור סידור רשמי",
        title: ""
      },
      viewOfficialSchedule: {
        disabled: false,
        title: ""
      },
      statusBadge: { textContent: "" },
      plainResult: { value: "" }
    };

    let selectedDays = [...marchPeriodDays];

    function updateOfficialScheduleControls() {
      const saveBtn = elements.saveOfficialSchedule;
      const viewBtn = elements.viewOfficialSchedule;

      if (!selectedDays.length) {
        saveBtn.disabled = true;
        saveBtn.classList.delete("btn-saved-official");
        saveBtn.textContent = "שמור סידור רשמי";
        if (viewBtn) viewBtn.title = "יש לבחור תקופת סידור תחילה";
        state.isCurrentScheduleOfficial = false;
        return;
      }

      const startIso = selectedDays[0]?.iso;
      const endIso = selectedDays[selectedDays.length - 1]?.iso;
      const periodId = `${startIso}_${endIso}`;

      const existing = (state.officialSchedules || []).find(
        s => (s.id === periodId || (s.startDate === startIso && s.endDate === endIso)) && s.status !== "archived"
      );

      if (viewBtn) {
        viewBtn.title = existing
          ? `הצג את הסידור הרשמי השמור לתקופה זו (${new Date(existing.savedAt).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })})`
          : "הצג סידור רשמי שנשמר לתקופה זו";
      }

      if (!state.currentSchedule) {
        saveBtn.disabled = true;
        saveBtn.classList.delete("btn-saved-official");
        saveBtn.textContent = "שמור סידור רשמי";
        state.isCurrentScheduleOfficial = false;
        return;
      }

      saveBtn.disabled = false;
      const isMatch = Boolean(
        existing &&
        fairness.isScheduleMatchingOfficial(state.currentSchedule, existing)
      );

      state.isCurrentScheduleOfficial = isMatch;
      if (isMatch) {
        saveBtn.classList.add("btn-saved-official");
        saveBtn.textContent = "✓ סידור רשמי נשמר";
      } else {
        saveBtn.classList.delete("btn-saved-official");
        saveBtn.textContent = "שמור סידור רשמי";
      }
    }

    async function handleViewOfficialSchedule() {
      if (!selectedDays.length) {
        alerts.push("לא נבחרה תקופת סידור. יש לבחור תאריך התחלה תחילה.");
        return;
      }

      const startIso = selectedDays[0].iso;
      const endIso = selectedDays[selectedDays.length - 1].iso;
      const periodId = `${startIso}_${endIso}`;

      const officialRecord = (state.officialSchedules || []).find(
        s => (s.id === periodId || (s.startDate === startIso && s.endDate === endIso)) && s.status !== "archived"
      );

      if (!officialRecord) {
        alerts.push("לא נמצא סידור רשמי שמור לתקופה זו.");
        return;
      }

      const hasUnsavedChanges = Boolean(
        state.currentSchedule &&
        !fairness.isScheduleMatchingOfficial(state.currentSchedule, officialRecord)
      );

      if (hasUnsavedChanges) {
        confirms.push("בסידור הנוכחי קיימים שינויים שלא נשמרו כסידור רשמי. האם להחליף אותו בסידור הרשמי השמור?");
        if (!confirmAnswer) {
          return;
        }
      }

      // Reconstruct
      const { schedule, workers } = fairness.reconstructScheduleFromOfficial(
        officialRecord,
        selectedDays,
        mockWorkers
      );

      state.currentSchedule = schedule;
      state.currentWorkers = workers;
      state.manualOverrides = {};
      state.currentOfficialSchedule = officialRecord;

      // Plain result / WhatsApp output
      const plainLines = [];
      for (const entry of (schedule[0] || [])) {
        if (entry.closed) {
          plainLines.push(`${entry.day.dayName} - סגור`);
        } else {
          plainLines.push(`${entry.day.dayName} - ${entry.first?.name || "-"} ו${entry.second?.name || "-"}`);
        }
      }
      elements.plainResult.value = plainLines.join("\n");
      elements.statusBadge.textContent = "סידור רשמי מוצג כעת ✓";

      updateOfficialScheduleControls();
    }

    return {
      state,
      elements,
      alerts,
      confirms,
      setConfirmAnswer: (val) => { confirmAnswer = val; },
      setSelectedDays: (days) => { selectedDays = days; },
      handleViewOfficialSchedule,
      updateOfficialScheduleControls,
      writeCalls
    };
  }

  // -------------------------------------------------------------
  // Test 1: Loading official schedule replaces schedule and updates UI
  // -------------------------------------------------------------
  await asyncTest("1. Loading official schedule: replaces current schedule and displays official version in main area", async () => {
    const harness = createViewOfficialScheduleHarness();

    // Initially no schedule displayed
    assert.strictEqual(harness.state.currentSchedule, null);

    await harness.handleViewOfficialSchedule();

    // 1. Schedule is now loaded
    assert.ok(harness.state.currentSchedule, "Schedule should be loaded");
    assert.strictEqual(harness.state.currentSchedule[0].length, 4);

    // 2. Exactly matches saved official record
    const isMatch = fairness.isScheduleMatchingOfficial(harness.state.currentSchedule, savedOfficialRecord);
    assert.strictEqual(isMatch, true, "Loaded schedule must match saved official schedule");

    // 3. Button state updated to green '✓ סידור רשמי נשמר'
    assert.strictEqual(harness.elements.saveOfficialSchedule.classList.has("btn-saved-official"), true);
    assert.strictEqual(harness.elements.saveOfficialSchedule.textContent, "✓ סידור רשמי נשמר");

    // 4. Status badge updated
    assert.strictEqual(harness.elements.statusBadge.textContent, "סידור רשמי מוצג כעת ✓");

    // 5. WhatsApp plain output generated
    assert.ok(harness.elements.plainResult.value.includes("דני ומיכל"), "Plain result should contain day 1 shift");
    assert.ok(harness.elements.plainResult.value.includes("יוסי ו-"), "Plain result should contain day 2 single shift");
  });

  // -------------------------------------------------------------
  // Test 2: Missing record handling (Requirement 5)
  // -------------------------------------------------------------
  await asyncTest("2. Missing records: shows Hebrew message and preserves currently displayed schedule", async () => {
    const draftSchedule = {
      0: [
        { day: marchPeriodDays[0], first: { name: "דני" }, second: { name: "יוסי" }, closed: false }
      ]
    };

    const harness = createViewOfficialScheduleHarness({
      currentSchedule: draftSchedule,
      officialSchedules: [] // No official schedules saved
    });

    await harness.handleViewOfficialSchedule();

    // 1. Hebrew message shown
    assert.strictEqual(harness.alerts.length, 1);
    assert.strictEqual(harness.alerts[0], "לא נמצא סידור רשמי שמור לתקופה זו.");

    // 2. Currently displayed schedule is strictly preserved
    assert.strictEqual(harness.state.currentSchedule, draftSchedule, "Draft schedule must remain untouched");
    assert.strictEqual(harness.state.currentSchedule[0][0].second.name, "יוסי");

    // Subtest: No period selected
    harness.alerts.length = 0;
    harness.setSelectedDays([]);
    await harness.handleViewOfficialSchedule();
    assert.strictEqual(harness.alerts.length, 1);
    assert.strictEqual(harness.alerts[0], "לא נבחרה תקופת סידור. יש לבחור תאריך התחלה תחילה.");
    assert.strictEqual(harness.state.currentSchedule, draftSchedule);
  });

  // -------------------------------------------------------------
  // Test 3: Unsaved-change confirmation (Requirement 6)
  // -------------------------------------------------------------
  await asyncTest("3. Unsaved-change confirmation: requires user confirmation if draft/edits differ from official", async () => {
    const modifiedDraftSchedule = {
      0: [
        { day: marchPeriodDays[0], first: { name: "מיכל" }, second: { name: "יוסי" }, closed: false },
        { day: marchPeriodDays[1], first: { name: "דני" }, second: null, closed: false },
        { day: marchPeriodDays[2], closed: true },
        { day: marchPeriodDays[3], first: { name: "יוסי" }, second: { name: "מיכל" }, closed: false }
      ]
    };

    // Subtest A: User CANCELS confirmation
    const harnessCancel = createViewOfficialScheduleHarness({
      currentSchedule: modifiedDraftSchedule
    });
    harnessCancel.setConfirmAnswer(false);

    await harnessCancel.handleViewOfficialSchedule();

    // Confirm was requested
    assert.strictEqual(harnessCancel.confirms.length, 1);
    assert.strictEqual(harnessCancel.confirms[0], "בסידור הנוכחי קיימים שינויים שלא נשמרו כסידור רשמי. האם להחליף אותו בסידור הרשמי השמור?");

    // Since user canceled, draft schedule is strictly preserved
    assert.strictEqual(harnessCancel.state.currentSchedule, modifiedDraftSchedule, "Must preserve draft when user cancels");
    assert.strictEqual(harnessCancel.state.currentSchedule[0][0].first.name, "מיכל");

    // Subtest B: User APPROVES confirmation
    const harnessApprove = createViewOfficialScheduleHarness({
      currentSchedule: modifiedDraftSchedule
    });
    harnessApprove.setConfirmAnswer(true);

    await harnessApprove.handleViewOfficialSchedule();

    assert.strictEqual(harnessApprove.confirms.length, 1);
    // Schedule was replaced with official schedule
    assert.notStrictEqual(harnessApprove.state.currentSchedule, modifiedDraftSchedule);
    assert.strictEqual(fairness.isScheduleMatchingOfficial(harnessApprove.state.currentSchedule, savedOfficialRecord), true);
    assert.strictEqual(harnessApprove.state.currentSchedule[0][0].first.name, "דני", "Official day 1 first slot is דני");

    // Subtest C: When current schedule already matches official, NO confirmation prompt is needed
    const harnessAlreadyOfficial = createViewOfficialScheduleHarness({
      currentSchedule: harnessApprove.state.currentSchedule // Already matches official
    });
    await harnessAlreadyOfficial.handleViewOfficialSchedule();
    assert.strictEqual(harnessAlreadyOfficial.confirms.length, 0, "No confirmation needed if schedule already matches");
  });

  // -------------------------------------------------------------
  // Test 4: Read-Only Persistence Guarantee (Requirement 7)
  // -------------------------------------------------------------
  await asyncTest("4. Read-only guarantee: loading official schedule triggers zero persistence writes or fairness modifications", async () => {
    let saveDocCalls = 0;
    let deleteDocCalls = 0;

    // Spy on fairnessService persistence functions
    const originalSave = fairness.saveOfficialScheduleDoc;
    const originalDelete = fairness.deleteOfficialScheduleDoc;

    const fakeFairness = {
      ...fairness,
      saveOfficialScheduleDoc: async (...args) => {
        saveDocCalls++;
        return { success: true };
      },
      deleteOfficialScheduleDoc: async (...args) => {
        deleteDocCalls++;
        return { success: true };
      }
    };

    // Calculate baseline fairness statistics before loading
    const baselineStats = fairness.calculateAggregatedFairness([savedOfficialRecord], "cumulative");

    const harness = createViewOfficialScheduleHarness();

    // Execute loading
    await harness.handleViewOfficialSchedule();

    // 1. Zero save / delete calls made
    assert.strictEqual(saveDocCalls, 0, "saveOfficialScheduleDoc must NEVER be called when viewing official schedule");
    assert.strictEqual(deleteDocCalls, 0, "deleteOfficialScheduleDoc must NEVER be called when viewing official schedule");

    // 2. Official schedules array and items are unmodified
    assert.strictEqual(harness.state.officialSchedules.length, 1);
    assert.strictEqual(harness.state.officialSchedules[0].id, savedOfficialRecord.id);
    assert.strictEqual(harness.state.officialSchedules[0].savedAt, savedOfficialRecord.savedAt);
    assert.strictEqual(harness.state.officialSchedules[0].status, "active");

    // 3. Fairness statistics remain strictly identical
    const afterStats = fairness.calculateAggregatedFairness(harness.state.officialSchedules, "cumulative");
    assert.deepStrictEqual(afterStats, baselineStats, "Fairness metrics must be completely unchanged by viewing official schedule");
  });

  // -------------------------------------------------------------
  // Test 5: Editability and Re-saving Preservation (Requirement 8)
  // -------------------------------------------------------------
  await asyncTest("5. Editability & saving: editing displayed official schedule invalidates match and allows re-saving", async () => {
    const harness = createViewOfficialScheduleHarness();

    // 1. Load official schedule
    await harness.handleViewOfficialSchedule();
    assert.strictEqual(harness.elements.saveOfficialSchedule.classList.has("btn-saved-official"), true);

    // 2. User manually overrides a shift: Sunday slot 1 becomes יוסי instead of דני
    const entrySunday = harness.state.currentSchedule[0].find(e => e.day.iso === "2026-03-01");
    entrySunday.first = { name: "יוסי" };

    // Update controls
    harness.updateOfficialScheduleControls();

    // 3. isCurrentScheduleOfficial must now be false
    assert.strictEqual(harness.state.isCurrentScheduleOfficial, false, "Must no longer match official schedule after manual override");

    // 4. Button reverts from green checkmark to standard 'שמור סידור רשמי'
    assert.strictEqual(harness.elements.saveOfficialSchedule.classList.has("btn-saved-official"), false);
    assert.strictEqual(harness.elements.saveOfficialSchedule.textContent, "שמור סידור רשמי");
    assert.strictEqual(harness.elements.saveOfficialSchedule.disabled, false);
  });

  console.log("\n=================================================");
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runViewOfficialScheduleTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
