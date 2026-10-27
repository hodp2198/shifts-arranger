/**
 * Official Google Cloud Firestore Emulator Test Suite
 *
 * Runs the official Google Cloud Firestore Emulator (cloud-firestore-emulator.jar)
 * and verifies real runtime behavior against firestore.rules:
 *
 * 1. Single document read (get) on published schedule: ALLOWED for unauthenticated employees.
 * 2. Collection listing (list) on employeeSchedules: STRICTLY DENIED (prevents enumeration).
 * 3. Manager workspace data (appData, officialSchedules): STRICTLY DENIED for unauthenticated & foreign users.
 * 4. Manager write operations: ALLOWED only for the authenticated owner.
 * 5. Legacy root collection: Single document get ALLOWED, collection list DENIED.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const EMULATOR_PORT = 8088;
const PROJECT_ID = 'shift-arranger';
const EMULATOR_JAR = 'C:\\Users\\hodp2\\.cache\\firebase\\emulators\\cloud-firestore-emulator-v1.19.8.jar';
const RULES_PATH = path.resolve(__dirname, '../firestore.rules');

// Locate Java binary
function findJava() {
  const jreDir = 'C:\\Users\\hodp2\\.jre';
  if (fs.existsSync(jreDir)) {
    const files = fs.readdirSync(jreDir, { recursive: true });
    for (const f of files) {
      if (f.endsWith('java.exe')) {
        return path.join(jreDir, f);
      }
    }
  }
  return 'java';
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Generate JWT for emulator testing
function createEmulatorToken(uid) {
  // The Firebase Emulator accepts unsigned mock JWTs or headers with {"user_id": uid}
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    user_id: uid,
    sub: uid,
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    auth_time: Math.floor(Date.now() / 1000)
  })).toString('base64url');
  return `Bearer ${header}.${payload}.`;
}

async function runEmulatorTests() {
  console.log("=================================================");
  console.log("Official Google Cloud Firestore Emulator Testing");
  console.log("=================================================\n");

  const javaBin = findJava();
  console.log(`Using Java: ${javaBin}`);
  console.log(`Using Rules: ${RULES_PATH}`);
  console.log(`Using Emulator JAR: ${EMULATOR_JAR}`);

  // 1. Spawn Firestore Emulator
  const emulatorProcess = spawn(javaBin, [
    '-jar', EMULATOR_JAR,
    '--host', '127.0.0.1',
    '--port', String(EMULATOR_PORT),
    '--rules', RULES_PATH
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  emulatorProcess.stderr.on('data', (d) => {
    // console.error(`[Emulator stderr] ${d}`);
  });

  // 2. Wait for emulator to start
  console.log(`Waiting for Firestore Emulator on port ${EMULATOR_PORT}...`);
  let isReady = false;
  for (let i = 0; i < 40; i++) {
    await wait(500);
    try {
      const res = await fetch(`http://127.0.0.1:${EMULATOR_PORT}/`);
      if (res.status === 200 || res.status === 404) {
        isReady = true;
        break;
      }
    } catch (_) {}
  }

  if (!isReady) {
    emulatorProcess.kill();
    throw new Error("Firestore Emulator failed to start in time.");
  }

  console.log("Firestore Emulator is running and rules are compiled successfully!\n");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(`       ${err.message}`);
      failed++;
    }
  }

  try {
    const baseUrl = `http://127.0.0.1:${EMULATOR_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
    const aliceUid = 'aliceManager123';
    const bobUid = 'bobManager456';
    const aliceToken = createEmulatorToken(aliceUid);
    const bobToken = createEmulatorToken(bobUid);

    // --- SETUP: Create test documents using authenticated Alice ---
    console.log("Setting up test documents via authenticated manager Alice...");

    // 1. Create published employee schedule under Alice
    await fetch(`${baseUrl}/users/${aliceUid}/employeeSchedules/schedDocABC`, {
      method: 'PATCH',
      headers: {
        'Authorization': aliceToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          payload: { stringValue: '{"v":2,"employees":["Gal","Hod"]}' },
          version: { integerValue: "1" }
        }
      })
    });

    // 2. Create private manager appData under Alice
    await fetch(`${baseUrl}/users/${aliceUid}/appData/current`, {
      method: 'PATCH',
      headers: {
        'Authorization': aliceToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          draftSchedule: { stringValue: 'private manager data' }
        }
      })
    });

    // 3. Create private official schedule under Alice
    await fetch(`${baseUrl}/users/${aliceUid}/officialSchedules/period_2026_03`, {
      method: 'PATCH',
      headers: {
        'Authorization': aliceToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          officialRecord: { stringValue: 'private fairness data' }
        }
      })
    });

    // 4. Create legacy root employee schedule
    await fetch(`${baseUrl}/employeeSchedules/legacyDocXYZ`, {
      method: 'PATCH',
      headers: {
        'Authorization': aliceToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          payload: { stringValue: '{"v":2,"legacy":true}' }
        }
      })
    });

    console.log("Setup complete. Running live security tests against emulator...\n");

    // =========================================================
    // Test Group 1: Employee Schedule Access & Enumeration Prevention
    // =========================================================
    console.log("--- Group 1: Employee Schedule Access & Enumeration Prevention ---");

    await test("1.1 Unauthenticated employee can GET specific published schedule by document ID", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/employeeSchedules/schedDocABC`);
      assert.strictEqual(res.status, 200, `Expected 200 OK, got ${res.status}`);
      const data = await res.json();
      assert(data.fields?.payload?.stringValue, "Must return payload field");
    });

    await test("1.2 Unauthenticated employee CANNOT LIST employeeSchedules collection (No Enumeration)", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/employeeSchedules`);
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden for collection list, got ${res.status}`);
      const data = await res.json();
      assert.strictEqual(data.error?.status, "PERMISSION_DENIED");
    });

    await test("1.3 Foreign user CANNOT LIST another manager's employeeSchedules collection", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/employeeSchedules`, {
        headers: { 'Authorization': bobToken }
      });
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden for foreign manager list, got ${res.status}`);
      const data = await res.json();
      assert.strictEqual(data.error?.status, "PERMISSION_DENIED");
    });

    await test("1.4 Unauthenticated user CANNOT create/modify a published schedule", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/employeeSchedules/unauthDoc`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { hack: { stringValue: "bad" } } })
      });
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden for unauth write, got ${res.status}`);
    });

    await test("1.5 Foreign manager CANNOT modify another manager's published schedule", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/employeeSchedules/schedDocABC`, {
        method: 'PATCH',
        headers: {
          'Authorization': bobToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: { hack: { stringValue: "bad" } } })
      });
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden for foreign manager write, got ${res.status}`);
    });

    // =========================================================
    // Test Group 2: Manager Private Workspace Protection
    // =========================================================
    console.log("\n--- Group 2: Manager Private Data Protection ---");

    await test("2.1 Unauthenticated user CANNOT read manager private appData", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/appData/current`);
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
      const data = await res.json();
      assert.strictEqual(data.error?.status, "PERMISSION_DENIED");
    });

    await test("2.2 Foreign user CANNOT read manager private appData", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/appData/current`, {
        headers: { 'Authorization': bobToken }
      });
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden for foreign user, got ${res.status}`);
      const data = await res.json();
      assert.strictEqual(data.error?.status, "PERMISSION_DENIED");
    });

    await test("2.3 Owning manager CAN read their own private appData", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/appData/current`, {
        headers: { 'Authorization': aliceToken }
      });
      assert.strictEqual(res.status, 200, `Expected 200 OK for owner, got ${res.status}`);
    });

    await test("2.4 Unauthenticated user CANNOT read official fairness records", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/officialSchedules/period_2026_03`);
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden for official schedule, got ${res.status}`);
    });

    await test("2.5 Owning manager CAN read official fairness records", async () => {
      const res = await fetch(`${baseUrl}/users/${aliceUid}/officialSchedules/period_2026_03`, {
        headers: { 'Authorization': aliceToken }
      });
      assert.strictEqual(res.status, 200, `Expected 200 OK for official schedule owner, got ${res.status}`);
    });

    // =========================================================
    // Test Group 3: Legacy Un-scoped Shared Links
    // =========================================================
    console.log("\n--- Group 3: Legacy Root Collection Backward Compatibility ---");

    await test("3.1 Unauthenticated employee can GET legacy root schedule by document ID", async () => {
      const res = await fetch(`${baseUrl}/employeeSchedules/legacyDocXYZ`);
      assert.strictEqual(res.status, 200, `Expected 200 OK for legacy doc get, got ${res.status}`);
      const data = await res.json();
      assert(data.fields?.payload?.stringValue, "Must return payload field");
    });

    await test("3.2 Unauthenticated user CANNOT LIST legacy root employeeSchedules collection", async () => {
      const res = await fetch(`${baseUrl}/employeeSchedules`);
      assert.strictEqual(res.status, 403, `Expected 403 Forbidden for legacy collection list, got ${res.status}`);
      const data = await res.json();
      assert.strictEqual(data.error?.status, "PERMISSION_DENIED");
    });

  } finally {
    // 3. Gracefully stop emulator
    console.log("\nStopping Firestore Emulator...");
    emulatorProcess.kill();
  }

  console.log("\n=================================================");
  console.log(`Official Emulator Results: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runEmulatorTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
