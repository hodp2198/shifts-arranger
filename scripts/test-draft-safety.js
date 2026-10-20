/* Executes browser code and the real storage module with in-memory Firebase fakes. */
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createSandbox } = require('./test-excel-date-import');
const snapshots = require('../src/draftSnapshot');

function storageHarness(isolated = true) {
  const entries = new Map();
  const calls = [];
  let failKey = '';
  const storage = {
    get length() { return entries.size; }, key: index => [...entries.keys()][index],
    getItem: key => entries.get(key) ?? null,
    setItem(key, value) { if (key.includes(failKey) && failKey) throw new Error('storage full'); entries.set(key, value); }
  };
  const scope = {
    window: { __ISOLATED_DEV_MODE__: isolated, runtimeEnvironment: { isTestMode: isolated, assertProductionAccess() { if (isolated) throw new Error("TEST MODE"); } } }, localStorage: storage,
    crypto: require('crypto').webcrypto, console, setTimeout, clearTimeout,
    initializeApp: () => ({}), getApps: () => [{}], getApp: () => ({}), getFirestore: () => ({}),
    hasFirebaseConfig: () => true, firebaseConfig: {},
    doc: (db, ...parts) => parts.join('/'), collection: (db, ...parts) => parts.join('/'),
    serverTimestamp: () => 'server timestamp',
    setDoc: async (target, data) => { calls.push({ target, data }); },
    writeBatch: () => {
      const writes = [];
      return { set: (target, data) => writes.push({ target, data }),
        commit: async () => { calls.push({ batch: writes }); } };
    }
  };
  vm.createContext(scope);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/userDataService.js'), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
  vm.runInContext(source, scope);
  const api = vm.runInContext('({loadUserAppData, saveUserAppData, cancelPendingSave, replaceDraftWithBackup, loadDraftBackups})', scope);
  return { api, entries, calls, scope, storage, fail: key => { failKey = key; } };
}

async function ui() {
  const c = createSandbox();
  const storage = storageHarness();
  c.run("currentAuthUid = 'manager'; state.historyStatus='ready'; selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-03-15',weekCount:2})); WORKERS=['דנה','רון','גל','שי'].map(name=>({name,min:1,max:4,aliases:[]}))");
  c.sandbox.window.userDataService = storage.api;
  c.sandbox.window.fairnessService = {
    ...(await import('../src/fairnessService.js')), loadOfficialSchedulesDocs: async () => []
  };
  for (const name of ['דנה', 'רון', 'גל', 'שי']) c.getWorkerCard(name).querySelector('.active-worker').checked = true;
  return { ...c, storage, state: c.sandbox.window.state };
}

async function run() {
  let passed = 0;
  async function test(name, fn) { await fn(); console.log(`[PASS] ${name}`); passed++; }
  await test('Runtime snapshots roundtrip dates, sets, assignments and worker state', () => {
    const source = { day: new Date('2026-03-15T10:00:00Z'), blocked: new Set(['2026-03-16']), values: [null, { text: 'אילוצים' }] };
    const restored = snapshots.parse(snapshots.stringify(source));
    assert.equal(restored.day.getTime(), source.day.getTime());
    assert(restored.blocked instanceof Set);
    assert(restored.blocked.has('2026-03-16'));
    assert.deepEqual(restored.values, source.values);
  });
  await test('Real isolated storage keeps independent per-manager recoverable backups', async () => {
    const h = storageHarness();
    const previous = { startDate: '2026-03-15', workers: [{ name: 'דנה', constraints: 'original' }] };
    await h.api.replaceDraftWithBackup('manager', previous, { startDate: '2026-03-22' });
    const backups = await h.api.loadDraftBackups('manager');
    assert.equal(backups.length, 1);
    assert.deepEqual(JSON.parse(backups[0].draftJson), previous);
    assert.equal((await h.api.loadUserAppData('manager')).startDate, '2026-03-22');
    assert.equal((await h.api.loadDraftBackups('other')).length, 0);
  });
  await test('Backup failure leaves current draft untouched', async () => {
    const h = storageHarness();
    await h.api.saveUserAppData('manager', { startDate: 'old' }, { immediate: true });
    h.fail('draftBackup');
    await assert.rejects(h.api.replaceDraftWithBackup('manager', { startDate: 'old' }, { startDate: 'new' }));
    assert.equal((await h.api.loadUserAppData('manager')).startDate, 'old');
  });
  await test('Replacement failure after backup preserves old current and its recoverable backup', async () => {
    const h = storageHarness();
    await h.api.saveUserAppData('manager', { startDate: 'old' }, { immediate: true });
    h.fail('appData');
    await assert.rejects(h.api.replaceDraftWithBackup('manager', { startDate: 'old' }, { startDate: 'new' }));
    assert.equal((await h.api.loadUserAppData('manager')).startDate, 'old');
    assert.equal((await h.api.loadDraftBackups('manager')).length, 1);
  });
  await test('Cloud storage commits backup and current together in an owner-scoped batch', async () => {
    const h = storageHarness(false);
    await h.api.replaceDraftWithBackup('manager', { workers: [{ constraints: 'original' }] }, { startDate: 'new' });
    assert.equal(h.calls.length, 1);
    const writes = h.calls[0].batch;
    assert.equal(writes.length, 2);
    assert(writes[0].target.startsWith('users/manager/draftBackups/'));
    assert.equal(writes[1].target, 'users/manager/appData/current');
    assert.equal(JSON.parse(writes[0].data.draftJson).workers[0].constraints, 'original');
  });
  await test('In-flight autosaves complete before replacement so they cannot overwrite the new draft', async () => {
    const h = storageHarness(false);
    let release;
    h.scope.setDoc = () => new Promise(resolve => { release = resolve; });
    const oldSave = h.api.saveUserAppData('manager', { startDate: 'old' }, { immediate: true });
    await new Promise(resolve => setImmediate(resolve));
    const transition = h.api.replaceDraftWithBackup('manager', { startDate: 'old' }, { startDate: 'new' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.length, 0);
    release();
    await oldSave;
    await transition;
    assert.equal(h.calls[0].batch[1].data.startDate, 'new');
  });
  await test('Failed cloud commit leaves no successful replacement and does not poison future saves', async () => {
    const h = storageHarness(false);
    h.scope.writeBatch = () => ({ set() {}, commit: async () => { throw new Error('offline'); } });
    await assert.rejects(h.api.replaceDraftWithBackup('manager', {}, {}));
    await h.api.saveUserAppData('manager', { recovered: true }, { immediate: true });
    assert.equal(h.calls[0].data.recovered, true);
  });
  await test('Refreshing today’s proposal does not alter draft, constraints, output or storage', async () => {
    const c = await ui();
    c.getWorkerCard('דנה').querySelector('.constraints').value = "א' - לא יכולה";
    c.getOrCreateMockEl('plainResult').value = 'saved output';
    c.state.draftOrigin = 'restored';
    const before = c.run('JSON.stringify(captureDraftData())');
    c.run('proposePeriod()');
    assert.equal(c.run('JSON.stringify(captureDraftData())'), before);
    assert(c.getOrCreateMockEl('draftStatus').textContent.includes('ששוחזרה'));
    assert(c.getOrCreateMockEl('automaticPeriodProposal').textContent.includes('2026-03-08'));
    assert.equal(c.storage.entries.size, 0);
  });
  await test('New schedule preserves full draft, starts at proposal and transfers no period-bound input', async () => {
    const c = await ui();
    c.getWorkerCard('דנה').querySelector('.constraints').value = "א' - לא יכולה";
    c.getOrCreateMockEl('bulkExcelNotes').value = 'original Excel';
    c.getOrCreateMockEl('oneTimeRules').value = 'original exception';
    c.state.manualOverrides = { '2026-03-15': { first: 'דנה' } };
    c.state.special = { '2026-03-16': { closed: true, label: 'custom', isExplicitUserCustom: true } };
    c.state.pendingExcelImport = { rowsJson: '[["דנה"]]', rawText: 'original Excel' };
    c.getOrCreateMockEl('plainResult').value = 'original output';
    c.getOrCreateMockEl('manualOffDate').value = '2026-03-20';
    const previous = JSON.parse(c.run('JSON.stringify(captureDraftData())'));
    await c.run('startNewSchedule()');
    assert.equal(c.state.period.startDate, '2026-03-08');
    assert.equal(c.state.draftOrigin, 'new');
    assert.equal(c.state.pendingExcelImport, null);
    assert.equal(Object.keys(c.state.manualOverrides).length, 0);
    assert.equal(Object.keys(c.state.special).length, 0);
    assert.equal(c.getWorkerCard('דנה').querySelector('.constraints').value, '');
    assert.equal(c.getWorkerCard('דנה').querySelector('.active-worker').checked, false);
    assert.equal(c.getOrCreateMockEl('bulkExcelNotes').value, '');
    assert.equal(c.getOrCreateMockEl('oneTimeRules').value, '');
    const backups = await c.storage.api.loadDraftBackups('manager');
    const backup = JSON.parse(backups[0].draftJson);
    assert.deepEqual(backup, previous);
    assert.equal(snapshots.parse(backup.runtimeSnapshotJson).fields.manualOffDate, '2026-03-20');
    assert.equal(c.state.officialSchedules.length, 0);
  });
  await test('Restoring a backup preserves the draft being replaced and recovers original constraints', async () => {
    const c = await ui();
    c.getWorkerCard('דנה').querySelector('.constraints').value = "א' - לא יכולה";
    await c.run('startNewSchedule()');
    const originalBackup = c.state.draftBackups[0];
    c.getWorkerCard('דנה').querySelector('.constraints').value = 'new draft text';
    c.getOrCreateMockEl('draftBackupSelect').value = originalBackup.id;
    await c.run('restoreDraftBackup()');
    assert.equal(c.state.period.startDate, '2026-03-15');
    assert.equal(c.getWorkerCard('דנה').querySelector('.constraints').value, "א' - לא יכולה");
    const backups = await c.storage.api.loadDraftBackups('manager');
    assert.equal(backups.length, 2);
    assert(backups.some(backup => JSON.parse(backup.draftJson).workers.some(worker => worker.constraints === 'new draft text')));
    assert.equal(c.state.draftOrigin, 'restored');
  });
  await test('Canceling or failing new-schedule preservation never clears current inputs', async () => {
    const c = await ui();
    c.getWorkerCard('דנה').querySelector('.constraints').value = 'original';
    c.sandbox.window.confirm = () => false;
    await c.run('startNewSchedule()');
    assert.equal(c.state.period.startDate, '2026-03-15');
    assert.equal(c.storage.entries.size, 0);
    c.sandbox.window.confirm = () => true;
    c.storage.fail('draftBackup');
    await c.run('startNewSchedule()');
    assert.equal(c.getWorkerCard('דנה').querySelector('.constraints').value, 'original');
    assert.equal(c.state.period.startDate, '2026-03-15');
    assert.equal(c.state.draftTransition, false);
    assert.equal(c.getOrCreateMockEl('mainShell').inert, false);
  });
  await test('Past restored draft stays past while today’s proposal is separate and generation stays blocked', async () => {
    const c = await ui();
    const draft = JSON.parse(c.run('JSON.stringify(captureDraftData())'));
    draft.schedulePeriod.startDate = '2026-02-22';
    draft.startDate = '2026-02-22';
    draft.workers[0].constraints = 'preserved';
    await c.run(`loadUserWorkspace('manager', ${JSON.stringify(draft)})`);
    assert.equal(c.state.period.startDate, '2026-02-22');
    assert(c.getOrCreateMockEl('automaticPeriodProposal').textContent.includes('2026-03-08'));
    assert(c.getOrCreateMockEl('draftStatus').textContent.includes('ששוחזרה'));
    assert.equal(c.run('requireReadyPeriod()'), false);
    assert.equal(c.getWorkerCard('דנה').querySelector('.constraints').value, 'preserved');
  });
  await test('Newly generated grid belongs to canonical period and runtime grid survives backup/restore', async () => {
    const c = await ui();
    await c.run('renderSchedule()');
    assert(c.getOrCreateMockEl('scheduleOutput').innerHTML.includes('15.3-21.3'));
    const original = c.run('window.draftSnapshot.stringify(state.currentSchedule)');
    await c.run('startNewSchedule()');
    const backup = c.state.draftBackups[0];
    c.getOrCreateMockEl('draftBackupSelect').value = backup.id;
    await c.run('restoreDraftBackup()');
    assert.equal(c.run('window.draftSnapshot.stringify(state.currentSchedule)'), original);
    assert(c.getOrCreateMockEl('scheduleOutput').innerHTML.includes('15.3-21.3'));
    assert.equal(c.run('requireCurrentGrid()'), true);
  });
  await test('Stale entries outside period or in the wrong week never render or export', async () => {
    for (const mutation of [
      "result.schedule[0][0].day.iso='2026-03-08'",
      "result.schedule[0][0].day.week=1",
      "result.schedule[0][0].day.date=new Date(2026,2,16,12)",
      "result.schedule[0][0].day.date=new Date(NaN)",
      "result.schedule[1].push(result.schedule[0][0])"
    ]) {
      const c = await ui();
      c.run('var result=generateSchedule()');
      c.run(mutation);
      await c.run('renderSchedule(result)');
      assert.equal(c.state.currentSchedule, null);
      assert.equal(c.getOrCreateMockEl('scheduleOutput').innerHTML, '');
      assert(c.state.rejectedGridSnapshotJson);
      assert(c.getOrCreateMockEl('scheduleWarnings').textContent.includes('אינם תואמים'));
    }
  });
  await test('Stale loaded runtime is preserved but not displayed; direct save/export is blocked', async () => {
    const c = await ui();
    c.run('state.currentSchedule=generateSchedule().schedule');
    const draft = JSON.parse(c.run('JSON.stringify(captureDraftData())'));
    draft.schedulePeriod.startDate = '2026-03-22';
    draft.startDate = '2026-03-22';
    await c.run(`loadUserWorkspace('manager', ${JSON.stringify(draft)})`);
    assert.equal(c.state.currentSchedule, null);
    assert.equal(c.getOrCreateMockEl('scheduleOutput').innerHTML, '');
    assert(c.state.rejectedGridSnapshotJson);
    c.run("state.currentSchedule=window.draftSnapshot.parse(state.rejectedGridSnapshotJson).schedule");
    assert.equal(c.run('requireCurrentGrid()'), false);
    assert.equal(c.state.currentSchedule, null);
  });
  await test('Reported October 18 draft remains intact while October 20 proposal starts October 25', async () => {
    const c = await ui();
    c.sandbox.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-10-20T09:00:00Z'])); }
      static now() { return new Date('2026-10-20T09:00:00Z').getTime(); }
    };
    const draft = JSON.parse(c.run('JSON.stringify(captureDraftData())'));
    draft.schedulePeriod.startDate = '2026-10-18';
    draft.startDate = '2026-10-18';
    draft.constraintPeriod = JSON.stringify(['2026-10-18', 2, 0]);
    draft.workers[0].constraints = 'original October constraints';
    await c.run(`loadUserWorkspace('manager', ${JSON.stringify(draft)})`);
    assert.equal(c.state.period.startDate, '2026-10-18');
    assert(c.getOrCreateMockEl('automaticPeriodProposal').textContent.includes('2026-10-25'));
    assert(c.getOrCreateMockEl('automaticPeriodProposal').textContent.includes('2026-11-07'));
    assert.equal(c.run('requireReadyPeriod()'), false);
    await c.run('startNewSchedule()');
    assert.equal(c.state.period.startDate, '2026-10-25');
    const backups = await c.storage.api.loadDraftBackups('manager');
    assert.equal(JSON.parse(backups[0].draftJson).workers[0].constraints, 'original October constraints');
    assert.equal(c.getWorkerCard('דנה').querySelector('.constraints').value, '');
  });
  await test('Past, unrendered runtime remains recoverable when starting a new schedule', async () => {
    const c = await ui();
    await c.run('renderSchedule()');
    const originalDraft = JSON.parse(c.run('JSON.stringify(captureDraftData())'));
    const originalRuntime = snapshots.parse(originalDraft.runtimeSnapshotJson);
    // Advance the clock beyond the draft without touching any of its data.
    c.sandbox.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : ['2026-04-01T09:00:00Z'])); }
    };
    await c.run(`loadUserWorkspace('manager', ${JSON.stringify(originalDraft)})`);
    assert.equal(c.state.currentSchedule, null);
    await c.run('startNewSchedule()');
    const backups = await c.storage.api.loadDraftBackups('manager');
    const preserved = snapshots.parse(JSON.parse(backups[0].draftJson).runtimeSnapshotJson);
    // Depending on the local clock, the preserved grid is either unrendered or
    // retained as a rejected snapshot; both preserve its assignment data.
    const storedSchedule = preserved.currentSchedule || snapshots.parse(preserved.rejectedGridSnapshotJson).schedule;
    assert.equal(storedSchedule[0][0].day.iso, originalRuntime.currentSchedule[0][0].day.iso);
    assert.equal(storedSchedule[0][0].first.name, originalRuntime.currentSchedule[0][0].first.name);
  });
  await test('A stale grid cannot be saved officially or exported even through direct action handlers', async () => {
    for (const action of ['handleSaveOfficialSchedule()', 'createCalendarExportLink()', 'copyCalendarExportLink()', 'openCalendarExportLink()']) {
      const c = await ui();
      c.run("state.currentSchedule=generateSchedule().schedule; state.currentSchedule[0][0].day.iso='2026-03-08'");
      let writes = 0;
      c.sandbox.window.fairnessService.saveOfficialScheduleDoc = async () => { writes++; };
      c.sandbox.window.scheduleExport = { createEmployeeExportLink: async () => { writes++; } };
      await c.run(action);
      assert.equal(writes, 0);
      assert.equal(c.state.currentSchedule, null);
    }
  });
  await test('Failed history refresh prevents a new schedule and creates no backup or replacement', async () => {
    const c = await ui();
    c.sandbox.window.fairnessService.loadOfficialSchedulesDocs = async () => { throw new Error('offline'); };
    c.getWorkerCard('דנה').querySelector('.constraints').value = 'original';
    await c.run('startNewSchedule()');
    assert.equal(c.storage.entries.size, 0);
    assert.equal(c.state.period.startDate, '2026-03-15');
    assert.equal(c.getWorkerCard('דנה').querySelector('.constraints').value, 'original');
  });
  await test('Existing confirmed schedule cleanup still selects an automatic period after preview was separated', async () => {
    const c = await ui();
    c.state.pendingExcelImport = { rawText: 'old' };
    await c.run('resetApplicationState()');
    assert.equal(c.state.period.startDate, '2026-03-08');
    assert.equal(c.state.pendingExcelImport, null);
    assert.equal(c.state.draftOrigin, 'new');
    assert.equal(c.run('requireReadyPeriod()'), true);
  });
  await test('Rejected stale grids retain their previous plain output inside the recoverable snapshot', async () => {
    const c = await ui();
    c.getOrCreateMockEl('plainResult').value = 'original output text';
    c.run("var stale=generateSchedule(); stale.schedule[0][0].day.iso='2026-03-08'");
    await c.run('renderSchedule(stale)');
    assert.equal(c.getOrCreateMockEl('plainResult').value, '');
    assert.equal(snapshots.parse(c.state.rejectedGridSnapshotJson).plainResult, 'original output text');
  });
  console.log(`Draft safety: ${passed} passed`);
}
module.exports = { storageHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
