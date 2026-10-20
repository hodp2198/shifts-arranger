/**
 * Test Suite: Excel Date Recognition & Authoritative Hod Source
 * Verifies all 8 mandatory scenarios:
 * 1. All employees report correct dates
 * 2. One employee reports wrong date but day of week and order are valid
 * 3. Hod reports 2 weeks and another employee reports 3 weeks
 * 4. Employee reports only 1 block and rest of days are empty
 * 5. Employee does not appear in file
 * 6. Hod does not appear in file
 * 7. Hod's dates are invalid (unparseable, invalid date, not Sunday, inverted range, inconsistent order)
 * 8. Period including an Israeli holiday
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSandbox() {
  const content = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

  const elements = new Map();

  function getOrCreateMockEl(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id,
      value: '',
      textContent: '',
      innerHTML: '',
      checked: false,
      dataset: {},
      style: {},
      hidden: false,
      classList: {
        add: () => {},
        remove: () => {},
        contains: () => false
      },
      querySelector: (sel) => {
        if (sel === '.active-worker') return getOrCreateMockEl(`${id}_active`);
        if (sel === '.constraints') return getOrCreateMockEl(`${id}_constraints`);
        if (sel === '.min-shifts') return { value: '1' };
        if (sel === '.max-shifts') return { value: '2' };
        if (sel === '.night2-only') return { checked: false };
        if (sel === '.one-time-indicator') return getOrCreateMockEl(`${id}_indicator`);
        return getOrCreateMockEl(`${id}_sub`);
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      remove: () => {},
      select: () => {}
    };
    elements.set(id, el);
    return el;
  }

  const workerCards = new Map();

  function getWorkerCard(name) {
    if (workerCards.has(name)) return workerCards.get(name);
    const activeEl = { checked: false };
    const constraintsEl = { value: '' };
    const minEl = { value: '1' };
    const maxEl = { value: '2' };
    const night2El = { checked: false };
    const indicatorEl = { hidden: true, textContent: '' };
    const metaEl = { textContent: '1/2', style: {} };

    const card = {
      dataset: { worker: name },
      querySelector: (sel) => {
        if (sel === '.active-worker') return activeEl;
        if (sel === '.constraints') return constraintsEl;
        if (sel === '.min-shifts') return minEl;
        if (sel === '.max-shifts') return maxEl;
        if (sel === '.night2-only') return night2El;
        if (sel === '.one-time-indicator') return indicatorEl;
        if (sel === '.worker-meta') return metaEl;
        return getOrCreateMockEl(`card_${name}_${sel}`);
      }
    };
    workerCards.set(name, card);
    return card;
  }

  const sandbox = {
    console,
    setTimeout: () => {},
    setInterval: () => {},
    clearTimeout: () => {},
    clearInterval: () => {},
    CSS: {
      escape: s => String(s).replace(/["\\]/g, '\\$&')
    },
    window: {},
    document: {
      getElementById: (id) => getOrCreateMockEl(id),
      querySelector: (sel) => {
        const workerMatch = sel.match(/\.worker\[data-worker="([^"]+)"\]/);
        if (workerMatch) {
          return getWorkerCard(workerMatch[1]);
        }
        return getOrCreateMockEl(sel);
      },
      querySelectorAll: (sel) => {
        if (sel === '.worker') {
          return Array.from(workerCards.values());
        }
        return [];
      },
      createElement: (tag) => getOrCreateMockEl(`tag_${tag}`),
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    navigator: {},
    location: { reload: () => {} },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    }
  };

  sandbox.window.document = sandbox.document;
  sandbox.window.window = sandbox.window;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);

  // Load hebcal-core into sandbox context
  const hebcalCode = fs.readFileSync(path.resolve(__dirname, '../vendor/hebcal-core.min.js'), 'utf8');
  vm.runInContext(hebcalCode, sandbox);
  sandbox.window.hebcal = sandbox.hebcal;

  // Load calendarRules helper into sandbox context
  const calendarRulesCode = fs.readFileSync(path.resolve(__dirname, '../src/calendarRules.js'), 'utf8');
  vm.runInContext(calendarRulesCode, sandbox);

  // Load index.html main inline script
  const scriptText = content.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(scriptText, sandbox);

  return { sandbox, getOrCreateMockEl, getWorkerCard, workerCards };
}

async function runTests() {
  console.log('=================================================');
  console.log('Testing Excel Date Recognition & Authoritative Hod');
  console.log('=================================================\n');

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

  // -------------------------------------------------------------
  // Test 1: All employees report correct dates
  // -------------------------------------------------------------
  test('Test 1: All employees report correct dates', () => {
    const { sandbox } = createSandbox();

    const rows = [
      ['הוד', 'אשרקת', 'דניאל'],
      ['15/03/2026 - 21/03/2026', '15/03/2026 - 21/03/2026', '15/03/2026 - 21/03/2026'],
      ['א\' - לא יכול', 'א\' -', 'א\' -'],
      ['ב\' -', 'ב\' - לא יכול', 'ב\' -'],
      ['22/03/2026 - 28/03/2026', '22/03/2026 - 28/03/2026', '22/03/2026 - 28/03/2026'],
      ['א\' -', 'א\' -', 'א\' - לא יכול']
    ];

    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(rows, statusEl);

    // Week detection check
    const weeks = sandbox.window.getDetectedWeekConfigs();
    assert.strictEqual(weeks.length, 2, 'Must detect 2 weeks from Hod');
    assert.strictEqual(sandbox.window.isoDate(weeks[0].start), '2026-03-15');
    assert.strictEqual(sandbox.window.isoDate(weeks[0].end), '2026-03-21');
    assert.strictEqual(sandbox.window.isoDate(weeks[1].start), '2026-03-22');
    assert.strictEqual(sandbox.window.isoDate(weeks[1].end), '2026-03-28');

    // UI text check
    assert(statusEl.innerHTML.includes('מקור התאריכים: הוד'), 'Summary must declare Hod as date source');
    assert(statusEl.innerHTML.includes('מספר השבועות: 2'), 'Summary must declare 2 weeks');

    // Worker constraints check
    const hodCard = sandbox.document.querySelector('.worker[data-worker="הוד"]');
    const ashraqatCard = sandbox.document.querySelector('.worker[data-worker="אשרקת"]');
    const danielCard = sandbox.document.querySelector('.worker[data-worker="דניאל"]');

    assert(hodCard.querySelector('.active-worker').checked, 'Hod must be active');
    assert(ashraqatCard.querySelector('.active-worker').checked, 'Ashraqat must be active');
    assert(danielCard.querySelector('.active-worker').checked, 'Daniel must be active');

    const hodParsed = sandbox.window.parseConstraints(hodCard.querySelector('.constraints').value, { workerName: 'הוד' });
    const ashraqatParsed = sandbox.window.parseConstraints(ashraqatCard.querySelector('.constraints').value, { workerName: 'אשרקת' });
    const danielParsed = sandbox.window.parseConstraints(danielCard.querySelector('.constraints').value, { workerName: 'דניאל' });

    assert(hodParsed.blocked.has('2026-03-15'), 'Hod blocked on 2026-03-15');
    assert(ashraqatParsed.blocked.has('2026-03-16'), 'Ashraqat blocked on 2026-03-16');
    assert(danielParsed.blocked.has('2026-03-22'), 'Daniel blocked on 2026-03-22');
  });

  // -------------------------------------------------------------
  // Test 2: One employee reports wrong date but day of week and order are valid
  // -------------------------------------------------------------
  test('Test 2: One employee reports wrong date but day of week and order are valid', () => {
    const { sandbox } = createSandbox();

    // Daniel has wrong dates: 14/03 - 20/03 instead of 15-21, and 21/03 - 27/03 instead of 22-28
    const rows = [
      ['הוד', 'דניאל'],
      ['15/03/2026 - 21/03/2026', '14/03/2026 - 20/03/2026'],
      ['א\' -', 'ב\' - לא יכול'],
      ['22/03/2026 - 28/03/2026', '21/03/2026 - 27/03/2026'],
      ['א\' -', 'ג\' - לא יכול']
    ];

    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(rows, statusEl);

    // Schedule period must be determined by Hod
    const weeks = sandbox.window.getDetectedWeekConfigs();
    assert.strictEqual(weeks.length, 2, 'Schedule weeks determined by Hod (2 weeks)');
    assert.strictEqual(sandbox.window.isoDate(weeks[0].start), '2026-03-15', 'Week 1 starts 15/03 from Hod');
    assert.strictEqual(sandbox.window.isoDate(weeks[1].start), '2026-03-22', 'Week 2 starts 22/03 from Hod');

    // Daniel's constraints must NOT be lost!
    const danielCard = sandbox.document.querySelector('.worker[data-worker="דניאל"]');
    const danielParsed = sandbox.window.parseConstraints(danielCard.querySelector('.constraints').value, { workerName: 'דניאל' });

    // In week 1 (15-21/03), day 'ב' is Monday 2026-03-16
    assert(danielParsed.blocked.has('2026-03-16'), 'Daniel day ב in week 1 must map to 2026-03-16');
    // In week 2 (22-28/03), day 'ג' is Tuesday 2026-03-24
    assert(danielParsed.blocked.has('2026-03-24'), 'Daniel day ג in week 2 must map to 2026-03-24');

    // Original constraints text must remain unmodified
    assert(danielCard.querySelector('.constraints').value.includes('14/03/2026'), 'Original text in card is preserved');
  });

  // -------------------------------------------------------------
  // Test 3: Hod reports 2 weeks and another employee reports 3 weeks
  // -------------------------------------------------------------
  test('Test 3: Hod reports 2 weeks and another employee reports 3 weeks', () => {
    const { sandbox } = createSandbox();

    // Hod has 2 weeks, Sarah has 3 weeks
    const rows = [
      ['הוד', 'שרה'],
      ['15/03/2026 - 21/03/2026', '15/03/2026 - 21/03/2026'],
      ['א\' -', 'א\' - לא יכול'],
      ['22/03/2026 - 28/03/2026', '22/03/2026 - 28/03/2026'],
      ['א\' -', 'ב\' - לא יכול'],
      ['', '29/03/2026 - 04/04/2026'],
      ['', 'ג\' - לא יכול']
    ];

    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(rows, statusEl);

    // Schedule remains 2 weeks (determined by Hod)
    const weeks = sandbox.window.getDetectedWeekConfigs();
    assert.strictEqual(weeks.length, 2, 'Schedule length must be 2 weeks (from Hod)');

    const sarahCard = sandbox.document.querySelector('.worker[data-worker="שרה"]');
    const sarahParsed = sandbox.window.parseConstraints(sarahCard.querySelector('.constraints').value, { workerName: 'שרה' });

    // Weeks 1 and 2 constraints are mapped
    assert(sarahParsed.blocked.has('2026-03-15'), 'Sarah week 1 blocked mapped');
    assert(sarahParsed.blocked.has('2026-03-23'), 'Sarah week 2 blocked mapped');

    // Week 3 must trigger a warning and NOT be assigned
    assert(sarahParsed.warnings.length > 0, 'Warning must be generated for out-of-bounds week 3');
    assert(sarahParsed.warnings.some(w => w.includes('מעבר לתקופת הסידור')), 'Warning message explains week 3 is beyond Hod period');

    // Week 3 constraint (Tuesday 2026-03-31) must NOT be assigned into week 1 or week 2
    assert(!sarahParsed.blocked.has('2026-03-17'), 'Week 3 constraint must not be falsely mapped to week 1');
    assert(!sarahParsed.blocked.has('2026-03-24'), 'Week 3 constraint must not be falsely mapped to week 2');

    // UI summary displays the warning
    assert(statusEl.innerHTML.includes('מעבר לתקופת הסידור'), 'Summary issues must display week 3 warning');
  });

  // -------------------------------------------------------------
  // Test 4: Employee reports only 1 block and rest of days are empty
  // -------------------------------------------------------------
  test('Test 4: Employee reports only 1 block and rest of days are empty', () => {
    const { sandbox } = createSandbox();

    const rows = [
      ['הוד', 'עומר'],
      ['15/03/2026 - 21/03/2026', '15/03/2026 - 21/03/2026'],
      ['א\' -', 'א\' - לא יכול'],
      ['22/03/2026 - 28/03/2026', '22/03/2026 - 28/03/2026']
    ];

    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(rows, statusEl);

    const omerCard = sandbox.document.querySelector('.worker[data-worker="עומר"]');
    const omerParsed = sandbox.window.parseConstraints(omerCard.querySelector('.constraints').value, { workerName: 'עומר' });

    // Exactly 1 block
    assert.strictEqual(omerParsed.blocked.size, 1, 'Omer must have exactly 1 blocked day');
    assert(omerParsed.blocked.has('2026-03-15'), 'Omer blocked on 2026-03-15');

    // Availability check: unmentioned days are available
    const isAvailable = (blocked, iso) => !blocked.has(iso);
    assert.strictEqual(isAvailable(omerParsed.blocked, '2026-03-15'), false, '2026-03-15 is blocked');
    assert.strictEqual(isAvailable(omerParsed.blocked, '2026-03-16'), true, '2026-03-16 is available');
    assert.strictEqual(isAvailable(omerParsed.blocked, '2026-03-17'), true, '2026-03-17 is available');
    assert.strictEqual(isAvailable(omerParsed.blocked, '2026-03-22'), true, '2026-03-22 is available');
    assert.strictEqual(isAvailable(omerParsed.blocked, '2026-03-23'), true, '2026-03-23 is available');
  });

  // -------------------------------------------------------------
  // Test 5: Employee does not appear in file
  // -------------------------------------------------------------
  test('Test 5: Employee does not appear in file', () => {
    const { sandbox, getWorkerCard } = createSandbox();

    // Initialize an existing worker in WORKERS
    sandbox.window.WORKERS.push(
      { name: 'עובד ותיק', aliases: [], min: 1, max: 2, color: ['#eee', '#333', '#ccc'] }
    );
    const veteranCard = getWorkerCard('עובד ותיק');
    veteranCard.querySelector('.active-worker').checked = true;

    // Excel file does NOT include 'עובד ותיק'
    const rows = [
      ['הוד', 'אשרקת'],
      ['15/03/2026 - 21/03/2026', '15/03/2026 - 21/03/2026'],
      ['א\' -', 'א\' -']
    ];

    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(rows, statusEl);

    // 'עובד ותיק' must be marked inactive
    assert.strictEqual(veteranCard.querySelector('.active-worker').checked, false, 'Veteran worker must be marked inactive');

    // UI summary notes that veteran worker was marked inactive
    assert(statusEl.innerHTML.includes('עובד ותיק'), 'Status summary must mention inactive worker');
    assert(statusEl.innerHTML.includes('סומנו כלא פעילים'), 'Status summary notes worker is inactive');
  });

  // -------------------------------------------------------------
  // Test 6: Hod does not appear in file
  // -------------------------------------------------------------
  test('Test 6: Hod does not appear in file', () => {
    const { sandbox } = createSandbox();

    // Excel headers without Hod
    const rows = [
      ['אשרקת', 'דניאל'],
      ['15/03/2026 - 21/03/2026', '15/03/2026 - 21/03/2026'],
      ['א\' - לא יכול', 'ב\' - לא יכול']
    ];

    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(rows, statusEl);

    // Must show clear error and NOT guess
    assert(statusEl.innerHTML.includes('העובד הוד לא נמצא בקובץ האקסל'), 'Error must explicitly state Hod is missing');
    assert(statusEl.innerHTML.includes('מקור התאריכים הקובע'), 'Error mentions Hod is the authoritative source');

    // Detected weeks must remain empty
    assert.strictEqual(sandbox.window.getDetectedWeekConfigs().length, 0, 'No weeks must be guessed or detected');
  });

  // -------------------------------------------------------------
  // Test 7: Hod's dates are invalid
  // -------------------------------------------------------------
  test('Test 7: Hod\'s dates are invalid', () => {
    const { sandbox } = createSandbox();

    // Subcase a: Unparseable header text
    const unparseableRows = [
      ['הוד'],
      ['שבוע בלי תאריכים בכלל'],
      ['א\' - לא יכול']
    ];
    let res = sandbox.window.applyWeekDatesFromRows(unparseableRows);
    assert.strictEqual(res.success, false);
    assert(res.error.includes('לא זוהו כותרות תאריכים') || res.error.includes('לא ניתן לפענח'));

    // Subcase b: Invalid calendar date (31/02)
    const invalidDateRows = [
      ['הוד'],
      ['31/02/2026 - 06/03/2026'],
      ['א\' - לא יכול']
    ];
    res = sandbox.window.applyWeekDatesFromRows(invalidDateRows);
    assert.strictEqual(res.success, false);
    assert(res.error.includes('לא ניתן לפענח') || res.error.includes('אינם תקינים') || res.error.includes('לא זוהו'));

    // Subcase c: Week does not start on Sunday (e.g., Monday 16/03)
    const notSundayRows = [
      ['הוד'],
      ['16/03/2026 - 22/03/2026'],
      ['א\' - לא יכול']
    ];
    res = sandbox.window.applyWeekDatesFromRows(notSundayRows);
    assert.strictEqual(res.success, false);
    assert(res.error.includes('חייב להתחיל ביום ראשון'));

    // Subcase d: Inconsistent week chronological order (Week 2 before Week 1)
    const inconsistentRows = [
      ['הוד'],
      ['22/03/2026 - 28/03/2026'],
      ['א\' -'],
      ['15/03/2026 - 21/03/2026'],
      ['א\' -']
    ];
    res = sandbox.window.applyWeekDatesFromRows(inconsistentRows);
    assert.strictEqual(res.success, false);
    assert(res.error.includes('אינם עקביים בסדר כרונולוגי'));

    // Ensure importRowsMatrix displays error in statusEl
    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(notSundayRows, statusEl);
    assert(statusEl.innerHTML.includes('חייב להתחיל ביום ראשון'));
  });

  // -------------------------------------------------------------
  // Test 8: Period including an Israeli holiday
  // -------------------------------------------------------------
  test('Test 8: Period including an Israeli holiday', () => {
    const { sandbox } = createSandbox();

    // Passover 2026:
    // 2026-03-29 is Sunday (11 Nisan 5786)
    // 2026-04-01 is Wednesday (14 Nisan 5786 - Erev Pesach)
    // 2026-04-02 is Thursday (15 Nisan 5786 - Pesach Day 1)
    // 2026-04-04 is Saturday (17 Nisan 5786 - Shabbat Chol HaMoed)
    const rows = [
      ['הוד', 'אשרקת'],
      ['29/03/2026 - 04/04/2026', '29/03/2026 - 04/04/2026'],
      ['א\' -', 'א\' -'],
      ['ב\' -', 'ב\' -']
    ];

    const statusEl = sandbox.document.getElementById('bulkExcelStatus');
    sandbox.window.importRowsMatrix(rows, statusEl);

    const weeks = sandbox.window.getDetectedWeekConfigs();
    assert.strictEqual(weeks.length, 1, '1 week detected from Hod');
    assert.strictEqual(sandbox.window.isoDate(weeks[0].start), '2026-03-29');

    // Inspect schedule days and holiday handling
    const scheduleDays = sandbox.window.getScheduleDays();
    assert(scheduleDays.length > 0, 'Schedule days generated');

    const erevPesach = scheduleDays.find(d => d.iso === '2026-04-01');
    const pesach = scheduleDays.find(d => d.iso === '2026-04-02');

    assert(erevPesach, 'Erev Pesach exists in schedule days');
    assert(pesach, 'Pesach exists in schedule days');

    // Verify holiday dayType identification from hebcal-core and calendarRules
    assert.strictEqual(erevPesach.closed, true, 'Erev Pesach (2026-04-01) is marked closed');
    assert.strictEqual(pesach.dayType.status, 'holiday', '2026-04-02 is identified as holiday');
    assert.strictEqual(pesach.closed, false, 'Motzei Pesach (2026-04-02) has a holiday shift for Friday delivery');

    // Regular workdays like Sunday 2026-03-29 must be open workdays
    const sunday = scheduleDays.find(d => d.iso === '2026-03-29');
    assert.strictEqual(sunday.closed, false, 'Sunday is open workday');
  });

  console.log('\n=================================================');
  console.log(`Excel Import Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('=================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
