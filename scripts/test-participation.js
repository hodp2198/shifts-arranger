/* Submission participation: real UI/storage/calculations with in-memory fakes. */
const assert = require('assert/strict');
const { createSandbox } = require('./test-excel-date-import');
const { storageHarness } = require('./test-draft-safety');
const period = require('../src/schedulePeriodService');
const imports = require('../src/constraintImportService');

async function ready() {
  const c = createSandbox();
  c.storage = storageHarness();
  c.fairness = await import('../src/fairnessService.js');
  c.sandbox.window.userDataService = c.storage.api;
  c.sandbox.window.fairnessService = { ...c.fairness, loadOfficialSchedulesDocs: async () => [] };
  c.sandbox.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-20T09:00:00Z'])); }
  };
  c.run("currentAuthUid='manager';state.historyStatus='ready';WORKERS=['הגיש','ריק','נעדר','בלוק ריק'].map(name=>({name,aliases:[],min:0,max:6}));WORKERS=ensureUniqueWorkerColors(WORKERS).workers;selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-10-25',weekCount:2}))");
  for (const name of ['הגיש', 'ריק', 'נעדר', 'בלוק ריק']) c.getWorkerCard(name);
  c.state = c.sandbox.window.state;
  c.worker = name => c.run(`getAllWorkersData().find(worker=>worker.name===${JSON.stringify(name)})`);
  c.import = async rows => {
    c.getOrCreateMockEl('bulkExcelNotes').value = rows.map(row => row.join('\t')).join('\n');
    return c.sandbox.window.importRowsMatrix(rows, c.getOrCreateMockEl('bulkExcelStatus'));
  };
  c.activate = async (name, checked) => {
    const card = c.getWorkerCard(name), target = card.querySelector('.active-worker');
    target.checked = checked;
    target.closest = selector => selector === '.worker' ? card : null;
    target.classList = { contains: value => value === 'active-worker' };
    await c.documentListeners.get('input')({ target });
    await c.documentListeners.get('change')({ target });
  };
  return c;
}
const blankBlock = () => ['תאריך: לא קובע', "א' -", "ב' -", "ג' -", "ד' -", "ה' -", 'שבת -'];
const matrix = columns => Array.from({ length: Math.max(...columns.map(column => column.length)) }, (_, index) => columns.map(column => column[index] || ''));
function official(fairness, days, snapshot, id) {
  return { id, status: 'active', savedAt: '2026-10-20T09:00:00Z', daysSnapshot: fairness.extractPeriodDays(days), workerConstraintsSnapshot: snapshot, assignments: [] };
}

async function run() {
  let passed = 0;
  async function test(name, fn) { await fn(); console.log('[PASS] ' + name); passed++; }
  await test('Name-only column and absent employee are inactive; submitted blank blocks are available', async () => {
    const c = await ready();
    await c.import(matrix([['הגיש', ...blankBlock(), ...blankBlock()], ['ריק']]));
    assert.equal(c.worker('ריק').active, false);
    assert.equal(c.worker('נעדר').active, false);
    assert.equal(c.getWorkerCard('ריק').querySelector('.active-worker').checked, false);
    assert(c.getWorkerCard('ריק').querySelector('.participation-status').textContent.includes('לא הוגש'));
    const submitted = c.worker('הגיש');
    assert(submitted.active); assert.equal(submitted.participationDates.length, 12);
    assert.equal(submitted.blocked.size, 0); assert.equal(submitted.submitted.size, 12);
    assert.equal(c.run('getWorkersData().length'), 1);
  });
  await test('A header-only weekly submission is distinct from a name-only column', async () => {
    const c = await ready();
    await c.import([['בלוק ריק', 'ריק'], ['תאריך: לא תקין', '']]);
    assert(c.worker('בלוק ריק').active);
    assert.equal(c.worker('בלוק ריק').participationDates.length, 6);
    assert.equal(c.worker('ריק').active, false);
  });
  await test('Two clearly separated weekly headers with blank day cells submit both weeks', async () => {
    const c = await ready();
    await c.import([['בלוק ריק'], ['תאריך: ישן'], [''], [''], ['תאריך: ישן נוסף'], ['']]);
    assert.equal(c.state.constraintImport.issues.length, 0);
    assert.equal(c.worker('בלוק ריק').participationDates.length, 12);
    assert.equal(c.worker('בלוק ריק').blocked.size, 0);
  });
  await test('Only submitted weeks participate; missing weeks cannot receive automatic assignments', async () => {
    const c = await ready();
    await c.import(matrix([['הגיש', ...blankBlock()], ['בלוק ריק', ...blankBlock(), ...blankBlock()]]));
    const first = c.worker('הגיש');
    assert.equal(first.participationDates.length, 6);
    assert(first.blocked.has('2026-11-01')); assert.equal(first.explicitBlocked.size, 0);
    const generated = c.run('generateSchedule()');
    for (const entry of Object.values(generated.schedule).flat()) {
      for (const worker of [entry.first, entry.second].filter(Boolean)) {
        assert.notEqual(worker.name, 'ריק'); assert.notEqual(worker.name, 'נעדר');
        if (entry.day.week === 1) assert.notEqual(worker.name, 'הגיש');
      }
    }
    assert(c.getWorkerCard('הגיש').querySelector('.participation-status').textContent.includes('שבועות 1'));
  });
  await test('Native checkbox input manually activates a non-submitter for both weeks and survives reload', async () => {
    const c = await ready(); await c.import([['ריק']]);
    await c.activate('ריק', true);
    assert(c.worker('ריק').active); assert.equal(c.worker('ריק').participationDates.length, 12);
    assert.equal(c.worker('ריק').participationSource, 'manager');
    assert(c.getWorkerCard('ריק').querySelector('.participation-status').textContent.includes('ידנית'));
    await c.storage.api.saveUserAppData('manager', c.run('captureDraftData()'), { immediate: true });
    await c.run("loadUserWorkspace('manager')");
    assert(c.worker('ריק').active); assert.equal(c.worker('ריק').participationDates.length, 12);
    await c.import([['ריק']]); assert(c.worker('ריק').active, 'manual activation survives reimport');
    await c.activate('ריק', false); assert.equal(c.worker('ריק').active, false);
  });
  await test('Manual activation fills missing participation without overriding explicit unavailability', async () => {
    const c = await ready(); await c.import([['הגיש'], ['תאריך: טעות'], ["א' - לא יכול"]]);
    await c.activate('הגיש', true);
    const worker = c.worker('הגיש');
    assert.equal(worker.participationDates.length, 12); assert(worker.blocked.has('2026-10-25'));
    assert.equal(worker.blocked.has('2026-11-01'), false);
    const snapshot = c.fairness.snapshotWorkerConstraints([worker]);
    assert.deepEqual(snapshot['הגיש'].blockedDays, ['2026-10-25']);
  });
  await test('A dated manual submission in week 2 does not activate missing week 1', async () => {
    const c = await ready();
    const card = c.getWorkerCard('הגיש');
    card.querySelector('.constraints').value = "1/11/2026 - 7/11/2026\nא' -";
    card.querySelector('.active-worker').checked = true;
    const worker = c.worker('הגיש');
    assert(worker.active); assert.equal(worker.participationDates.length, 6);
    assert.equal(worker.participationDates[0], '2026-11-01');
    assert(worker.blocked.has('2026-10-25')); assert.equal(worker.explicitBlocked.size, 0);
  });
  await test('Manual deactivation survives reimport and manager activation expires on a different period', async () => {
    const c = await ready(); const rows = [['הגיש'], ...blankBlock().map(value => [value])];
    await c.import(rows); await c.activate('הגיש', false); await c.import(rows);
    assert.equal(c.worker('הגיש').active, false);
    await c.activate('ריק', true);
    c.run("selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-11-01',weekCount:2}))");
    assert.equal(c.worker('ריק').active, false);
    assert.equal(c.getWorkerCard('ריק').querySelector('.active-worker').checked, false);
  });
  await test('New fairness snapshots exclude missing weeks rather than count them as closed days', async () => {
    const c = await ready(); await c.import(matrix([['הגיש', ...blankBlock()], ['ריק']]));
    const snapshot = c.fairness.snapshotWorkerConstraints(c.run('getWorkersData()'));
    assert.equal(snapshot['ריק'], undefined);
    assert.equal(snapshot['הגיש'].participationDates.length, 6);
    assert.equal(snapshot['הגיש'].blockedDays.length, 0);
    const days = c.sandbox.window.getScheduleDays();
    const local = c.fairness.computePeriodFairness(c.fairness.extractPeriodDays(days), snapshot, []);
    assert.equal(local['2026-10']['הגיש'].opened, 6);
    assert.equal(local['2026-11']['הגיש'].opened, 0);
    assert.equal(local['2026-11']['הגיש'].closed, 0);
    const aggregate = c.fairness.calculateAggregatedFairness([official(c.fairness, days, snapshot, 'new')]);
    assert.equal(aggregate.records.find(worker => worker.name === 'הגיש').opened, 6);
  });
  await test('Manual non-submitter participation counts correctly in new official fairness', async () => {
    const c = await ready(); await c.activate('ריק', true);
    const snapshot = c.fairness.snapshotWorkerConstraints(c.run('getWorkersData()'));
    const record = official(c.fairness, c.sandbox.window.getScheduleDays(), snapshot, 'manual');
    record.assignments = [{ iso: '2026-10-25', slot1: 'ריק', slot2: null }];
    const stats = c.fairness.calculateAggregatedFairness([record]).records.find(worker => worker.name === 'ריק');
    assert.equal(stats.opened, 12); assert.equal(stats.assigned, 1); assert.equal(stats.closed, 0);
  });
  await test('Historical official snapshots without participation metadata retain all original counts and data', async () => {
    const c = await ready();
    const record = official(c.fairness, c.sandbox.window.getScheduleDays(), { 'ריק': { submittedDays: [], blockedDays: ['2026-10-26'] } }, 'historical');
    record.assignments = [{ iso: '2026-10-25', slot1: 'ריק', slot2: null }];
    const original = JSON.stringify(record);
    await c.import([['ריק']]);
    const stats = c.fairness.calculateAggregatedFairness([record]).records.find(worker => worker.name === 'ריק');
    assert.equal(stats.opened, 11); assert.equal(stats.closed, 1); assert.equal(stats.assigned, 1);
    assert.equal(JSON.stringify(record), original);
    const local = c.fairness.computePeriodFairness(record.daysSnapshot, record.workerConstraintsSnapshot, record.assignments);
    assert.equal(local['2026-10']['ריק'].opened, 5); assert.equal(local['2026-11']['ריק'].opened, 6);
  });
  await test('Actual official-save handler stores participation for new records using memory-only services', async () => {
    const c = await ready();
    await c.import(matrix([['הגיש', ...blankBlock()], ['בלוק ריק', ...blankBlock(), ...blankBlock()]]));
    await c.activate('נעדר', true);
    const saved = [];
    c.sandbox.window.fairnessService = { ...c.fairness,
      loadOfficialSchedulesDocs: async () => saved,
      saveOfficialScheduleDoc: async (uid, record) => { assert.equal(uid, 'manager'); saved.push(record); return { success: true }; }
    };
    await c.run('renderSchedule(generateSchedule())');
    await c.run('handleSaveOfficialSchedule()');
    assert.equal(saved.length, 1);
    const snapshot = saved[0].workerConstraintsSnapshot;
    assert.equal(snapshot['ריק'], undefined);
    assert.equal(snapshot['הגיש'].participationDates.length, 6);
    assert.equal(snapshot['נעדר'].participationDates.length, 12);
    assert.equal(snapshot['נעדר'].participationSource, 'manager');
    const stats = c.fairness.calculateAggregatedFairness(saved).records;
    assert.equal(stats.find(worker => worker.name === 'הגיש').opened, 6);
    assert.equal(stats.find(worker => worker.name === 'נעדר').opened, 12);
  });
  await test('Older block-sequence drafts derive submission metadata without replacing their import sources', async () => {
    const c = await ready(); await c.import(matrix([['הגיש', ...blankBlock()], ['ריק']]));
    for (const employee of c.state.constraintImport.employees) delete employee.submittedBlockNumbers;
    const before = JSON.stringify(c.state.constraintImport);
    c.getWorkerCard('ריק').querySelector('.active-worker').checked = true;
    assert.equal(c.worker('ריק').active, false); assert(c.worker('הגיש').active);
    assert.equal(JSON.stringify(c.state.constraintImport), before);
  });
  await test('Restored pre-rule grids cannot be saved or exported with a non-participating employee', async () => {
    const c = await ready(); await c.activate('ריק', true); await c.activate('נעדר', true);
    await c.run('renderSchedule(generateSchedule())');
    c.getWorkerCard('ריק').dataset.activationOverride = '';
    c.getWorkerCard('נעדר').dataset.activationOverride = '';
    const before = c.run('window.draftSnapshot.stringify(state.currentSchedule)');
    assert.equal(c.run('requireCurrentGrid()'), false);
    assert.equal(c.run('window.draftSnapshot.stringify(state.currentSchedule)'), before);
  });
  await test('Import metadata independently records submitted blocks including blank blocks', () => {
    const chosen = period.createPeriod({ startDate: '2026-10-25', weekCount: 2 });
    const rows = matrix([['הגיש', ...blankBlock(), ...blankBlock()], ['ריק']]);
    const plan = imports.interpret({ sources: [{ rowsJson: JSON.stringify(rows) }], workers: [], period: chosen }, period);
    assert.deepEqual(plan.employees.find(employee => employee.name === 'הגיש').submittedBlockNumbers, [1, 2]);
    assert.deepEqual(plan.employees.find(employee => employee.name === 'ריק').submittedBlockNumbers, []);
  });
  console.log(`Participation: ${passed} passed`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
