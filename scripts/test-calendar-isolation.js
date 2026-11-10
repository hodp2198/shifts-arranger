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
  const oauthSource = fs.readFileSync(path.join(root, 'src/auth/googleOAuthService.js'), 'utf8');
  assert(!/<script[^>]+src="https:\/\/accounts\.google\.com/.test(html));
  assert(!/oauthDiagnostics|recordDiagnostic/.test(html), 'Temporary public OAuth diagnostics UI must be removed');
  assert(!/onDiagnostic|error_callback|POPUP_CLOSE_GRACE_MS/.test(oauthSource), 'Diagnostics hooks and GIS error_callback polling must not be present');
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
    const scope = 'https://www.googleapis.com/auth/calendar.events';
    const granted = { access_token: 'mock-token', expires_in: 3600, scope: `openid ${scope}` };
    const calls = { scripts: 0, init: 0, auth: 0, requests: [] };
    const timers = new Map();
    const pageEvents = new Map();
    let now = Date.now();
    let activeGesture = false;
    let initOptions;
    let clientInstance;
    let respondToTokenRequest = () => {};
    let pendingScript;
    const oauth2 = { initTokenClient(options) {
      calls.init++;
      initOptions = options;
      clientInstance = {
        callback: options.callback,
        requestAccessToken(requestOptions) {
          assert.equal(activeGesture, true, 'The popup must open during the click');
          calls.auth++;
          respondToTokenRequest(clientInstance, requestOptions);
        }
      };
      return clientInstance;
    } };
    const elements = {};
    const element = id => ({ disabled: false, hidden: true, value: '', textContent: '',
      innerHTML: '', classList: { add() {}, remove() {} },
      addEventListener: (event, callback) => pageEvents.set(`${id}:${event}`, callback) });
    const document = {
      addEventListener: (event, callback) => pageEvents.set(event, callback),
      getElementById: id => elements[id] ||= element(id),
      createElement: () => ({ remove() { pendingScript = null; } }),
      head: { appendChild(script) { calls.scripts++; pendingScript = script; } }
    };
    document.getElementById('calendarIsolationNotice');
    const storage = new Map();
    const sandbox = {
      location: { ...mode, protocol: 'http:' }, document,
      __ISOLATED_DEV_MODE__: mode.blocked && !mode.emulator,
      googleCalendarConfig: { clientId: 'mock-client', scope },
      addEventListener: (event, callback) => pageEvents.set(event, callback),
      localStorage: {
        getItem: k => storage.get(k) || null,
        setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k)
      },
      setTimeout(callback, delay) {
        const id = Symbol();
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: id => timers.delete(id),
      Date: class extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
      },
      URLSearchParams,
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
      await exportEvents();
      await exportEvents();
      assert.deepEqual(calls.requests.map(r => r.method), ['GET', 'POST', 'PATCH']);
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
      assert.deepEqual(calls, { scripts: 0, init: 0, auth: 0, requests: [] });
    } else {
      const click = () => {
        activeGesture = true;
        try {
          return vm.runInContext('handleAuthorizeGoogle()', context);
        } finally {
          activeGesture = false;
        }
      };
      const runTimeout = delay => {
        const timer = [...timers.values()].find(timer => timer.delay === delay);
        assert.ok(timer, `Expected a ${delay} ms timeout`);
        timer.callback();
      };
      assert.equal(elements.authorizeGoogle.disabled, true);
      runTimeout(10000);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(elements.authorizeGoogle.disabled, false);
      assert.match(elements.calendarMessage.textContent, /טעינת ההתחברות.*נכשלה/);

      const failedLoad = click();
      await new Promise(resolve => setImmediate(resolve));
      pendingScript.onerror();
      await failedLoad;
      const prepare = click();
      await new Promise(resolve => setImmediate(resolve));
      sandbox.google = { accounts: { oauth2 } };
      pendingScript.onload();
      await prepare;
      assert.equal(elements.authorizeGoogle.disabled, false);
      assert.equal(elements.calendarIsolationNotice.hidden, true);
      assert.equal(calls.init, 1, 'Eager initialization must create the cached TokenClient once');
      assert.equal(calls.auth, 0, 'Preloading must not open the popup');
      assert.equal(initOptions.client_id, 'mock-client');
      assert.equal(initOptions.scope, scope);
      assert.equal('error_callback' in initOptions, false, 'Must not enable GIS popup_closed polling');
      assert.equal(elements.oauthDiagnosticsEnabled, undefined);
      assert.equal(elements.oauthDiagnosticsPanel, undefined);

      let lastRequestPrompt;
      respondToTokenRequest = (client, reqOptions) => {
        lastRequestPrompt = reqOptions.prompt;
        client.callback(granted);
      };
      await click();
      assert.equal(lastRequestPrompt, 'consent');
      assert.equal(elements.authStatus.textContent, 'מחובר');
      assert.equal(oauth.isAuthorized(), true);
      assert.equal(calls.init, 1);

      // Subsequent sign-in while already authorized omits forced consent and still reuses the cached TokenClient.
      await click();
      assert.equal(lastRequestPrompt, '');
      assert.equal(elements.authStatus.textContent, 'מחובר');
      assert.equal(calls.init, 1);
      // Expire existing token to start subsequent error tests unauthorized.
      now += 3600000;
      pageEvents.get('visibilitychange')();
      assert.equal(oauth.isAuthorized(), false);

      for (const [respond, expected] of [
        [client => client.callback({ error: 'access_denied' }), /לא ניתנה הרשאה/],
        [client => client.callback({ error: 'private-account@example.invalid', error_description: 'https://private.example.invalid/' }), /לא ניתן להתחבר/],
        [client => client.callback({ ...granted, scope: `${scope}.readonly` }), /לא ניתנה הרשאה/],
        [client => client.callback({ ...granted, scope: undefined }), /לא ניתנה הרשאה/],
        [client => client.callback({ access_token: 'mock-token', expires_in: 0, scope }), /לא ניתן להתחבר/],
        [client => client.callback({ access_token: 'mock-token', expires_in: 'NaN', scope }), /לא ניתן להתחבר/],
        [client => client.callback({}), /לא ניתן להתחבר/],
        [() => { throw new Error('mock exception'); }, /לא ניתן להתחבר/]
      ]) {
        respondToTokenRequest = respond;
        await click();
        assert.equal(elements.authStatus.textContent, 'לא מחובר');
        assert.match(elements.calendarMessage.textContent, expected);
        assert.equal(elements.authorizeGoogle.disabled, false);
        assert.equal(elements.addToCalendar.disabled, true);
        assert.equal(oauth.getAccessToken(), '');
        assert.equal(timers.size, 0);
      }

      // Consent callback arriving after >1s popup close without premature popup_closed rejection.
      respondToTokenRequest = () => {};
      const slowCallback = click();
      assert.equal(elements.authStatus.textContent, 'מתחבר...');
      assert.equal(elements.authorizeGoogle.disabled, false);
      assert.equal([...timers.values()].filter(timer => timer.delay === 1000).length, 0);
      clientInstance.callback(granted);
      await slowCallback;
      assert.equal(elements.authStatus.textContent, 'מחובר');
      assert.equal(oauth.isAuthorized(), true);
      assert.deepEqual([...timers.values()].map(timer => timer.delay), [3600000]);

      now += 3600000;
      runTimeout(3600000);
      assert.equal(oauth.isAuthorized(), false);
      assert.equal(timers.size, 0);

      // Stalled attempt recovers cleanly after 120s timeout and ignores late callback.
      respondToTokenRequest = () => {};
      const stalled = click();
      const stalledCallback = clientInstance.callback;
      assert.equal(elements.authStatus.textContent, 'מתחבר...');
      runTimeout(120000);
      await stalled;
      assert.equal(elements.authStatus.textContent, 'לא מחובר');
      assert.match(elements.calendarMessage.textContent, /תם הזמן/);
      assert.equal(elements.authorizeGoogle.disabled, false);
      stalledCallback(granted);
      assert.equal(oauth.isAuthorized(), false);

      // Manual popup close followed by immediate retry supersedes the old attempt without UI regression.
      const abandoned = click();
      const abandonedCallback = clientInstance.callback;
      const retry = click();
      await abandoned;
      assert.equal(elements.authStatus.textContent, 'מתחבר...');
      assert.equal(elements.authorizeGoogle.disabled, false);
      abandonedCallback(granted);
      assert.equal(oauth.isAuthorized(), false);
      clientInstance.callback(granted);
      await retry;
      assert.equal(elements.authStatus.textContent, 'מחובר');
      assert.equal(oauth.getAccessToken(), 'mock-token');
      assert.equal(calls.init, 1);
      assert.equal(timers.size, 1);

      now += 3600000;
      runTimeout(3600000);
      assert.equal(oauth.isAuthorized(), false);
      assert.equal(oauth.getAccessToken(), '');
      assert.equal(elements.authStatus.textContent, 'לא מחובר');
      assert.match(elements.calendarMessage.textContent, /פג תוקף ההרשאה/);
      assert.equal(elements.addToCalendar.disabled, true);
      assert.equal(timers.size, 0);

      const shiftsForEmployee = calendar.shiftsForEmployee;
      calendar.shiftsForEmployee = () => { throw new Error('mock preview failure'); };
      respondToTokenRequest = client => client.callback(granted);
      await click();
      assert.equal(elements.authStatus.textContent, 'מחובר');
      assert.equal(oauth.isAuthorized(), true);
      assert.equal(elements.addToCalendar.disabled, true);
      assert.match(elements.calendarMessage.textContent, /ההרשאה התקבלה/);
      assert.match(elements.previewMessage.textContent, /לא ניתן להציג את המשמרות/);
      calendar.shiftsForEmployee = shiftsForEmployee;
      vm.runInContext('renderPreview()', context);
      assert.equal(elements.previewMessage.textContent, '');
      assert.equal(elements.authStatus.textContent, 'מחובר');

      // A backgrounded mobile tab may resume before its expiry timer runs.
      now += 3600000;
      pageEvents.get('visibilitychange')();
      assert.equal(elements.authStatus.textContent, 'לא מחובר');
      assert.equal(elements.addToCalendar.disabled, true);
      assert.equal(timers.size, 0);
    }
    console.log(`[PASS] ${mode.hostname}${mode.emulator ? ' (emulator)' : ''}: ${mode.blocked ? 'zero Google requests, authentication and writes blocked; Hebrew notice visible' : 'mock OAuth success, cached TokenClient, errors, timeouts, retry, expiry and Calendar export'}`);
  }
  delete global.window;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
