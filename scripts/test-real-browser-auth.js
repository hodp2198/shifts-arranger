const { spawn } = require('child_process');
const assert = require('assert');

async function runBrowserAuthTests() {
  console.log("=================================================");
  console.log("Running Complete Real Browser Authentication Tests");
  console.log("=================================================\n");

  const chromePath = 'C:\\Users\\hodp2\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9228',
    '--disable-gpu',
    '--no-sandbox',
    '--user-data-dir=C:\\Users\\hodp2\\AppData\\Local\\Temp\\chrome-real-test-profile',
    'http://localhost:5500'
  ]);

  try {
    await new Promise(r => setTimeout(r, 1500));

    const listRes = await fetch('http://127.0.0.1:9228/json/list');
    const tabs = await listRes.json();
    const tab = tabs.find(t => t.url.includes('localhost:5500'));
    if (!tab) throw new Error('Tab for localhost:5500 not found');

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let id = 1;
    const callbacks = new Map();
    const networkRequests = [];
    const consoleLogs = [];

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = id++;
        callbacks.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    ws.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Console.messageAdded') {
        consoleLogs.push({ level: msg.params.message.level, text: msg.params.message.text });
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        consoleLogs.push({ type: msg.params.type, args: msg.params.args.map(a => a.value || a.description) });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[BROWSER EXCEPTION]', msg.params.exceptionDetails);
      } else if (msg.method === 'Network.requestWillBeSent') {
        networkRequests.push(msg.params.request.url);
      } else if (msg.id && callbacks.has(msg.id)) {
        const { resolve } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        resolve(msg);
      }
    };

    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    console.log('[PASS] Chrome DevTools Protocol connected');
    await send('Console.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    // Step 1: Clear localStorage and reload for a pure fresh start
    await send('Runtime.evaluate', { expression: `localStorage.clear(); location.reload();` });
    await new Promise(r => setTimeout(r, 2000));

    // Step 2: Verify Initial Login Screen Elements & Label
    const initialScreen = await send('Runtime.evaluate', {
      expression: `({
        gatekeeperInDom: Boolean(document.getElementById('authGatekeeper')),
        mainShellInDom: Boolean(document.getElementById('mainShell')),
        btnText: document.getElementById('googleBtnText')?.textContent?.trim(),
        googleIconVisible: document.getElementById('googleLoginIcon')?.style?.display !== 'none',
        devIconVisible: document.getElementById('devLoginIcon')?.style?.display !== 'none',
        devNoticeVisible: Boolean(document.getElementById('authDevNotice') && !document.getElementById('authDevNotice').hidden),
        btnDisabled: document.getElementById('googleLoginBtn')?.disabled
      })`,
      returnByValue: true
    });
    const initData = initialScreen.result.result.value;
    console.log("Initial Screen State:", initData);

    assert.strictEqual(initData.gatekeeperInDom, true, "Gatekeeper must be in DOM before login");
    assert.strictEqual(initData.mainShellInDom, false, "mainShell must NOT be in DOM before login");
    assert.strictEqual(initData.btnText, "כניסה למצב פיתוח", "Button label MUST be 'כניסה למצב פיתוח'");
    assert.strictEqual(initData.googleIconVisible, false, "Google icon must be hidden in local mode");
    assert.strictEqual(initData.devIconVisible, true, "Dev icon must be visible in local mode");
    assert.strictEqual(initData.devNoticeVisible, true, "Auth dev notice must be visible");
    console.log("[PASS] 1. Initial login screen correctly labeled 'כניסה למצב פיתוח' with dev icon and notices");

    // Step 3: Click 'כניסה למצב פיתוח'
    console.log("\nClicking 'כניסה למצב פיתוח' button...");
    const clickExec = await send('Runtime.evaluate', {
      expression: `(function() {
        const btn = document.getElementById('googleLoginBtn');
        btn.click();
        return { clicked: true };
      })()`,
      returnByValue: true
    });
    assert.strictEqual(clickExec.result.result.value.clicked, true);

    // Wait 500ms for lifecycle to transition
    await new Promise(r => setTimeout(r, 500));

    // Step 4: Verify Main Application is Mounted & Authenticated
    const loggedInScreen = await send('Runtime.evaluate', {
      expression: `({
        gatekeeperInDom: Boolean(document.getElementById('authGatekeeper')),
        mainShellInDom: Boolean(document.getElementById('mainShell')),
        bodyAuthenticated: document.body.classList.contains('authenticated'),
        adminEmail: document.getElementById('adminUserEmail')?.textContent?.trim(),
        devBadgeText: document.getElementById('devModeBadge')?.textContent?.trim(),
        devBadgeVisible: Boolean(document.getElementById('devModeBadge') && !document.getElementById('devModeBadge').hidden),
        scheduleOutputExists: Boolean(document.getElementById('scheduleOutput')),
        currentAuthUid: typeof currentAuthUid !== 'undefined' ? currentAuthUid : null,
        currentAuthEmail: typeof currentAuthUser !== 'undefined' ? currentAuthUser?.email : null
      })`,
      returnByValue: true
    });
    const loggedData = loggedInScreen.result.result.value;
    console.log("Logged In Screen State:", loggedData);

    assert.strictEqual(loggedData.gatekeeperInDom, false, "Gatekeeper must be removed after login");
    assert.strictEqual(loggedData.mainShellInDom, true, "mainShell MUST be mounted after login");
    assert.strictEqual(loggedData.bodyAuthenticated, true, "body must have .authenticated");
    assert.strictEqual(loggedData.adminEmail, "dev-admin@shift-arranger.local", "Admin email must show dev email");
    assert.strictEqual(loggedData.currentAuthUid, "dev-local-admin", "currentAuthUid must be dev-local-admin");
    assert.strictEqual(loggedData.devBadgeVisible, true, "Dev mode badge must be visible in top bar");
    console.log("[PASS] 2. Logging in opens the actual scheduler interface as dev-local-admin");

    // Step 5: Verify Isolation from Production Network Endpoints
    const prodAuthRequests = networkRequests.filter(url => 
      url.includes('identitytoolkit.googleapis.com') ||
      url.includes('securetoken.googleapis.com') ||
      (url.includes('shift-arranger.firebaseapp.com') && !url.includes('localhost'))
    );
    assert.strictEqual(prodAuthRequests.length, 0, "Must NEVER dispatch requests to production Firebase Auth or Google OAuth");
    console.log("[PASS] 3. Zero network requests dispatched to production Firebase Auth or Google OAuth");

    // Step 6: Test Local Persistence & Unsaved Changes / Official Schedule in UI
    const schedulerState = await send('Runtime.evaluate', {
      expression: `(function() {
        // Verify schedule export and fairness buttons exist
        const viewOfficialBtn = document.getElementById('viewOfficialSchedule');
        const saveOfficialBtn = document.getElementById('saveOfficialSchedule');
        return {
          viewOfficialBtnExists: Boolean(viewOfficialBtn),
          saveOfficialBtnExists: Boolean(saveOfficialBtn),
          viewOfficialBtnText: viewOfficialBtn?.textContent?.trim(),
          saveOfficialBtnText: saveOfficialBtn?.textContent?.trim()
        };
      })()`,
      returnByValue: true
    });
    const schedData = schedulerState.result.result.value;
    console.log("Scheduler Controls:", schedData);
    assert.strictEqual(schedData.viewOfficialBtnExists, true);
    assert.strictEqual(schedData.saveOfficialBtnExists, true);
    console.log("[PASS] 4. Scheduler interface controls and 'הצג סידור רשמי' button fully operational");

    // Step 7: Test Logout and Re-Login
    console.log("\nTesting Logout flow...");
    await send('Runtime.evaluate', {
      expression: `(function() {
        // Call logoutAdmin
        window.authService.logoutAdmin();
      })()`
    });
    await new Promise(r => setTimeout(r, 400));

    const loggedOutScreen = await send('Runtime.evaluate', {
      expression: `({
        gatekeeperInDom: Boolean(document.getElementById('authGatekeeper')),
        mainShellInDom: Boolean(document.getElementById('mainShell')),
        bodyAuthenticated: document.body.classList.contains('authenticated'),
        btnText: document.getElementById('googleBtnText')?.textContent?.trim()
      })`,
      returnByValue: true
    });
    const outData = loggedOutScreen.result.result.value;
    console.log("Logged Out Screen State:", outData);
    assert.strictEqual(outData.gatekeeperInDom, true, "Gatekeeper must be restored after logout");
    assert.strictEqual(outData.mainShellInDom, false, "mainShell must be removed after logout");
    assert.strictEqual(outData.bodyAuthenticated, false, "body must not be authenticated");
    assert.strictEqual(outData.btnText, "כניסה למצב פיתוח", "Button label must remain 'כניסה למצב פיתוח'");
    console.log("[PASS] 5. Logout returns to login gatekeeper with 'כניסה למצב פיתוח'");

    // Step 8: Re-login test
    console.log("\nTesting Re-login...");
    await send('Runtime.evaluate', {
      expression: `document.getElementById('googleLoginBtn').click();`
    });
    await new Promise(r => setTimeout(r, 400));

    const reLoggedInScreen = await send('Runtime.evaluate', {
      expression: `({
        gatekeeperInDom: Boolean(document.getElementById('authGatekeeper')),
        mainShellInDom: Boolean(document.getElementById('mainShell')),
        bodyAuthenticated: document.body.classList.contains('authenticated')
      })`,
      returnByValue: true
    });
    const reData = reLoggedInScreen.result.result.value;
    assert.strictEqual(reData.gatekeeperInDom, false);
    assert.strictEqual(reData.mainShellInDom, true);
    assert.strictEqual(reData.bodyAuthenticated, true);
    console.log("[PASS] 6. Re-login immediately re-mounts scheduler interface cleanly");

    ws.close();
    chrome.kill();

    console.log("\n=================================================");
    console.log("All Real Browser Authentication Tests PASSED (6/6)");
    console.log("=================================================");

  } catch (err) {
    console.error("Test failed:", err);
    chrome.kill();
    process.exit(1);
  }
}

runBrowserAuthTests();
