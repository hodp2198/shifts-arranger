const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Baseline Test Suite for Shift Arranger Constraint & Week Parser
 *
 * This test suite loads the EXACT legacy parser functions directly from index.html
 * and runs baseline verification:
 * 1. Confirms all currently supported formats pass.
 * 2. Confirms all identified edge cases and bugs fail under the legacy parser (documenting baseline behavior).
 * 3. Operates 100% offline with zero Firebase dependencies.
 */

// 1. Load and extract legacy parser code from index.html into a sandboxed VM context
const indexPath = path.join(__dirname, '..', 'index.html');
const indexHtmlContent = fs.readFileSync(indexPath, 'utf8');

// Sandbox environment mimicking index.html global context
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  String,
  Number,
  Set,
  Map,
  Array,
  RegExp,
  DAY_NAMES: ["א", "ב", "ג", "ד", "ה", "ו", "שבת"],
  SCHEDULE_DAYS: [0, 1, 2, 3, 4, 6],
  state: {
    detectedWeeks: [],
    special: {}
  },
  startDateEl: { value: "2026-11-01" },
  weekCountEl: { value: "1" }
};

vm.createContext(sandbox);

// Helper to extract a function declaration from index.html by name
function extractFunction(source, funcName) {
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex(line => new RegExp(`^\\s*function\\s+${funcName}\\s*\\(`).test(line));
  if (startIdx === -1) throw new Error(`Function ${funcName} not found in index.html`);

  const initialIndent = lines[startIdx].match(/^(\s*)/)[1];
  const funcLines = [lines[startIdx]];

  for (let i = startIdx + 1; i < lines.length; i++) {
    funcLines.push(lines[i]);
    // Top-level function in index.html terminates at the same indentation level '    }'
    if (lines[i] === initialIndent + '}') {
      return funcLines.join('\n');
    }
  }

  throw new Error(`Could not find closing brace for ${funcName}`);
}

// Extract relevant functions
const functionsToExtract = [
  'isoDate',
  'displayDate',
  'addDays',
  'parseUiDate',
  'orderedDateRange',
  'getBaseStartDate',
  'safeImportDate',
  'importYear',
  'normalizeWeekHeaderText',
  'weekRangeKey',
  'weekRangeLabel',
  'simpleWeekRangeLabel',
  'inferStartMonth',
  'parseWeekLabelToRange',
  'normalizeDayName',
  'isConstraintWeekHeader',
  'resolveConstraintWeekOffset',
  'isUnavailableText',
  'isPreferredText',
  'dayIndexFromText',
  'datePartsFromText',
  'findOneTimeTargetDay',
  'parseConstraints'
];

let scriptCode = `
function getWeekConfigs() {
  const start = getBaseStartDate();
  if (!start) return [];
  const weeks = Number(weekCountEl.value) || 1;
  return Array.from({ length: weeks }, (_, index) => {
    const weekStart = addDays(start, index * 7);
    return { start: weekStart, end: addDays(weekStart, 6) };
  });
}
function applyInlineOnlyAvailabilityConstraint() { return false; }
`;

for (const fn of functionsToExtract) {
  scriptCode += '\n' + extractFunction(indexHtmlContent, fn);
}

vm.runInContext(scriptCode, sandbox);

// -------------------------------------------------------------------------
// Test Runner
// -------------------------------------------------------------------------
let passedCount = 0;
let confirmedBugCount = 0;

function testPass(description, fn) {
  try {
    fn();
    console.log(`  [PASS - Current Supported] ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL - Expected to Pass!] ${description}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

function testConfirmBug(description, fn) {
  try {
    fn();
    console.log(`  [BUG CONFIRMED] ${description}`);
    confirmedBugCount++;
  } catch (err) {
    console.error(`  [UNEXPECTED PASS/CHANGE] Bug did not reproduce as expected: ${description}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("===============================================================================");
console.log("BASELINE TEST SUITE: Legacy Parser in index.html");
console.log("===============================================================================\n");

// Context for tests: Schedule starting Sunday 2026-11-01 (1 week)
sandbox.startDateEl.value = "2026-11-01";
sandbox.weekCountEl.value = "1";

// -------------------------------------------------------------------------
// Category 1: Currently Supported Formats (Passing Today)
// -------------------------------------------------------------------------
console.log("--- Category 1: Formats Currently Supported (Passing Today) ---");

testPass("1.1 Single-letter hyphen: 'א - לא יכול' blocks Sunday", () => {
  const res = sandbox.parseConstraints("א - לא יכול");
  assert.strictEqual(res.blocked.has("2026-11-01"), true);
  assert.strictEqual(res.submitted.has("2026-11-01"), false);
});

testPass("1.2 Single-letter hyphen: 'ב - רוצה' prefers Monday", () => {
  const res = sandbox.parseConstraints("ב - רוצה");
  assert.strictEqual(res.submitted.has("2026-11-02"), true);
  assert.strictEqual(res.preferred.has("2026-11-02"), true);
  assert.strictEqual(res.blocked.has("2026-11-02"), false);
});

testPass("1.3 Single-letter hyphen: 'ג - יכול' submits Tuesday", () => {
  const res = sandbox.parseConstraints("ג - יכול");
  assert.strictEqual(res.submitted.has("2026-11-03"), true);
  assert.strictEqual(res.blocked.has("2026-11-03"), false);
});

testPass("1.4 Trailing hyphen with empty value: 'ד -' submits Wednesday", () => {
  const res = sandbox.parseConstraints("ד -");
  assert.strictEqual(res.submitted.has("2026-11-04"), true);
  assert.strictEqual(res.blocked.has("2026-11-04"), false);
});

testPass("1.5 Saturday single-word: 'שבת - לא יכולה' blocks Saturday", () => {
  const res = sandbox.parseConstraints("שבת - לא יכולה");
  assert.strictEqual(res.blocked.has("2026-11-07"), true);
});

testPass("1.6 Week header parsing: '01/11-07/11' detects range correctly", () => {
  const range = sandbox.parseWeekLabelToRange("01/11-07/11");
  assert.ok(range);
  assert.strictEqual(sandbox.isoDate(range.start), "2026-11-01");
  assert.strictEqual(sandbox.isoDate(range.end), "2026-11-07");
});

testPass("1.7 Week header parsing with dots: '01.11 - 07.11' detects range correctly", () => {
  const range = sandbox.parseWeekLabelToRange("01.11 - 07.11");
  assert.ok(range);
  assert.strictEqual(sandbox.isoDate(range.start), "2026-11-01");
  assert.strictEqual(sandbox.isoDate(range.end), "2026-11-07");
});

testPass("1.8 Colon delimiter: 'ה: לא יכול' blocks Thursday", () => {
  const res = sandbox.parseConstraints("ה: לא יכול");
  assert.strictEqual(res.blocked.has("2026-11-05"), true);
});

// -------------------------------------------------------------------------
// Category 2: Existing Bugs & Flaws Confirmed (Failing Today)
// -------------------------------------------------------------------------
console.log("\n--- Category 2: Existing Bugs Confirmed in Legacy Parser ---");

testConfirmBug("2.1 BUG: Full day name 'ראשון' is silently dropped", () => {
  const res = sandbox.parseConstraints("ראשון - לא יכול");
  // Clean[0] is 'ר' -> not in DAY_NAMES -> index -1 -> dropped!
  assert.strictEqual(res.blocked.has("2026-11-01"), false, "Sunday should NOT be blocked because legacy parser dropped it");
  assert.strictEqual(res.submitted.has("2026-11-01"), false);
});

testConfirmBug("2.2 CRITICAL BUG: Full day name 'שני' is corrupted into Saturday (2026-11-07) instead of Monday (2026-11-02)", () => {
  const res = sandbox.parseConstraints("שני - לא יכול");
  // 'שני' startsWith('ש') -> normalized to 'שבת' (day 6)!
  assert.strictEqual(res.blocked.has("2026-11-02"), false, "Monday is NOT blocked");
  assert.strictEqual(res.blocked.has("2026-11-07"), true, "Saturday IS WRONGLY BLOCKED because 'שני' became 'שבת'!");
});

testConfirmBug("2.3 CRITICAL BUG: Full day name 'שלישי' is corrupted into Saturday (2026-11-07) instead of Tuesday (2026-11-03)", () => {
  const res = sandbox.parseConstraints("שלישי - רוצה");
  // 'שלישי' startsWith('ש') -> normalized to 'שבת' (day 6)!
  assert.strictEqual(res.preferred.has("2026-11-03"), false, "Tuesday is NOT preferred");
  assert.strictEqual(res.preferred.has("2026-11-07"), true, "Saturday IS WRONGLY PREFERRED because 'שלישי' became 'שבת'!");
});

testConfirmBug("2.4 BUG: Full day name 'רביעי' is silently dropped", () => {
  const res = sandbox.parseConstraints("רביעי - לא יכול");
  // Clean[0] is 'ר' -> index -1 -> dropped!
  assert.strictEqual(res.blocked.has("2026-11-04"), false);
});

testConfirmBug("2.5 BUG: Full day name 'חמישי' is silently dropped", () => {
  const res = sandbox.parseConstraints("חמישי - לא יכול");
  // Clean[0] is 'ח' -> index -1 -> dropped!
  assert.strictEqual(res.blocked.has("2026-11-05"), false);
});

testConfirmBug("2.6 BUG: Period delimiter 'א. לא יכול' is silently dropped", () => {
  const res = sandbox.parseConstraints("א. לא יכול");
  // Regex strictly requires [-:] -> fails match -> dropped!
  assert.strictEqual(res.blocked.has("2026-11-01"), false);
});

testConfirmBug("2.7 BUG: Space delimiter 'א לא יכול' is silently dropped", () => {
  const res = sandbox.parseConstraints("א לא יכול");
  // No hyphen or colon -> dropped!
  assert.strictEqual(res.blocked.has("2026-11-01"), false);
});

testConfirmBug("2.8 BUG: Preposition 'בא\' לא יכול' is misassigned to Monday instead of Sunday", () => {
  const res = sandbox.parseConstraints("בא' - לא יכול");
  // clean[0] is 'ב' -> normalized to Monday!
  assert.strictEqual(res.blocked.has("2026-11-01"), false, "Sunday not blocked");
  assert.strictEqual(res.blocked.has("2026-11-02"), true, "Monday wrongly blocked!");
});

testConfirmBug("2.9 BUG: Saturday night 'מוצ\"ש - לא יכול' is silently dropped", () => {
  const res = sandbox.parseConstraints('מוצ"ש - לא יכול');
  // clean[0] is 'מ' -> index -1 -> dropped!
  assert.strictEqual(res.blocked.has("2026-11-07"), false);
});

testConfirmBug("2.10 CRITICAL BUG: Negated preference 'מעדיף שלא' is inverted into PREFERRED", () => {
  const res = sandbox.parseConstraints("א - מעדיף שלא");
  // Matches 'מעדיף' in isPreferredText(), not unavailable -> PREFERRED!
  assert.strictEqual(res.preferred.has("2026-11-01"), true, "INVERTED INTENTION: employee said prefer NOT to, but marked preferred!");
  assert.strictEqual(res.blocked.has("2026-11-01"), false);
});

testConfirmBug("2.11 CRITICAL BUG: Military service 'מילואים' is treated as AVAILABLE", () => {
  const res = sandbox.parseConstraints("א - מילואים");
  // Fails isUnavailableText() -> falls through to submitted!
  assert.strictEqual(res.blocked.has("2026-11-01"), false, "Not blocked");
  assert.strictEqual(res.submitted.has("2026-11-01"), true, "WRONGLY MARKED AVAILABLE despite reserve duty!");
});

testConfirmBug("2.12 CRITICAL BUG: Vacation 'חופש' is treated as AVAILABLE", () => {
  const res = sandbox.parseConstraints("ב - חופש");
  assert.strictEqual(res.blocked.has("2026-11-02"), false);
  assert.strictEqual(res.submitted.has("2026-11-02"), true, "WRONGLY MARKED AVAILABLE despite vacation!");
});

testConfirmBug("2.13 CRITICAL BUG: University Exam 'מבחן' is treated as AVAILABLE", () => {
  const res = sandbox.parseConstraints("ג - מבחן");
  assert.strictEqual(res.blocked.has("2026-11-03"), false);
  assert.strictEqual(res.submitted.has("2026-11-03"), true, "WRONGLY MARKED AVAILABLE despite exam!");
});

testConfirmBug("2.14 BUG: Cross-month boundary with missing month '28-03' uses system clock month", () => {
  // Line has 28-3 without end month -> startDay > endDay -> endMonth = new Date().getMonth() + 1
  const range = sandbox.parseWeekLabelToRange("28 - 03");
  const currentClockMonth = new Date().getMonth() + 1;
  // If schedule is for November but clock is October, end month will be 10 instead of 11!
  assert.strictEqual(range.end.getMonth() + 1, currentClockMonth, "End month is tied to real-time clock");
});

testConfirmBug("2.15 BUG: Year boundary December to January: Week 2 '03/01-09/01' is assigned Year 2026 instead of 2027", () => {
  // Start date in Week 1 is 2026-12-27
  sandbox.startDateEl.value = "2026-12-27";
  const range = sandbox.parseWeekLabelToRange("03/01-09/01");
  // importYear() returns getBaseStartDate().getFullYear() which is 2026
  assert.strictEqual(range.start.getFullYear(), 2026, "WRONGLY ASSIGNED 2026 (12 months in past) instead of 2027");
});

console.log("\n===============================================================================");
console.log(`Baseline Test Summary:`);
console.log(`  Passed (Currently Supported): ${passedCount}`);
console.log(`  Bugs Confirmed (Legacy Flaws): ${confirmedBugCount}`);
console.log(`  Total Verified Behaviors:     ${passedCount + confirmedBugCount}`);
console.log("===============================================================================");
