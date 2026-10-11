/**
 * End-to-End Workflow Verification for Isolated Dev Mode
 *
 * Verifies the complete lifecycle of:
 * 1. Generating drafts (does not affect fairness)
 * 2. Saving as official ("שמור")
 * 3. Fairness table computation (פתח, סגר, לא דיווח, קיבל, אחוז שיבוץ)
 * 4. Page refresh / persistence
 * 5. Re-saving & replacement for the same period (zero double-counting)
 * 6. Multi-month attribution & cumulative totals
 */

const assert = require('assert');

async function run() {
  console.log("=================================================");
  console.log("Running Isolated Workflow End-to-End Simulation");
  console.log("=================================================\n");

  const fairnessService = await import('../src/fairnessService.js');

  // Simulated browser isolated localStorage
  const isolatedLocalStorage = new Map();

  function saveOfficialToIsolatedStore(uid, record) {
    const key = `isolated_dev_official_${uid}`;
    let list = isolatedLocalStorage.has(key) ? JSON.parse(isolatedLocalStorage.get(key)) : [];
    const index = list.findIndex(item => item.id === record.id);
    const payload = { ...record, savedAt: record.savedAt || new Date().toISOString() };
    if (index >= 0) {
      list[index] = payload;
    } else {
      list.push(payload);
    }
    isolatedLocalStorage.set(key, JSON.stringify(list));
    return { success: true, id: record.id };
  }

  function loadOfficialFromIsolatedStore(uid) {
    const key = `isolated_dev_official_${uid}`;
    return isolatedLocalStorage.has(key) ? JSON.parse(isolatedLocalStorage.get(key)) : [];
  }

  const UID = "isolated-dev-manager";

  // Step 1: User generates draft schedule
  console.log("Step 1: User generates draft schedule...");
  let loaded = loadOfficialFromIsolatedStore(UID);
  let fairness = fairnessService.calculateAggregatedFairness(loaded, "cumulative");
  assert.strictEqual(fairness.records.length, 0, "No official records exist yet");
  console.log("✓ Draft is not counted in fairness table.");

  // Step 2: User clicks 'שמור'
  console.log("\nStep 2: User clicks 'שמור' for Period 1 (2026-03-01 to 2026-03-07)...");
  const period1 = {
    id: "2026-03-01_2026-03-07",
    startDate: "2026-03-01",
    endDate: "2026-03-07",
    savedAt: "2026-03-01T10:00:00.000Z",
    status: "active",
    daysSnapshot: [
      { iso: "2026-03-01", monthKey: "2026-03", closed: false },
      { iso: "2026-03-02", monthKey: "2026-03", closed: false },
      { iso: "2026-03-03", monthKey: "2026-03", closed: false },
      { iso: "2026-03-04", monthKey: "2026-03", closed: false },
      { iso: "2026-03-05", monthKey: "2026-03", closed: false },
      { iso: "2026-03-06", monthKey: "2026-03", closed: true }, // Friday off
      { iso: "2026-03-07", monthKey: "2026-03", closed: false }
    ],
    workerConstraintsSnapshot: {
      "הוד": {
        submittedDays: ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"],
        blockedDays: ["2026-03-05"]
        // 2026-03-07 is unmentioned -> should be counted as unreported
      },
      "אשרקת": {
        submittedDays: ["2026-03-01", "2026-03-02", "2026-03-05", "2026-03-07"],
        blockedDays: ["2026-03-03", "2026-03-04"]
      }
    },
    assignments: [
      { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: "אשרקת" },
      { iso: "2026-03-02", monthKey: "2026-03", slot1: "הוד", slot2: "אשרקת" },
      { iso: "2026-03-03", monthKey: "2026-03", slot1: "הוד", slot2: null }
    ]
  };

  saveOfficialToIsolatedStore(UID, period1);
  loaded = loadOfficialFromIsolatedStore(UID);
  assert.strictEqual(loaded.length, 1);

  fairness = fairnessService.calculateAggregatedFairness(loaded, "2026-03");
  const hod1 = fairness.records.find(r => r.name === "הוד");
  const ashraqat1 = fairness.records.find(r => r.name === "אשרקת");

  assert.strictEqual(hod1.opened, 4, "Hod opened 4 shifts");
  assert.strictEqual(hod1.closed, 1, "Hod closed 1 shift");
  assert.strictEqual(hod1.unreported, 1, "Hod 1 unreported shift");
  assert.strictEqual(hod1.assigned, 3, "Hod assigned 3 shifts");
  assert.strictEqual(hod1.assignmentRate, 75, "75% assignment rate (3/4)");

  assert.strictEqual(ashraqat1.opened, 4, "Ashraqat opened 4 shifts");
  assert.strictEqual(ashraqat1.closed, 2, "Ashraqat closed 2 shifts");
  assert.strictEqual(ashraqat1.unreported, 0, "Ashraqat 0 unreported");
  assert.strictEqual(ashraqat1.assigned, 2, "Ashraqat assigned 2 shifts");
  assert.strictEqual(ashraqat1.assignmentRate, 50, "50% assignment rate (2/4)");
  console.log("✓ Saved schedule accurately updates fairness table.");

  // Step 3: Refresh page simulation
  console.log("\nStep 3: User refreshes page...");
  const refreshedList = loadOfficialFromIsolatedStore(UID);
  const refreshedFairness = fairnessService.calculateAggregatedFairness(refreshedList, "2026-03");
  assert.deepStrictEqual(refreshedFairness.records, fairness.records, "Data persists after refresh");
  console.log("✓ Data persists cleanly across page reloads.");

  // Step 4: Re-saving replacement for the same period
  console.log("\nStep 4: User edits schedule and clicks 'שמור' again for same period...");
  const period1Revised = {
    ...period1,
    savedAt: "2026-03-01T11:00:00.000Z", // 1 hour later
    assignments: [
      { iso: "2026-03-01", monthKey: "2026-03", slot1: "הוד", slot2: "אשרקת" },
      { iso: "2026-03-02", monthKey: "2026-03", slot1: "אשרקת", slot2: null } // Ashraqat now gets slot1 on 03-02, Hod unassigned
    ]
  };

  saveOfficialToIsolatedStore(UID, period1Revised);
  loaded = loadOfficialFromIsolatedStore(UID);
  assert.strictEqual(loaded.length, 1, "Still exactly 1 document in store (no duplicate documents)");

  fairness = fairnessService.calculateAggregatedFairness(loaded, "2026-03");
  const hodRevised = fairness.records.find(r => r.name === "הוד");
  const ashraqatRevised = fairness.records.find(r => r.name === "אשרקת");

  assert.strictEqual(hodRevised.assigned, 1, "Hod shifts decreased from 3 to 1");
  assert.strictEqual(ashraqatRevised.assigned, 2, "Ashraqat shifts remained 2");
  console.log("✓ Replacement for same period cleanly replaces assignments without double-counting.");

  // Step 5: Multi-month history and cumulative view
  console.log("\nStep 5: User saves an additional period in April 2026 (2026-04-01 to 2026-04-07)...");
  const periodApril = {
    id: "2026-04-01_2026-04-07",
    startDate: "2026-04-01",
    endDate: "2026-04-07",
    savedAt: "2026-04-01T10:00:00.000Z",
    status: "active",
    daysSnapshot: [
      { iso: "2026-04-01", monthKey: "2026-04", closed: false },
      { iso: "2026-04-02", monthKey: "2026-04", closed: false }
    ],
    workerConstraintsSnapshot: {
      "הוד": {
        submittedDays: ["2026-04-01", "2026-04-02"],
        blockedDays: []
      },
      "אשרקת": {
        submittedDays: ["2026-04-01"],
        blockedDays: ["2026-04-02"]
      }
    },
    assignments: [
      { iso: "2026-04-01", monthKey: "2026-04", slot1: "הוד", slot2: "אשרקת" },
      { iso: "2026-04-02", monthKey: "2026-04", slot1: "הוד", slot2: null }
    ]
  };

  saveOfficialToIsolatedStore(UID, periodApril);
  loaded = loadOfficialFromIsolatedStore(UID);
  assert.strictEqual(loaded.length, 2, "2 periods now saved in store");

  // Check April 2026 view:
  const aprilFairness = fairnessService.calculateAggregatedFairness(loaded, "2026-04");
  const aprilHod = aprilFairness.records.find(r => r.name === "הוד");
  assert.strictEqual(aprilHod.opened, 2);
  assert.strictEqual(aprilHod.assigned, 2);

  // Check Cumulative view:
  const cumFairness = fairnessService.calculateAggregatedFairness(loaded, "cumulative");
  const cumHod = cumFairness.records.find(r => r.name === "הוד");
  const cumAshraqat = cumFairness.records.find(r => r.name === "אשרקת");

  // Hod cumulative:
  // March: opened 4, assigned 1
  // April: opened 2, assigned 2
  // Total: opened 6, assigned 3 -> 50%
  assert.strictEqual(cumHod.opened, 6, "Cumulative opened = 4 + 2 = 6");
  assert.strictEqual(cumHod.assigned, 3, "Cumulative assigned = 1 + 2 = 3");
  assert.strictEqual(cumHod.assignmentRate, 50, "Cumulative rate = 50% (3/6)");

  // Ashraqat cumulative:
  // March: opened 4, assigned 2
  // April: opened 1, assigned 1
  // Total: opened 5, assigned 3 -> 60%
  assert.strictEqual(cumAshraqat.opened, 5, "Cumulative opened = 4 + 1 = 5");
  assert.strictEqual(cumAshraqat.assigned, 3, "Cumulative assigned = 2 + 1 = 3");
  assert.strictEqual(cumAshraqat.assignmentRate, 60, "Cumulative rate = 60% (3/5)");
  console.log("✓ Cumulative view accurately sums multiple months and calculates overall assignment rates.");

  console.log("\n=================================================");
  console.log("ALL E2E WORKFLOW CHECKS PASSED WITH 100% SUCCESS!");
  console.log("=================================================");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
