/**
 * Fairness Service - Shift Arranger
 *
 * Manages Official Schedules ("שמור") and the Fairness Table ("טבלת צדק").
 * Handles pure calculations, month attribution, cumulative metrics,
 * and Firestore persistence isolated per authenticated user.
 */

const HEBREW_MONTH_NAMES = [
  "",
  "ינואר", "פברואר", "מרץ", "אפריל",
  "מאי", "יוני", "יולי", "אוגוסט",
  "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
];

/**
 * Formats YYYY-MM to Hebrew readable string, e.g. "2026-03" -> "מרץ 2026"
 */
export function formatMonthLabel(monthKey) {
  if (!monthKey || typeof monthKey !== "string") return "";
  const [yearStr, monthStr] = monthKey.split("-");
  const monthNum = parseInt(monthStr, 10);
  if (!monthNum || monthNum < 1 || monthNum > 12) return monthKey;
  const monthName = HEBREW_MONTH_NAMES[monthNum] || monthStr;
  return `${monthName} ${yearStr}`;
}

/**
 * Extracts a normalized list of calendar days for the period, marking whether each day
 * is open or calendar-closed (holidays / manual closures).
 */
export function extractPeriodDays(days) {
  if (!Array.isArray(days)) return [];
  return days.map(day => {
    const iso = day.iso || (day.date ? day.date.toISOString().slice(0, 10) : "");
    const monthKey = iso ? iso.slice(0, 7) : "";
    return {
      iso,
      dayName: day.dayName || "",
      dayIndex: typeof day.dayIndex === "number" ? day.dayIndex : -1,
      week: typeof day.week === "number" ? day.week : 0,
      closed: Boolean(day.closed),
      label: day.label || "",
      monthKey
    };
  });
}

/**
 * Creates a snapshot of employee constraints for the period.
 * Explicitly distinguishes:
 * - submittedDays: dates the employee explicitly stated as available
 * - blockedDays: dates the employee explicitly marked as unavailable
 */
export function snapshotWorkerConstraints(workers) {
  if (!Array.isArray(workers)) return {};
  const snapshot = {};
  for (const worker of workers) {
    if (!worker || !worker.name) continue;
    const submittedDays = worker.submitted
      ? (worker.submitted instanceof Set ? [...worker.submitted] : Array.from(worker.submitted))
      : (Array.isArray(worker.submittedDays) ? worker.submittedDays : []);
    const blockedDays = worker.blocked
      ? (worker.blocked instanceof Set ? [...worker.blocked] : Array.from(worker.blocked))
      : (Array.isArray(worker.blockedDays) ? worker.blockedDays : []);

    snapshot[worker.name] = {
      name: worker.name,
      submittedDays: Array.from(new Set(submittedDays)),
      blockedDays: Array.from(new Set(blockedDays))
    };
  }
  return snapshot;
}

/**
 * Extracts actual shift assignments from schedule object.
 * Returns array of assignments: { iso, monthKey, slot1, slot2 }
 */
export function snapshotAssignments(schedule) {
  if (!schedule || typeof schedule !== "object") return [];
  const entries = Object.values(schedule).flat();
  const assignments = [];

  for (const entry of entries) {
    if (!entry || !entry.day) continue;
    if (entry.closed) continue; // Calendar closed days have no assignments
    const iso = entry.day.iso || "";
    if (!iso) continue;
    const monthKey = iso.slice(0, 7);

    const slot1 = entry.first?.name && entry.first.name !== "-" ? entry.first.name : null;
    const slot2 = entry.second?.name && entry.second.name !== "-" && entry.second.name !== slot1
      ? entry.second.name
      : null;

    assignments.push({
      iso,
      monthKey,
      slot1,
      slot2
    });
  }

  return assignments;
}

/**
 * Computes fairness statistics for a single period, grouped by monthKey (YYYY-MM).
 * Strictly adheres to:
 * 1. פתח (opened): eligible open days the employee explicitly marked available (submitted and not blocked).
 * 2. סגר (closed): eligible open days the employee explicitly marked unavailable (blocked).
 * 3. לא דיווח (unreported): eligible open days where employee neither marked available nor unavailable.
 *    (Crucial: Unreported days are NOT counted as סגר).
 * 4. קיבל (assigned): shifts actually assigned in the official saved schedule.
 * 5. אחוז שיבוץ: assigned / opened.
 */
export function computePeriodFairness(days, workerConstraints, assignments) {
  const eligibleDays = (Array.isArray(days) ? days : []).filter(d => !d.closed);
  const assignmentsByIso = new Map();
  for (const a of (Array.isArray(assignments) ? assignments : [])) {
    assignmentsByIso.set(a.iso, a);
  }

  const workerNames = Object.keys(workerConstraints || {});
  const resultByMonth = {};

  for (const day of eligibleDays) {
    const monthKey = day.monthKey || day.iso.slice(0, 7);
    if (!resultByMonth[monthKey]) {
      resultByMonth[monthKey] = {};
      for (const name of workerNames) {
        resultByMonth[monthKey][name] = {
          opened: 0,
          closed: 0,
          unreported: 0,
          assigned: 0
        };
      }
    }

    const assignment = assignmentsByIso.get(day.iso);

    for (const name of workerNames) {
      const constraints = workerConstraints[name] || { submittedDays: [], blockedDays: [] };
      const subSet = new Set(constraints.submittedDays || []);
      const blkSet = new Set(constraints.blockedDays || []);

      const stats = resultByMonth[monthKey][name];

      // Explicit availability:
      if (subSet.has(day.iso) && !blkSet.has(day.iso)) {
        stats.opened += 1;
      } else if (blkSet.has(day.iso)) {
        // Explicit unavailability:
        stats.closed += 1;
      } else {
        // Lack of reporting:
        stats.unreported += 1;
      }

      // Assigned:
      if (assignment) {
        if (assignment.slot1 === name) stats.assigned += 1;
        if (assignment.slot2 === name) stats.assigned += 1;
      }
    }
  }

  return resultByMonth;
}

/**
 * Returns a list of all unique YYYY-MM months present in the saved official schedules,
 * sorted chronologically.
 */
export function getAvailableMonths(officialSchedules) {
  if (!Array.isArray(officialSchedules)) return [];
  const monthSet = new Set();
  for (const record of officialSchedules) {
    if (record.status === "archived") continue;
    if (Array.isArray(record.daysSnapshot)) {
      for (const day of record.daysSnapshot) {
        if (!day.closed && day.monthKey) {
          monthSet.add(day.monthKey);
        }
      }
    }
  }
  return Array.from(monthSet).sort();
}

/**
 * Finds any active official schedule that overlaps in date range with [startDate, endDate],
 * excluding the schedule with ignoreId (e.g. current schedule period).
 */
export function findOverlappingOfficialSchedules(existingSchedules, startDate, endDate, ignoreId = null) {
  if (!Array.isArray(existingSchedules) || !startDate || !endDate) return [];
  return existingSchedules.filter(record => {
    if (record.status === "archived") return false;
    if (ignoreId && record.id === ignoreId) return false;
    const rStart = record.startDate;
    const rEnd = record.endDate;
    if (!rStart || !rEnd) return false;
    // Overlap condition: rStart <= endDate && rEnd >= startDate
    return rStart <= endDate && rEnd >= startDate;
  });
}

/**
 * Aggregates fairness statistics across all active official schedules.
 * Handles:
 * - Specific month view (e.g. "2026-03")
 * - Cumulative view ("cumulative" or "מצטבר")
 * - Deduplication of dates in case of overlapping periods: the schedule with later savedAt wins for any duplicate day.
 */
export function calculateAggregatedFairness(officialSchedules, periodFilter = "cumulative") {
  if (!Array.isArray(officialSchedules) || !officialSchedules.length) {
    return { records: [], totalEligibleDays: 0, periodFilter };
  }

  const activeSchedules = officialSchedules.filter(s => s.status !== "archived");
  if (!activeSchedules.length) {
    return { records: [], totalEligibleDays: 0, periodFilter };
  }

  // To guarantee zero duplicate counting:
  // Map each unique eligible date (iso) to its winning schedule (the one with the latest savedAt timestamp)
  const sortedByRecency = [...activeSchedules].sort((a, b) => {
    const timeA = new Date(a.savedAt || 0).getTime();
    const timeB = new Date(b.savedAt || 0).getTime();
    return timeB - timeA; // Most recent first
  });

  const dayScheduleMap = new Map(); // iso -> record
  for (const schedule of sortedByRecency) {
    for (const day of (schedule.daysSnapshot || [])) {
      if (day.closed) continue; // Skip calendar closed
      if (periodFilter !== "cumulative" && periodFilter !== "מצטבר") {
        if (day.monthKey !== periodFilter) continue;
      }
      if (!dayScheduleMap.has(day.iso)) {
        dayScheduleMap.set(day.iso, { day, schedule });
      }
    }
  }

  // Collect all known workers across all considered schedules
  const allWorkers = new Set();
  for (const { schedule } of dayScheduleMap.values()) {
    if (schedule.workerConstraintsSnapshot) {
      Object.keys(schedule.workerConstraintsSnapshot).forEach(w => allWorkers.add(w));
    }
    if (Array.isArray(schedule.assignments)) {
      for (const a of schedule.assignments) {
        if (a.slot1) allWorkers.add(a.slot1);
        if (a.slot2) allWorkers.add(a.slot2);
      }
    }
  }

  const workerStats = new Map();
  for (const name of allWorkers) {
    workerStats.set(name, {
      name,
      opened: 0,
      closed: 0,
      unreported: 0,
      assigned: 0,
      assignmentRate: 0,
      assignmentRateFormatted: "0%"
    });
  }

  let totalEligibleDays = 0;

  for (const [iso, { day, schedule }] of dayScheduleMap.entries()) {
    totalEligibleDays += 1;

    // Find assignment for this day in this schedule
    const assignment = (schedule.assignments || []).find(a => a.iso === iso);
    const constraintsSnapshot = schedule.workerConstraintsSnapshot || {};

    for (const name of allWorkers) {
      const stats = workerStats.get(name);
      const workerC = constraintsSnapshot[name] || { submittedDays: [], blockedDays: [] };
      const subSet = new Set(workerC.submittedDays || []);
      const blkSet = new Set(workerC.blockedDays || []);

      if (subSet.has(iso) && !blkSet.has(iso)) {
        stats.opened += 1;
      } else if (blkSet.has(iso)) {
        stats.closed += 1;
      } else {
        stats.unreported += 1;
      }

      if (assignment) {
        if (assignment.slot1 === name) stats.assigned += 1;
        if (assignment.slot2 === name) stats.assigned += 1;
      }
    }
  }

  // Calculate assignment percentage
  const records = Array.from(workerStats.values()).map(worker => {
    let rate = 0;
    let rateFormatted = "-";
    if (worker.opened > 0) {
      rate = Math.round((worker.assigned / worker.opened) * 100);
      rateFormatted = `${rate}%`;
    } else if (worker.assigned > 0) {
      // Assigned despite 0 opened (e.g. forced or manual override)
      rateFormatted = "100%";
      rate = 100;
    }
    return {
      ...worker,
      assignmentRate: rate,
      assignmentRateFormatted: rateFormatted
    };
  });

  // Sort by highest assignment rate, then by name Hebrew locale
  records.sort((a, b) => {
    if (b.assignmentRate !== a.assignmentRate) return b.assignmentRate - a.assignmentRate;
    return a.name.localeCompare(b.name, "he");
  });

  return {
    records,
    totalEligibleDays,
    periodFilter
  };
}

// -------------------------------------------------------------
// Firestore Persistence Integration (User Scoped)
// -------------------------------------------------------------

let firestoreInstance = null;

async function getFirestoreDb(customDb = null) {
  if (customDb) return customDb;
  if (firestoreInstance) return firestoreInstance;

  const { getApps, initializeApp, getApp } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js");
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");
  const { firebaseConfig, hasFirebaseConfig } = await import("../firebase-config.js");

  if (!hasFirebaseConfig()) {
    throw new Error("Firebase אינו מוגדר כראוי.");
  }
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  firestoreInstance = getFirestore(app);
  return firestoreInstance;
}

/**
 * Saves an official schedule snapshot document to:
 * /users/{uid}/officialSchedules/{periodId}
 */
export async function saveOfficialScheduleDoc(uid, scheduleRecord, customDb = null) {
  if (!uid || typeof uid !== "string") {
    throw new Error("מזהה משתמש (UID) אינו תקין.");
  }
  if (!scheduleRecord || !scheduleRecord.id) {
    throw new Error("נתוני הסידור הרשמי אינם תקינים לשמירה.");
  }

  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) {
    const storageKey = `isolated_dev_official_${uid}`;
    const raw = localStorage.getItem(storageKey);
    let list = raw ? JSON.parse(raw) : [];
    const payload = {
      ...scheduleRecord,
      savedAt: scheduleRecord.savedAt || new Date().toISOString()
    };
    const index = list.findIndex(item => item.id === scheduleRecord.id);
    if (index >= 0) {
      list[index] = payload;
    } else {
      list.push(payload);
    }
    localStorage.setItem(storageKey, JSON.stringify(list));
    return { success: true, id: scheduleRecord.id };
  }

  const db = await getFirestoreDb(customDb);
  const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");

  const docRef = doc(db, "users", uid, "officialSchedules", scheduleRecord.id);
  const payload = {
    ...scheduleRecord,
    savedAt: scheduleRecord.savedAt || new Date().toISOString(),
    updatedAt: serverTimestamp()
  };

  await setDoc(docRef, payload);
  return { success: true, id: scheduleRecord.id };
}

/**
 * Loads all official schedules for the user from:
 * /users/{uid}/officialSchedules
 */
export async function loadOfficialSchedulesDocs(uid, customDb = null) {
  if (!uid || typeof uid !== "string") {
    throw new Error("מזהה משתמש (UID) אינו תקין.");
  }

  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) {
    const storageKey = `isolated_dev_official_${uid}`;
    const raw = localStorage.getItem(storageKey);
    const list = raw ? JSON.parse(raw) : [];
    list.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
    return list;
  }

  const db = await getFirestoreDb(customDb);
  const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");

  const colRef = collection(db, "users", uid, "officialSchedules");
  const snapshot = await getDocs(colRef);

  const schedules = [];
  snapshot.forEach(docSnap => {
    schedules.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  // Sort chronologically by startDate
  schedules.sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  return schedules;
}

/**
 * Deletes or archives an official schedule document.
 */
export async function deleteOfficialScheduleDoc(uid, periodId, customDb = null) {
  if (!uid || !periodId) return;

  if (typeof window !== "undefined" && window.__ISOLATED_DEV_MODE__) {
    const storageKey = `isolated_dev_official_${uid}`;
    const raw = localStorage.getItem(storageKey);
    let list = raw ? JSON.parse(raw) : [];
    list = list.filter(item => item.id !== periodId);
    localStorage.setItem(storageKey, JSON.stringify(list));
    return { success: true };
  }

  const db = await getFirestoreDb(customDb);
  const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js");

  const docRef = doc(db, "users", uid, "officialSchedules", periodId);
  await deleteDoc(docRef);
  return { success: true };
}
