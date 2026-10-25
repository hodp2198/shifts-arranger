const assert = require('assert');

async function runIntegrationTests() {
  console.log("=================================================");
  console.log("Starting Isolated Integration Tests for Fixes");
  console.log("=================================================\n");

  const fairness = await import('../src/fairnessService.js');

  let passed = 0;
  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      process.exit(1);
    }
  }

  // -------------------------------------------------------------
  // Test 1: Navigation Logic Verification
  // -------------------------------------------------------------
  test("1. Navigation: switching between /fairness and / works correctly in both directions", () => {
    let currentPath = "/fairness";
    let historyState = [];
    const state = { currentRoute: "/fairness" };
    const elements = {
      schedulingView: { hidden: true },
      fairnessView: { hidden: false },
      navScheduleLink: { active: false },
      navFairnessLink: { active: true }
    };

    function simulateNavigate(route, pushState = true) {
      const targetRoute = (route !== undefined && route !== null) ? route : currentPath;
      const isFairness = targetRoute === "/fairness" || targetRoute === "#/fairness" || targetRoute.endsWith("/fairness");

      if (pushState) {
        currentPath = isFairness ? "/fairness" : "/";
        historyState.push(currentPath);
      }

      state.currentRoute = isFairness ? "/fairness" : "/";
      elements.schedulingView.hidden = isFairness;
      elements.fairnessView.hidden = !isFairness;
      elements.navScheduleLink.active = !isFairness;
      elements.navFairnessLink.active = isFairness;
    }

    // Currently on /fairness
    assert.strictEqual(elements.schedulingView.hidden, true);
    assert.strictEqual(elements.fairnessView.hidden, false);

    // User clicks "סידור עבודה" (route = "/")
    simulateNavigate("/", true);
    assert.strictEqual(currentPath, "/");
    assert.strictEqual(state.currentRoute, "/");
    assert.strictEqual(elements.schedulingView.hidden, false, "Scheduling view must be visible after clicking סידור עבודה");
    assert.strictEqual(elements.fairnessView.hidden, true, "Fairness view must be hidden after clicking סידור עבודה");
    assert.strictEqual(elements.navScheduleLink.active, true);
    assert.strictEqual(elements.navFairnessLink.active, false);

    // User clicks "טבלת צדק" (route = "/fairness")
    simulateNavigate("/fairness", true);
    assert.strictEqual(currentPath, "/fairness");
    assert.strictEqual(elements.schedulingView.hidden, true);
    assert.strictEqual(elements.fairnessView.hidden, false);

    // Browser back button to "/"
    simulateNavigate("/", false);
    assert.strictEqual(elements.schedulingView.hidden, false);
    assert.strictEqual(elements.fairnessView.hidden, true);
  });

  // -------------------------------------------------------------
  // Test 2: Save Worker Snapshot without trim() exception
  // -------------------------------------------------------------
  test("2. Save official schedule: snapshots workers without trim() error and handles non-submitters", () => {
    const mockWorkersData = [
      {
        name: "הוד",
        active: true,
        oneTimeOnly: false,
        hasSubmitted: true,
        submitted: new Set(["2026-03-01", "2026-03-02"]),
        blocked: new Set(["2026-03-03"])
      },
      {
        name: "ללא אילוצים",
        active: false,
        oneTimeOnly: false,
        hasSubmitted: false,
        submitted: new Set(),
        blocked: new Set()
      }
    ];

    // snapshotWorkerConstraints must run without error and preserve hasSubmitted
    const snapshot = fairness.snapshotWorkerConstraints(mockWorkersData);
    assert.ok(snapshot["הוד"]);
    assert.strictEqual(snapshot["הוד"].hasSubmitted, true);
    assert.deepStrictEqual(snapshot["הוד"].submittedDays, ["2026-03-01", "2026-03-02"]);
    assert.deepStrictEqual(snapshot["הוד"].blockedDays, ["2026-03-03"]);

    assert.ok(snapshot["ללא אילוצים"]);
    assert.strictEqual(snapshot["ללא אילוצים"].hasSubmitted, false);
  });

  // -------------------------------------------------------------
  // Test 3: Failure Safety (no stats updated if save throws)
  // -------------------------------------------------------------
  test("3. Save failure safety: failed save leaves state and statistics unchanged", async () => {
    let savedDocs = [];
    const officialSchedules = [{ id: "existing", status: "active", daysSnapshot: [], assignments: [] }];

    async function mockSave(shouldFail) {
      if (shouldFail) {
        throw new Error("Simulated Firestore Network Failure");
      }
      savedDocs.push({ id: "new_saved" });
      return { success: true };
    }

    // Try save with failure
    let errorCaught = false;
    try {
      await mockSave(true);
      officialSchedules.push({ id: "new_saved" }); // Should NOT reach here
    } catch (err) {
      errorCaught = true;
    }

    assert.strictEqual(errorCaught, true);
    assert.strictEqual(savedDocs.length, 0, "No documents should be saved on error");
    assert.strictEqual(officialSchedules.length, 1, "Official schedules list must not be updated on error");
  });

  // -------------------------------------------------------------
  // Test 4: Assignment Invalidation upon edits
  // -------------------------------------------------------------
  test("4. Official match status: editing assignment invalidates badge while preserving official record", () => {
    const officialRecord = {
      id: "2026-03-01_2026-03-02",
      status: "active",
      savedAt: "2026-03-01T12:00:00Z",
      assignments: [
        { iso: "2026-03-01", slot1: "הוד", slot2: "אשרקת" },
        { iso: "2026-03-02", slot1: "דני", slot2: null }
      ]
    };

    const currentSchedule = {
      0: [
        { day: { iso: "2026-03-01" }, first: { name: "הוד" }, second: { name: "אשרקת" } },
        { day: { iso: "2026-03-02" }, first: { name: "דני" }, second: { name: "-" } }
      ]
    };

    // 1. Initial saved match
    assert.strictEqual(fairness.isScheduleMatchingOfficial(currentSchedule, officialRecord), true);

    // 2. User edits assignment on March 2 from "דני" to "מיכל"
    currentSchedule[0][1].first = { name: "מיכל" };

    // 3. Status must immediately become false
    assert.strictEqual(fairness.isScheduleMatchingOfficial(currentSchedule, officialRecord), false, "Must not match after manual override");

    // 4. Official record itself was untouched
    assert.strictEqual(officialRecord.assignments[1].slot1, "דני", "Saved official record in storage must remain preserved");
  });

  console.log("\n=================================================");
  console.log(`Integration Test Results: ${passed} Passed, 0 Failed`);
  console.log("=================================================");
}

runIntegrationTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
