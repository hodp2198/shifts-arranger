/**
 * Fairness Service - Shift Arranger
 *
 * Manages Official Schedules ("שמור סידור רשמי") and Fairness Statistics ("טבלת צדק").
 * Provides pure calculations, month attribution, cumulative metrics, deduplication of overlapping schedules,
 * and user-scoped Firestore persistence.
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
    const iso = day.iso || (day.date ? (typeof day.date === "string" ? day.date : day.date.toISOString().slice(0, 10)) : "");
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
 * Explicitly records:
 * - hasSubmitted: whether employee actively submitted constraints for this period
 * - submittedDays: dates explicitly marked available
 * - blockedDays: dates explicitly marked unavailable ("סגר" / "לא יכול")
 */
export function snapshotWorkerConstraints(workers) {
  if (!Array.isArray(workers)) return {};
  const snapshot = {};
  for (const worker of workers) {
    if (!worker || !worker.name) continue;

    const submittedDays = worker.submitted
      ? (worker.submitted instanceof Set ? [...worker.submitted] : Array.from(worker.submitted))
      : (Array.isArray(worker.submittedDays) ? worker.submittedDays : []);

    const blockedSource = worker.explicitBlocked || worker.blocked;
    const blockedDays = blockedSource
      ? (blockedSource instanceof Set ? [...blockedSource] : Array.from(blockedSource))
      : (Array.isArray(worker.blockedDays) ? worker.blockedDays : []);

    // Determine if employee actively submitted constraints
    const hasSubmitted = typeof worker.hasSubmitted === "boolean"
      ? worker.hasSubmitted
      : (typeof worker.hasMeaningfulInput === "boolean"
          ? worker.hasMeaningfulInput
          : (submittedDays.length > 0 || blockedDays.length > 0 || Boolean(worker.active && !worker.oneTimeOnly)));

    snapshot[worker.name] = {
      name: worker.name,
      hasSubmitted: Boolean(hasSubmitted),
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
 * Finds any active official schedule that overlaps in date range with [startDate, endDate],
 * excluding the schedule with ignoreId.
 */
export function findOverlappingOfficialSchedules(existingSchedules, startDate, endDate, ignoreId = null) {
  if (!Array.isArray(existingSchedules) || !startDate || !endDate) return [];
  return existingSchedules.filter(record => {
    if (record.status === "archived") return false;
    if (ignoreId && record.id === ignoreId) return false;
    const rStart = record.startDate;
    const rEnd = record.endDate;
    if (!rStart || !rEnd) return false;
    return rStart <= endDate && rEnd >= startDate;
  });
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
 * Aggregates fairness statistics across all active official schedules.
 *
 * Core principles:
 * 1. Only approved and saved official schedules contribute.
 * 2. Deduplication: when schedules overlap, dates are unique; the schedule with the latest savedAt timestamp
 *    takes precedence for overlapping dates, preserving non-overlapping historical dates and preventing double counting.
 * 3. Total eligible shift opportunities: count of eligible (open) schedule days in the filtered period.
 * 4. Available shifts (פתח): shifts submitted as open. Never assumed if employee did not submit constraints.
 * 5. Unavailable shifts (סגר): shifts explicitly blocked.
 * 6. Assigned shifts (קיבל): shifts officially assigned.
 * 7. Assignment rate: assigned / available * 100.
 * 8. Availability percentage: available / total eligible shift opportunities * 100.
 * 9. Default sorting: Availability percentage, highest to lowest.
 */
export function calculateAggregatedFairness(officialSchedules, periodFilter = "cumulative") {
  if (!Array.isArray(officialSchedules) || !officialSchedules.length) {
    return { records: [], totalEligibleDays: 0, periodFilter };
  }

  const activeSchedules = officialSchedules.filter(s => s.status !== "archived");
  if (!activeSchedules.length) {
    return { records: [], totalEligibleDays: 0, periodFilter };
  }

  // Sort active schedules by savedAt descending (most recent first)
  const sortedByRecency = [...activeSchedules].sort((a, b) => {
    const timeA = new Date(a.savedAt || 0).getTime();
    const timeB = new Date(b.savedAt || 0).getTime();
    return timeB - timeA;
  });

  // Map each unique eligible date (iso) to its winning schedule without double-counting
  const dayScheduleMap = new Map(); // iso -> { day, schedule }
  for (const schedule of sortedByRecency) {
    for (const day of (schedule.daysSnapshot || [])) {
      if (day.closed) continue; // Calendar closed / holidays are not eligible shifts
      if (periodFilter !== "cumulative" && periodFilter !== "מצטבר") {
        if (day.monthKey !== periodFilter) continue;
      }
      if (!dayScheduleMap.has(day.iso)) {
        dayScheduleMap.set(day.iso, { day, schedule });
      }
    }
  }

  const totalEligibleDays = dayScheduleMap.size;

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
      assigned: 0,
      hasSubmittedAny: false,
      participationCount: 0
    });
  }

  for (const [iso, { day, schedule }] of dayScheduleMap.entries()) {
    const assignment = (schedule.assignments || []).find(a => a.iso === iso);
    const constraintsSnapshot = schedule.workerConstraintsSnapshot || {};

    for (const name of allWorkers) {
      const stats = workerStats.get(name);
      const workerC = constraintsSnapshot[name];

      // Track assignments
      if (assignment) {
        if (assignment.slot1 === name) stats.assigned += 1;
        if (assignment.slot2 === name) stats.assigned += 1;
      }

      // Track availability and constraints
      if (workerC) {
        const hasSubmitted = workerC.hasSubmitted !== false && (
          workerC.hasSubmitted === true ||
          (Array.isArray(workerC.submittedDays) && workerC.submittedDays.length > 0) ||
          (Array.isArray(workerC.blockedDays) && workerC.blockedDays.length > 0)
        );

        if (hasSubmitted) {
          stats.hasSubmittedAny = true;
          stats.participationCount += 1;
          const blockedSet = new Set(workerC.blockedDays || []);
          if (blockedSet.has(iso)) {
            stats.closed += 1;
          } else {
            stats.opened += 1;
          }
        }
        // If not submitted, we NEVER assume missing submissions mean availability!
      }
    }
  }

  // Calculate metrics and formatted strings
  const records = Array.from(workerStats.values()).map(worker => {
    // 1. Availability percentage: available / total eligible shift opportunities * 100
    const availabilityPercentage = totalEligibleDays > 0
      ? Math.round((worker.opened / totalEligibleDays) * 100)
      : 0;

    // 2. Assignment rate: assigned / available * 100
    let assignmentRate = 0;
    let assignmentRateFormatted = "-";
    if (worker.opened > 0) {
      assignmentRate = Math.round((worker.assigned / worker.opened) * 100);
      assignmentRateFormatted = `${assignmentRate}%`;
    } else if (worker.assigned > 0) {
      assignmentRate = 100;
      assignmentRateFormatted = "100%";
    }

    const submissionStatus = worker.hasSubmittedAny ? "הוגש" : "לא הוגש";

    return {
      name: worker.name,
      opened: worker.opened,
      closed: worker.closed,
      assigned: worker.assigned,
      hasSubmitted: worker.hasSubmittedAny,
      submissionStatus,
      assignmentRate,
      assignmentRateFormatted,
      availabilityPercentage,
      availabilityPercentageFormatted: `${availabilityPercentage}%`
    };
  });

  // Default sorting: availability percentage, highest to lowest
  records.sort((a, b) => {
    if (b.availabilityPercentage !== a.availabilityPercentage) {
      return b.availabilityPercentage - a.availabilityPercentage;
    }
    if (b.assignmentRate !== a.assignmentRate) {
      return b.assignmentRate - a.assignmentRate;
    }
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

  // Isolated test/dev mode in localStorage if set
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
