const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const CHROME_PATH = 'C:\\Users\\hodp2\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE_DIR = 'C:\\Users\\hodp2\\AppData\\Local\\Temp\\chrome-siwar-verify-profile';
const ARTIFACT_DIR = 'C:\\Users\\hodp2\\.gemini\\antigravity\\brain\\0adef3ca-93fe-4543-bfe7-9b411c97a1de';
const CDP_PORT = 9250;

async function run() {
  console.log("===============================================================================");
  console.log("STARTING TEST: Siwar Manual Flow, Auto-Participation Activation & Boundaries");
  console.log("===============================================================================\n");

  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${PROFILE_DIR}`,
    'about:blank'
  ]);

  try {
    await new Promise(r => setTimeout(r, 2000));
    const versionRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
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

    const target = await send('Target.createTarget', { url: 'http://localhost:3000/?dev=true' });
    const targetId = target.result.targetId;

    const pageWsRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTabs = await pageWsRes.json();
    const targetTab = pageTabs.find(t => t.id === targetId);
    let pageWs = new WebSocket(targetTab.webSocketDebuggerUrl);

    let pageMsgId = 1;
    let pageCallbacks = new Map();
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
    await sendPage('Runtime.enable');

    await new Promise(r => setTimeout(r, 2000));

    async function evaluate(expr) {
      const res = await sendPage('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true
      });
      if (res.result?.exceptionDetails) {
        console.error("Eval error:", res.result.exceptionDetails);
        throw new Error(res.result.exceptionDetails.text || "Eval failed");
      }
      return res.result?.result?.value;
    }

    async function takeScreenshot(filename) {
      const res = await sendPage('Page.captureScreenshot', { format: 'png' });
      const buffer = Buffer.from(res.result.data, 'base64');
      const outPath = path.join(ARTIFACT_DIR, filename);
      fs.writeFileSync(outPath, buffer);
      console.log(`  📸 Screenshot saved: ${filename}`);
      return outPath;
    }

    // Step 0: Ensure local login
    await evaluate(`(() => {
      const loginBtn = document.getElementById('googleLoginBtn');
      if (loginBtn) loginBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 1200));

    // Step 1: Set schedule dates (1 week starting 01/11/2026) and import constraints
    console.log("--- Step 1: Importing matrix with Siwar unsubmitted ---");
    const step1Data = await evaluate(`(async () => {
      document.getElementById('startDate').value = '01/11/2026';
      document.getElementById('weekCount').value = '1';
      document.getElementById('buildWeeks').click();
      await refreshCalendarDays();

      const matrixText = "דני\tיוני\tסיוואר\\nא - לא יכול\\t\\t\\nב - יכול\\tב - יכול\\t\\nג - יכול\\tג - יכול\\t\\nד - יכול\\tד - יכול\\t\\nה - יכול\\tה - יכול\\t";
      const bulkEl = document.getElementById("bulkExcelNotes");
      bulkEl.value = matrixText;
      document.getElementById("applyBulkExcelNotes").click();

      // Configure Yoni as onlyNight2: true (so Dani blocked, Yoni night2 only, Siwar is only candidate for Sunday slot 1)
      const yoniCard = document.querySelector('.worker[data-worker="יוני"]');
      if (yoniCard) {
        const night2Cb = yoniCard.querySelector('.night2-only');
        if (night2Cb) night2Cb.checked = true;
      }

      const siwarCard = document.querySelector('.worker[data-worker="סיוואר"]');
      const siwarActive = siwarCard?.querySelector('.active-worker')?.checked;
      const siwarAvail = getWorkerAvailability("סיוואר");

      return {
        hasSiwarCard: Boolean(siwarCard),
        siwarActive,
        hasSubmitted: siwarAvail?.hasSubmitted,
        source: siwarAvail?.source
      };
    })()`);

    assert.strictEqual(step1Data.hasSiwarCard, true, "Siwar card should exist");
    assert.strictEqual(step1Data.siwarActive, false, "Siwar participation checkbox should be unchecked");
    assert.strictEqual(step1Data.hasSubmitted, false, "Siwar hasSubmitted should be false");
    assert.strictEqual(step1Data.source, "unsubmitted", "Siwar source should be unsubmitted");
    console.log("  [PASS] Step 1: Siwar imported without constraints is unsubmitted and participation unchecked");

    // Step 2: Expand Siwar's card and click "הזנת זמינות ידנית"
    console.log("\n--- Step 2: Clicking 'הזנת זמינות ידנית' ---");
    const step2Data = await evaluate(`(() => {
      const siwarCard = document.querySelector('.worker[data-worker="סיוואר"]');
      const details = siwarCard.querySelector('details');
      details.open = true;

      const manualBtn = siwarCard.querySelector('.btn-manual-availability');
      if (!manualBtn) throw new Error("Manual availability button should exist");
      manualBtn.click();

      const siwarAvail = getWorkerAvailability("סיוואר");
      const noticeEl = siwarCard.querySelector('.availability-excluded-notice');
      const activeChecked = siwarCard.querySelector('.active-worker').checked;

      return {
        hasSubmitted: siwarAvail.hasSubmitted,
        source: siwarAvail.source,
        blockedCount: siwarAvail.blocked.size,
        hasNotice: Boolean(noticeEl),
        noticeText: noticeEl?.textContent?.trim(),
        activeChecked
      };
    })()`);

    assert.strictEqual(step2Data.hasSubmitted, true, "Siwar hasSubmitted should now be true");
    assert.strictEqual(step2Data.source, "manual", "Siwar source should be manual");
    assert.strictEqual(step2Data.blockedCount, 6, "All 6 schedule days should be initialized to closed");
    assert.strictEqual(step2Data.activeChecked, false, "Entering manual mode alone must NOT enable participation");
    assert.strictEqual(step2Data.hasNotice, true, "Exclusion notice must be displayed when participation is unchecked");
    assert.match(step2Data.noticeText, /העובד מסומן כלא משתתף בסידור/, "Notice text must explain employee is excluded");
    console.log("  [PASS] Step 2: Manual mode starts all days closed, participation unchecked, exclusion notice shown");

    // Step 3: Explicitly click daily toggle to OPEN Sunday (2026-11-01)
    // Approved behavior: changing a toggle from CLOSED to OPEN automatically checks participation!
    console.log("\n--- Step 3: Explicitly opening Sunday (2026-11-01) -> Auto-enable participation ---");
    const step3Data = await evaluate(`(() => {
      const siwarCard = document.querySelector('.worker[data-worker="סיוואר"]');
      const sunToggle = siwarCard.querySelector('.day-toggle[data-iso="2026-11-01"]');
      sunToggle.click();

      // Query state after click
      const updatedToggle = siwarCard.querySelector('.day-toggle[data-iso="2026-11-01"]');
      const siwarAvail = getWorkerAvailability("סיוואר");
      const sunChecked = updatedToggle.getAttribute("aria-checked");
      const statusLabel = updatedToggle.closest('.day-toggle-wrapper')?.querySelector('.day-status-label')?.textContent?.trim();
      const isSunBlocked = siwarAvail.blocked.has("2026-11-01");
      const isSunSubmitted = siwarAvail.submitted.has("2026-11-01");
      const activeCheckbox = siwarCard.querySelector('.active-worker');
      const noticeEl = siwarCard.querySelector('.availability-excluded-notice');
      const activatedPill = siwarCard.querySelector('.worker-activated-notice');
      const statusBadgeText = document.getElementById("statusBadge")?.textContent?.trim();

      return {
        sunChecked,
        statusLabel,
        isSunBlocked,
        isSunSubmitted,
        activeChecked: activeCheckbox?.checked,
        hasNotice: Boolean(noticeEl),
        pillText: activatedPill?.textContent?.trim(),
        hasPillVisible: activatedPill?.classList?.contains('is-visible'),
        statusBadgeText,
        workersData: getWorkersData().map(w => w.name)
      };
    })()`);

    assert.strictEqual(step3Data.sunChecked, "true", "Sunday toggle should have aria-checked='true'");
    assert.strictEqual(step3Data.statusLabel, "זמין", "Sunday status label should be 'זמין'");
    assert.strictEqual(step3Data.isSunBlocked, false, "Sunday should NOT be blocked");
    assert.strictEqual(step3Data.isSunSubmitted, true, "Sunday should be in submitted");
    assert.strictEqual(step3Data.activeChecked, true, "Participation checkbox MUST be automatically checked on OPEN toggle");
    assert.strictEqual(step3Data.hasNotice, false, "Exclusion notice must be removed immediately");
    assert.strictEqual(step3Data.pillText, "העובד הופעל להשתתפות בסידור", "Confirmation pill must be displayed");
    assert.strictEqual(step3Data.hasPillVisible, true, "Confirmation pill must have is-visible class");
    assert.strictEqual(step3Data.statusBadgeText, "העובד הופעל להשתתפות בסידור", "Status badge must confirm activation");
    assert.strictEqual(step3Data.workersData.includes("סיוואר"), true, "Siwar must now be in active workers data");
    console.log("  [PASS] Step 3: Toggling day to OPEN automatically enables participation, displays confirmation, and removes notice");

    await takeScreenshot("screenshot-siwar-participation-enabled.png");

    // Step 4: Generate schedule -> verify solver assigns Siwar to Sunday slot 1 and NEVER on closed dates
    console.log("\n--- Step 4: Generating schedule ---");
    const step4Data = await evaluate(`(() => {
      document.getElementById("buildSchedule").click();

      const schedule = state.currentSchedule;
      const week0 = schedule ? schedule[0] : [];
      const sundayEntry = week0.find(e => e.day.iso === "2026-11-01");
      const otherDays = week0.filter(e => e.day.iso !== "2026-11-01");
      const siwarOnOtherDays = otherDays.some(e => e.first?.name === "סיוואר" || e.second?.name === "סיוואר");
      const siwarStats = state.currentWorkers.find(w => w.name === "סיוואר");

      return {
        sundayFirst: sundayEntry?.first?.name,
        sundaySecond: sundayEntry?.second?.name,
        siwarOnOtherDays,
        siwarTotal: siwarStats?.total
      };
    })()`);

    assert.strictEqual(step4Data.sundayFirst, "סיוואר", "Siwar MUST be assigned to Sunday slot 1");
    assert.strictEqual(step4Data.sundaySecond, "יוני", "Yoni (onlyNight2) should be assigned to Sunday slot 2");
    assert.strictEqual(step4Data.siwarOnOtherDays, false, "Siwar MUST NEVER be assigned on closed days");
    assert.strictEqual(step4Data.siwarTotal, 1, "Siwar should have exactly 1 total shift");
    console.log("  [PASS] Step 4: Solver assigns Siwar to open Sunday slot 1 and NEVER on closed dates");

    // Step 5: Boundary Check - User explicitly unchecks participation
    console.log("\n--- Step 5: User explicitly unchecks participation ---");
    const step5Data = await evaluate(`(() => {
      const siwarCard = document.querySelector('.worker[data-worker="סיוואר"]');
      const activeCheckbox = siwarCard.querySelector('.active-worker');
      activeCheckbox.checked = false;
      activeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));

      // Regenerate schedule
      document.getElementById("buildSchedule").click();
      const schedule = state.currentSchedule;
      const week0 = schedule ? schedule[0] : [];
      const sundayEntry = week0.find(e => e.day.iso === "2026-11-01");
      const noticeEl = siwarCard.querySelector('.availability-excluded-notice');

      return {
        activeChecked: activeCheckbox.checked,
        hasNotice: Boolean(noticeEl),
        sundayFirst: sundayEntry?.first?.name,
        sundaySecond: sundayEntry?.second?.name
      };
    })()`);

    assert.strictEqual(step5Data.activeChecked, false, "Participation is now unchecked");
    assert.strictEqual(step5Data.hasNotice, true, "Exclusion notice must reappear when participation is unchecked");
    assert.notStrictEqual(step5Data.sundayFirst, "סיוואר", "Siwar MUST NOT be assigned when participation is unchecked");
    assert.notStrictEqual(step5Data.sundaySecond, "סיוואר", "Siwar MUST NOT be assigned when participation is unchecked");
    console.log("  [PASS] Step 5: User uncheck is respected; exclusion notice reappears and solver excludes employee");

    // Step 6: Test persistence across reload when excluded
    console.log("\n--- Step 6: Verifying excluded state persists across reload ---");
    await evaluate(`saveState(true)`);
    await new Promise(r => setTimeout(r, 600));

    await evaluate(`location.reload()`);
    await new Promise(r => setTimeout(r, 2000));

    // Reconnect after reload
    const pageWsRes2 = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
    const pageTabs2 = await pageWsRes2.json();
    const targetTab2 = pageTabs2.find(t => t.id === targetId);
    pageWs = new WebSocket(targetTab2.webSocketDebuggerUrl);
    pageCallbacks = new Map();
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
    await sendPage('Runtime.enable');
    await new Promise(r => setTimeout(r, 1000));

    // Login after reload
    await evaluate(`(() => {
      const loginBtn = document.getElementById('googleLoginBtn');
      if (loginBtn) loginBtn.click();
    })()`);
    await new Promise(r => setTimeout(r, 2000));

    const step6Data = await evaluate(`(() => {
      const siwarCard = document.querySelector('.worker[data-worker="סיוואר"]');
      const activeChecked = siwarCard.querySelector('.active-worker').checked;
      const siwarAvail = getWorkerAvailability("סיוואר");
      const sunOpen = siwarAvail.submitted.has("2026-11-01");

      // Expand accordion to verify notice
      const details = siwarCard.querySelector('details');
      details.open = true;
      renderWorkerAvailability(siwarCard);
      const noticeEl = siwarCard.querySelector('.availability-excluded-notice');

      return {
        activeChecked,
        sunOpen,
        hasNotice: Boolean(noticeEl)
      };
    })()`);

    assert.strictEqual(step6Data.activeChecked, false, "Participation must remain unchecked after reload (no auto-enable on reload!)");
    assert.strictEqual(step6Data.sunOpen, true, "Sunday availability remains OPEN");
    assert.strictEqual(step6Data.hasNotice, true, "Exclusion notice remains visible after reload");
    console.log("  [PASS] Step 6: Excluded state persists cleanly across reload without accidental auto-activation");

    // Step 7: Master Toggle Activation - opening week auto-activates participation
    console.log("\n--- Step 7: Master Toggle opening week auto-activates participation ---");
    const step7Data = await evaluate(`(() => {
      const siwarCard = document.querySelector('.worker[data-worker="סיוואר"]');
      const masterToggle = siwarCard.querySelector('.master-toggle[data-week="0"]');
      masterToggle.click();

      const activeCheckbox = siwarCard.querySelector('.active-worker');
      const noticeEl = siwarCard.querySelector('.availability-excluded-notice');
      const activatedPill = siwarCard.querySelector('.worker-activated-notice');

      return {
        activeChecked: activeCheckbox?.checked,
        hasNotice: Boolean(noticeEl),
        pillText: activatedPill?.textContent?.trim()
      };
    })()`);

    assert.strictEqual(step7Data.activeChecked, true, "Master toggle OPEN must automatically enable participation");
    assert.strictEqual(step7Data.hasNotice, false, "Exclusion notice must be hidden after master toggle activation");
    assert.strictEqual(step7Data.pillText, "העובד הופעל להשתתפות בסידור", "Confirmation pill shown on master toggle activation");
    console.log("  [PASS] Step 7: Master toggle opening auto-enables participation and shows confirmation");

    // Step 8: Closing days must NOT disable participation
    console.log("\n--- Step 8: Closing days must NOT automatically disable participation ---");
    const step8Data = await evaluate(`(() => {
      const siwarCard = document.querySelector('.worker[data-worker="סיוואר"]');
      const sunToggle = siwarCard.querySelector('.day-toggle[data-iso="2026-11-01"]');
      sunToggle.click(); // Close Sunday

      const activeCheckbox = siwarCard.querySelector('.active-worker');
      const updatedToggle = siwarCard.querySelector('.day-toggle[data-iso="2026-11-01"]');

      return {
        sunChecked: updatedToggle.getAttribute("aria-checked"),
        activeChecked: activeCheckbox?.checked
      };
    })()`);

    assert.strictEqual(step8Data.sunChecked, "false", "Sunday is now closed");
    assert.strictEqual(step8Data.activeChecked, true, "Participation must REMAIN checked when closing days");
    console.log("  [PASS] Step 8: Closing days does NOT automatically disable participation");

    console.log("\n===============================================================================");
    console.log("ALL TESTS IN TEST-SIWAR-MANUAL-FLOW PASSED WITH 100% SUCCESS!");
    console.log("===============================================================================");

  } finally {
    chrome.kill();
  }
}

run().catch(err => {
  console.error("Test failure:", err);
  process.exit(1);
});
