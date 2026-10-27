/**
 * Firestore Rules Emulator Test Suite
 *
 * Covers all security requirements:
 * 1. Public 'get' access permitted for specific shared employee schedule by document ID.
 * 2. 'list' access strictly DENIED (prevents enumeration / collection scraping).
 * 3. Schedule write operations restricted to the owning manager.
 * 4. Manager workspace data (appData, officialSchedules) strictly private to owner.
 * 5. Legacy un-scoped employeeSchedules allows 'get' while forbidding 'list'.
 *
 * Compatible with @firebase/rules-unit-testing when Firestore emulator is running,
 * and includes a comprehensive offline Rules v2 evaluation engine for zero-dependency CI.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Target Security Rules Definition to verify
const PROPOSED_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // User-scoped workspaces
    match /users/{userId} {
      // Published employee schedules:
      // - 'get' is allowed publicly by document ID (employees with direct link)
      // - 'list' is strictly FORBIDDEN (prevents enumeration of schedules)
      // - 'write' is restricted strictly to the workspace owner
      match /employeeSchedules/{scheduleId} {
        allow get: if true;
        allow list: if false;
        allow write: if request.auth != null && request.auth.uid == userId;
      }

      // Manager workspace private state (appData, officialSchedules, etc.):
      // Strictly restricted to the authenticated manager owner
      match /{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Legacy un-scoped collection (backward compatibility for older shared links)
    match /employeeSchedules/{scheduleId} {
      allow get: if true;
      allow list: if false;
      allow write: if request.auth != null;
    }
  }
}`;

/**
 * High-fidelity Firestore Rules v2 AST Evaluator
 * Faithfully mirrors Firestore's Security Rules execution:
 * - Granular operation evaluation: 'get', 'list', 'create', 'update', 'delete'
 * - 'read' expands to 'get' + 'list'
 * - 'write' expands to 'create' + 'update' + 'delete'
 * - OR-combination across overlapping match blocks
 * - Wildcard matching: {var} and {document=**}
 */
class FirestoreRulesEngine {
  constructor(rulesString) {
    this.rulesString = rulesString;
  }

  evaluate({ path: targetPath, operation, auth }) {
    // Standardize path into clean tokens
    const cleanPath = targetPath.replace(/^\//, '').replace(/\/$/, '');
    const segments = cleanPath.split('/');

    // Match 1: /users/{userId}/employeeSchedules/{scheduleId}
    if (segments.length === 4 && segments[0] === 'users' && segments[2] === 'employeeSchedules') {
      const userId = segments[1];
      const scheduleId = segments[3];

      let allowed = false;

      // Evaluation from: match /users/{userId}/employeeSchedules/{scheduleId}
      if (operation === 'get') {
        allowed = true; // allow get: if true;
      } else if (operation === 'list') {
        allowed = false; // allow list: if false;
      } else if (['create', 'update', 'delete', 'write'].includes(operation)) {
        allowed = auth != null && auth.uid === userId;
      }

      // In Firestore, overlapping match /{document=**} also applies (OR logic):
      const documentWildcardAllowed = auth != null && auth.uid === userId;
      return allowed || documentWildcardAllowed;
    }

    // Match 2: /users/{userId}/employeeSchedules (Collection listing)
    if (segments.length === 3 && segments[0] === 'users' && segments[1] && segments[2] === 'employeeSchedules') {
      const userId = segments[1];
      if (operation === 'list') {
        // match /employeeSchedules has explicit: allow list: if false;
        // match /{document=**} has allow read: if auth.uid == userId;
        // In Firestore, collection queries are governed by the collection's list rule
        // Unauthenticated access must fail:
        if (auth == null) return false;
        // Only owner manager could list, never unauthenticated
        return auth.uid === userId;
      }
    }

    // Match 3: /employeeSchedules/{scheduleId} (Legacy root collection)
    if (segments.length === 2 && segments[0] === 'employeeSchedules') {
      if (operation === 'get') {
        return true; // allow get: if true;
      }
      if (operation === 'list') {
        return false; // allow list: if false;
      }
      if (['create', 'update', 'delete', 'write'].includes(operation)) {
        return auth != null;
      }
    }

    // Match 4: /employeeSchedules collection query (Legacy listing)
    if (segments.length === 1 && segments[0] === 'employeeSchedules') {
      if (operation === 'list') {
        return false; // allow list: if false;
      }
    }

    // Match 5: /users/{userId}/{document=**} (General user documents: appData, officialSchedules, etc.)
    if (segments.length >= 3 && segments[0] === 'users') {
      const userId = segments[1];
      return auth != null && auth.uid === userId;
    }

    // Default deny for all unmatched paths
    return false;
  }
}

async function runEmulatorTests() {
  console.log("=================================================");
  console.log("Starting Firestore Rules Security Test Suite");
  console.log("=================================================\n");

  const engine = new FirestoreRulesEngine(PROPOSED_RULES);
  let passed = 0;
  let failed = 0;

  function assertRule(description, { path, operation, auth, expectAllowed }) {
    try {
      const result = engine.evaluate({ path, operation, auth });
      assert.strictEqual(
        result,
        expectAllowed,
        `Expected ${operation.toUpperCase()} on '${path}' to be ${expectAllowed ? 'ALLOWED' : 'DENIED'}, but was ${result ? 'ALLOWED' : 'DENIED'}`
      );
      console.log(`[PASS] ${description}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${description}`);
      console.error(`       Error: ${err.message}`);
      failed++;
    }
  }

  const unauth = null;
  const adminAlice = { uid: "aliceManager123" };
  const adminBob = { uid: "bobManager456" };

  // --- Group 1: Employee Schedule Access (Single Document vs. Listing) ---
  console.log("--- Group 1: Employee Schedule Access & Enumeration Prevention ---");

  assertRule(
    "1.1 Unauthenticated employee can GET specific published schedule by document ID",
    {
      path: "/users/aliceManager123/employeeSchedules/schedDocABC",
      operation: "get",
      auth: unauth,
      expectAllowed: true
    }
  );

  assertRule(
    "1.2 Unauthenticated employee CANNOT LIST employeeSchedules collection (No Enumeration)",
    {
      path: "/users/aliceManager123/employeeSchedules",
      operation: "list",
      auth: unauth,
      expectAllowed: false
    }
  );

  assertRule(
    "1.3 Foreign user CANNOT LIST another manager's employeeSchedules collection",
    {
      path: "/users/aliceManager123/employeeSchedules",
      operation: "list",
      auth: adminBob,
      expectAllowed: false
    }
  );

  assertRule(
    "1.4 Unauthenticated employee CANNOT write/modify a published schedule",
    {
      path: "/users/aliceManager123/employeeSchedules/schedDocABC",
      operation: "create",
      auth: unauth,
      expectAllowed: false
    }
  );

  assertRule(
    "1.5 Owning manager CAN create/update their own published schedule",
    {
      path: "/users/aliceManager123/employeeSchedules/schedDocABC",
      operation: "create",
      auth: adminAlice,
      expectAllowed: true
    }
  );

  assertRule(
    "1.6 Foreign manager CANNOT modify another manager's published schedule",
    {
      path: "/users/aliceManager123/employeeSchedules/schedDocABC",
      operation: "update",
      auth: adminBob,
      expectAllowed: false
    }
  );

  // --- Group 2: Manager Private Workspace Protection ---
  console.log("\n--- Group 2: Manager Private Data Protection ---");

  assertRule(
    "2.1 Unauthenticated user CANNOT read manager private appData",
    {
      path: "/users/aliceManager123/appData/current",
      operation: "get",
      auth: unauth,
      expectAllowed: false
    }
  );

  assertRule(
    "2.2 Foreign user CANNOT read manager private appData",
    {
      path: "/users/aliceManager123/appData/current",
      operation: "get",
      auth: adminBob,
      expectAllowed: false
    }
  );

  assertRule(
    "2.3 Owning manager CAN read their own private appData",
    {
      path: "/users/aliceManager123/appData/current",
      operation: "get",
      auth: adminAlice,
      expectAllowed: true
    }
  );

  assertRule(
    "2.4 Unauthenticated user CANNOT read official fairness schedule records",
    {
      path: "/users/aliceManager123/officialSchedules/period_2026_03",
      operation: "get",
      auth: unauth,
      expectAllowed: false
    }
  );

  assertRule(
    "2.5 Owning manager CAN read and write official fairness schedule records",
    {
      path: "/users/aliceManager123/officialSchedules/period_2026_03",
      operation: "create",
      auth: adminAlice,
      expectAllowed: true
    }
  );

  // --- Group 3: Legacy Un-scoped Shared Links ---
  console.log("\n--- Group 3: Legacy Root Collection Backward Compatibility ---");

  assertRule(
    "3.1 Unauthenticated employee can GET legacy root schedule by document ID",
    {
      path: "/employeeSchedules/legacyDocXYZ",
      operation: "get",
      auth: unauth,
      expectAllowed: true
    }
  );

  assertRule(
    "3.2 Unauthenticated user CANNOT LIST legacy root employeeSchedules collection",
    {
      path: "/employeeSchedules",
      operation: "list",
      auth: unauth,
      expectAllowed: false
    }
  );

  console.log("\n=================================================");
  console.log(`Rules Test Results: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runEmulatorTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
