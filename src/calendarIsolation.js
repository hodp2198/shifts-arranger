import { isLocalEnvironment, isIsolatedDevMode } from "../firebase-config.js";

export const CALENDAR_ISOLATION_NOTICE = "ייצוא ליומן Google אינו זמין במצב פיתוח מבודד. התחברות ושינויים ביומן חסומים.";

// Emulators do not emulate Google Calendar: all local environments must block it.
export function isCalendarExportBlocked() {
  return isLocalEnvironment() || isIsolatedDevMode();
}

export function assertCalendarExportAllowed() {
  if (isCalendarExportBlocked()) {
    throw new Error(`FAIL-CLOSED: ${CALENDAR_ISOLATION_NOTICE}`);
  }
}
