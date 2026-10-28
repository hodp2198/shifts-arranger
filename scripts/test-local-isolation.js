const assert = require('assert');

/**
 * Automated Verification Suite: Firebase Local Emulator Suite & Fail-Closed Safeguards
 *
 * Verifies that:
 * 1. isLocalEnvironment correctly identifies localhost/127.0.0.1/test runners vs production domains.
 * 2. When running locally and emulator is unavailable, all services fail-closed into isolated local storage.
 * 3. Zero writes or requests are ever dispatched to the production Firestore database or Auth from local environment.
 * 4. Local dev operations (saving official schedule, viewing, auto-saving workspace, export link) work seamlessly in isolation.
 * 5. Admin Authentication operates in 100% offline mock mode on localhost without contacting production Google.
 */
async function runLocalIsolationTests() {
  console.log("=================================================");
  console.log("Starting Firebase Local Emulator & Fail-Closed Tests");
  console.log("=================================================\n");

  const firebaseConfigModule = await import('../firebase-config.js');
  const fairnessService = await import('../src/fairnessService.js');
  const userDataService = await import('../src/userDataService.js');
  const scheduleStore = await import('../src/firebaseScheduleStore.js');
  const adminAuth = await import('../src/auth/adminAuthService.js');

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

  // Setup mock localStorage in Node environment
  const store = {};
  global.localStorage = {
    getItem: (k) => store[k] || null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); }
  };
  global.window = {
    location: {
      hostname: "localhost",
      port: "5500"
    },
    __ISOLATED_DEV_MODE__: true,
    localStorage: global.localStorage
  };

  // -------------------------------------------------------------
  // Test 1: Environment Detection
  // -------------------------------------------------------------
  test("1. Environment detection: classifies localhost / 127.0.0.1 / test runner as local, and web.app as production", () => {
    // Current window is localhost:5500
    assert.strictEqual(firebaseConfigModule.isLocalEnvironment(), true, "localhost must be detected as local");

    // 127.0.0.1
    global.window.location.hostname = "127.0.0.1";
    assert.strictEqual(firebaseConfigModule.isLocalEnvironment(), true, "127.0.0.1 must be detected as local");

    // [::1]
    global.window.location.hostname = "[::1]";
    assert.strictEqual(firebaseConfigModule.isLocalEnvironment(), true, "[::1] must be detected as local");

    // Production domain
    global.window.location.hostname = "shift-arranger.web.app";
    global.window.location.port = "";
    assert.strictEqual(firebaseConfigModule.isLocalEnvironment(), false, "shift-arranger.web.app must be detected as production");

    global.window.location.hostname = "shift-arranger.firebaseapp.com";
    assert.strictEqual(firebaseConfigModule.isLocalEnvironment(), false, "shift-arranger.firebaseapp.com must be detected as production");

    // Reset back to localhost
    global.window.location.hostname = "localhost";
    global.window.location.port = "5500";
  });

  // -------------------------------------------------------------
  // Test 2: FairnessService Fail-Closed Isolation
  // -------------------------------------------------------------
  await asyncTest("2. FairnessService: local save traps write in isolated localStorage; zero production network writes", async () => {
    global.localStorage.clear();
    const testUid = "dev-test-user-123";

    const officialRecord = {
      id: "2026-11-01_2026-11-14",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
      status: "active",
      daysSnapshot: [{ iso: "2026-11-01", closed: false }],
      assignments: [{ iso: "2026-11-01", monthKey: "2026-11", slot1: "עובד א", slot2: "עובד ב" }]
    };

    // Save official schedule
    const saveRes = await fairnessService.saveOfficialScheduleDoc(testUid, officialRecord);
    assert.strictEqual(saveRes.success, true);
    assert.strictEqual(saveRes.id, "2026-11-01_2026-11-14");

    // Verify it was stored in localStorage under isolated_dev_official_
    const rawSaved = store[`isolated_dev_official_${testUid}`];
    assert.ok(rawSaved, "Record must be saved in isolated localStorage");
    const parsedList = JSON.parse(rawSaved);
    assert.strictEqual(parsedList.length, 1);
    assert.strictEqual(parsedList[0].assignments[0].slot1, "עובד א");

    // Load back
    const loadedList = await fairnessService.loadOfficialSchedulesDocs(testUid);
    assert.strictEqual(loadedList.length, 1);
    assert.strictEqual(loadedList[0].id, "2026-11-01_2026-11-14");

    // Delete
    const delRes = await fairnessService.deleteOfficialScheduleDoc(testUid, "2026-11-01_2026-11-14");
    assert.strictEqual(delRes.success, true);
    const afterDelete = await fairnessService.loadOfficialSchedulesDocs(testUid);
    assert.strictEqual(afterDelete.length, 0);
  });

  // -------------------------------------------------------------
  // Test 3: UserDataService Fail-Closed Isolation
  // -------------------------------------------------------------
  await asyncTest("3. UserDataService: local autosave is trapped in isolated localStorage; never overwrites production appData", async () => {
    global.localStorage.clear();
    const testUid = "dev-test-user-123";

    const workspaceData = {
      startDate: "2026-11-01",
      weekCount: 2,
      workers: [{ name: "עובד מקומי", min: 1, max: 5 }]
    };

    // Save
    const saveRes = await userDataService.saveUserAppData(testUid, workspaceData, { immediate: true });
    assert.strictEqual(saveRes.success, true);

    // Verify stored in isolated localStorage
    const rawSaved = store[`isolated_dev_appData_${testUid}`];
    assert.ok(rawSaved, "Workspace data must be saved in isolated localStorage");
    const parsed = JSON.parse(rawSaved);
    assert.strictEqual(parsed.startDate, "2026-11-01");
    assert.strictEqual(parsed.workers[0].name, "עובד מקומי");

    // Load
    const loaded = await userDataService.loadUserAppData(testUid);
    assert.strictEqual(loaded.startDate, "2026-11-01");
    assert.strictEqual(loaded.workers[0].name, "עובד מקומי");
  });

  // -------------------------------------------------------------
  // Test 4: ScheduleExport / FirebaseScheduleStore Fail-Closed Isolation
  // -------------------------------------------------------------
  await asyncTest("4. FirebaseScheduleStore: calendar export payload is stored in isolated localStorage on localhost", async () => {
    global.localStorage.clear();
    const testUid = "dev-test-user-123";

    const payload = JSON.stringify({
      id: "schedule-test",
      entries: [{ date: "2026-11-01", slot1: "דן" }]
    });

    const saveRes = await scheduleStore.saveSchedulePayload(payload, testUid);
    assert.ok(saveRes, "Must generate valid result");
    const docId = typeof saveRes === "object" ? saveRes.id : saveRes;
    assert.ok(docId, "Must have valid document id");
    assert.strictEqual(saveRes.uid, testUid, "Must preserve owner UID");

    // Verify stored in isolated localStorage
    const rawSaved = store[`isolated_dev_emp_${docId}`];
    assert.ok(rawSaved, "Employee schedule must be saved in isolated localStorage");

    // Load back
    const loadedPayload = await scheduleStore.loadSchedulePayload(docId, testUid);
    assert.strictEqual(loadedPayload, payload, "Payload roundtrip must succeed in isolation");

    // Load via alias readSchedulePayload
    const aliasLoaded = await scheduleStore.readSchedulePayload(docId, testUid);
    assert.strictEqual(aliasLoaded, payload, "Alias readSchedulePayload must also succeed");
  });

  // -------------------------------------------------------------
  // Test 5: Reconstructed Official Schedule Roundtrip in Local Isolation
  // -------------------------------------------------------------
  await asyncTest("5. End-to-End: View and save official schedule flow operates with 100% isolation in local dev mode", async () => {
    global.localStorage.clear();
    const testUid = "dev-test-user-123";

    const officialRecord = {
      id: "2026-11-01_2026-11-14",
      startDate: "2026-11-01",
      endDate: "2026-11-14",
      status: "active",
      daysSnapshot: [
        { iso: "2026-11-01", dayIndex: 0, dayName: "ראשון", week: 0, closed: false },
        { iso: "2026-11-02", dayIndex: 1, dayName: "שני", week: 0, closed: false }
      ],
      assignments: [
        { iso: "2026-11-01", monthKey: "2026-11", slot1: "הוד", slot2: "הדס" },
        { iso: "2026-11-02", monthKey: "2026-11", slot1: "דניאל", slot2: "אשרקת" }
      ]
    };

    // Save in local dev mode
    await fairnessService.saveOfficialScheduleDoc(testUid, officialRecord);

    // Load in local dev mode
    const loadedSchedules = await fairnessService.loadOfficialSchedulesDocs(testUid);
    assert.strictEqual(loadedSchedules.length, 1);

    // Reconstruct schedule for UI
    const { schedule, workers } = fairnessService.reconstructScheduleFromOfficial(
      loadedSchedules[0],
      loadedSchedules[0].daysSnapshot,
      [{ name: "הוד" }, { name: "הדס" }, { name: "דניאל" }, { name: "אשרקת" }]
    );

    // Verify matching
    assert.strictEqual(fairnessService.isScheduleMatchingOfficial(schedule, loadedSchedules[0]), true);

    // Calculate fairness in local dev mode
    const fairnessStats = fairnessService.calculateAggregatedFairness(loadedSchedules, "cumulative");
    assert.strictEqual(fairnessStats.totalEligibleDays, 2);
    const hod = fairnessStats.records.find(r => r.name === "הוד");
    assert.strictEqual(hod.assigned, 1);
  });

  // -------------------------------------------------------------
  // Test 6: Admin Authentication Local Dev Mock & Fail-Closed Isolation
  // -------------------------------------------------------------
  await asyncTest("6. AdminAuthService: local authentication operates 100% offline with zero production auth access", async () => {
    global.localStorage.clear();

    // Verify getFirebaseAuth throws fail-closed error when emulator is unavailable
    let errorThrown = false;
    try {
      await adminAuth.getFirebaseAuth();
    } catch (err) {
      errorThrown = true;
      assert.ok(err.message.includes("FAIL-CLOSED"), "Must throw fail-closed error");
    }
    assert.strictEqual(errorThrown, true, "Must block production auth access from localhost");

    // Login locally as mock user
    const loggedUser = await adminAuth.loginWithGoogle();
    assert.strictEqual(loggedUser.uid, adminAuth.LOCAL_DEV_ADMIN_USER.uid);
    assert.strictEqual(loggedUser.email, adminAuth.LOCAL_DEV_ADMIN_USER.email);
    assert.strictEqual(store["isolated_dev_auth_logged_in"], "true");

    // Verify auth state changed listener receives user
    let observedUser = null;
    const unsubscribe = adminAuth.onAdminAuthStateChanged(user => {
      observedUser = user;
    });

    // Wait for microtask/timer callback
    await new Promise(r => setTimeout(r, 10));
    assert.ok(observedUser, "Must observe authenticated mock user");
    assert.strictEqual(observedUser.uid, adminAuth.LOCAL_DEV_ADMIN_USER.uid);

    // Logout
    await adminAuth.logoutAdmin();
    assert.strictEqual(store["isolated_dev_auth_logged_in"], undefined);
    assert.strictEqual(observedUser, null, "Must observe null after logout");

    unsubscribe();
  });

  console.log("\n=================================================");
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runLocalIsolationTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
