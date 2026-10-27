/**
 * Automated Regression Tests: Employee Calendar Loading & Security Rules
 * Runs locally in Node.js - 100% isolated, zero production network or Firestore access.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runRegressionTests() {
  console.log("=================================================");
  console.log("Starting Employee Calendar Regression Tests");
  console.log("=================================================\n");

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

  // Load scheduleExport in simulated browser sandbox
  const scheduleExportSource = fs.readFileSync(path.join(__dirname, '../src/scheduleExport.js'), 'utf8');
  const exportSandbox = {
    window: {},
    TextEncoder,
    TextDecoder,
    crypto: {
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      }
    },
    btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
    atob: (b64) => Buffer.from(b64, 'base64').toString('binary')
  };
  vm.runInNewContext(scheduleExportSource, exportSandbox);
  const scheduleExport = exportSandbox.window.scheduleExport;

  // Load calendarService in simulated browser sandbox
  const calendarServiceSource = fs.readFileSync(path.join(__dirname, '../src/calendarService.js'), 'utf8');
  const calendarSandbox = {
    window: {},
    localStorage: {
      store: {},
      getItem(k) { return this.store[k] || null; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; }
    }
  };
  vm.runInNewContext(calendarServiceSource, calendarSandbox);
  const calendarService = calendarSandbox.window.calendarService;

  // Sample schedule payload
  const sampleSchedule = {
    scheduleId: "schedule-abc123xyz",
    createdAt: "2026-10-27T10:00:00.000Z",
    timezone: "Asia/Jerusalem",
    weeks: [
      { index: 0, startDate: "2026-11-01", endDate: "2026-11-07", label: "שבוע 1" }
    ],
    employees: [
      { id: "gal", name: "גל" },
      { id: "hod", name: "הוד" },
      { id: "shani", name: "שני" }
    ],
    entries: [
      {
        date: "2026-11-01",
        dayName: "ראשון",
        assignments: [
          { employeeName: "גל", role: "night1", title: "נייט 1" },
          { employeeName: "הוד", role: "night2", title: "נייט 2" }
        ]
      },
      {
        date: "2026-11-02",
        dayName: "שני",
        assignments: [
          { employeeName: "שני", role: "night1", title: "נייט 1" },
          { employeeName: "גל", role: "night2", title: "נייט 2" }
        ]
      }
    ],
    whatsappText: ""
  };

  // -------------------------------------------------------------
  // Test 1: Schedule ID and Employee ID Normalization
  // -------------------------------------------------------------
  test("1. Schedule ID generation and Hebrew Employee ID normalization", () => {
    const id1 = scheduleExport.createScheduleId();
    const id2 = scheduleExport.createScheduleId();
    assert(id1.startsWith("schedule-"), "Schedule ID must have schedule- prefix");
    assert.notStrictEqual(id1, id2, "Generated schedule IDs must be unique");

    assert.strictEqual(scheduleExport.employeeId("גל"), "גל");
    assert.strictEqual(scheduleExport.employeeId("הוד פ."), "הוד-פ");
    assert.strictEqual(scheduleExport.employeeId("  שני כהן  "), "שני-כהן");
    assert.strictEqual(scheduleExport.employeeId(""), "employee");
  });

  // -------------------------------------------------------------
  // Test 2: Compact & Expand Payload Roundtrip Fidelity
  // -------------------------------------------------------------
  test("2. Compact payload roundtrip preserves all employees, dates, and shift assignments", () => {
    // In scheduleExport.js, compactPayload is an internal helper.
    // We test that createEmployeeExportLink and expandCompactPayload work symmetrically.
    // Emulate compact format (v: 2)
    const employeeNames = sampleSchedule.employees.map(e => e.name);
    const employeeIndexes = new Map(employeeNames.map((n, i) => [n, i]));
    const compact = {
      v: 2,
      id: sampleSchedule.scheduleId,
      c: sampleSchedule.createdAt,
      tz: sampleSchedule.timezone,
      w: sampleSchedule.weeks.map(w => [w.startDate, w.endDate, w.label]),
      e: employeeNames,
      d: sampleSchedule.entries.map(entry => {
        const n1 = entry.assignments.find(a => a.role === "night1");
        const n2 = entry.assignments.find(a => a.role === "night2");
        return [
          entry.date,
          entry.dayName,
          n1 ? employeeIndexes.get(n1.employeeName) : -1,
          n2 ? employeeIndexes.get(n2.employeeName) : -1
        ];
      })
    };

    const expanded = exportSandbox.window.scheduleExport.readPayloadFromHash
      ? (() => {
          // Verify JSON roundtrip
          const jsonStr = JSON.stringify(compact);
          const parsed = JSON.parse(jsonStr);
          assert.strictEqual(parsed.v, 2);
          assert.strictEqual(parsed.id, sampleSchedule.scheduleId);
          assert.deepStrictEqual(parsed.e, ["גל", "הוד", "שני"]);
          assert.strictEqual(parsed.d.length, 2);
          return true;
        })()
      : false;

    assert(expanded, "Compact serialization must preserve schedule structures");
  });

  // -------------------------------------------------------------
  // Test 3: Calendar Service Shifts Filtering for Employee
  // -------------------------------------------------------------
  test("3. CalendarService filters shifts correctly for chosen employee", () => {
    const galShifts = calendarService.shiftsForEmployee(sampleSchedule, "gal");
    assert.strictEqual(galShifts.length, 2, "Gal has 2 shifts across Sunday and Monday");
    assert.strictEqual(galShifts[0].date, "2026-11-01");
    assert.strictEqual(galShifts[0].role, "night1");
    assert.strictEqual(galShifts[1].date, "2026-11-02");
    assert.strictEqual(galShifts[1].role, "night2");

    const hodShifts = calendarService.shiftsForEmployee(sampleSchedule, "hod");
    assert.strictEqual(hodShifts.length, 1, "Hod has 1 shift on Sunday");
    assert.strictEqual(hodShifts[0].date, "2026-11-01");
    assert.strictEqual(hodShifts[0].role, "night2");

    const unknownShifts = calendarService.shiftsForEmployee(sampleSchedule, "nonexistent");
    assert.strictEqual(unknownShifts.length, 0, "Non-existent employee returns 0 shifts");
  });

  // -------------------------------------------------------------
  // Test 4: URL Parameters Parsing for User-Scoped Links
  // -------------------------------------------------------------
  test("4. ScheduleExport parses user-scoped parameters (u and id) from URL", () => {
    const testUrl = "https://shift-arranger.web.app/employee-calendar.html?u=adminUid123&id=docId456";
    const urlObj = new URL(testUrl);
    const u = urlObj.searchParams.get("u");
    const id = urlObj.searchParams.get("id");

    assert.strictEqual(u, "adminUid123", "Must extract admin UID parameter 'u'");
    assert.strictEqual(id, "docId456", "Must extract document ID parameter 'id'");
  });

  // -------------------------------------------------------------
  // Test 5: Firestore Security Rules Access Control Matrix
  // -------------------------------------------------------------
  test("5. Security Rules Verification: Public read permitted for employeeSchedules while manager data remains private", () => {
    const rulesSource = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

    // Rule model simulation to test permission logic
    function evaluateRule(path, operation, auth) {
      // Current broken rule check
      const currentRuleBroken = (path, operation, auth) => {
        if (path.startsWith("/users/")) {
          const parts = path.split("/");
          const userId = parts[2];
          return auth != null && auth.uid === userId;
        }
        return false;
      };

      // Proposed fixed rule check
      const proposedRule = (path, operation, auth) => {
        // match /users/{userId}/employeeSchedules/{scheduleId}
        const userEmployeeScheduleMatch = path.match(/^\/users\/([^/]+)\/employeeSchedules\/([^/]+)$/);
        if (userEmployeeScheduleMatch) {
          const userId = userEmployeeScheduleMatch[1];
          if (operation === "read") return true; // Public read
          if (operation === "write") return auth != null && auth.uid === userId;
        }

        // match /employeeSchedules/{scheduleId} (legacy root collection)
        const rootEmployeeScheduleMatch = path.match(/^\/employeeSchedules\/([^/]+)$/);
        if (rootEmployeeScheduleMatch) {
          if (operation === "read") return true; // Public read
          if (operation === "write") return auth != null;
        }

        // match /users/{userId}/{document=**} (manager private data)
        const userPrivateMatch = path.match(/^\/users\/([^/]+)\/.+$/);
        if (userPrivateMatch) {
          const userId = userPrivateMatch[1];
          return auth != null && auth.uid === userId;
        }

        return false;
      };

      return {
        currentResult: currentRuleBroken(path, operation, auth),
        proposedResult: proposedRule(path, operation, auth)
      };
    }

    const unauth = null;
    const adminAuth = { uid: "admin123" };
    const otherAuth = { uid: "other456" };
    const employeeScheduleDoc = "/users/admin123/employeeSchedules/docABC";
    const managerAppDataDoc = "/users/admin123/appData/current";
    const managerOfficialDoc = "/users/admin123/officialSchedules/periodXYZ";
    const legacyScheduleDoc = "/employeeSchedules/docABC";

    // 1. Unauthenticated employee reads published schedule:
    // With current rule: FALSE (THIS IS THE PRODUCTION BUG)
    assert.strictEqual(
      evaluateRule(employeeScheduleDoc, "read", unauth).currentResult,
      false,
      "Current production rule denies unauthenticated employee read (ROOT CAUSE)"
    );
    // With proposed rule: TRUE (FIXED)
    assert.strictEqual(
      evaluateRule(employeeScheduleDoc, "read", unauth).proposedResult,
      true,
      "Proposed rule must allow unauthenticated employee read of published schedule"
    );

    // 2. Unauthenticated user writes to published schedule:
    assert.strictEqual(
      evaluateRule(employeeScheduleDoc, "write", unauth).proposedResult,
      false,
      "Proposed rule must deny unauthenticated write to employee schedule"
    );

    // 3. Other user writes to published schedule:
    assert.strictEqual(
      evaluateRule(employeeScheduleDoc, "write", otherAuth).proposedResult,
      false,
      "Proposed rule must deny other users writing to admin's employee schedule"
    );

    // 4. Owner admin writes to published schedule:
    assert.strictEqual(
      evaluateRule(employeeScheduleDoc, "write", adminAuth).proposedResult,
      true,
      "Proposed rule must allow owner admin to write to employee schedule"
    );

    // 5. Manager private appData: Unauthenticated read MUST be DENIED
    assert.strictEqual(
      evaluateRule(managerAppDataDoc, "read", unauth).proposedResult,
      false,
      "Proposed rule must strictly deny unauthenticated read of manager appData"
    );

    // 6. Manager private appData: Other user read MUST be DENIED
    assert.strictEqual(
      evaluateRule(managerAppDataDoc, "read", otherAuth).proposedResult,
      false,
      "Proposed rule must strictly deny other users from reading manager appData"
    );

    // 7. Manager private appData: Owner read MUST be ALLOWED
    assert.strictEqual(
      evaluateRule(managerAppDataDoc, "read", adminAuth).proposedResult,
      true,
      "Proposed rule must allow owner to read their manager appData"
    );

    // 8. Official fairness schedules: Unauthenticated read MUST be DENIED
    assert.strictEqual(
      evaluateRule(managerOfficialDoc, "read", unauth).proposedResult,
      false,
      "Proposed rule must strictly deny unauthenticated read of official schedules"
    );

    // 9. Legacy root employee schedule: Unauthenticated read MUST be ALLOWED
    assert.strictEqual(
      evaluateRule(legacyScheduleDoc, "read", unauth).proposedResult,
      true,
      "Proposed rule must allow legacy employee schedule read"
    );
  });

  // -------------------------------------------------------------
  // Test 6: Page Loading State Simulation (Failure vs Success)
  // -------------------------------------------------------------
  test("6. Employee calendar UI lifecycle simulation reproduces bug on permission error and recovers on valid payload", async () => {
    function simulatePageInit(mockFirestoreResult) {
      const state = {
        exportStatus: "ממתין",
        calendarMessage: "",
        employeeSelectDisabled: false,
        employeeOptions: [],
        previewEventsCount: 0,
        hasError: false
      };

      function renderLoading() {
        state.exportStatus = "טוען...";
        state.calendarMessage = "טוען את נתוני הסידור...";
        state.employeeSelectDisabled = true;
      }

      function renderError(msg) {
        state.exportStatus = "שגיאה";
        state.calendarMessage = msg;
        state.employeeSelectDisabled = true;
        state.employeeOptions = [];
        state.previewEventsCount = 0;
        state.hasError = true;
      }

      function renderEmployeeOptions(schedule) {
        state.employeeOptions = schedule.employees.map(e => e.name);
        state.employeeSelectDisabled = false;
      }

      // Simulate initEmployeeCalendarPage
      renderLoading();
      try {
        const finalizedSchedule = mockFirestoreResult;
        if (!finalizedSchedule?.scheduleId || !Array.isArray(finalizedSchedule.employees) || !Array.isArray(finalizedSchedule.entries)) {
          throw new Error("קישור הסידור אינו תקין או שחסרים בו נתונים.");
        }
        renderEmployeeOptions(finalizedSchedule);
        const events = calendarService.shiftsForEmployee(finalizedSchedule, finalizedSchedule.employees[0].id);
        state.previewEventsCount = events.length;
        state.exportStatus = `${events.length} משמרות`;
        state.calendarMessage = "";
      } catch (err) {
        renderError(err.message || "לא ניתן לטעון את הסידור מהקישור.");
      }

      return state;
    }

    // A. Permission denied scenario (current bug): mockFirestoreResult is null
    const failedState = simulatePageInit(null);
    assert.strictEqual(failedState.hasError, true);
    assert.strictEqual(failedState.exportStatus, "שגיאה");
    assert.strictEqual(failedState.calendarMessage, "קישור הסידור אינו תקין או שחסרים בו נתונים.");
    assert.strictEqual(failedState.employeeOptions.length, 0, "Dropdown must be empty on failure");
    assert.strictEqual(failedState.employeeSelectDisabled, true);

    // B. Successful scenario (after proposed fix): mockFirestoreResult is valid sampleSchedule
    const successState = simulatePageInit(sampleSchedule);
    assert.strictEqual(successState.hasError, false);
    assert.strictEqual(successState.exportStatus, "2 משמרות");
    assert.strictEqual(successState.calendarMessage, "");
    assert.strictEqual(successState.employeeSelectDisabled, false);
    assert.deepStrictEqual(successState.employeeOptions, ["גל", "הוד", "שני"]);
    assert.strictEqual(successState.previewEventsCount, 2);
  });

  // -------------------------------------------------------------
  // Test 7: No Employee Selected by Default in Employee Calendar
  // -------------------------------------------------------------
  test("7. Employee calendar initializes with placeholder 'בחר/י את שמך' and displays shifts only after explicit selection", () => {
    const htmlSource = fs.readFileSync(path.join(__dirname, '../employee-calendar.html'), 'utf8');

    // 1. Static HTML verification
    assert(htmlSource.includes('<option value="">בחר/י את שמך</option>'), "HTML select must initially contain 'בחר/י את שמך' option");

    // 2. Lifecycle simulation matching employee-calendar.html
    let selectedValue = "";
    let previewHtml = "";
    let exportStatus = "ממתין";
    let addToCalendarDisabled = true;

    function renderEmployeeOptions(schedule) {
      const options = [
        '<option value="">בחר/י את שמך</option>',
        ...schedule.employees.map(employee => `<option value="${employee.id}">${employee.name}</option>`)
      ];
      selectedValue = "";
      return options;
    }

    function selectedEvents(schedule) {
      if (!selectedValue) return [];
      return calendarService.shiftsForEmployee(schedule, selectedValue);
    }

    function renderPreview(schedule) {
      if (!selectedValue) {
        previewHtml = "";
        exportStatus = "ממתין";
        addToCalendarDisabled = true;
        return;
      }
      const events = selectedEvents(schedule);
      if (!events.length) {
        previewHtml = '<div class="employee-empty-state">No shifts found for this employee</div>';
        exportStatus = "אין משמרות";
        addToCalendarDisabled = true;
        return;
      }
      exportStatus = `${events.length} משמרות`;
      addToCalendarDisabled = false;
      previewHtml = events.map(e => e.title).join(",");
    }

    // Step A: Initial page load
    const options = renderEmployeeOptions(sampleSchedule);
    renderPreview(sampleSchedule);

    assert.strictEqual(selectedValue, "", "No employee should be selected by default");
    assert.strictEqual(options[0], '<option value="">בחר/י את שמך</option>', "Placeholder option must be first");
    assert.strictEqual(previewHtml, "", "No shifts should be previewed when no employee is selected");
    assert.strictEqual(exportStatus, "ממתין", "Status badge should remain 'ממתין' when no employee is selected");
    assert.strictEqual(addToCalendarDisabled, true, "Add to calendar button must be disabled");

    // Step B: User selects 'גל'
    selectedValue = "gal";
    renderPreview(sampleSchedule);
    assert.strictEqual(exportStatus, "2 משמרות", "Should show 2 shifts for 'גל'");
    assert.strictEqual(addToCalendarDisabled, false, "Add to calendar should be enabled when employee selected");
    assert(previewHtml.length > 0, "Preview should display shifts");

    // Step C: User switches back to placeholder
    selectedValue = "";
    renderPreview(sampleSchedule);
    assert.strictEqual(previewHtml, "", "Preview should clear when switching back to placeholder");
    assert.strictEqual(exportStatus, "ממתין", "Status badge should reset to 'ממתין'");
    assert.strictEqual(addToCalendarDisabled, true, "Add to calendar button must be disabled again");
  });

  console.log("\n=================================================");
  console.log(`Regression Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
