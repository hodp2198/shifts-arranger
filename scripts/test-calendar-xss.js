// Isolated XSS regression tests for employee-calendar.html and URL/schedule payload flows.
// Runs 100% locally in Node.js with zero production network, Firestore, OAuth, or Calendar access.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'employee-calendar.html'), 'utf8');
const scheduleExportSource = fs.readFileSync(path.join(root, 'src/scheduleExport.js'), 'utf8');
const calendarServiceSource = fs.readFileSync(path.join(root, 'src/calendarService.js'), 'utf8');

function toBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeJsonHashParam(key, obj) {
  return `#${key}=${toBase64Url(Buffer.from(JSON.stringify(obj), 'utf8'))}`;
}

async function encodeGzipHashParam(key, obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return `#${key}=${toBase64Url(new Uint8Array(buffer))}`;
}

function createDomSandbox({ hash = '', search = '', firestorePayload = null } = {}) {
  const pageEvents = new Map();
  const createdElements = [];

  function makeNode(tagName, id = '') {
    const node = {
      tagName: String(tagName || '').toUpperCase(),
      id,
      disabled: false,
      hidden: id === 'calendarIsolationNotice',
      value: '',
      className: '',
      dir: '',
      children: [],
      _textContent: '',
      classList: {
        _set: new Set(),
        add(cls) { this._set.add(cls); },
        remove(cls) { this._set.delete(cls); },
        contains(cls) { return this._set.has(cls); }
      },
      get textContent() {
        if (this.children.length) {
          return this.children.map(child => child.textContent).join('');
        }
        return this._textContent;
      },
      set textContent(val) {
        this.children = [];
        this._textContent = String(val ?? '');
      },
      get innerHTML() {
        throw new Error('XSS Regression Guard: reading innerHTML is disallowed');
      },
      set innerHTML(_val) {
        throw new Error('XSS Regression Guard: writing innerHTML is forbidden in employee-calendar.html');
      },
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      replaceChildren(...nodes) {
        this.children = [...nodes];
      },
      addEventListener(event, callback) {
        pageEvents.set(`${id}:${event}`, callback);
      },
      remove() {}
    };
    return node;
  }

  const elements = {};
  const document = {
    addEventListener(event, callback) {
      pageEvents.set(event, callback);
    },
    getElementById(id) {
      return elements[id] ||= makeNode('div', id);
    },
    createElement(tagName) {
      const node = makeNode(tagName);
      createdElements.push(node);
      return node;
    },
    head: makeNode('head')
  };

  const storage = new Map();
  const sandbox = {
    window: null,
    location: {
      hostname: 'localhost',
      port: '3000',
      protocol: 'http:',
      hash,
      search
    },
    document,
    TextEncoder,
    TextDecoder,
    URLSearchParams,
    Blob,
    Response,
    CompressionStream: globalThis.CompressionStream,
    DecompressionStream: globalThis.DecompressionStream,
    btoa: str => Buffer.from(str, 'binary').toString('base64'),
    atob: b64 => Buffer.from(b64, 'base64').toString('binary'),
    crypto: {
      getRandomValues: arr => {
        for (let i = 0; i < arr.length; i++) arr[i] = i + 1;
        return arr;
      }
    },
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    addEventListener(event, callback) {
      pageEvents.set(`window:${event}`, callback);
    },
    setTimeout,
    clearTimeout,
    Date,
    googleCalendarConfig: { clientId: 'mock-client', scope: 'https://www.googleapis.com/auth/calendar.events' },
    isCalendarExportBlocked: () => true,
    CALENDAR_ISOLATION_NOTICE: 'ייצוא ליומן Google אינו זמין במצב פיתוח מבודד. התחברות ושינויים ביומן חסומים.'
  };
  sandbox.window = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(scheduleExportSource, context);
  vm.runInContext(calendarServiceSource, context);

  // stub OAuth so it never touches network/script tags
  sandbox.googleOAuthService = {
    hasConfiguredClient: () => false,
    initialize: async () => {},
    isAuthorized: () => false,
    getAccessToken: () => ''
  };

  if (firestorePayload !== null) {
    const originalReadEmployeePayload = sandbox.scheduleExport.readEmployeePayload;
    sandbox.scheduleExport.readEmployeePayload = async () =>
      typeof firestorePayload === 'function' ? firestorePayload() : firestorePayload;
    sandbox._originalReadEmployeePayload = originalReadEmployeePayload;
  }

  return { sandbox, context, elements, createdElements, pageEvents };
}

async function runPageController(harness) {
  const controller = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
    .replace(/import .*? from ".*?";/, '');
  vm.runInContext(controller, harness.context);
  // Allow async initEmployeeCalendarPage to settle
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function collectNodes(rootNode) {
  const all = [rootNode];
  for (const child of rootNode.children || []) {
    all.push(...collectNodes(child));
  }
  return all;
}

function selectEmployee(harness, value) {
  harness.elements.employeeSelect.value = value;
  const onChange = harness.pageEvents.get('employeeSelect:change');
  assert.ok(onChange, 'employeeSelect change listener must be registered');
  onChange();
}

async function runTests() {
  console.log('=================================================');
  console.log('Starting Employee Calendar XSS Regression Tests');
  console.log('=================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test 1: Static DOM-safe sink check
  // -------------------------------------------------------------
  await test('1. employee-calendar.html contains zero unsafe HTML injection sinks', async () => {
    assert.equal(/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/.test(html), false,
      'employee-calendar.html must not contain innerHTML, outerHTML, insertAdjacentHTML, or document.write');
  });

  // -------------------------------------------------------------
  // Test 2: Compact v2 hash (#p=) with harmless XSS payloads
  // -------------------------------------------------------------
  await test('2. Compact #p= hash payload renders XSS vectors safely as plain text without HTML injection', async () => {
    const xssName = '</option></select><img src=x onerror="window.__xss=1">';
    const xssDayName = '<svg onload="window.__xss=2">ראשון';
    const compactV2 = {
      v: 2,
      id: 'sched-xss-p',
      c: '2026-11-01T10:00:00.000Z',
      tz: 'Asia/Jerusalem',
      w: [['2026-11-01', '2026-11-07', 'שבוע 1']],
      e: [xssName, 'גל'],
      d: [['2026-11-01', xssDayName, 0, 1]]
    };

    const harness = createDomSandbox({ hash: encodeJsonHashParam('p', compactV2) });
    await runPageController(harness);

    assert.equal(harness.sandbox.__xss, undefined, 'XSS payload must never execute');
    const options = harness.elements.employeeSelect.children;
    assert.equal(options.length, 3);
    assert.equal(options[0].value, '');
    assert.equal(options[0].textContent, 'בחר/י את שמך');
    assert.equal(options[1].tagName, 'OPTION');
    assert.equal(options[1].textContent, xssName, 'Malicious employee name must remain literal text in option');
    assert.equal(options[1].children.length, 0, 'Option must not contain injected child HTML elements');
    assert.equal(options[2].textContent, 'גל');

    // Select the employee with XSS name and dayName
    selectEmployee(harness, options[1].value);
    assert.equal(harness.sandbox.__xss, undefined);
    assert.equal(harness.elements.exportStatus.textContent, '1 משמרות');

    const previewNodes = collectNodes(harness.elements.eventPreview);
    const forbiddenTags = previewNodes.filter(n => ['IMG', 'SVG', 'SCRIPT', 'IFRAME'].includes(n.tagName));
    assert.equal(forbiddenTags.length, 0, 'Preview must never create IMG/SVG/SCRIPT/IFRAME nodes');

    const row = harness.elements.eventPreview.children[0];
    assert.equal(row.className, 'employee-event-row');
    const metaSpan = row.children[0].children[1];
    assert.equal(metaSpan.tagName, 'SPAN');
    assert.equal(metaSpan.textContent, `1.11.2026 · ${xssDayName}`);
    assert.equal(metaSpan.children.length, 0);
  });

  // -------------------------------------------------------------
  // Test 3: Unversioned #p= and legacy #data= raw payloads with attribute/tag breakouts
  // -------------------------------------------------------------
  await test('3. Raw #data= and non-v2 #p= payloads neutralize id attribute breakout and title/dayName HTML tags', async () => {
    const xssId = '"><img src=x onerror="window.__xss=3">';
    const xssName = '</option><script>window.__xss=4</script>';
    const xssTitle = '<img src=x onerror="window.__xss=5">נייט 1';
    const xssDayName = '<svg onload="window.__xss=6">';
    const rawPayload = {
      scheduleId: 'sched-raw-xss',
      employees: [{ id: xssId, name: xssName }],
      entries: [{
        date: '2026-11-02<img src=x>',
        dayName: xssDayName,
        assignments: [{ employeeName: xssName, role: 'night1', title: xssTitle }]
      }]
    };

    for (const hash of [encodeJsonHashParam('data', rawPayload), encodeJsonHashParam('p', rawPayload)]) {
      const harness = createDomSandbox({ hash });
      await runPageController(harness);

      assert.equal(harness.sandbox.__xss, undefined);
      const options = harness.elements.employeeSelect.children;
      assert.equal(options.length, 2);
      assert.equal(options[1].value, xssId, 'Raw option.value must stay intact without breaking attributes');
      assert.equal(options[1].textContent, xssName);
      assert.equal(options[1].children.length, 0);

      // Selecting the raw malicious ID still resolves shifts and renders safely
      selectEmployee(harness, xssId);
      assert.equal(harness.sandbox.__xss, undefined);
      assert.equal(harness.elements.exportStatus.textContent, '1 משמרות');

      const previewNodes = collectNodes(harness.elements.eventPreview);
      assert.equal(previewNodes.filter(n => ['IMG', 'SVG', 'SCRIPT'].includes(n.tagName)).length, 0);
      const row = harness.elements.eventPreview.children[0];
      assert.equal(row.children[0].children[0].textContent, xssTitle);
      assert.equal(row.children[0].children[1].textContent, `NaN.NaN.NaN · ${xssDayName}`);
    }
  });

  // -------------------------------------------------------------
  // Test 4: Gzip-compressed #z= hash payload with XSS vector + Hebrew
  // -------------------------------------------------------------
  await test('4. Compressed #z= hash payload safely renders XSS vectors and preserves Hebrew text', async () => {
    const xssName = 'שני <img src=x onerror=alert(1)>';
    const compactV2 = {
      v: 2,
      id: 'sched-z-xss',
      c: '2026-11-01T10:00:00.000Z',
      tz: 'Asia/Jerusalem',
      w: [],
      e: [xssName, 'הוד'],
      d: [['2026-11-03', '<b>שלישי</b>', 0, 1]]
    };

    const hash = await encodeGzipHashParam('z', compactV2);
    const harness = createDomSandbox({ hash });
    await runPageController(harness);

    const options = harness.elements.employeeSelect.children;
    assert.equal(options.length, 3);
    assert.equal(options[1].textContent, xssName);
    assert.equal(options[2].textContent, 'הוד');

    selectEmployee(harness, options[1].value);
    const row = harness.elements.eventPreview.children[0];
    assert.equal(row.children[0].children[0].textContent, 'נייט 1');
    assert.equal(row.children[0].children[1].textContent, '3.11.2026 · <b>שלישי</b>');
    assert.equal(collectNodes(harness.elements.eventPreview).filter(n => n.tagName === 'B' || n.tagName === 'IMG').length, 0);
  });

  // -------------------------------------------------------------
  // Test 5: Firestore / schedule payload injection path
  // -------------------------------------------------------------
  await test('5. Untrusted Firestore schedule payload renders harmless XSS vectors safely as text', async () => {
    const tamperedFirestorePayload = {
      scheduleId: 'firestore-xss-test',
      employees: [{ id: 'emp-1', name: 'עובד "בדיקה" <script>alert(1)</script>' }],
      entries: [{
        date: '2026-11-04',
        dayName: '<iframe src="javascript:alert(1)">רביעי',
        assignments: [{
          employeeName: 'עובד "בדיקה" <script>alert(1)</script>',
          role: 'night1',
          title: '<a href="javascript:alert(1)">נייט 1</a>'
        }]
      }]
    };

    const harness = createDomSandbox({
      search: '?u=attackerUid&id=AbCdEf1234',
      firestorePayload: tamperedFirestorePayload
    });
    await runPageController(harness);

    const options = harness.elements.employeeSelect.children;
    assert.equal(options[1].textContent, 'עובד "בדיקה" <script>alert(1)</script>');
    selectEmployee(harness, 'emp-1');

    const previewNodes = collectNodes(harness.elements.eventPreview);
    assert.equal(previewNodes.filter(n => ['SCRIPT', 'IFRAME', 'A'].includes(n.tagName)).length, 0);
    const row = harness.elements.eventPreview.children[0];
    assert.equal(row.children[0].children[0].textContent, '<a href="javascript:alert(1)">נייט 1</a>');
    assert.equal(row.children[0].children[1].textContent, '4.11.2026 · <iframe src="javascript:alert(1)">רביעי');
  });

  // -------------------------------------------------------------
  // Test 6: Legitimate Hebrew employee names & shift details preserved
  // -------------------------------------------------------------
  await test('6. Legitimate Hebrew employee names, quotes, and shift details display accurately', async () => {
    const legitimateCompact = {
      v: 2,
      id: 'sched-hebrew-ok',
      c: '2026-11-01T10:00:00.000Z',
      tz: 'Asia/Jerusalem',
      w: [['2026-11-01', '2026-11-07', 'שבוע 1']],
      e: ['גל', 'הוד פ.', 'שני כהן', 'ג\'ורג\' "הראשי" & ב\'', 'עובד ללא משמרות'],
      d: [
        ['2026-11-01', 'ראשון', 0, 1],
        ['2026-11-02', 'שני', 2, 0],
        ['2026-11-03', 'שלישי', 3, -1]
      ]
    };

    const harness = createDomSandbox({ hash: encodeJsonHashParam('p', legitimateCompact) });
    await runPageController(harness);

    const options = harness.elements.employeeSelect.children;
    assert.deepEqual(
      options.map(o => o.textContent),
      ['בחר/י את שמך', 'גל', 'הוד פ.', 'שני כהן', 'ג\'ורג\' "הראשי" & ב\'', 'עובד ללא משמרות']
    );
    assert.equal(harness.elements.employeeSelect.value, '');
    assert.equal(harness.elements.exportStatus.textContent, 'ממתין');
    assert.equal(harness.elements.eventPreview.children.length, 0);

    // Select 'גל' (2 shifts)
    selectEmployee(harness, options[1].value);
    assert.equal(harness.elements.exportStatus.textContent, '2 משמרות');
    const rows = harness.elements.eventPreview.children;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].children[0].children[0].textContent, 'נייט 1');
    assert.equal(rows[0].children[0].children[1].textContent, '1.11.2026 · ראשון');
    assert.equal(rows[0].children[1].dir, 'ltr');
    assert.equal(rows[0].children[1].textContent, '14:30–15:30');
    assert.equal(rows[1].children[0].children[0].textContent, 'נייט 2');
    assert.equal(rows[1].children[0].children[1].textContent, '2.11.2026 · שני');

    // Select 'ג'ורג' "הראשי" & ב'' (quotes & ampersand preserved intact)
    selectEmployee(harness, options[4].value);
    assert.equal(harness.elements.exportStatus.textContent, '1 משמרות');
    assert.equal(harness.elements.eventPreview.children[0].children[0].children[1].textContent, '3.11.2026 · שלישי');

    // Select employee with 0 shifts
    selectEmployee(harness, options[5].value);
    assert.equal(harness.elements.exportStatus.textContent, 'אין משמרות');
    assert.equal(harness.elements.eventPreview.children.length, 1);
    assert.equal(harness.elements.eventPreview.children[0].className, 'employee-empty-state');
    assert.equal(harness.elements.eventPreview.children[0].textContent, 'No shifts found for this employee');

    // Reset back to placeholder
    selectEmployee(harness, '');
    assert.equal(harness.elements.exportStatus.textContent, 'ממתין');
    assert.equal(harness.elements.eventPreview.children.length, 0);
  });

  // -------------------------------------------------------------
  // Test 7: Malformed employee/event fields degrade gracefully
  // -------------------------------------------------------------
  await test('7. Malformed schedule fields and non-string primitives do not crash rendering', async () => {
    const malformedPayload = {
      scheduleId: 'sched-malformed',
      employees: [
        null,
        'invalid-string-entry',
        {},
        { id: 'bad-obj', name: { toString: null } },
        { id: 'valid-emp', name: 'דני' }
      ],
      entries: [
        {
          date: { toString: null },
          dayName: { nested: true },
          assignments: [{ employeeName: 'דני', role: 'night1', title: null }]
        }
      ]
    };

    const harness = createDomSandbox({ hash: encodeJsonHashParam('data', malformedPayload) });
    await runPageController(harness);

    const options = harness.elements.employeeSelect.children;
    assert.deepEqual(options.map(o => o.value), ['', 'bad-obj', 'valid-emp']);
    assert.deepEqual(options.map(o => o.textContent), ['בחר/י את שמך', '', 'דני']);

    // Note: employees[0] is null, so calendarService.shiftsForEmployee throws and renderPreview catches cleanly
    selectEmployee(harness, 'valid-emp');
    assert.equal(harness.elements.exportStatus.textContent, 'שגיאה בתצוגה');
    assert.equal(harness.elements.previewMessage.textContent, 'לא ניתן להציג את המשמרות. נסו לבחור את השם מחדש.');
    assert.equal(harness.elements.eventPreview.children.length, 0);
  });

  console.log('\n=================================================');
  console.log(`XSS Regression Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('=================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('XSS regression tests failed:', err);
  process.exit(1);
});
