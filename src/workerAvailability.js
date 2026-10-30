/**
 * Worker Availability Service for Shift Arranger
 *
 * Manages daily and weekly availability state for each worker:
 * - Canonical availability state (blocked, avoid, preferred, submitted)
 * - Integration with deterministic Hebrew constraint parser
 * - Daily toggle interaction (open/closed)
 * - Weekly master toggle interaction (open/closed/partial) with deterministic state machine
 * - Soft negative preference ("מעדיף שלא לעבוד") preservation and distinction
 * - Non-submitter unknown/unsubmitted state (gray, disabled toggles, excluded from automatic scheduling)
 * - Explicit manual availability mode ("הזנת זמינות ידנית" starting with all days closed)
 * - State serialization and deserialization for isolated storage
 *
 * Operates in both Node.js (CommonJS/ESM) and browser (window.WorkerAvailability).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WorkerAvailability = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Creates an availability model for a worker.
   */
  function createWorkerAvailability(options = {}) {
    const hasSubmitted = Boolean(options.hasSubmitted);
    const source = options.source || (hasSubmitted ? "submitted" : "unsubmitted");

    return {
      workerName: options.workerName || "עובד",
      blocked: new Set(options.blocked || []),
      avoid: new Set(options.avoid || []),
      preferred: new Set(options.preferred || []),
      submitted: new Set(options.submitted || []),
      hasSubmitted,
      source, // "unsubmitted" | "submitted" | "manual"
      rawConstraints: options.rawConstraints || "",
      manualEdits: new Set(options.manualEdits || []),
      warnings: options.warnings ? [...options.warnings] : [],
      criticalErrors: options.criticalErrors ? [...options.criticalErrors] : []
    };
  }

  /**
   * Returns availability state for a specific day:
   * "UNSUBMITTED" | "OPEN" | "CLOSED" | "AVOID" | "PREFERRED"
   */
  function getDayAvailabilityState(availability, iso) {
    if (!availability || !availability.hasSubmitted || !iso) {
      return "UNSUBMITTED";
    }
    if (availability.blocked.has(iso)) {
      return "CLOSED";
    }
    if (availability.avoid?.has(iso)) {
      return "AVOID";
    }
    if (availability.preferred?.has(iso)) {
      return "PREFERRED";
    }
    return "OPEN";
  }

  /**
   * Determines whether a day is considered OPEN for employee availability.
   * A day is OPEN if availability is submitted/active and day is NOT in blocked.
   * For unsubmitted workers, days are not open (unknown availability).
   */
  function isDayOpen(availability, iso) {
    if (!availability || !availability.hasSubmitted || !iso) {
      return false;
    }
    return !availability.blocked.has(iso);
  }

  /**
   * Starts manual availability mode for an employee who has not submitted constraints.
   * All schedule days are initialized to CLOSED (in blocked).
   * Source is marked as "manual", hasSubmitted is set to true.
   * Preserves separate participation checkbox in caller.
   */
  function startManualAvailability(availability, scheduleDays = []) {
    if (!availability) return null;
    availability.hasSubmitted = true;
    availability.source = "manual";
    availability.rawConstraints = "";
    availability.blocked.clear();
    availability.avoid.clear();
    availability.preferred.clear();
    availability.submitted.clear();
    availability.manualEdits.clear();
    availability.warnings = [];
    availability.criticalErrors = [];

    for (const day of scheduleDays) {
      const iso = typeof day === "string" ? day : day?.iso;
      if (iso) {
        availability.blocked.add(iso);
      }
    }
    return availability;
  }

  /**
   * Populates a worker's availability model from parsed constraints output and active schedule days.
   */
  function populateAvailabilityFromParsed(availability, parsed, scheduleDays = []) {
    if (!availability || !parsed) return availability;

    availability.blocked.clear();
    availability.avoid.clear();
    availability.preferred.clear();
    availability.submitted.clear();
    availability.manualEdits.clear();

    if (parsed.rawText !== undefined) {
      availability.rawConstraints = parsed.rawText;
    }
    availability.warnings = parsed.warnings ? [...parsed.warnings] : [];
    availability.criticalErrors = parsed.criticalErrors ? [...parsed.criticalErrors] : [];

    const hasInput = Boolean(
      (parsed.blocked && parsed.blocked.size > 0) ||
      (parsed.avoid && parsed.avoid.size > 0) ||
      (parsed.preferred && parsed.preferred.size > 0) ||
      (parsed.submitted && parsed.submitted.size > 0) ||
      parsed.hasWorkerInput
    );

    availability.hasSubmitted = hasInput;
    availability.source = hasInput ? "submitted" : "unsubmitted";

    if (hasInput) {
      if (parsed.blocked) {
        for (const iso of parsed.blocked) availability.blocked.add(iso);
      }
      if (parsed.avoid) {
        for (const iso of parsed.avoid) availability.avoid.add(iso);
      }
      if (parsed.preferred) {
        for (const iso of parsed.preferred) availability.preferred.add(iso);
      }
      if (parsed.submitted) {
        for (const iso of parsed.submitted) availability.submitted.add(iso);
      }

      // For schedule workdays in genuinely submitted weeks:
      // Any day that is not in blocked is treated as submitted/available
      const submittedWeeks = new Set(
        Array.isArray(parsed.submittedWeeks) && parsed.submittedWeeks.length
          ? parsed.submittedWeeks
          : [0]
      );

      for (const day of scheduleDays) {
        const week = typeof day === "object" ? day?.week : null;
        const iso = typeof day === "string" ? day : day?.iso;
        if (iso && (week === null || submittedWeeks.has(week)) && !availability.blocked.has(iso)) {
          availability.submitted.add(iso);
        }
      }
    }

    return availability;
  }

  /**
   * Toggles the availability for a specific ISO date.
   */
  function toggleDayAvailability(availability, iso, forcedState) {
    if (!availability || !iso) return false;

    // If worker had not submitted yet, toggling makes it active manual
    if (!availability.hasSubmitted) {
      availability.hasSubmitted = true;
      availability.source = "manual";
    }

    const currentOpen = isDayOpen(availability, iso);
    const targetOpen = forcedState !== undefined ? Boolean(forcedState) : !currentOpen;

    if (targetOpen) {
      // OPEN: remove from blocked, add to submitted
      availability.blocked.delete(iso);
      availability.submitted.add(iso);
    } else {
      // CLOSED: add to blocked, remove from submitted, avoid, and preferred
      availability.blocked.add(iso);
      availability.submitted.delete(iso);
      availability.avoid.delete(iso);
      availability.preferred.delete(iso);
    }

    availability.manualEdits.add(iso);
    return targetOpen;
  }

  /**
   * Calculates the weekly availability status for a given week's days.
   * Returns: "UNSUBMITTED" | "OPEN" | "CLOSED" | "PARTIAL"
   */
  function getWeekAvailabilityStatus(availability, weekDays = []) {
    if (!availability || !availability.hasSubmitted) {
      return "UNSUBMITTED";
    }
    if (!weekDays.length) return "OPEN";

    let openCount = 0;
    let closedCount = 0;
    let unsubCount = 0;

    for (const day of weekDays) {
      const state = getDayAvailabilityState(availability, day.iso);
      if (state === "UNSUBMITTED") {
        unsubCount++;
      } else if (state === "CLOSED") {
        closedCount++;
      } else {
        openCount++;
      }
    }

    if (unsubCount === weekDays.length) return "UNSUBMITTED";
    if (openCount === weekDays.length) return "OPEN";
    if (closedCount === weekDays.length) return "CLOSED";
    return "PARTIAL";
  }

  /**
   * Sets all days in a week to open or closed.
   */
  function setWeekAvailability(availability, weekDays = [], openState) {
    if (!availability) return;
    if (!availability.hasSubmitted) {
      availability.hasSubmitted = true;
      availability.source = "manual";
    }

    for (const day of weekDays) {
      toggleDayAvailability(availability, day.iso, openState);
    }
  }

  /**
   * Deterministic Master Toggle State Machine.
   * If unsubmitted, returns "UNSUBMITTED" (master toggle disabled).
   */
  function handleMasterToggleClick(availability, weekDays = []) {
    if (!availability || !weekDays.length) return "OPEN";
    if (!availability.hasSubmitted) return "UNSUBMITTED";

    const currentStatus = getWeekAvailabilityStatus(availability, weekDays);

    if (currentStatus === "PARTIAL" || currentStatus === "UNSUBMITTED") {
      setWeekAvailability(availability, weekDays, true);
      return "OPEN";
    } else if (currentStatus === "OPEN") {
      setWeekAvailability(availability, weekDays, false);
      return "CLOSED";
    } else {
      setWeekAvailability(availability, weekDays, true);
      return "OPEN";
    }
  }

  /**
   * Serializes an availability model into a plain JSON-compatible object for persistence.
   */
  function serializeAvailability(availability) {
    if (!availability) return null;
    return {
      workerName: availability.workerName || "עובד",
      blocked: Array.from(availability.blocked || []),
      avoid: Array.from(availability.avoid || []),
      preferred: Array.from(availability.preferred || []),
      submitted: Array.from(availability.submitted || []),
      hasSubmitted: Boolean(availability.hasSubmitted),
      source: availability.source || (availability.hasSubmitted ? "submitted" : "unsubmitted"),
      rawConstraints: availability.rawConstraints || "",
      manualEdits: Array.from(availability.manualEdits || []),
      warnings: availability.warnings ? [...availability.warnings] : [],
      criticalErrors: availability.criticalErrors ? [...availability.criticalErrors] : []
    };
  }

  /**
   * Deserializes a saved object into an active availability model with Set structures.
   */
  function deserializeAvailability(data, scheduleDays = []) {
    if (!data) return createWorkerAvailability();

    const model = createWorkerAvailability({
      workerName: data.workerName,
      blocked: data.blocked,
      avoid: data.avoid,
      preferred: data.preferred,
      submitted: data.submitted,
      hasSubmitted: data.hasSubmitted,
      source: data.source,
      rawConstraints: data.rawConstraints,
      manualEdits: data.manualEdits,
      warnings: data.warnings,
      criticalErrors: data.criticalErrors
    });
    return model;
  }

  return {
    createWorkerAvailability,
    getDayAvailabilityState,
    isDayOpen,
    startManualAvailability,
    populateAvailabilityFromParsed,
    toggleDayAvailability,
    getWeekAvailabilityStatus,
    setWeekAvailability,
    handleMasterToggleClick,
    serializeAvailability,
    deserializeAvailability
  };
});
