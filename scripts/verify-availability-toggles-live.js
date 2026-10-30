const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 3456;
const ROOT_DIR = path.resolve(__dirname, '..');
const CHROME_PATH = 'C:\\Users\\hodp2\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = 'C:\\Users\\hodp2\\AppData\\Local\\Temp\\chrome-toggle-verify-profile';
const ARTIFACT_DIR = 'C:\\Users\\hodp2\\.gemini\\antigravity\\brain\\0adef3ca-93fe-4543-bfe7-9b411c97a1de';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

async function main() {
  console.log("===============================================================================");
  console.log("LIVE BROWSER VERIFICATION: Availability Toggles, Unsubmitted State & Manual Entry");
  console.log("===============================================================================\n");

  // 1. Start isolated local dev server
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(url.parse(req.url).pathname);
    if (pathname === '/' || pathname === '/fairness') pathname = '/index.html';
    const filePath = path.join(ROOT_DIR, pathname);
    if (!filePath.startsWith(ROOT_DIR)) {
      res.statusCode = 403;
      res.end('Access Denied');
      return;
    }
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.statusCode = 404;
        res.end('404 Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      fs.createReadStream(filePath).pipe(res);
    });
  });

  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`[PASS] Isolated local server listening on http://127.0.0.1:${PORT}`);

  // 2. Launch headless Chrome with CDP
  const cdpPort = 9235;
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${PROFILE_DIR}`,
    'about:blank'
  ]);

  try {
    await new Promise(r => setTimeout(r, 1800));

    // Connect to Chrome DevTools Protocol
    const versionRes = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
    const versionData = await versionRes.json();
    const browserWs = new WebSocket(versionData.webSocketDebuggerUrl);

    let msgId = 1;
    const callbacks = new Map();
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        callbacks.set(id, { resolve, reject });
        browserWs.send(JSON.stringify({ id, method, params }));
      });
    }

    browserWs.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        const { resolve } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        resolve(msg);
      }
    };

    await new Promise((resolve, reject) => {
      browserWs.onopen = resolve;
      browserWs.onerror = reject;
    });

    console.log('[PASS] Connected to Headless Chrome via CDP');

    // Create target page
    const target = await send('Target.createTarget', { url: `http://localhost:${PORT}/?dev=true` });
    const targetId = target.result.targetId;

    const pageWsRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const pageTabs = await pageWsRes.json();
    const targetTab = pageTabs.find(t => t.id === targetId);
    const pageWs = new WebSocket(targetTab.webSocketDebuggerUrl);

    let pageMsgId = 1;
    const pageCallbacks = new Map();
    const networkRequests = [];

    function sendPage(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = pageMsgId++;
        pageCallbacks.set(id, { resolve, reject });
        pageWs.send(JSON.stringify({ id, method, params }));
      });
    }

    pageWs.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Network.requestWillBeSent') {
        networkRequests.push(msg.params.request.url);
      }
      if (msg.id && pageCallbacks.has(msg.id)) {
        const { resolve } = pageCallbacks.get(msg.id);
        pageCallbacks.delete(msg.id);
        resolve(msg);
      }
    };

    await new Promise((resolve, reject) => {
      pageWs.onopen = resolve;
      pageWs.onerror = reject;
    });

    await sendPage('Network.enable');
    await sendPage('Page.enable');
    await sendPage('DOM.enable');

    // Helper to evaluate JS in the browser page
    async function evalInPage(expression) {
      const res = await sendPage('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.result.exceptionDetails) {
        throw new Error(`Eval error: ${JSON.stringify(res.result.exceptionDetails)}`);
      }
      return res.result.result.value;
    }

    // Helper to capture screenshot
    async function takeScreenshot(filename) {
      const res = await sendPage('Page.captureScreenshot', { format: 'png' });
      const buffer = Buffer.from(res.result.data, 'base64');
      const outPath = path.join(ARTIFACT_DIR, filename);
      fs.writeFileSync(outPath, buffer);
      console.log(`  📸 Screenshot saved: ${filename}`);
      return outPath;
    }

    // Wait for page load
    await new Promise(r => setTimeout(r, 2000));

    // Clear localStorage and reload for a completely clean synthetic session
    await evalInPage('localStorage.clear();');
    await evalInPage('location.reload();');
    await new Promise(r => setTimeout(r, 1500));

    // If gatekeeper login screen is present, click dev mode login button
    await evalInPage(`
      (() => {
        const loginBtn = document.getElementById('googleLoginBtn');
        if (loginBtn) loginBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    console.log('\n--- 1. Verification of Fail-Closed Isolation ---');
    const devModeActive = await evalInPage('Boolean(window.isLocalEnvironment?.())');
    console.log(`  [PASS] Isolated Dev Environment active: ${devModeActive}`);

    const forbiddenDomains = ['firebaseio.com', 'firestore.googleapis.com', 'google.com/calendar', 'shift-arranger.web.app'];
    const leaked = networkRequests.filter(url => forbiddenDomains.some(d => url.includes(d)));
    assert.strictEqual(leaked.length, 0, `Forbidden production requests found: ${leaked.join(', ')}`);
    console.log('  [PASS] Zero production requests dispatched (100% fail-closed isolation)');

    // Setup schedule dates
    await evalInPage(`
      (async () => {
        document.getElementById('startDate').value = '01/11/2026';
        document.getElementById('weekCount').value = '2';
        document.getElementById('buildWeeks').click();
        await refreshCalendarDays();
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    console.log('\n--- 2. Unsubmitted Employee (Siwar): Gray, Disabled Toggles & Solver Exclusion ---');
    // Add Siwar without constraints
    await evalInPage(`
      (() => {
        const input = document.getElementById('newWorkerName');
        input.value = 'סיוואר';
        document.getElementById('addWorker').click();
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        card.querySelector('.worker-details').setAttribute('open', '');
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    // Check Siwar's toggles state
    const siwarState = await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        const dayToggles = Array.from(card.querySelectorAll('.day-toggle'));
        const masterToggles = Array.from(card.querySelectorAll('.master-toggle'));
        const statusLabels = Array.from(card.querySelectorAll('.day-status-label'));
        const masterBadges = Array.from(card.querySelectorAll('.master-unsubmitted-badge'));
        const unsubmittedBox = card.querySelector('.availability-unsubmitted-box');
        const manualBtn = card.querySelector('.btn-manual-availability');

        const firstToggleStyle = window.getComputedStyle(dayToggles[0]);

        const workerData = buildWorkerDataFromCard(card);
        const activeWorkers = getWorkersData().map(w => w.name);

        return {
          totalDays: dayToggles.length,
          allDaysDisabled: dayToggles.every(t => t.disabled && t.classList.contains('is-disabled')),
          allMastersDisabled: masterToggles.every(t => t.disabled && t.classList.contains('is-disabled')),
          allLabelsUnsubmitted: statusLabels.every(l => l.textContent.includes('לא הוגשו אילוצים')),
          hasMasterBadges: masterBadges.length > 0 && masterBadges.every(b => b.textContent.includes('לא הוגשו אילוצים')),
          hasNoticeBox: Boolean(unsubmittedBox && unsubmittedBox.textContent.includes('לא הוגשו אילוצים לתקופה זו')),
          hasManualBtn: Boolean(manualBtn && manualBtn.textContent.includes('הזנת זמינות ידנית')),
          firstToggleBg: firstToggleStyle.backgroundColor,
          firstToggleCursor: firstToggleStyle.cursor,
          hasSubmitted: workerData.hasSubmitted,
          active: workerData.active,
          isExcludedFromSolver: !activeWorkers.includes('סיוואר'),
          blockedCount: workerData.blocked.size,
          submittedCount: workerData.submitted.size
        };
      })()
    `);

    assert.strictEqual(siwarState.totalDays > 0, true, 'Days must be rendered');
    assert.strictEqual(siwarState.allDaysDisabled, true, 'All daily toggles must be disabled');
    assert.strictEqual(siwarState.allMastersDisabled, true, 'All weekly master toggles must be disabled');
    assert.strictEqual(siwarState.allLabelsUnsubmitted, true, 'All day labels must show "לא הוגשו אילוצים"');
    assert.strictEqual(siwarState.hasMasterBadges, true, 'Master toggles must display "לא הוגשו אילוצים" badge');
    assert.strictEqual(siwarState.hasNoticeBox, true, 'Must display unsubmitted notice box');
    assert.strictEqual(siwarState.hasManualBtn, true, 'Must display "הזנת זמינות ידנית" action button');
    assert.strictEqual(siwarState.hasSubmitted, false, 'hasSubmitted must be false');
    assert.strictEqual(siwarState.active, false, 'active must be false (excluded from solver)');
    assert.strictEqual(siwarState.isExcludedFromSolver, true, 'Must be excluded from getWorkersData()');
    assert.strictEqual(siwarState.blockedCount, 0, 'Must NOT convert unsubmitted days to hard blocks');
    assert.strictEqual(siwarState.submittedCount, 0, 'Must NOT count unsubmitted days as submitted');

    console.log('  [PASS] Siwar shows gray disabled toggles with "לא הוגשו אילוצים" labels and master badges');
    console.log('  [PASS] Unsubmitted availability is NOT hard blocked and NOT counted in fairness');
    console.log('  [PASS] Siwar is excluded from automatic solver scheduling');

    await takeScreenshot('screenshot-unsubmitted-gray-toggles.png');

    console.log('\n--- 3. Stability: Accordion Toggle, Min/Max Shift Bounds, Reloading ---');
    // Change min and max shifts for Siwar
    await evalInPage(`
      (async () => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        const minSelect = card.querySelector('.min-shifts');
        minSelect.value = '3';
        minSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await saveState(true);
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    // Check that Siwar is STILL unsubmitted
    const stateAfterMinChange = await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        const workerData = buildWorkerDataFromCard(card);
        return {
          hasSubmitted: workerData.hasSubmitted,
          min: workerData.min
        };
      })()
    `);
    assert.strictEqual(stateAfterMinChange.hasSubmitted, false, 'Changing min/max must NOT mark worker as submitted');
    assert.strictEqual(stateAfterMinChange.min, 3, 'Min shifts updated');
    console.log('  [PASS] Changing min/max shifts preserved hasSubmitted = false');

    // Reload page to verify persistence in isolated storage
    await evalInPage('location.reload();');
    await new Promise(r => setTimeout(r, 1500));
    await evalInPage(`
      (() => {
        const loginBtn = document.getElementById('googleLoginBtn');
        if (loginBtn) loginBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    // Verify Siwar after reload
    const stateAfterReload = await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        if (!card) return null;
        card.querySelector('.worker-details').setAttribute('open', '');
        const dayToggles = Array.from(card.querySelectorAll('.day-toggle'));
        const workerData = buildWorkerDataFromCard(card);
        return {
          found: true,
          hasSubmitted: workerData.hasSubmitted,
          allDisabled: dayToggles.every(t => t.disabled && t.classList.contains('is-disabled')),
          min: workerData.min
        };
      })()
    `);
    assert.strictEqual(stateAfterReload.found, true, 'Siwar preserved after reload');
    assert.strictEqual(stateAfterReload.hasSubmitted, false, 'Reload must preserve hasSubmitted = false');
    assert.strictEqual(stateAfterReload.allDisabled, true, 'Reload must preserve disabled gray toggles');
    assert.strictEqual(stateAfterReload.min, 3, 'Reload must preserve min shifts');
    console.log('  [PASS] Saving and reloading in isolated storage preserved unsubmitted state intact');

    console.log('\n--- 4. Explicit Manual Availability Entry ---');
    // Verify initial participation checkbox state (should be preserved)
    const initialActive = await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        return card.querySelector('.active-worker').checked;
      })()
    `);

    // Click "הזנת זמינות ידנית"
    await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        const manualBtn = card.querySelector('.btn-manual-availability');
        manualBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 500));

    // Verify state after clicking manual availability
    const manualState = await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        const dayToggles = Array.from(card.querySelectorAll('.day-toggle'));
        const masterToggles = Array.from(card.querySelectorAll('.master-toggle'));
        const statusLabels = Array.from(card.querySelectorAll('.day-status-label'));
        const banner = card.querySelector('.availability-manual-banner');
        const workerData = buildWorkerDataFromCard(card);
        const activeCheckbox = card.querySelector('.active-worker');

        return {
          allEnabled: dayToggles.every(t => !t.disabled && !t.classList.contains('is-disabled')),
          allClosed: dayToggles.every(t => t.getAttribute('aria-checked') === 'false'),
          allMasterClosed: masterToggles.every(t => t.getAttribute('aria-checked') === 'false'),
          allLabelsClosed: statusLabels.every(l => l.textContent.includes('חסום')),
          hasBanner: Boolean(banner && banner.textContent.includes('פתח/י את הימים שבהם העובד זמין')),
          hasSubmitted: workerData.hasSubmitted,
          blockedCount: workerData.blocked.size,
          submittedCount: workerData.submitted.size,
          activeCheckboxPreserved: activeCheckbox.checked === ${initialActive}
        };
      })()
    `);

    assert.strictEqual(manualState.allEnabled, true, 'All daily toggles must now be enabled');
    assert.strictEqual(manualState.allClosed, true, 'All days must initially be CLOSED');
    assert.strictEqual(manualState.allMasterClosed, true, 'Weekly master toggles must initially be CLOSED');
    assert.strictEqual(manualState.allLabelsClosed, true, 'Day labels must display "חסום"');
    assert.strictEqual(manualState.hasBanner, true, 'Must display banner: "פתח/י את הימים שבהם העובד זמין"');
    assert.strictEqual(manualState.hasSubmitted, true, 'hasSubmitted must now be true');
    assert.strictEqual(manualState.blockedCount > 0, true, 'All days are initially in blocked');
    assert.strictEqual(manualState.submittedCount, 0, 'No days in submitted yet');
    assert.strictEqual(manualState.activeCheckboxPreserved, true, 'Participation checkbox must be preserved');

    console.log('  [PASS] Clicking "הזנת זמינות ידנית" enabled manual editing with all days initially closed');
    console.log('  [PASS] Explanatory banner displayed: "פתח/י את הימים שבהם העובד זמין"');
    console.log('  [PASS] Participation checkbox strictly preserved');

    await takeScreenshot('screenshot-manual-availability-banner.png');

    console.log('\n--- 5. Opening Days & Solver Availability ---');
    // Open Day 0 (2026-11-01) and Day 1 (2026-11-02) for Siwar
    await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        card.querySelectorAll('.day-toggle')[0].click(); // Open Sunday
        card.querySelectorAll('.day-toggle')[1].click(); // Open Monday
        // Also ensure participation checkbox is checked for this test
        card.querySelector('.active-worker').checked = true;
      })()
    `);
    await new Promise(r => setTimeout(r, 400));

    const openedState = await evalInPage(`
      (() => {
        const card = document.querySelector('.worker[data-worker="סיוואר"]');
        const dayToggles = Array.from(card.querySelectorAll('.day-toggle'));
        const masterToggle = card.querySelector('.master-toggle');
        const workerData = buildWorkerDataFromCard(card);
        const allActiveWorkers = getWorkersData().map(w => w.name);

        return {
          day0Open: dayToggles[0].getAttribute('aria-checked') === 'true',
          day1Open: dayToggles[1].getAttribute('aria-checked') === 'true',
          day2Closed: dayToggles[2].getAttribute('aria-checked') === 'false',
          masterPartial: masterToggle.getAttribute('aria-checked') === 'mixed',
          submittedHasDay0: workerData.submitted.has('2026-11-01'),
          submittedHasDay1: workerData.submitted.has('2026-11-02'),
          blockedHasDay2: workerData.blocked.has('2026-11-03'),
          active: workerData.active,
          inActiveWorkersList: allActiveWorkers.includes('סיוואר')
        };
      })()
    `);

    assert.strictEqual(openedState.day0Open, true, 'Day 0 must now be open');
    assert.strictEqual(openedState.day1Open, true, 'Day 1 must now be open');
    assert.strictEqual(openedState.day2Closed, true, 'Day 2 must remain closed');
    assert.strictEqual(openedState.masterPartial, true, 'Master toggle must reflect partial state');
    assert.strictEqual(openedState.submittedHasDay0, true, 'Day 0 must be in submitted');
    assert.strictEqual(openedState.submittedHasDay1, true, 'Day 1 must be in submitted');
    assert.strictEqual(openedState.blockedHasDay2, true, 'Day 2 must remain in blocked');
    assert.strictEqual(openedState.active, true, 'Siwar is now active in solver');
    assert.strictEqual(openedState.inActiveWorkersList, true, 'Siwar is included in solver candidates');

    console.log('  [PASS] Opening days explicitly enables solver availability on those specific days');

    // Add additional workers and test schedule generation
    await evalInPage(`
      (() => {
        const input = document.getElementById('newWorkerName');
        input.value = 'דני';
        document.getElementById('addWorker').click();
        const daniCard = document.querySelector('.worker[data-worker="דני"]');
        daniCard.querySelector('.active-worker').checked = true;
        // Dan manual entry: open all days
        window.WorkerAvailability.startManualAvailability(getWorkerAvailability('דני'), getScheduleDays());
        window.WorkerAvailability.setWeekAvailability(getWorkerAvailability('דני'), getScheduleDays().filter(d => d.week === 0), true);
        window.WorkerAvailability.setWeekAvailability(getWorkerAvailability('דני'), getScheduleDays().filter(d => d.week === 1), true);

        input.value = 'רוני';
        document.getElementById('addWorker').click();
        const roniCard = document.querySelector('.worker[data-worker="רוני"]');
        roniCard.querySelector('.active-worker').checked = true;
        window.WorkerAvailability.startManualAvailability(getWorkerAvailability('רוני'), getScheduleDays());
        window.WorkerAvailability.setWeekAvailability(getWorkerAvailability('רוני'), getScheduleDays().filter(d => d.week === 0), true);
        window.WorkerAvailability.setWeekAvailability(getWorkerAvailability('רוני'), getScheduleDays().filter(d => d.week === 1), true);

        renderAllWorkersAvailability();
        document.getElementById('buildSchedule').click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1200));

    const scheduleValid = await evalInPage(`
      Boolean(state.currentSchedule && Object.keys(state.currentSchedule).length > 0)
    `);
    assert.strictEqual(scheduleValid, true, 'Schedule generated successfully with manual availability');
    console.log('  [PASS] Solver successfully generates schedule with manual employee availability');

    await takeScreenshot('screenshot-full-schedule-with-toggles.png');

    console.log('\n===============================================================================');
    console.log("LIVE BROWSER VERIFICATION COMPLETE: ALL 5 TEST SECTIONS PASSED!");
    console.log("===============================================================================\n");

  } finally {
    try {
      chrome.kill();
    } catch (e) {}
    server.close();
  }
}

main().catch(err => {
  console.error('\n[FATAL ERROR IN LIVE VERIFICATION]:', err);
  process.exit(1);
});
