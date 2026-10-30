const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');
const assert = require('assert');

const PORT = 3458;
const ROOT_DIR = path.resolve(__dirname, '..');
const CHROME_PATH = 'C:\\Users\\hodp2\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = 'C:\\Users\\hodp2\\AppData\\Local\\Temp\\chrome-date-range-profile';
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
  console.log("VERIFICATION: Date-Range & Week Badges Physical Left-to-Right Display");
  console.log("===============================================================================\n");

  // 1. Isolated dev server
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
  console.log(`[PASS] Server running on http://127.0.0.1:${PORT}`);

  // 2. Headless Chrome
  const cdpPort = 9239;
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

    const target = await send('Target.createTarget', { url: `http://localhost:${PORT}/?dev=true` });
    const targetId = target.result.targetId;

    const pageWsRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const pageTabs = await pageWsRes.json();
    const targetTab = pageTabs.find(t => t.id === targetId);
    const pageWs = new WebSocket(targetTab.webSocketDebuggerUrl);

    let pageMsgId = 1;
    const pageCallbacks = new Map();
    function sendPage(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = pageMsgId++;
        pageCallbacks.set(id, { resolve, reject });
        pageWs.send(JSON.stringify({ id, method, params }));
      });
    }

    pageWs.onmessage = event => {
      const msg = JSON.parse(event.data);
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

    await sendPage('Page.enable');
    await sendPage('DOM.enable');

    async function evalInPage(expression) {
      const res = await sendPage('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.result.exceptionDetails) {
        throw new Error(`Eval error: ${JSON.stringify(res.result.exceptionDetails)}`);
      }
      return res.result.result.value;
    }

    async function takeScreenshot(filename) {
      const res = await sendPage('Page.captureScreenshot', { format: 'png' });
      const buffer = Buffer.from(res.result.data, 'base64');
      const outPath = path.join(ARTIFACT_DIR, filename);
      fs.writeFileSync(outPath, buffer);
      console.log(`  📸 Screenshot saved: ${filename}`);
      return outPath;
    }

    await new Promise(r => setTimeout(r, 1500));
    await evalInPage('localStorage.clear();');
    await evalInPage('location.reload();');
    await new Promise(r => setTimeout(r, 1500));

    await evalInPage(`
      (() => {
        const loginBtn = document.getElementById('googleLoginBtn');
        if (loginBtn) loginBtn.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    console.log('--- 1. Desktop (1200px): Week Badges Container & Relative Physical Placement ---');
    await evalInPage(`
      (async () => {
        document.getElementById('startDate').value = '01/11/2026';
        document.getElementById('weekCount').value = '2';
        document.getElementById('buildWeeks').click();
        await refreshCalendarDays();

        // Add 3 workers for scheduling
        const input = document.getElementById('newWorkerName');
        input.value = 'דני';
        document.getElementById('addWorker').click();
        input.value = 'שרה';
        document.getElementById('addWorker').click();
        input.value = 'רוני';
        document.getElementById('addWorker').click();

        // Expand first worker card to show availability week headings
        document.querySelector('.worker-details').setAttribute('open', '');
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    // A. Verify Badge Container direction and physical relative positions of badges
    const badgesPlacement = await evalInPage(`
      (() => {
        const list = document.querySelector('#weekSettings .summary-list');
        const pills = Array.from(document.querySelectorAll('#weekSettings .summary-pill'));
        const listStyle = window.getComputedStyle(list);

        const r0 = pills[0].getBoundingClientRect();
        const r1 = pills[1].getBoundingClientRect();

        return {
          listDirection: listStyle.direction,
          pill0Text: pills[0].textContent.trim(),
          pill1Text: pills[1].textContent.trim(),
          pill0Left: r0.left,
          pill0Right: r0.right,
          pill1Left: r1.left,
          pill1Right: r1.right,
          isPill0LeftOfPill1: r0.left < r1.left && r0.right <= r1.left
        };
      })()
    `);

    assert.strictEqual(badgesPlacement.listDirection, 'ltr', 'Badge container must have direction: ltr');
    assert.strictEqual(badgesPlacement.pill0Text, '1.11–7.11', 'Badge 0 text must be 1.11–7.11');
    assert.strictEqual(badgesPlacement.pill1Text, '8.11–14.11', 'Badge 1 text must be 8.11–14.11');
    assert.strictEqual(badgesPlacement.isPill0LeftOfPill1, true, 'Badge 0 (1.11–7.11) must be physically to the LEFT of Badge 1 (8.11–14.11)');
    console.log(`  [PASS] Week badge container direction: "${badgesPlacement.listDirection}"`);
    console.log(`  [PASS] LEFT badge:  "${badgesPlacement.pill0Text}" (left=${badgesPlacement.pill0Left.toFixed(1)}px, right=${badgesPlacement.pill0Right.toFixed(1)}px)`);
    console.log(`  [PASS] RIGHT badge: "${badgesPlacement.pill1Text}" (left=${badgesPlacement.pill1Left.toFixed(1)}px, right=${badgesPlacement.pill1Right.toFixed(1)}px)`);

    // B. Verify LTR isolation inside each badge
    const pillsGeometry = await evalInPage(`
      (() => {
        const pillBdis = Array.from(document.querySelectorAll('#weekSettings .summary-pill bdi'));
        return pillBdis.map(bdi => {
          const text = bdi.textContent.trim();
          const parts = text.split(/[–-]/);
          const textNode = bdi.firstChild;

          const r1 = document.createRange();
          r1.setStart(textNode, 0);
          r1.setEnd(textNode, parts[0].length);
          const rect1 = r1.getBoundingClientRect();

          const r2 = document.createRange();
          r2.setStart(textNode, text.length - parts[1].length);
          r2.setEnd(textNode, text.length);
          const rect2 = r2.getBoundingClientRect();

          return {
            text,
            isPhysicallyLeftToRight: rect1.left < rect2.left
          };
        });
      })()
    `);

    assert.strictEqual(pillsGeometry.every(p => p.isPhysicallyLeftToRight), true, 'Inside each badge: earlier date must be on the left of later date');
    console.log('  [PASS] Date range text inside each badge is isolated LTR');

    // C. Verify worker availability week headings
    const headingsGeometry = await evalInPage(`
      (() => {
        const headingBdis = Array.from(document.querySelectorAll('.worker-details[open] .worker-week-title .week-dates bdi'));
        return headingBdis.map(bdi => {
          const text = bdi.textContent.trim();
          const parts = text.split(/[–-]/);
          const textNode = bdi.firstChild;

          const r1 = document.createRange();
          r1.setStart(textNode, 0);
          r1.setEnd(textNode, parts[0].length);
          const rect1 = r1.getBoundingClientRect();

          const r2 = document.createRange();
          r2.setStart(textNode, text.length - parts[1].length);
          r2.setEnd(textNode, text.length);
          const rect2 = r2.getBoundingClientRect();

          return {
            text,
            isPhysicallyLeftToRight: rect1.left < rect2.left
          };
        });
      })()
    `);

    assert.strictEqual(headingsGeometry.length >= 2, true, 'At least 2 week headings');
    assert.strictEqual(headingsGeometry.every(h => h.isPhysicallyLeftToRight), true, 'Heading date ranges must be LTR');
    console.log('  [PASS] Employee availability week headings: LTR isolated');

    // D. Build schedule and verify week titles in generated schedule
    await evalInPage(`
      (() => {
        document.getElementById('buildSchedule').click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1000));

    const scheduleWeekTitles = await evalInPage(`
      (() => {
        const titleBdis = Array.from(document.querySelectorAll('.week-result .week-title bdi'));
        return titleBdis.map(bdi => {
          const text = bdi.textContent.trim();
          const parts = text.split(/[–-]/);
          const textNode = bdi.firstChild;

          const r1 = document.createRange();
          r1.setStart(textNode, 0);
          r1.setEnd(textNode, parts[0].length);
          const rect1 = r1.getBoundingClientRect();

          const r2 = document.createRange();
          r2.setStart(textNode, text.length - parts[1].length);
          r2.setEnd(textNode, text.length);
          const rect2 = r2.getBoundingClientRect();

          return {
            text,
            isPhysicallyLeftToRight: rect1.left < rect2.left
          };
        });
      })()
    `);

    assert.strictEqual(scheduleWeekTitles.length, 2, 'Should have 2 schedule week titles');
    assert.strictEqual(scheduleWeekTitles.every(t => t.isPhysicallyLeftToRight), true, 'Schedule week titles must be LTR');
    console.log('  [PASS] Schedule result week titles: LTR isolated');

    // Desktop Screenshot
    await sendPage('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 950,
      deviceScaleFactor: 1,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 400));
    await takeScreenshot('screenshot-date-ranges-desktop.png');

    console.log('\n--- 2. Mobile Viewport (375px): Badges Physical Left-to-Right Placement ---');
    await sendPage('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true
    });
    await new Promise(r => setTimeout(r, 400));

    const mobileChecks = await evalInPage(`
      (() => {
        const list = document.querySelector('#weekSettings .summary-list');
        const pills = Array.from(document.querySelectorAll('#weekSettings .summary-pill'));
        const listStyle = window.getComputedStyle(list);

        const r0 = pills[0].getBoundingClientRect();
        const r1 = pills[1].getBoundingClientRect();

        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          listDirection: listStyle.direction,
          pill0Left: r0.left,
          pill1Left: r1.left,
          isPill0LeftOfPill1: r0.left < r1.left
        };
      })()
    `);

    assert.strictEqual(mobileChecks.hasOverflow, false, 'No horizontal overflow on mobile');
    assert.strictEqual(mobileChecks.listDirection, 'ltr', 'On mobile: list direction must be ltr');
    assert.strictEqual(mobileChecks.isPill0LeftOfPill1, true, 'On mobile: Badge 0 (1.11–7.11) must remain to the LEFT of Badge 1 (8.11–14.11)');
    console.log(`  [PASS] Mobile width (375px): No overflow, Badge 0 left=${mobileChecks.pill0Left.toFixed(1)}px < Badge 1 left=${mobileChecks.pill1Left.toFixed(1)}px`);

    await takeScreenshot('screenshot-date-ranges-mobile.png');

    console.log('\n--- 3. Month & Year Boundary Chronological Verification (2 Weeks) ---');
    // Test 2 weeks spanning month boundary: 28/10/2026 (Week 0: 28.10–3.11, Week 1: 4.11–10.11)
    await evalInPage(`
      (async () => {
        document.getElementById('startDate').value = '28/10/2026';
        document.getElementById('weekCount').value = '2';
        document.getElementById('buildWeeks').click();
        await refreshCalendarDays();
        document.querySelector('.worker-details').setAttribute('open', '');
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    const monthBoundary = await evalInPage(`
      (() => {
        const pills = Array.from(document.querySelectorAll('#weekSettings .summary-pill'));
        const r0 = pills[0].getBoundingClientRect();
        const r1 = pills[1].getBoundingClientRect();
        return {
          pillsCount: pills.length,
          pillsTexts: pills.map(p => p.textContent.trim()),
          pill0Text: pills[0].textContent.trim(),
          pill1Text: pills[1].textContent.trim(),
          isPill0LeftOfPill1: r0.left < r1.left
        };
      })()
    `);

    console.log('Month boundary pills found:', monthBoundary.pillsTexts);

    assert.strictEqual(monthBoundary.pillsCount, 2, '2 month-boundary pills');
    assert.strictEqual(monthBoundary.pill0Text, '28.10–3.11', 'Week 0 is 28.10–3.11');
    assert.strictEqual(monthBoundary.pill1Text, '4.11–10.11', 'Week 1 is 4.11–10.11');
    assert.strictEqual(monthBoundary.isPill0LeftOfPill1, true, 'Week 0 badge (28.10–3.11) must be physically on the LEFT of Week 1 badge (4.11–10.11)');
    console.log(`  [PASS] Month boundary (2 weeks): LEFT="${monthBoundary.pill0Text}" | RIGHT="${monthBoundary.pill1Text}"`);

    // Test 2 weeks spanning year boundary: 27/12/2026 (Week 0: 27.12–2.1, Week 1: 3.1–9.1)
    await evalInPage(`
      (async () => {
        document.getElementById('startDate').value = '27/12/2026';
        document.getElementById('weekCount').value = '2';
        document.getElementById('buildWeeks').click();
        await refreshCalendarDays();
        document.querySelector('.worker-details').setAttribute('open', '');
      })()
    `);
    await new Promise(r => setTimeout(r, 600));

    const yearBoundary = await evalInPage(`
      (() => {
        const pills = Array.from(document.querySelectorAll('#weekSettings .summary-pill'));
        const r0 = pills[0].getBoundingClientRect();
        const r1 = pills[1].getBoundingClientRect();
        return {
          pillsCount: pills.length,
          pillsTexts: pills.map(p => p.textContent.trim()),
          pill0Text: pills[0].textContent.trim(),
          pill1Text: pills[1].textContent.trim(),
          isPill0LeftOfPill1: r0.left < r1.left
        };
      })()
    `);

    console.log('Month boundary pills found:', monthBoundary.pillsTexts);

    assert.strictEqual(yearBoundary.pillsCount, 2, '2 year-boundary pills');
    assert.strictEqual(yearBoundary.pill0Text, '27.12–2.1', 'Week 0 is 27.12–2.1');
    assert.strictEqual(yearBoundary.pill1Text, '3.1–9.1', 'Week 1 is 3.1–9.1');
    assert.strictEqual(yearBoundary.isPill0LeftOfPill1, true, 'Week 0 badge (27.12–2.1) must be physically on the LEFT of Week 1 badge (3.1–9.1)');
    console.log(`  [PASS] Year boundary (2 weeks): LEFT="${yearBoundary.pill0Text}" | RIGHT="${yearBoundary.pill1Text}"`);

    console.log('\n===============================================================================');
    console.log("DATE RANGE & BADGE PLACEMENT VERIFICATION COMPLETE: ALL CHECKS PASSED!");
    console.log("===============================================================================\n");

  } finally {
    try {
      chrome.kill();
    } catch (e) {}
    server.close();
  }
}

main().catch(err => {
  console.error('\n[FATAL ERROR IN DATE RANGE VERIFICATION]:', err);
  process.exit(1);
});
