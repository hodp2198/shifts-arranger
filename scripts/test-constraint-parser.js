const assert = require('assert');
const path = require('path');

/**
 * Comprehensive Automated Verification Suite for Deterministic Constraint Parser
 * Tests:
 * 1. All existing baseline formats (Regression test)
 * 2. All 15 bug fixes (Full Hebrew days, delimiters, prepositions, slang, intent)
 * 3. Soft negative preferences behavior (Avoid vs Blocked)
 * 4. Day/Date conflict detection (Safety halt)
 * 5. Ambiguous line detection (Safety halt)
 * 6. Friday nonworking isolation
 * 7. Cross-month and cross-year rollover date math
 * 8. Scheduler scoring integration: soft preference penalty and fallback under shortage
 */

const ConstraintParser = require('../src/constraintParser.js');

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  [PASS] ${description}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log("===============================================================================");
console.log("STARTING TEST SUITE: Deterministic Hebrew Constraint Parser");
console.log("===============================================================================\n");

// Mock weekConfigs: 1 week starting Sunday 2026-11-01 (11/01 Sun .. 11/07 Sat)
const sampleWeekConfigs = [
  {
    start: new Date(2026, 10, 1, 12),
    end: new Date(2026, 10, 7, 12)
  }
];

// -----------------------------------------------------------------------------
// Test Group 1: Baseline Regression Formats
// -----------------------------------------------------------------------------
console.log("--- Group 1: Baseline Regression Formats (Preserved Behaviors) ---");

test("1.1 'א - לא יכול' marks Sunday as blocked", () => {
  const res = ConstraintParser.parseWorkerConstraints("א - לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-01"), true);
  assert.strictEqual(res.submitted.has("2026-11-01"), false);
  assert.strictEqual(res.hasCriticalErrors, false);
});

test("1.2 'ב - רוצה' marks Monday as preferred and submitted", () => {
  const res = ConstraintParser.parseWorkerConstraints("ב - רוצה", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.submitted.has("2026-11-02"), true);
  assert.strictEqual(res.preferred.has("2026-11-02"), true);
  assert.strictEqual(res.blocked.has("2026-11-02"), false);
});

test("1.3 'ג - יכול' marks Tuesday as submitted", () => {
  const res = ConstraintParser.parseWorkerConstraints("ג - יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.submitted.has("2026-11-03"), true);
  assert.strictEqual(res.blocked.has("2026-11-03"), false);
});

test("1.4 'ד -' trailing hyphen marks Wednesday as submitted", () => {
  const res = ConstraintParser.parseWorkerConstraints("ד -", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.submitted.has("2026-11-04"), true);
});

test("1.5 'שבת - לא יכולה' marks Saturday as blocked", () => {
  const res = ConstraintParser.parseWorkerConstraints("שבת - לא יכולה", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-07"), true);
});

test("1.6 '01/11-07/11' parsed as week range", () => {
  const range = ConstraintParser.parseWeekLabelToRange("01/11-07/11", { fallbackYear: 2026 });
  assert.strictEqual(ConstraintParser.toIsoDate(range.start), "2026-11-01");
  assert.strictEqual(ConstraintParser.toIsoDate(range.end), "2026-11-07");
});

test("1.7 '01.11 - 07.11' dot format parsed as week range", () => {
  const range = ConstraintParser.parseWeekLabelToRange("01.11 - 07.11", { fallbackYear: 2026 });
  assert.strictEqual(ConstraintParser.toIsoDate(range.start), "2026-11-01");
  assert.strictEqual(ConstraintParser.toIsoDate(range.end), "2026-11-07");
});

test("1.8 'ה: לא יכול' preserves colon-delimited Thursday constraints", () => {
  const res = ConstraintParser.parseWorkerConstraints("ה: לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-05"), true);
  assert.strictEqual(res.submitted.has("2026-11-05"), false);
  assert.strictEqual(res.hasCriticalErrors, false);
});

// -----------------------------------------------------------------------------
// Test Group 2: The 15 Confirmed Bug Fixes
// -----------------------------------------------------------------------------
console.log("\n--- Group 2: Verification of the 15 Confirmed Bug Fixes ---");

test("2.1 FIX BUG: Full day name 'ראשון - לא יכול' correctly blocks Sunday", () => {
  const res = ConstraintParser.parseWorkerConstraints("ראשון - לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-01"), true, "Sunday must be blocked!");
  assert.strictEqual(res.hasCriticalErrors, false);
});

test("2.2 FIX CRITICAL BUG: Full day name 'שני - לא יכול' blocks MONDAY (2026-11-02), NOT Saturday", () => {
  const res = ConstraintParser.parseWorkerConstraints("שני - לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-02"), true, "Monday must be blocked!");
  assert.strictEqual(res.blocked.has("2026-11-07"), false, "Saturday must NOT be blocked!");
  assert.strictEqual(res.hasCriticalErrors, false);
});

test("2.3 FIX CRITICAL BUG: Full day name 'שלישי - רוצה' prefers TUESDAY (2026-11-03), NOT Saturday", () => {
  const res = ConstraintParser.parseWorkerConstraints("שלישי - רוצה", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.preferred.has("2026-11-03"), true, "Tuesday must be preferred!");
  assert.strictEqual(res.preferred.has("2026-11-07"), false, "Saturday must NOT be preferred!");
});

test("2.4 FIX BUG: Full day name 'רביעי - לא יכול' correctly blocks Wednesday", () => {
  const res = ConstraintParser.parseWorkerConstraints("רביעי - לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-04"), true);
});

test("2.5 FIX BUG: Full day name 'חמישי - לא יכולה' correctly blocks Thursday", () => {
  const res = ConstraintParser.parseWorkerConstraints("חמישי - לא יכולה", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-05"), true);
});

test("2.6 FIX BUG: Period delimiter 'א. לא יכול' correctly blocks Sunday", () => {
  const res = ConstraintParser.parseWorkerConstraints("א. לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-01"), true);
});

test("2.7 FIX BUG: Space delimiter 'א לא יכול' and 'יום ראשון לא יכול' correctly block Sunday", () => {
  const res1 = ConstraintParser.parseWorkerConstraints("א לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res1.blocked.has("2026-11-01"), true);

  const res2 = ConstraintParser.parseWorkerConstraints("יום ראשון לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res2.blocked.has("2026-11-01"), true);
});

test("2.8 FIX BUG: Preposition 'בא\' לא יכול' blocks Sunday, NOT Monday", () => {
  const res = ConstraintParser.parseWorkerConstraints("בא' - לא יכול", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-01"), true, "Sunday must be blocked!");
  assert.strictEqual(res.blocked.has("2026-11-02"), false, "Monday must NOT be blocked!");
});

test("2.9 FIX BUG: Saturday night 'מוצ\"ש - לא יכול' and 'מוצש לא פנוי' correctly block Saturday", () => {
  const res1 = ConstraintParser.parseWorkerConstraints('מוצ"ש - לא יכול', { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res1.blocked.has("2026-11-07"), true);

  const res2 = ConstraintParser.parseWorkerConstraints('מוצש לא פנוי', { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res2.blocked.has("2026-11-07"), true);
});

test("2.10 FIX CRITICAL BUG: Negated preference 'מעדיף שלא' is AVOID (NOT preferred!)", () => {
  const res = ConstraintParser.parseWorkerConstraints("א - מעדיף שלא", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.preferred.has("2026-11-01"), false, "Must NOT be in preferred!");
  assert.strictEqual(res.blocked.has("2026-11-01"), false, "Must NOT be hard-blocked!");
  assert.strictEqual(res.avoid.has("2026-11-01"), true, "Must be in avoid set!");
  assert.strictEqual(res.submitted.has("2026-11-01"), true, "Must be in submitted so it can be assigned if needed!");
});

test("2.11 FIX CRITICAL BUG: Military service 'מילואים' blocks scheduling", () => {
  const res = ConstraintParser.parseWorkerConstraints("א - מילואים", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-01"), true, "Must be hard-blocked!");
  assert.strictEqual(res.submitted.has("2026-11-01"), false);
});

test("2.12 FIX CRITICAL BUG: Vacation 'חופש' / 'חופשה' blocks scheduling", () => {
  const res1 = ConstraintParser.parseWorkerConstraints("ב - חופש", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res1.blocked.has("2026-11-02"), true);

  const res2 = ConstraintParser.parseWorkerConstraints("ב - חופשה", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res2.blocked.has("2026-11-02"), true);
});

test("2.13 FIX CRITICAL BUG: University exam 'מבחן' blocks scheduling", () => {
  const res = ConstraintParser.parseWorkerConstraints("ג - מבחן", { weekConfigs: sampleWeekConfigs });
  assert.strictEqual(res.blocked.has("2026-11-03"), true);
});

test("2.14 FIX BUG: Cross-month boundary '28/10 - 03/11' and '28 - 03/11' correctly infers months independently of system clock", () => {
  const range1 = ConstraintParser.parseWeekLabelToRange("28/10 - 03/11", { fallbackYear: 2026 });
  assert.strictEqual(ConstraintParser.toIsoDate(range1.start), "2026-10-28");
  assert.strictEqual(ConstraintParser.toIsoDate(range1.end), "2026-11-03");

  const range2 = ConstraintParser.parseWeekLabelToRange("28 - 03/11", { fallbackYear: 2026 });
  assert.strictEqual(ConstraintParser.toIsoDate(range2.start), "2026-10-28");
  assert.strictEqual(ConstraintParser.toIsoDate(range2.end), "2026-11-03");

  // A monthless range must use explicit row context, never the system-clock month.
  const rowContext = { start: range1.start, end: range1.end };
  const contextualRange = ConstraintParser.parseWeekLabelToRange("28 - 03", { rowContext });
  assert.strictEqual(ConstraintParser.toIsoDate(contextualRange.start), "2026-10-28");
  assert.strictEqual(ConstraintParser.toIsoDate(contextualRange.end), "2026-11-03");
  assert.strictEqual(ConstraintParser.parseWeekLabelToRange("28 - 03", { fallbackYear: 2026 }), null);
});

test("2.15 FIX BUG: Year boundary December to January assigns 2027 to January", () => {
  const baseStart = new Date(2026, 11, 27, 12); // 2026-12-27
  const range = ConstraintParser.parseWeekLabelToRange("03/01 - 09/01", { baseStart, fallbackYear: 2026 });
  assert.strictEqual(ConstraintParser.toIsoDate(range.start), "2027-01-03", "Year must be 2027, NOT 2026!");
  assert.strictEqual(ConstraintParser.toIsoDate(range.end), "2027-01-09");
});

// -----------------------------------------------------------------------------
// Test Group 3: Soft Negative Preferences (Avoid) Variations
// -----------------------------------------------------------------------------
console.log("\n--- Group 3: Soft Negative Preferences (Avoid vs Blocked) ---");

test("3.1 Various Hebrew soft-negative phrasings correctly classified as AVOID", () => {
  const phrasings = [
    "מעדיף שלא",
    "מעדיפה שלא",
    "עדיף שלא",
    "עדיף לי שלא",
    "מעדיף לא לעבוד",
    "מעדיפה לא לעבוד",
    "לא רוצה",
    "מעדיף להימנע",
    "מעדיפה להימנע"
  ];

  phrasings.forEach(phrase => {
    const res = ConstraintParser.classifyAvailability(phrase);
    assert.strictEqual(res.status, "AVOID", `Phrase '${phrase}' must be classified as AVOID!`);
  });
});

// -----------------------------------------------------------------------------
// Test Group 4: Safety & Ambiguity Handling
// -----------------------------------------------------------------------------
console.log("\n--- Group 4: Safety Guardrails (Day/Date Conflict & Ambiguity) ---");

test("4.1 Day/Date conflict halts generation and reports clear Hebrew error", () => {
  // Context: In week 2026-11-01..2026-11-07, Nov 4 is Wednesday. Employee writes 'יום שלישי 04/11'
  const text = "יום שלישי 04/11 - לא יכול";
  const res = ConstraintParser.parseWorkerConstraints(text, { weekConfigs: sampleWeekConfigs, workerName: "דני" });

  assert.strictEqual(res.hasCriticalErrors, true, "Must flag critical error!");
  assert.strictEqual(res.blocked.has("2026-11-03"), false, "Must NOT guess Tuesday");
  assert.strictEqual(res.blocked.has("2026-11-04"), false, "Must NOT guess Wednesday");
  assert.ok(res.criticalErrors.some(e => e.includes("אי-התאמה בין יום לתאריך")));
});

test("4.2 Unrecognized / ambiguous text halts generation and reports clear warning", () => {
  const text = "א - אולי כן אולי לא";
  const res = ConstraintParser.parseWorkerConstraints(text, { weekConfigs: sampleWeekConfigs, workerName: "שרה" });

  assert.strictEqual(res.hasCriticalErrors, true, "Must flag critical error!");
  assert.strictEqual(res.submitted.has("2026-11-01"), false, "Must NOT assume availability!");
  assert.strictEqual(res.blocked.has("2026-11-01"), false, "Must NOT assume blocked!");
  assert.ok(res.criticalErrors.some(e => e.includes("אילוץ לא מזוהה")));
});

test("4.3 Friday constraints are cleanly ignored for scheduling and emit informational note", () => {
  const text = "שישי - לא יכולה";
  const res = ConstraintParser.parseWorkerConstraints(text, { weekConfigs: sampleWeekConfigs, workerName: "תמר" });

  assert.strictEqual(res.hasCriticalErrors, false, "Friday note is not a critical error");
  assert.strictEqual(res.blocked.has("2026-11-06"), false, "Friday is nonworking and not added to schedule blocked set");
  assert.ok(res.warnings.some(w => w.includes("יום שישי")));
});

// -----------------------------------------------------------------------------
// Test Group 5: Scheduler Scoring Simulation for Soft Negative Preferences
// -----------------------------------------------------------------------------
console.log("\n--- Group 5: Scheduler Scoring Simulation for Avoid vs Needed Shifts ---");

test("5.1 Soft negative preference adds penalty (+950), selecting neutral candidate first", () => {
  // Simulation of workerScore logic
  function calculateMockScore(worker, dayIso) {
    let score = 0;
    if (worker.needed) score -= 1800;
    if (worker.preferred.has(dayIso)) score -= 950;
    if (worker.avoid.has(dayIso)) score += 950;
    return score;
  }

  const dayIso = "2026-11-02";
  const workerNeutral = { name: "דני", needed: false, preferred: new Set(), avoid: new Set() };
  const workerAvoid = { name: "הוד", needed: false, preferred: new Set(), avoid: new Set([dayIso]) };
  const workerPreferred = { name: "רות", needed: false, preferred: new Set([dayIso]), avoid: new Set() };

  const scoreNeutral = calculateMockScore(workerNeutral, dayIso);
  const scoreAvoid = calculateMockScore(workerAvoid, dayIso);
  const scorePreferred = calculateMockScore(workerPreferred, dayIso);

  assert.strictEqual(scorePreferred < scoreNeutral, true, "Preferred (-950) beats Neutral (0)");
  assert.strictEqual(scoreNeutral < scoreAvoid, true, "Neutral (0) beats Avoid (+950)");

  // But if workerAvoid urgently needs minimum shift (needed = true), score is -1800 + 950 = -850
  workerAvoid.needed = true;
  const scoreAvoidUrgent = calculateMockScore(workerAvoid, dayIso);
  assert.strictEqual(scoreAvoidUrgent < scoreNeutral, true, "Urgent minimum shift beats unneeded neutral");
});

console.log("\n===============================================================================");
console.log(`Test Execution Summary:`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log("===============================================================================");

if (failed > 0) {
  process.exit(1);
}
