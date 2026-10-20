/* Actual UI handlers and draft storage, with in-memory fakes only. No network. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { createSandbox } = require('./test-excel-date-import');
const { storageHarness } = require('./test-draft-safety');
const snapshots = require('../src/draftSnapshot');

async function ready() {
  const c = createSandbox();
  const storage = storageHarness();
  c.sandbox.window.userDataService = storage.api;
  c.sandbox.window.fairnessService = {
    ...(await import('../src/fairnessService.js')), loadOfficialSchedulesDocs: async () => c.state.officialSchedules
  };
  c.state = c.sandbox.window.state;
  c.run("currentAuthUid='manager'; state.historyStatus='ready'; WORKERS=['דנה','רון','גל','שי'].map(name=>({name,min:1,max:4,aliases:[]})); selectPeriod(window.schedulePeriodService.createPeriod({startDate:'2026-03-15',weekCount:2}))");
  c.run('WORKERS = ensureUniqueWorkerColors(WORKERS).workers');
  for (const name of ['דנה', 'רון', 'גל', 'שי']) {
    c.getWorkerCard(name);
    c.run(`setWorkerActivation(document.querySelector('.worker[data-worker="${name}"]'), true)`);
  }
  c.storage = storage;
  c.edit = async (date, count = '2', event = 'input') => {
    const target = c.getOrCreateMockEl('startDate');
    target.value = date;
    c.getOrCreateMockEl('weekCount').value = count;
    target.closest = () => null;
    await c.documentListeners.get(event)({ target });
  };
  c.apply = () => c.listeners.get('buildWeeks:click')();
  c.draft = () => JSON.parse(c.run('JSON.stringify(captureDraftData())'));
  return c;
}

async function run() {
  let passed = 0;
  async function test(name, fn) { await fn(); console.log('[PASS] ' + name); passed++; }
  await test('Controls, recommendation and Apply are visible outside every collapsed section', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
    const section = html.slice(html.indexOf('<section id="periodSelection"'), html.indexOf('</section>', html.indexOf('<section id="periodSelection"')));
    assert(!section.includes('<details'));
    for (const id of ['startDate', 'weekCount', 'automaticPeriodProposal', 'buildWeeks', 'periodPreviewRanges']) assert(section.includes(`id="${id}"`));
    assert(section.includes('type="date"'));
    assert(section.includes('min="1" max="8"'));
    assert(html.indexOf('id="periodSelection"') < html.indexOf('id="weekDetails"'));
    assert(!html.includes('startDateEl.min ='));
  });
  await test('Native input previews ranges without mutating grid, activation, constraints or draft', async () => {
    const c = await ready();
    c.getWorkerCard('דנה').querySelector('.constraints').value = "א' - לא יכולה";
    await c.run('renderSchedule(generateSchedule())');
    const before = c.draft(), grid = c.getOrCreateMockEl('output').innerHTML;
    await c.edit('2026-03-22', '3');
    assert.deepEqual(c.draft(), before);
    assert.equal(c.getOrCreateMockEl('output').innerHTML, grid);
    assert(c.getOrCreateMockEl('periodPreviewRanges').innerHTML.includes('2026-04-11'));
    assert.equal(c.storage.entries.size, 0);
  });
  await test('Native change and week-count input both update preview only', async () => {
    const c = await ready();
    await c.edit('2026-03-22', '8', 'change');
    assert(c.getOrCreateMockEl('periodPreviewRanges').innerHTML.includes('2026-05-16'));
    const target = c.getOrCreateMockEl('weekCount'); target.closest = () => null; target.value = '1';
    await c.documentListeners.get('input')({ target });
    assert(c.getOrCreateMockEl('periodPreviewRanges').innerHTML.includes('2026-03-28'));
    assert.equal(c.state.period.weekCount, 2);
  });
  await test('Invalid dates, non-Sundays and counts outside 1–8 never apply', async () => {
    const c = await ready();
    for (const [date, count] of [['', '2'], ['2026-02-30', '2'], ['2026-03-23', '2'], ['2026-03-22', '0'], ['2026-03-22', '9'], ['2026-03-22', '1.5']]) {
      await c.edit(date, count);
      assert.equal(c.getOrCreateMockEl('buildWeeks').disabled, true);
      assert.equal(await c.apply(), false);
      assert.equal(c.state.period.startDate, '2026-03-15');
    }
    assert.equal(c.storage.entries.size, 0);
  });
  await test('Every supported count previews consecutive canonical ranges', async () => {
    const c = await ready();
    for (let count = 1; count <= 8; count++) {
      await c.edit('2026-03-22', String(count));
      const preview = c.run('inspectPeriodPreview()');
      assert.equal(preview.weeks.length, count);
      assert.equal(preview.weeks.at(-1).end, c.run(`periodService().addDays('2026-03-22',${count * 7 - 1})`));
    }
  });
  await test('Cancel confirmation leaves all data intact and makes no backup', async () => {
    const c = await ready();
    c.getWorkerCard('דנה').querySelector('.constraints').value = "א' - לא יכולה";
    const before = c.draft(); let confirmations = 0;
    c.sandbox.window.confirm = () => { confirmations++; return false; };
    await c.edit('2026-03-22');
    assert.equal(confirmations, 0);
    assert.equal(await c.apply(), false);
    assert.equal(confirmations, 1);
    assert.deepEqual(c.draft(), before);
    assert.equal(c.storage.entries.size, 0);
  });
  await test('Apply backs up complete prior grid and data; old grid cannot remain usable', async () => {
    const c = await ready();
    await c.run('renderSchedule(generateSchedule())');
    const before = c.draft(); let confirmed = false;
    c.sandbox.window.confirm = () => { confirmed = true; return true; };
    await c.edit('2026-03-22', '1');
    assert.equal(await c.apply(), true);
    assert(confirmed);
    assert.equal(c.state.period.startDate, '2026-03-22');
    assert.equal(c.state.period.weekCount, 1);
    assert.equal(c.state.currentSchedule, null);
    const backups = await c.storage.api.loadDraftBackups('manager');
    assert.deepEqual(JSON.parse(backups[0].draftJson), before);
    assert(snapshots.parse(JSON.parse(backups[0].draftJson).runtimeSnapshotJson).currentSchedule);
    assert.equal(c.getOrCreateMockEl('output').innerHTML, '');
    c.getOrCreateMockEl('draftBackupSelect').value = backups[0].id;
    await c.run('restoreDraftBackup()');
    assert.equal(c.state.period.startDate, '2026-03-15');
    assert(c.state.currentSchedule);
    assert.equal((await c.storage.api.loadDraftBackups('manager')).length, 2);
  });
  await test('Backup failure preserves active period, constraints and output', async () => {
    const c = await ready();
    c.getWorkerCard('דנה').querySelector('.constraints').value = "א' - לא יכולה";
    const before = c.draft();
    c.storage.fail('draftBackup');
    await c.edit('2026-03-22');
    assert.equal(await c.apply(), false);
    assert.deepEqual(c.draft(), before);
    assert(c.getOrCreateMockEl('periodPreviewStatus').textContent.includes('המעבר לא הושלם'));
  });
  await test('Preview leaves imports untouched; confirmed Apply maps block positions to the new period', async () => {
    const c = await ready();
    const rows = [['דנה'], ['15.3-21.3'], ["א' - לא יכולה"], ['22.3-28.3'], ["ב' - לא יכולה"]];
    c.getOrCreateMockEl('bulkExcelNotes').value = rows.map(row => row.join('\t')).join('\n');
    await c.sandbox.window.importRowsMatrix(rows, c.getOrCreateMockEl('bulkExcelStatus'));
    const before = JSON.stringify(c.state.constraintImport);
    await c.edit('2026-03-22', '1');
    assert.equal(JSON.stringify(c.state.constraintImport), before);
    assert(await c.apply());
    assert.equal(c.state.constraintImport.applied.length, 1);
    assert.equal(c.state.constraintImport.applied[0].date, '2026-03-22');
    assert.equal(c.state.constraintImport.skipped[0].date, '2026-03-30');
    assert.equal(c.state.constraintImport.sources[0].anchorPeriod.startDate, '2026-03-15');
    assert.equal(c.run('periodReadiness()'), '');
    await c.run("loadUserWorkspace('manager')");
    assert.equal(c.state.period.startDate, '2026-03-22');
    assert.equal(c.state.constraintImport.applied[0].date, '2026-03-22');
  });
  await test('Manual constraints, special dates and assignment overrides survive, with generation blocked', async () => {
    const c = await ready();
    c.getWorkerCard('דנה').querySelector('.constraints').value = "א' - לא יכולה";
    c.state.special = { '2026-03-16': { closed: true, label: 'custom', isExplicitUserCustom: true } };
    c.state.manualOverrides = { '2026-03-17': { first: 'דנה' } };
    const before = c.draft();
    await c.edit('2026-03-22');
    assert(await c.apply());
    const after = c.draft();
    assert.deepEqual(after.workers.map(({ active, ...worker }) => worker), before.workers.map(({ active, ...worker }) => worker));
    assert.deepEqual(after.special, before.special);
    assert.deepEqual(after.manualOverrides, before.manualOverrides);
    assert(c.run('periodReadiness()').includes('התקופה השתנתה'));
  });
  await test('Past Sundays remain inspectable and applicable; generation stays future-only', async () => {
    const c = await ready();
    await c.edit('2026-02-22');
    assert(c.getOrCreateMockEl('periodPreviewStatus').textContent.includes('בעבר'));
    assert(c.getOrCreateMockEl('periodPreviewRanges').innerHTML.includes('2026-02-22'));
    assert.equal(c.state.period.startDate, '2026-03-15');
    assert(await c.apply());
    assert.equal(c.state.period.startDate, '2026-02-22');
    assert.equal(c.run('requireReadyPeriod()'), false);
    assert(c.run('periodReadiness()').includes('עתידי'));
  });
  await test('Overlaps warn in preview, preserve official history, and retain replacement checks', async () => {
    const c = await ready();
    c.state.officialSchedules = [{ id: 'official', startDate: '2026-03-22', endDate: '2026-03-28' }];
    const official = JSON.stringify(c.state.officialSchedules);
    await c.edit('2026-03-22');
    assert(c.getOrCreateMockEl('periodPreviewStatus').textContent.includes('חפיפה'));
    assert(await c.apply());
    assert.equal(JSON.stringify(c.state.officialSchedules), official);
    assert.equal(c.run('periodService().validate(state.period,{historyStatus:"ready",officialSchedules:state.officialSchedules}).valid'), false);
    assert(c.getOrCreateMockEl('periodStatus').textContent.includes('החלפה'));
  });
  await test('Failed history leaves controls editable but blocks Apply without empty-history fallback', async () => {
    const c = await ready();
    c.state.historyStatus = 'failed';
    await c.edit('2026-03-22');
    assert.equal(c.getOrCreateMockEl('buildWeeks').disabled, true);
    assert.equal(await c.apply(), false);
    assert.equal(c.state.period.startDate, '2026-03-15');
    assert.equal(c.storage.entries.size, 0);
  });
  await test('Automatic recommendation can be staged and canceled without changing the active draft', async () => {
    const c = await ready();
    const before = c.draft();
    c.listeners.get('previewAutomaticPeriod:click')();
    assert.equal(c.getOrCreateMockEl('startDate').value, '2026-03-08');
    assert.deepEqual(c.draft(), before);
    c.listeners.get('cancelPeriodPreview:click')();
    assert.equal(c.getOrCreateMockEl('startDate').value, '2026-03-15');
    assert.equal(c.storage.entries.size, 0);
  });
  console.log(`Manual period selection: ${passed} passed`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
