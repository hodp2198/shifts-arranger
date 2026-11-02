// No real Google services: execute the actual services and page with mocked DOM/network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

async function main() {
  const isolation = await import('../src/calendarIsolation.js');
  const html = fs.readFileSync(path.join(root, 'employee-calendar.html'), 'utf8');
  assert(!/<script[^>]+src="https:\/\/accounts\.google\.com/.test(html));
  const schedule = {
    scheduleId: 'isolated-test', employees: [{ id: 'worker', name: 'Worker' }],
    entries: [{ date: '2026-11-01', dayName: 'ראשון', assignments: [
      { employeeName: 'Worker', role: 'night1', title: 'Night' }
    ] }]
  };
  const modes = [
    { hostname: 'localhost', port: '3000', blocked: true },
    { hostname: '127.0.0.1', port: '3000', blocked: true },
    { hostname: '[::1]', port: '3000', blocked: true },
    { hostname: 'localhost', port: '3000', emulator: true, blocked: true },
    { hostname: 'shift-arranger.web.app', port: '', blocked: false }
  ];
  for (const mode of modes) {
    const calls = { scripts: 0, auth: 0, requests: [] };
    const elements = {};
    const element = () => ({ disabled: false, hidden: true, value: '', textContent: '',
      innerHTML: '', classList: { add() {}, remove() {} }, addEventListener() {} });
    const document = {
      getElementById: id => elements[id] ||= element(),
      querySelector: () => null,
      createElement: () => ({}),
      head: { appendChild: () => calls.scripts++ }
    };
    document.getElementById('calendarIsolationNotice');
    const storage = new Map();
    const sandbox = {
      location: { ...mode, protocol: 'http:' }, document,
      __ISOLATED_DEV_MODE__: mode.blocked && !mode.emulator,
      googleCalendarConfig: { clientId: 'mock-client' },
      localStorage: {
        getItem: k => storage.get(k) || null,
        setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k)
      },
      setInterval, clearInterval, Date, URLSearchParams,
      google: { accounts: { oauth2: { initTokenClient: options => {
        calls.auth++;
        return { ...options, requestAccessToken() {
          calls.auth++;
          this.callback({ access_token: 'mock-token' });
        } };
      } } } },
      fetch: async (url, options) => {
        calls.requests.push({ url, method: options.method || 'GET' });
        return { ok: true, status: 200, json: async () =>
          options.method ? { id: 'mock-event' } : { items: [] } };
      }
    };
    sandbox.window = sandbox;
    // The real imported isolation helper sees this simulated browser environment.
    global.window = sandbox;
    const context = vm.createContext(sandbox);
    for (const file of ['src/auth/googleOAuthService.js', 'src/calendarService.js']) {
      let source = fs.readFileSync(path.join(root, file), 'utf8');
      // Exercise the private request boundary for every HTTP verb, including DELETE.
      if (file === 'src/calendarService.js') {
        source = source.replace('window.calendarService = {', 'window.calendarService = { googleCalendarRequest,');
      }
      new vm.Script(source, {
        filename: path.join(root, file),
        importModuleDynamically: specifier => import(pathToFileURL(path.resolve(root, path.dirname(file), specifier)).href)
      }).runInContext(context);
    }
    const oauth = sandbox.googleOAuthService;
    const calendar = sandbox.calendarService;
    const exportEvents = () => calendar.createGoogleCalendarEvents({ schedule,
      employeeId: 'worker', accessToken: 'provided-token' });
    if (mode.blocked) {
      await assert.rejects(oauth.initialize(), /FAIL-CLOSED/);
      await assert.rejects(oauth.signIn(), /FAIL-CLOSED/);
      await assert.rejects(exportEvents(), /FAIL-CLOSED/);
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        await assert.rejects(calendar.googleCalendarRequest('provided-token', '/calendars/primary/events', { method }), /FAIL-CLOSED/);
      }
      // A previously exported event must not allow the update path to bypass isolation.
      storage.set('shifts-arranger-calendar-events-v1', JSON.stringify({
        'isolated-test:worker:2026-11-01:night1': { googleEventId: 'existing-event' }
      }));
      await assert.rejects(exportEvents(), /FAIL-CLOSED/);
    } else {
      await oauth.signIn();
      await exportEvents();
      await exportEvents();
      assert.deepEqual(calls.requests.map(r => r.method), ['GET', 'POST', 'PATCH']);
      assert.equal(calls.auth, 2);
      assert.equal(calls.scripts, 1);
    }

    sandbox.scheduleExport = { readEmployeePayload: async () => schedule };
    Object.assign(sandbox, isolation);
    // Run the actual page controller; only its static module import is supplied by the harness.
    const controller = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
      .replace(/import .*? from ".*?";/, '');
    vm.runInContext(controller, context);
    await new Promise(resolve => setImmediate(resolve));
    elements.employeeSelect.value = 'worker';
    vm.runInContext('renderPreview()', context);
    if (mode.blocked) {
      // Call handlers directly as well as checking disabled controls.
      await vm.runInContext('handleAuthorizeGoogle()', context);
      await vm.runInContext('handleAddToGoogleCalendar()', context);
      assert.equal(elements.authorizeGoogle.disabled, true);
      assert.equal(elements.addToCalendar.disabled, true);
      assert.equal(elements.calendarIsolationNotice.hidden, false);
      assert.match(elements.calendarIsolationNotice.textContent, /ייצוא ליומן Google אינו זמין/);
      assert.deepEqual(calls, { scripts: 0, auth: 0, requests: [] });
    } else {
      assert.equal(elements.authorizeGoogle.disabled, false);
      assert.equal(elements.calendarIsolationNotice.hidden, true);
    }
    console.log(`[PASS] ${mode.hostname}${mode.emulator ? ' (emulator)' : ''}: ${mode.blocked ? 'zero Google requests, authentication and writes blocked; Hebrew notice visible' : 'mock authentication, create and update preserved'}`);
  }
  delete global.window;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
