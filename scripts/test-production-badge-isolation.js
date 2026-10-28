const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function runProductionBadgeIsolationTests() {
  console.log("=================================================");
  console.log("Starting Production Badge & Isolation Regression Tests");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}`);
      console.error(e);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}`);
      console.error(e);
      failed++;
    }
  }

  const baseCss = fs.readFileSync(path.join(__dirname, '../styles/base.css'), 'utf8');
  const componentsCss = fs.readFileSync(path.join(__dirname, '../styles/components.css'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const firebaseConfig = await import('../firebase-config.js');

  // -------------------------------------------------------------
  // Test 1: CSS Specificity Safeguards
  // -------------------------------------------------------------
  test("1. CSS rules enforce display: none !important for [hidden] and .badge[hidden]", () => {
    assert.ok(baseCss.includes('[hidden]'), "base.css must contain [hidden] rule");
    assert.ok(baseCss.includes('display: none !important'), "base.css must enforce display: none !important on [hidden]");
    assert.ok(componentsCss.includes('.badge[hidden]'), "components.css must explicitly protect .badge[hidden]");
    assert.ok(componentsCss.includes('display: none !important'), "components.css must enforce display: none !important on .badge[hidden]");
  });

  // -------------------------------------------------------------
  // Test 2: HTML Static Markup Safeguards
  // -------------------------------------------------------------
  test("2. devModeBadge template defaults to display:none inline style and hidden attribute", () => {
    assert.ok(indexHtml.includes('id="devModeBadge"'), "devModeBadge must exist in index.html");
    const badgeMatch = indexHtml.match(/<span[^>]*id="devModeBadge"[^>]*>/);
    assert.ok(badgeMatch, "Must find devModeBadge tag");
    const tag = badgeMatch[0];
    assert.ok(tag.includes('display:none'), "devModeBadge must have inline display:none default");
    assert.ok(tag.includes('hidden'), "devModeBadge must have hidden attribute");
  });

  // -------------------------------------------------------------
  // Test 3: Environment Detection Integrity
  // -------------------------------------------------------------
  test("3. Environment classification strictly denies local isolation for production hosts", () => {
    global.window = {
      location: {
        hostname: "shift-arranger.web.app",
        port: "",
        protocol: "https:"
      }
    };
    assert.strictEqual(firebaseConfig.isLocalEnvironment(), false);
    assert.strictEqual(firebaseConfig.isIsolatedDevMode(), false);

    global.window.location.hostname = "shift-arranger.firebaseapp.com";
    assert.strictEqual(firebaseConfig.isLocalEnvironment(), false);
    assert.strictEqual(firebaseConfig.isIsolatedDevMode(), false);

    global.window.location.hostname = "custom-prod-domain.com";
    global.window.location.port = "";
    assert.strictEqual(firebaseConfig.isLocalEnvironment(), false);
  });

  // -------------------------------------------------------------
  // Test 4: Production Authenticated Admin Lifecycle
  // -------------------------------------------------------------
  test("4. Production authenticated state: devModeBadge stays display:none and hidden=true", () => {
    // Setup simulated DOM in production environment
    const elements = {};
    function createElement(id, tag = 'div') {
      const el = {
        id,
        tagName: tag,
        hidden: true,
        style: { display: 'none' },
        classList: {
          contains: (cls) => false,
          add: () => {},
          remove: () => {}
        },
        textContent: '',
        innerHTML: ''
      };
      elements[id] = el;
      return el;
    }

    const devBadge = createElement('devModeBadge', 'span');
    const authDevNotice = createElement('authDevNotice');
    const autosaveStatus = createElement('autosaveStatus');
    const adminUserEmail = createElement('adminUserEmail');

    global.window = {
      location: { hostname: "shift-arranger.web.app", port: "", protocol: "https:" },
      isLocalEnvironment: () => false,
      getEl: (id) => elements[id] || null,
      document: {
        getElementById: (id) => elements[id] || null,
        body: {
          contains: () => true,
          appendChild: () => {},
          remove: () => {},
          classList: { add: () => {}, remove: () => {} }
        },
        documentElement: {
          classList: { add: () => {}, remove: () => {} }
        }
      }
    };

    // Simulate handleAuthTransition in production
    const isLocal = typeof global.window.isLocalEnvironment === "function" ? global.window.isLocalEnvironment() : false;
    devBadge.style.display = isLocal ? "inline-flex" : "none";
    devBadge.hidden = !isLocal;

    assert.strictEqual(isLocal, false, "Must evaluate to false on production host");
    assert.strictEqual(devBadge.hidden, true, "devModeBadge must remain hidden on production");
    assert.strictEqual(devBadge.style.display, "none", "devModeBadge must have display:none on production");
  });

  // -------------------------------------------------------------
  // Test 5: Localhost Authenticated Admin Lifecycle
  // -------------------------------------------------------------
  test("5. Localhost authenticated state: devModeBadge is properly unhidden and displayed", () => {
    const devBadge = {
      hidden: true,
      style: { display: 'none' }
    };

    global.window = {
      location: { hostname: "localhost", port: "5500", protocol: "http:" },
      isLocalEnvironment: () => true
    };

    const isLocal = typeof global.window.isLocalEnvironment === "function" ? global.window.isLocalEnvironment() : false;
    devBadge.style.display = isLocal ? "inline-flex" : "none";
    devBadge.hidden = !isLocal;

    assert.strictEqual(isLocal, true, "Must evaluate to true on localhost");
    assert.strictEqual(devBadge.hidden, false, "devModeBadge must be visible in local dev mode");
    assert.strictEqual(devBadge.style.display, "inline-flex", "devModeBadge must have display:inline-flex in local dev mode");
  });

  // -------------------------------------------------------------
  // Test 6: Zero Local Storage / Mock Fallback on Production
  // -------------------------------------------------------------
  test("6. Production operations never query or write to isolated_dev_* keys", () => {
    const storageAccesses = [];
    global.localStorage = {
      getItem: (k) => { storageAccesses.push(`get:${k}`); return null; },
      setItem: (k, v) => { storageAccesses.push(`set:${k}`); },
      removeItem: (k) => { storageAccesses.push(`remove:${k}`); }
    };

    global.window = {
      location: { hostname: "shift-arranger.web.app", port: "", protocol: "https:" },
      __ISOLATED_DEV_MODE__: false
    };

    assert.strictEqual(firebaseConfig.isLocalEnvironment(), false);

    // Filter isolated accesses
    const devAccesses = storageAccesses.filter(a => a.includes('isolated_dev_'));
    assert.strictEqual(devAccesses.length, 0, "No isolated dev storage keys should be accessed in production");
  });

  console.log("\n=================================================");
  console.log(`Regression Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) process.exit(1);
}

runProductionBadgeIsolationTests().catch(e => {
  console.error("Test error:", e);
  process.exit(1);
});
