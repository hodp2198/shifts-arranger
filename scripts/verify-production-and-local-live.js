const { spawn } = require('child_process');
const assert = require('assert');

async function runLiveVerification() {
  console.log("=================================================");
  console.log("Starting Live Production & Localhost Verification");
  console.log("=================================================\n");

  const chromePath = 'C:\\Users\\hodp2\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  const profileDir = 'C:\\Users\\hodp2\\AppData\\Local\\Temp\\chrome-live-verify-profile';
  
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9229',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ]);

  try {
    await new Promise(r => setTimeout(r, 1500));

    // Connect to browser target
    const versionRes = await fetch('http://127.0.0.1:9229/json/version');
    const versionData = await versionRes.json();
    const browserWs = new WebSocket(versionData.webSocketDebuggerUrl);

    let id = 1;
    const callbacks = new Map();

    function sendBrowser(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = id++;
        callbacks.set(msgId, { resolve, reject });
        browserWs.send(JSON.stringify({ id: msgId, method, params }));
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

    // -------------------------------------------------------------
    // PART 1: PRODUCTION LIVE SITE (https://shift-arranger.web.app)
    // -------------------------------------------------------------
    console.log('\n--- PART 1: Testing Production (https://shift-arranger.web.app) ---');
    
    // Create new target for production
    const prodTarget = await sendBrowser('Target.createTarget', { url: 'https://shift-arranger.web.app/?nocache=' + Date.now() });
    const prodTargetId = prodTarget.result.targetId;

    const attachProd = await sendBrowser('Target.attachToTarget', { targetId: prodTargetId, flatten: true });
    const prodSessionId = attachProd.result.sessionId;

    function sendSession(sessionId, method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = id++;
        callbacks.set(msgId, { resolve, reject });
        browserWs.send(JSON.stringify({ id: msgId, sessionId, method, params }));
      });
    }

    await sendSession(prodSessionId, 'Page.enable');
    await sendSession(prodSessionId, 'Runtime.enable');
    await sendSession(prodSessionId, 'Network.enable');

    // Wait for page load
    await new Promise(r => setTimeout(r, 3500));

    // Verify initial unauthenticated production state
    const prodInit = await sendSession(prodSessionId, 'Runtime.evaluate', {
      expression: `(() => {
        const gatekeeper = document.getElementById('authGatekeeper');
        const mainShell = document.getElementById('mainShell');
        const devBadge = document.getElementById('devModeBadge');
        const authDevNotice = document.getElementById('authDevNotice');
        const googleLoginBtn = document.getElementById('googleLoginBtn');
        const googleLoginIcon = document.getElementById('googleLoginIcon');
        const devLoginIcon = document.getElementById('devLoginIcon');

        return {
          hostname: window.location.hostname,
          isLocal: typeof window.isLocalEnvironment === 'function' ? window.isLocalEnvironment() : null,
          gatekeeperExists: Boolean(gatekeeper),
          mainShellInDom: Boolean(mainShell),
          btnText: document.getElementById('googleBtnText')?.textContent?.trim(),
          googleIconVisible: googleLoginIcon ? window.getComputedStyle(googleLoginIcon).display !== 'none' : false,
          devIconVisible: devLoginIcon ? window.getComputedStyle(devLoginIcon).display !== 'none' : false,
          authDevNoticeVisible: authDevNotice ? (!authDevNotice.hidden && window.getComputedStyle(authDevNotice).display !== 'none') : false,
          devBadgeInDom: Boolean(devBadge)
        };
      })()`,
      returnByValue: true
    });

    const pInit = prodInit.result.result.value;
    console.log('Production Initial Screen State:', pInit);

    assert.strictEqual(pInit.hostname, 'shift-arranger.web.app', 'Hostname must be shift-arranger.web.app');
    assert.strictEqual(pInit.isLocal, false, 'isLocalEnvironment() must return false on production');
    assert.strictEqual(pInit.gatekeeperExists, true, 'Gatekeeper must be present');
    assert.strictEqual(pInit.mainShellInDom, false, 'mainShell must be detached from DOM before auth');
    assert.strictEqual(pInit.btnText, 'התחבר עם Google', 'Production login button text must be "התחבר עם Google"');
    assert.strictEqual(pInit.googleIconVisible, true, 'Google icon must be visible on production');
    assert.strictEqual(pInit.devIconVisible, false, 'Dev icon must be hidden on production');
    assert.strictEqual(pInit.authDevNoticeVisible, false, 'Dev notice must be hidden on production');
    assert.strictEqual(pInit.devBadgeInDom, false, 'devModeBadge must not be in DOM before login');
    console.log('[PASS] 1. Production initial state is clean: Google login shown, dev notices and devModeBadge completely absent/hidden');

    // Simulate Google Login on production (trigger handleAuthTransition)
    const prodAuth = await sendSession(prodSessionId, 'Runtime.evaluate', {
      expression: `(() => {
        window.handleAuthTransition({
          uid: 'prod-admin-mock-tester',
          email: 'admin@prod.test',
          displayName: 'מנהל ייצור'
        });

        const devBadge = document.getElementById('devModeBadge');
        const viewOfficialBtn = document.getElementById('viewOfficialSchedule');
        const saveOfficialBtn = document.getElementById('saveOfficialSchedule');
        const navFairness = document.getElementById('navFairnessLink');
        const fairnessView = document.getElementById('fairnessView');
        const adminEmail = document.getElementById('adminUserEmail')?.textContent?.trim();

        return {
          bodyAuthenticated: document.body.classList.contains('authenticated'),
          adminEmail,
          devBadgeExists: Boolean(devBadge),
          devBadgeHidden: devBadge ? devBadge.hidden : null,
          devBadgeStyleDisplay: devBadge ? devBadge.style.display : null,
          devBadgeComputedDisplay: devBadge ? window.getComputedStyle(devBadge).display : null,
          devBadgeOffsetParent: devBadge ? Boolean(devBadge.offsetParent) : false,
          viewOfficialBtnExists: Boolean(viewOfficialBtn),
          viewOfficialBtnText: viewOfficialBtn?.textContent?.trim(),
          saveOfficialBtnExists: Boolean(saveOfficialBtn),
          navFairnessExists: Boolean(navFairness),
          fairnessViewExists: Boolean(fairnessView)
        };
      })()`,
      returnByValue: true
    });

    const pAuth = prodAuth.result.result.value;
    console.log('Production Authenticated State:', pAuth);

    assert.strictEqual(pAuth.bodyAuthenticated, true, 'Body must have authenticated class');
    assert.strictEqual(pAuth.adminEmail, 'admin@prod.test', 'Admin email must be displayed');
    assert.strictEqual(pAuth.devBadgeExists, true, 'devModeBadge element exists in DOM inside mainShell');
    assert.strictEqual(pAuth.devBadgeHidden, true, 'devModeBadge MUST remain hidden=true after login');
    assert.strictEqual(pAuth.devBadgeStyleDisplay, 'none', 'devModeBadge style.display MUST be "none"');
    assert.strictEqual(pAuth.devBadgeComputedDisplay, 'none', 'devModeBadge computed display MUST be "none"');
    assert.strictEqual(pAuth.devBadgeOffsetParent, false, 'devModeBadge must have no layout presence (offsetParent === false)');
    assert.strictEqual(pAuth.viewOfficialBtnExists, true, '#viewOfficialSchedule button must exist in authenticated view');
    assert.strictEqual(pAuth.viewOfficialBtnText, 'הצג סידור רשמי', 'Button text must be "הצג סידור רשמי"');
    assert.strictEqual(pAuth.saveOfficialBtnExists, true, '#saveOfficialSchedule button must exist');
    assert.strictEqual(pAuth.navFairnessExists, true, 'Fairness navigation link must exist (#navFairnessLink)');
    assert.strictEqual(pAuth.fairnessViewExists, true, 'Fairness view panel must exist (#fairnessView)');
    console.log('[PASS] 2. Production authenticated state: devModeBadge is COMPLETELY HIDDEN (style.display:none, computed:none, hidden=true, offsetParent:false)');

    // Verify Read-Only guarantee on production
    const prodStorageCheck = await sendSession(prodSessionId, 'Runtime.evaluate', {
      expression: `(() => {
        const isolatedKeys = Object.keys(localStorage).filter(k => k.startsWith('isolated_dev_'));
        return { isolatedKeysCount: isolatedKeys.length, isolatedKeys };
      })()`,
      returnByValue: true
    });
    assert.strictEqual(prodStorageCheck.result.result.value.isolatedKeysCount, 0, 'No isolated dev keys should exist in production');
    console.log('[PASS] 3. Zero isolated dev data written to localStorage on production');

    // -------------------------------------------------------------
    // PART 2: LOCALHOST LIVE SITE (http://localhost:5500)
    // -------------------------------------------------------------
    console.log('\n--- PART 2: Testing Localhost (http://localhost:5500) ---');

    const localTarget = await sendBrowser('Target.createTarget', { url: 'http://localhost:5500/?nocache=' + Date.now() });
    const localTargetId = localTarget.result.targetId;

    const attachLocal = await sendBrowser('Target.attachToTarget', { targetId: localTargetId, flatten: true });
    const localSessionId = attachLocal.result.sessionId;

    await sendSession(localSessionId, 'Page.enable');
    await sendSession(localSessionId, 'Runtime.enable');

    await new Promise(r => setTimeout(r, 2000));

    // Clear local storage and reload localhost
    await sendSession(localSessionId, 'Runtime.evaluate', { expression: `localStorage.clear(); location.reload();` });
    await new Promise(r => setTimeout(r, 2500));

    const localInit = await sendSession(localSessionId, 'Runtime.evaluate', {
      expression: `(() => {
        const gatekeeper = document.getElementById('authGatekeeper');
        const authDevNotice = document.getElementById('authDevNotice');
        const devLoginIcon = document.getElementById('devLoginIcon');

        return {
          hostname: window.location.hostname,
          isLocal: typeof window.isLocalEnvironment === 'function' ? window.isLocalEnvironment() : null,
          btnText: document.getElementById('googleBtnText')?.textContent?.trim(),
          devIconVisible: devLoginIcon ? window.getComputedStyle(devLoginIcon).display !== 'none' : false,
          authDevNoticeVisible: authDevNotice ? (!authDevNotice.hidden && window.getComputedStyle(authDevNotice).display !== 'none') : false
        };
      })()`,
      returnByValue: true
    });

    const lInit = localInit.result.result.value;
    console.log('Localhost Initial Screen State:', lInit);

    assert.strictEqual(lInit.hostname, 'localhost', 'Hostname must be localhost');
    assert.strictEqual(lInit.isLocal, true, 'isLocalEnvironment() must be true on localhost');
    assert.strictEqual(lInit.btnText, 'כניסה למצב פיתוח', 'Button text must be "כניסה למצב פיתוח"');
    assert.strictEqual(lInit.devIconVisible, true, 'Dev icon must be visible on localhost');
    assert.strictEqual(lInit.authDevNoticeVisible, true, 'Dev notice must be visible on localhost');
    console.log('[PASS] 4. Localhost initial state: Dev mode login is active and labeled "כניסה למצב פיתוח"');

    // Click local login
    const localLoginClick = await sendSession(localSessionId, 'Runtime.evaluate', {
      expression: `(() => {
        const btn = document.getElementById('googleLoginBtn');
        if (btn) btn.click();
      })()`
    });

    await new Promise(r => setTimeout(r, 1500));

    const localAuth = await sendSession(localSessionId, 'Runtime.evaluate', {
      expression: `(() => {
        const devBadge = document.getElementById('devModeBadge');
        return {
          bodyAuthenticated: document.body.classList.contains('authenticated'),
          adminEmail: document.getElementById('adminUserEmail')?.textContent?.trim(),
          devBadgeHidden: devBadge ? devBadge.hidden : null,
          devBadgeComputedDisplay: devBadge ? window.getComputedStyle(devBadge).display : null,
          devBadgeText: devBadge?.textContent?.trim()
        };
      })()`,
      returnByValue: true
    });

    const lAuth = localAuth.result.result.value;
    console.log('Localhost Authenticated State:', lAuth);

    assert.strictEqual(lAuth.bodyAuthenticated, true, 'Body must have authenticated class on localhost');
    assert.strictEqual(lAuth.adminEmail, 'dev-admin@shift-arranger.local', 'Local admin email must be dev-admin@shift-arranger.local');
    assert.strictEqual(lAuth.devBadgeHidden, false, 'devModeBadge must have hidden=false on localhost');
    assert.ok(['inline-flex', 'flex'].includes(lAuth.devBadgeComputedDisplay), 'devModeBadge computed display MUST be flex/inline-flex on localhost');
    assert.ok(lAuth.devBadgeText.includes('מצב פיתוח מבודד'), 'devModeBadge text must mention isolated dev mode on localhost');
    console.log('[PASS] 5. Localhost authenticated state: devModeBadge is properly VISIBLE (display: flex/inline-flex, hidden=false)');

    console.log('\n=================================================');
    console.log('ALL LIVE PRODUCTION AND LOCALHOST VERIFICATIONS PASSED (5/5)');
    console.log('=================================================');

  } finally {
    chrome.kill();
  }
}

runLiveVerification().catch(err => {
  console.error('\n[FATAL VERIFICATION ERROR]:', err);
  process.exit(1);
});
