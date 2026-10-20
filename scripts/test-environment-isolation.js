/* Actual service code, in-memory browser storage and Firebase/network spies only. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const official = {
  id: '2026-10-25_2026-10-31', startDate: '2026-10-25', endDate: '2026-10-31',
  status: 'active', savedAt: '2026-10-20T08:00:00Z',
  daysSnapshot: [{ iso: '2026-10-25', monthKey: '2026-10', closed: false }],
  workerConstraintsSnapshot: { Test: { blockedDays: [], submittedDays: [] } },
  assignments: [{ iso: '2026-10-25', monthKey: '2026-10', slot1: 'Test', slot2: null }]
};

function harness(search = '?dev=true', entries = new Map()) {
  const calls = { reads: 0, writes: [], auth: 0, network: 0, remoteImports: 0 };
  const production = JSON.stringify(official);
  const storage = {
    get length() { return entries.size; }, key: index => [...entries.keys()][index],
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key)
  };
  const scope = {
    window: { location: { search, href: `http://localhost:3000/${search}`, hash: '' } },
    localStorage: storage, URL, URLSearchParams, TextEncoder, TextDecoder, btoa, atob,
    crypto: require('crypto').webcrypto, setTimeout, clearTimeout, console,
    firebaseConfig: {}, hasFirebaseConfig: () => true,
    getApps: () => [], getApp: () => ({}), initializeApp: () => { calls.auth++; return {}; },
    getFirestore: () => ({}), doc: (db, ...parts) => parts.join('/'),
    collection: (db, ...parts) => parts.join('/'), serverTimestamp: () => 'timestamp',
    Timestamp: { fromDate: date => date.toISOString() },
    setDoc: async (target, data) => { calls.writes.push({ target, data }); },
    deleteDoc: async target => { calls.writes.push({ target, deleted: true }); },
    getDoc: async () => { calls.reads++; return { exists: () => true, data: () => ({ schedule: { production: true } }) }; },
    getDocs: async () => {
      calls.reads++;
      const docs = [{ id: official.id, data: () => JSON.parse(production) }];
      return { docs, forEach: fn => docs.forEach(fn) };
    },
    writeBatch: () => {
      const batch = [];
      return { set: (target, data) => batch.push({ target, data }), commit: async () => calls.writes.push(...batch) };
    },
    getAuth: () => { calls.auth++; return {}; }, setPersistence: async () => {}, browserLocalPersistence: {},
    onAuthStateChanged: (auth, callback) => { calls.auth++; callback({ uid: 'real-manager' }); return () => {}; },
    GoogleAuthProvider: class { setCustomParameters() {} },
    signInWithPopup: async () => { calls.auth++; return { user: { uid: 'real-manager' } }; },
    signInWithEmailAndPassword: async () => { calls.auth++; return { user: { uid: 'real-manager' } }; },
    signOut: async () => { calls.auth++; },
    fetch: async () => { calls.network++; throw new Error('Network is forbidden in this test'); }
  };
  vm.createContext(scope);
  const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const run = file => vm.runInContext(read(file), scope);
  run('src/runtimeEnvironment.js');
  const modules = new Map();
  function module(file) {
    if (modules.has(file)) return modules.get(file);
    const raw = read(file);
    const exports = [...raw.matchAll(/^export (?:async )?function (\w+)|^export const (\w+)/gm)].map(match => match[1] || match[2]);
    const source = raw.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '').replace(/\bimport\(/g, '__import(');
    const result = vm.runInContext(`(function(){${source}\nreturn {${exports.join(',')}};})()`, scope);
    modules.set(file, result);
    return result;
  }
  scope.__import = async specifier => {
    if (specifier === './firebaseScheduleStore.js') return module('src/firebaseScheduleStore.js');
    calls.remoteImports++;
    return scope;
  };
  function script(file) {
    vm.runInContext(read(file).replace(/\bimport\(/g, '__import('), scope);
  }
  return { scope, window: scope.window, entries, calls, module, script,
    unchangedProduction: () => assert.equal(JSON.stringify(official), production),
    noProductionCalls() {
      assert.equal(calls.reads, 0); assert.equal(calls.writes.length, 0);
      assert.equal(calls.auth, 0); assert.equal(calls.network, 0); assert.equal(calls.remoteImports, 0);
    }
  };
}

async function run() {
  let passed = 0;
  async function test(name, fn) { await fn(); console.log(`[PASS] ${name}`); passed++; }
  await test('dev=true selects immutable TEST MODE before auth; similar parameters do not', () => {
    for (const query of ['?dev=true', '?id=123&dev=true']) assert.equal(harness(query).window.runtimeEnvironment.isTestMode, true);
    for (const query of ['', '?dev=false', '?dev=truex', '?nodev=true']) assert.equal(harness(query).window.runtimeEnvironment.isTestMode, false);
    const h = harness();
    assert.equal(Reflect.set(h.window, '__ISOLATED_DEV_MODE__', false), false);
    assert.equal(Reflect.set(h.window, 'runtimeEnvironment', {}), false);
    h.window.location.search = '';
    assert.equal(h.window.runtimeEnvironment.isTestMode, true);
  });
  await test('Remembered production login is never subscribed to in TEST MODE', async () => {
    const h = harness();
    const auth = h.module('src/auth/adminAuthService.js');
    let user;
    auth.onAdminAuthStateChanged(value => { user = value; });
    assert.equal(user.uid, 'isolated-dev-manager');
    await assert.rejects(auth.loginWithGoogle(), /TEST MODE/);
    await assert.rejects(auth.loginAdmin('test@example.com', 'dummy'), /TEST MODE/);
    await assert.rejects(auth.logoutAdmin(), /TEST MODE/);
    h.noProductionCalls();
  });
  await test('Drafts and recoverable backups only read and write test storage', async () => {
    const h = harness();
    h.entries.set('production-draft-sentinel', 'unchanged');
    const service = h.module('src/userDataService.js');
    const uid = 'isolated-dev-manager';
    await service.saveUserAppData(uid, { constraints: 'original test' }, { immediate: true });
    assert.equal((await service.loadUserAppData(uid)).constraints, 'original test');
    await service.replaceDraftWithBackup(uid, { constraints: 'original test' }, { constraints: 'new test' });
    assert.equal((await service.loadDraftBackups(uid)).length, 1);
    assert.equal(h.entries.get('production-draft-sentinel'), 'unchanged');
    assert([...h.entries.keys()].filter(key => key !== 'production-draft-sentinel').every(key => key.startsWith('isolated_dev_')));
    h.noProductionCalls();
  });
  await test('Real October 25 official coverage does not influence test proposals or overlap checks', async () => {
    const h = harness();
    const service = h.module('src/fairnessService.js');
    const period = require('../src/schedulePeriodService');
    const records = await service.loadOfficialSchedulesDocs('isolated-dev-manager');
    assert.equal(records.length, 0);
    const proposed = period.propose({ now: '2026-10-20T09:00:00Z', historyStatus: 'ready', officialSchedules: records, weekCount: 1 });
    assert.equal(proposed.startDate, '2026-10-25');
    assert.equal(service.findOverlappingOfficialSchedules(records, '2026-10-25', '2026-10-31').length, 0);
    h.noProductionCalls();
  });
  await test('Test official save, replacement, fairness and deletion leave real official history unchanged', async () => {
    const h = harness();
    const service = h.module('src/fairnessService.js');
    const uid = 'isolated-dev-manager';
    await service.saveOfficialScheduleDoc(uid, { ...official, assignments: [] });
    let records = await service.loadOfficialSchedulesDocs(uid);
    assert.equal(records.length, 1);
    assert.equal(service.calculateAggregatedFairness(records).records[0].assigned, 0);
    await service.saveOfficialScheduleDoc(uid, official);
    records = await service.loadOfficialSchedulesDocs(uid);
    assert.equal(records.length, 1);
    assert.equal(service.calculateAggregatedFairness(records).records[0].assigned, 1);
    assert.equal(service.findOverlappingOfficialSchedules(records, official.startDate, official.endDate).length, 1, 'test-to-test collisions still use replacement');
    await service.deleteOfficialScheduleDoc(uid, official.id);
    assert.equal((await service.loadOfficialSchedulesDocs(uid)).length, 0);
    h.unchangedProduction(); h.noProductionCalls();
  });
  await test('TEST MODE public-link storage and reads stay local; missing IDs never fall back to production', async () => {
    const h = harness();
    const store = h.module('src/firebaseScheduleStore.js');
    const schedule = { scheduleId: 'test-schedule', employees: [], entries: [], weeks: [] };
    const result = await store.saveSchedulePayload(schedule, 'isolated-dev-manager');
    assert.equal((await store.readSchedulePayload(result.id)).scheduleId, 'test-schedule');
    await assert.rejects(store.readSchedulePayload('ProductionID123'), /TEST MODE/);
    assert([...h.entries.keys()].every(key => key.startsWith('isolated_dev_')));
    h.noProductionCalls();
  });
  await test('Generated preview links carry dev=true and open only local test payloads', async () => {
    const h = harness();
    h.script('src/scheduleExport.js');
    const url = new URL(await h.window.scheduleExport.createEmployeeExportLink({ scheduleId: 'test-schedule' }, 'employee-calendar.html', 'isolated-dev-manager'));
    assert.equal(url.searchParams.get('dev'), 'true');
    const page = harness(url.search, h.entries);
    page.script('src/scheduleExport.js');
    assert.equal((await page.window.scheduleExport.readEmployeePayload()).scheduleId, 'test-schedule');
    h.noProductionCalls(); page.noProductionCalls();
  });
  await test('Access requests, approvals and rejections cannot reach Firebase or GAS in TEST MODE', async () => {
    const h = harness();
    const service = h.module('src/accessRequestService.js');
    await assert.rejects(service.submitAccessRequest('Test User', 'test@example.com'), /TEST MODE/);
    await assert.rejects(service.fetchPendingAccessRequests(), /TEST MODE/);
    await assert.rejects(service.approveAccessRequest('req_dummy', 'dummy'), /TEST MODE/);
    await assert.rejects(service.rejectAccessRequest('req_dummy', 'dummy'), /TEST MODE/);
    h.entries.set('gasBackendUrl', 'production-pref');
    service.setGasBackendUrl('test-pref');
    assert.equal(h.entries.get('gasBackendUrl'), 'production-pref');
    assert.equal(service.getGasBackendUrl(), 'test-pref');
    h.noProductionCalls();
  });
  await test('Google OAuth, Google Calendar writes and calendar-file exports are blocked in TEST MODE', async () => {
    const h = harness();
    h.script('src/auth/googleOAuthService.js');
    h.script('src/calendarService.js');
    assert.equal(h.window.googleOAuthService.hasConfiguredClient(), false);
    await assert.rejects(h.window.googleOAuthService.signIn(), /TEST MODE/);
    await assert.rejects(h.window.calendarService.createGoogleCalendarEvents({ accessToken: 'dummy' }), /TEST MODE/);
    await assert.rejects(h.window.calendarService.exportCalendarFile({}), /TEST MODE/);
    h.entries.set('shifts-arranger-calendar-events-v1', '{"production":true}');
    assert.equal(Object.keys(h.window.calendarService.readCreatedEvents()).length, 0);
    h.noProductionCalls();
  });
  await test('Legacy-cache cleanup/logout in TEST MODE cannot delete normal-mode browser state', () => {
    const h = harness();
    h.entries.set('shifts-arranger-v4', '{"production":true}');
    h.entries.set('shifts-arranger-v1', 'production legacy');
    h.script('src/stateStorage.js');
    h.window.stateStorage.writeSavedData({ schemaVersion: 4, test: true });
    h.window.stateStorage.clearLegacyStorage();
    h.window.stateStorage.removeSavedData();
    assert.equal(h.entries.get('shifts-arranger-v4'), '{"production":true}');
    assert.equal(h.entries.get('shifts-arranger-v1'), 'production legacy');
    h.noProductionCalls();
  });
  await test('Missing environment initialization fails closed before production service access', async () => {
    const h = harness('');
    // Evaluate a separate browser scope where the bootstrap script failed to load.
    const scope = { window: {}, console, setTimeout, clearTimeout, localStorage: h.scope.localStorage };
    vm.createContext(scope);
    const source = fs.readFileSync(path.resolve(__dirname, '../src/userDataService.js'), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, scope);
    await assert.rejects(vm.runInContext("loadUserAppData('manager')", scope), /not initialized/);
    h.noProductionCalls();
  });
  await test('Normal mode still loads production history and enforces coverage/overlap rules', async () => {
    const h = harness('');
    h.entries.set('isolated_dev_active', 'true');
    const service = h.module('src/fairnessService.js');
    const records = await service.loadOfficialSchedulesDocs('real-manager');
    const period = require('../src/schedulePeriodService');
    assert.equal(records.length, 1);
    assert.equal(period.propose({ now: '2026-10-20T09:00:00Z', historyStatus: 'ready', officialSchedules: records, weekCount: 1 }).startDate, '2026-11-01');
    assert.equal(period.validate(period.createPeriod({ startDate: '2026-10-25', weekCount: 1 }), { now: '2026-10-20T09:00:00Z', historyStatus: 'ready', officialSchedules: records }).valid, false);
    assert.equal(service.findOverlappingOfficialSchedules(records, official.startDate, official.endDate).length, 1);
    assert.equal(h.window.runtimeEnvironment.isTestMode, false);
    assert.equal(h.calls.writes.length, 0);
    h.unchangedProduction();
  });
  await test('Normal-mode official save still uses the existing owner-scoped Firebase path (mock only)', async () => {
    const h = harness('');
    const service = h.module('src/fairnessService.js');
    await service.saveOfficialScheduleDoc('real-manager', official);
    assert.equal(h.calls.writes[0].target, `users/real-manager/officialSchedules/${official.id}`);
    h.unchangedProduction();
  });
  await test('Bootstrap precedes other scripts on both pages and the visible banner says TEST MODE', () => {
    for (const file of ['index.html', 'employee-calendar.html']) {
      const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
      assert.equal(source.match(/<script[^>]*src="([^"]+)"/)[1], 'src/runtimeEnvironment.js?v=1');
      assert(source.includes('TEST MODE'));
    }
  });
  await test('Delayed draft writes cannot switch to production if the compatibility flag is changed', async () => {
    const h = harness();
    const service = h.module('src/userDataService.js');
    const saved = service.saveUserAppData('isolated-dev-manager', { test: 'delayed' }, { debounceMs: 1 });
    assert.equal(Reflect.set(h.window, '__ISOLATED_DEV_MODE__', false), false);
    await saved;
    assert.equal((await service.loadUserAppData('isolated-dev-manager')).test, 'delayed');
    h.noProductionCalls();
  });
  await test('Corrupt or missing isolated history never falls back to production history', async () => {
    const h = harness();
    h.entries.set('isolated_dev_official_isolated-dev-manager', 'invalid JSON');
    const service = h.module('src/fairnessService.js');
    await assert.rejects(service.loadOfficialSchedulesDocs('isolated-dev-manager'));
    h.noProductionCalls();
  });
  await test('Actual UI startup, ignored real-user callbacks and logout stay inside TEST MODE', async () => {
    const h = harness();
    const c = require('./test-excel-date-import').createSandbox();
    c.sandbox.URLSearchParams = URLSearchParams;
    c.window = c.sandbox.window;
    c.window.location = { search: '?dev=true', href: 'http://localhost:3000/?dev=true' };
    c.sandbox.document.body = { classList: { add() {}, remove() {} }, contains: () => false, appendChild() {} };
    c.sandbox.document.documentElement = { classList: { add() {}, remove() {} } };
    c.run(fs.readFileSync(path.resolve(__dirname, '../src/runtimeEnvironment.js'), 'utf8'));
    const auth = h.module('src/auth/adminAuthService.js');
    let boot;
    c.window.authService = { ...auth, onAdminAuthStateChanged(callback) {
      return auth.onAdminAuthStateChanged(user => { boot = callback(user); });
    } };
    c.window.userDataService = h.module('src/userDataService.js');
    c.window.fairnessService = h.module('src/fairnessService.js');
    h.script('src/stateStorage.js');
    c.window.stateStorage = h.window.stateStorage;
    c.run('window.initAuthLifecycle()');
    await boot;
    assert.equal(c.run('currentAuthUid'), 'isolated-dev-manager');
    assert.equal(c.window.state.historyStatus, 'ready');
    assert.equal(c.getOrCreateMockEl('devIsolatedBanner').style.display, 'flex');
    assert.equal(c.getOrCreateMockEl('googleLoginBtn').style.display, 'none');
    assert(c.sandbox.document.title.includes('TEST MODE'));
    await c.window._handleAuthStateChange({ uid: 'real-manager', email: 'real@example.com' });
    assert.equal(c.run('currentAuthUid'), 'isolated-dev-manager');
    await c.window._handleAuthStateChange(null);
    assert.equal(c.window.runtimeEnvironment.isTestMode, true);
    await c.listeners.get('devIsolatedLoginBtn:click')();
    assert.equal(c.run('currentAuthUid'), 'isolated-dev-manager');
    h.noProductionCalls();
  });
  console.log(`Environment isolation: ${passed} passed`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
