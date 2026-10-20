/** Phase 2 integration: automatic employee matching and calendar-dated imports. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSandbox() {
  const listeners = new Map();
  const documentListeners = new Map();
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
      closest: () => null,
      appendChild: () => {},
      addEventListener: (event, handler) => listeners.set(`${id}:${event}`, handler),
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
    console: { log() {}, info() {}, warn() {}, error() {} },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-03-01T10:00:00Z'])); }
      static now() { return new Date('2026-03-01T10:00:00Z').getTime(); }
    },
    alert: () => {},
    confirm: () => true,
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
      addEventListener: (event, handler) => documentListeners.set(event, handler),
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

  sandbox.window.confirm = () => true;
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

  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/schedulePeriodService.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/draftSnapshot.js'), 'utf8'), sandbox);

  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/constraintImportService.js'), 'utf8'), sandbox);

  // Load index.html main inline script
  const scriptText = content.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(scriptText, sandbox);

  return { sandbox, getOrCreateMockEl, getWorkerCard, workerCards, listeners, documentListeners,
    run: code => vm.runInContext(code, sandbox) };
}

async function runTests() {
  const { storageHarness } = require('./test-draft-safety');
  const { workers, screenshotRows } = require('./test-constraint-import');
  let passed = 0;
  async function test(name, fn) { await fn(); console.log(`[PASS] ${name}`); passed++; }
  async function ready() {
    const c = createSandbox();
    const storage = storageHarness();
    c.sandbox.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-10-20T09:00:00Z'])); }
    };
    c.sandbox.window.userDataService = storage.api;
    c.sandbox.window.fairnessService = { ...(await import('../src/fairnessService.js')), loadOfficialSchedulesDocs: async () => [] };
    c.run(`currentAuthUid='manager'; state.historyStatus='ready'; WORKERS=${JSON.stringify(workers.map(worker => ({ ...worker, min: 1, max: 2 })))}; selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-10-25',weekCount:2}))`);
    for (const worker of workers) c.getWorkerCard(worker.name);
    return { ...c, storage, state: c.sandbox.window.state };
  }
  async function importRows(c, rows) {
    c.getOrCreateMockEl('bulkExcelNotes').value = rows.map(row => row.join('\t')).join('\n');
    return c.sandbox.window.importRowsMatrix(rows, c.getOrCreateMockEl('bulkExcelStatus'));
  }
  function issueContainer(id, choice) {
    return { dataset: { importIssue: id }, querySelector: selector => ({ value: choice[selector] || '' }) };
  }
  await test('Real screenshot layout matches all employees and automatically applies dated constraints', async () => {
    const c = await ready();
    const before = JSON.stringify(c.state.period);
    const result = await importRows(c, screenshotRows('1.11-7.11', false));
    assert.equal(result.success, true);
    assert.equal(JSON.stringify(c.state.period), before);
    assert.equal(c.state.pendingExcelImport, null);
    assert.equal(c.run('periodReadiness()'), '');
    const daniel = c.run("getAllWorkersData().find(worker=>worker.name==='דניאל')");
    assert(daniel.blocked.has('2026-10-25'));
    assert(daniel.blocked.has('2026-11-01'));
    const hod = c.run("getAllWorkersData().find(worker=>worker.name==='הוד')");
    assert.equal(hod.blocked.has('2026-10-25'), true, 'first Excel block maps to first canonical week');
    assert(c.getOrCreateMockEl('bulkExcelStatus').textContent.includes('סדר בלוקים'));
    assert(c.getWorkerCard('דניאל').querySelector('.imported-constraints').textContent.includes('2026-10-25'));
    assert.equal((await c.storage.api.loadDraftBackups('manager')).length, 1);
  });
  await test('Screenshot date errors and election note do not require review; Saturday shorthand applies', async () => {
    const c = await ready();
    await importRows(c, screenshotRows());
    assert.equal(c.state.constraintImport.issues.length, 0);
    assert.equal(c.run('periodReadiness()'), '');
    assert.equal(c.run('requireReadyPeriod()'), true);
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='דניאל').blocked.has('2026-10-25')"));
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='דניאל').blocked.has('2026-11-01')"));
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='נעמי').blocked.has('2026-10-31')"));
    assert(c.state.constraintImport.notes.some(note => note.workerName === 'הוד' && note.date === '2026-11-03'));
    assert(c.getOrCreateMockEl('constraintImportReview').innerHTML.includes('יום בחירות'));
  });
  await test('Audited screenshot corrections reach engine inputs and permit all 24 audited assignments', async () => {
    const c = await ready();
    await importRows(c, screenshotRows());
    const input = c.run('getAllWorkersData()');
    const worker = name => input.find(item => item.name === name);
    assert(worker('דניאל').blocked.has('2026-11-03'));
    for (const date of ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05']) assert(worker('יהלי').blocked.has(date), date);
    for (const date of ['2026-11-03', '2026-11-07']) {
      assert.equal(worker('יהלי').blocked.has(date), false, date);
      assert(worker('יהלי').submitted.has(date), date);
    }
    for (const date of ['2026-10-25', '2026-11-01']) {
      assert.equal(worker('נעמי').blocked.has(date), false, date);
      assert(worker('נעמי').submitted.has(date), date);
    }
    for (const date of ['2026-10-27', '2026-11-03']) assert.equal(worker('שדא').blocked.has(date), false, date);
    for (const date of ['2026-10-28', '2026-10-29', '2026-11-04', '2026-11-05']) assert(worker('שדא').blocked.has(date), date);
    const audited = [
      ['2026-10-25', 'נעמי', 'הדס'], ['2026-10-26', 'סיואר', 'הוד'],
      ['2026-10-27', 'דניאל', 'שדא'], ['2026-10-28', 'הוד', 'אשרקת'],
      ['2026-10-29', 'הדס', 'דניאל'], ['2026-10-31', 'יהלי', 'סיואר'],
      ['2026-11-01', 'הוד', 'נעמי'], ['2026-11-02', 'אשרקת', 'דניאל'],
      ['2026-11-03', 'הדס', 'יהלי'], ['2026-11-04', 'סיואר', 'הוד'],
      ['2026-11-05', 'דניאל', 'אשרקת'], ['2026-11-07', 'שדא', 'הדס']
    ];
    assert.equal(c.run('periodReadiness()'), '');
    let checked = 0;
    for (const [date, ...names] of audited) {
      const day = c.sandbox.window.getScheduleDays().find(item => item.iso === date);
      assert(day && !day.closed, date);
      for (const name of names) {
        assert(worker(name).active, name);
        assert.equal(worker(name).blocked.has(date), false, name + ' ' + date);
        checked++;
      }
    }
    assert.equal(checked, 24);
    for (const date of ['2026-10-30', '2026-11-06']) assert.equal(c.sandbox.window.getScheduleDays().some(day => day.iso === date), false);
  });
  await test('Manager resolves genuinely unclear boundaries and weekday labels with a backed-up decision', async () => {
    const c = await ready();
    await importRows(c, [['הוד', 'דניאל'], ["ב' - לא יכול", 'תאריך: טעות'], ["ב' - יכול", 'ז - לא יכול']]);
    let item = c.state.constraintImport.issues.find(issue => issue.type === 'block');
    c.sandbox.reviewContainer = issueContainer(item.id, { '.resolve-block': '2' });
    await c.run('resolveImportIssue(reviewContainer,false)');
    item = c.state.constraintImport.issues.find(issue => issue.type === 'entry');
    c.sandbox.reviewContainer = issueContainer(item.id, { '.resolve-weekday': '6', '.resolve-status': 'unavailable' });
    await c.run('resolveImportIssue(reviewContainer,false)');
    assert.equal(c.state.constraintImport.issues.length, 0);
    assert.equal(c.run('periodReadiness()'), '');
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='דניאל').blocked.has('2026-10-31')"));
    assert(c.state.constraintImport.sources[0].rawText.includes('תאריך: טעות'));
    assert.equal((await c.storage.api.loadDraftBackups('manager')).length, 3);
  });
  await test('An employee becomes active when their only unresolved entry is resolved', async () => {
    const c = await ready();
    await importRows(c, [['דניאל'], ['25-31.10'], ["א' - אולי"]]);
    assert.equal(c.getWorkerCard('דניאל').querySelector('.active-worker').checked, false);
    const item = c.state.constraintImport.issues[0];
    c.sandbox.reviewContainer = issueContainer(item.id, { '.resolve-status': 'unavailable' });
    await c.run('resolveImportIssue(reviewContainer,false)');
    assert.equal(c.getWorkerCard('דניאל').querySelector('.active-worker').checked, true);
  });
  await test('Backup failure cannot overwrite employee settings, prior constraints or imported state', async () => {
    const c = await ready();
    c.getWorkerCard('הוד').querySelector('.constraints').value = 'original manual data';
    c.storage.fail('draftBackup');
    const result = await importRows(c, [['הוד'], ['25-31.10'], ["א' - לא יכול"]]);
    assert.equal(result.success, false);
    assert.equal(c.state.constraintImport, null);
    assert.equal(c.getWorkerCard('הוד').querySelector('.constraints').value, 'original manual data');
  });
  await test('Reimporting a recognized legacy column preserves a backup before replacing its old parser text', async () => {
    const c = await ready();
    const original = "25-31.10\nא' - לא יכול";
    c.getWorkerCard('הוד').querySelector('.constraints').value = original;
    c.state.legacyImportReviewRequired = true;
    c.state.pendingExcelImport = { rawText: original };
    await importRows(c, [['הוד'], ['25-31.10'], ["א' - לא יכול"]]);
    assert.equal(c.getWorkerCard('הוד').querySelector('.constraints').value, '');
    assert.equal(c.state.legacyImportReviewRequired, false);
    assert.equal(c.run('periodReadiness()'), '');
    const backups = await c.storage.api.loadDraftBackups('manager');
    assert.equal(JSON.parse(backups[0].draftJson).workers.find(worker => worker.name === 'הוד').constraints, original);
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='הוד').blocked.has('2026-10-25')"));
  });
  await test('Repeated imports merge restrictions instead of overwriting earlier columns or sources', async () => {
    const c = await ready();
    await importRows(c, [['הוד'], ['25-31.10'], ["א' - לא יכול"]]);
    await importRows(c, [['הוד'], ['25-31.10'], ["ב' - לא יכול"]]);
    assert.equal(c.state.constraintImport.sources.length, 2);
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='הוד').blocked.has('2026-10-25')"));
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='הוד').blocked.has('2026-10-26')"));
    await importRows(c, [['הוד'], ['25-31.10'], ["ב' - לא יכול"]]);
    assert.equal(c.state.constraintImport.sources.length, 2, 'same matrix is idempotent');
  });
  await test('Imported sources, decisions, matching and typed restrictions survive reload', async () => {
    const c = await ready();
    await importRows(c, screenshotRows('1.11-7.11', false));
    const original = JSON.stringify(c.state.constraintImport);
    await c.run("loadUserWorkspace('manager')");
    assert.equal(JSON.stringify(c.state.constraintImport), original);
    assert(c.run("getAllWorkersData().find(worker=>worker.name==='דניאל').blocked.has('2026-11-01')"));
    assert.equal(c.run('periodReadiness()'), '');
  });
  await test('Switching canonical periods maps the same block positions into the new period', async () => {
    const c = await ready();
    await importRows(c, [['דניאל'], ['25-31.10'], ["א' - לא יכול"]]);
    c.run("selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-11-01',weekCount:2}))");
    assert.equal(c.state.constraintImport.applied.length, 1);
    assert.equal(c.state.constraintImport.applied[0].date, '2026-11-01');
    assert.equal(c.getWorkerCard('דניאל').querySelector('.active-worker').checked, true);
    assert(c.getOrCreateMockEl('bulkExcelStatus').textContent.includes('סדר בלוקים'));
  });
  await test('Existing manual restrictions remain and conflicting manual availability blocks generation', async () => {
    const c = await ready();
    c.getWorkerCard('הוד').querySelector('.constraints').value = "25/10/2026 - 31/10/2026\nא' -";
    await importRows(c, [['הוד'], ['25-31.10'], ["א' - לא יכול"]]);
    assert(c.run('periodReadiness()').includes('סתירה'));
    assert(c.getWorkerCard('הוד').querySelector('.constraints').value.includes("א' -"));
  });
  await test('Canonical grid and engine use imported blocked dates, while holiday rules remain unchanged', async () => {
    const c = await ready();
    await importRows(c, screenshotRows('1.11-7.11', false));
    const result = c.run('generateSchedule()');
    for (const entry of Object.values(result.schedule).flat()) {
      assert(entry.day.iso >= '2026-10-25' && entry.day.iso <= '2026-11-07');
      for (const worker of [entry.first, entry.second].filter(Boolean)) assert.equal(worker.blocked.has(entry.day.iso), false);
    }
    assert.equal(c.run('periodService().validateScheduleDates(state.period,generateSchedule().schedule).valid'), true);
    // Calendar rules are exercised directly for the previously verified Pesach fixture.
    c.run("state.constraintImport=null; selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-03-29',weekCount:1}))");
    assert.equal(c.sandbox.window.getScheduleDays().find(day => day.iso === '2026-04-01').closed, true);
    assert.equal(c.sandbox.window.getScheduleDays().find(day => day.iso === '2026-04-02').closed, false);
  });
  await test('Unknown new employee is created safely without requiring column-order matching', async () => {
    const c = await ready();
    await importRows(c, [['נועם'], ['25-31.10'], ["א' - לא יכול"]]);
    assert(c.run("WORKERS.some(worker=>worker.name==='נועם')"));
    assert(c.run("getWorkersData().find(worker=>worker.name==='נועם').blocked.has('2026-10-25')"));
  });
  await test('Explicitly deferred restrictions remain in original source and decision audit', async () => {
    const c = await ready();
    await importRows(c, [['הוד'], ['25-31.10'], ["א' - אולי"]]);
    const id = c.state.constraintImport.issues[0].id;
    c.sandbox.reviewContainer = issueContainer(id, {});
    await c.run('resolveImportIssue(reviewContainer,true)');
    assert.equal(c.state.constraintImport.issues.length, 0);
    assert.equal(c.state.constraintImport.resolutions[id].action, 'defer');
    assert(c.state.constraintImport.sources[0].rawText.includes('אולי'));
  });
  await test('Old date-anchored drafts stay unchanged and blocked until confirmed reimport', async () => {
    const c = await ready();
    await importRows(c, screenshotRows());
    c.state.constraintImport.version = 2;
    delete c.state.constraintImport.mappingMode;
    c.state.constraintImport.resolutions = { old: { weekStart: '2026-12-06', status: 'unavailable' } };
    const old = JSON.stringify(c.state.constraintImport);
    assert(c.run('periodReadiness()').includes('שיוך תאריכים קודם'));
    c.run("selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-11-01',weekCount:2}))");
    assert.equal(JSON.stringify(c.state.constraintImport), old, 'no silent reinterpretation on period change');
    c.sandbox.window.confirm = () => false;
    assert.equal((await importRows(c, screenshotRows())).success, false);
    assert.equal(JSON.stringify(c.state.constraintImport), old);
    c.sandbox.window.confirm = () => true;
    c.storage.fail('draftBackup');
    assert.equal((await importRows(c, screenshotRows())).success, false);
    assert.equal(JSON.stringify(c.state.constraintImport), old);
    c.storage.fail('');
    assert.equal((await importRows(c, screenshotRows())).success, true);
    assert.equal(c.state.constraintImport.version, 3);
    assert.equal(Object.keys(c.state.constraintImport.resolutions).length, 0);
    const backups = await c.storage.api.loadDraftBackups('manager');
    assert(backups.some(backup => JSON.stringify(JSON.parse(backup.draftJson).constraintImport) === old));
    assert.equal(c.run('periodReadiness()'), '');
  });
  console.log(`Excel import integration: ${passed} passed`);
}

module.exports = { createSandbox };
if (require.main === module) runTests().catch(error => { console.error(error); process.exitCode = 1; });
