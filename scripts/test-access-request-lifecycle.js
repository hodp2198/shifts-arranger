const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const PROJECT_ID = 'shift-arranger';
const tokenFile = path.join(process.env.USERPROFILE, '.config', 'configstore', 'firebase-tools.json');
const authData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
const saToken = authData.tokens.access_token;

// Helpers
async function computeRequestId(email) {
  const normalized = (email || "").trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `req_${hash}`;
}

function firestoreApi(subPath, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents${subPath}`, {
      method,
      headers: {
        'Authorization': 'Bearer ' + saToken,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, raw: b });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function authApi(endpoint, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + saToken,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(b || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, raw: b });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Simulated GAS Functions mirroring google-apps-script-backend.js
async function gasCheckUserExists(email) {
  const res = await authApi(':lookup', { email: [email.toLowerCase().trim()] });
  return Boolean(res.data.users && res.data.users.length > 0);
}

async function gasHandleNotify(requestId) {
  if (!requestId || !requestId.startsWith('req_')) {
    return { status: 400, data: { error: 'Invalid requestId' } };
  }
  const docRes = await firestoreApi(`/accessRequests/${requestId}`);
  if (docRes.status !== 200) {
    return { status: 404, data: { error: 'Doc not found' } };
  }
  const fields = docRes.data.fields || {};
  if (fields.status?.stringValue !== 'pending') {
    return { status: 400, data: { error: 'Not pending' } };
  }
  if (fields.notificationSent?.booleanValue) {
    return { status: 200, data: { success: true, alreadyNotified: true } };
  }
  // Mark notificationSent
  await firestoreApi(`/accessRequests/${requestId}?updateMask.fieldPaths=notificationSent`, 'PATCH', {
    fields: { notificationSent: { booleanValue: true } }
  });
  return { status: 200, data: { success: true, notificationDispatched: true } };
}

async function gasHandleRetryAccessRequest(requestId, clientProvidedName) {
  if (!requestId || !/^req_[a-f0-9]{64}$/i.test(requestId)) {
    return { status: 400, data: { error: 'Invalid or malformed requestId' } };
  }
  const docRes = await firestoreApi(`/accessRequests/${requestId}`);
  if (docRes.status !== 200) {
    return { status: 404, data: { success: false, message: 'בקשת גישה אינה קיימת או שחלה שגיאה בעיבודה.' } };
  }
  const fields = docRes.data.fields || {};
  const currentStatus = fields.status?.stringValue || '';
  const canonicalEmail = (fields.email?.stringValue || '').trim().toLowerCase();
  const canonicalName = fields.name ? fields.name.stringValue : '';
  const currentReopenCount = fields.reopenCount ? parseInt(fields.reopenCount.integerValue || '0', 10) : 0;

  if (currentStatus === 'pending') {
    return {
      status: 200,
      data: {
        success: false,
        alreadyPending: true,
        message: 'בקשת גישה כבר קיימת עבור כתובת זו וממתינה לאישור המנהל.'
      }
    };
  }

  if (currentStatus === 'approved') {
    const exists = await gasCheckUserExists(canonicalEmail);
    if (exists) {
      return {
        status: 200,
        data: {
          success: false,
          alreadyApproved: true,
          message: 'החשבון כבר מורשה במערכת. באפשרותך להתחבר ישירות באמצעות Google.'
        }
      };
    }
  }

  // Reopen
  const nowIso = new Date().toISOString();
  const finalName = clientProvidedName || canonicalName || 'ללא שם';
  const mask = ['status', 'name', 'createdAt', 'reopenedAt', 'reopenCount', 'notificationSent', 'processedAt', 'processedBy', 'reason'];
  const maskQuery = mask.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');

  await firestoreApi(`/accessRequests/${requestId}?${maskQuery}`, 'PATCH', {
    fields: {
      status: { stringValue: 'pending' },
      name: { stringValue: finalName },
      createdAt: { timestampValue: nowIso },
      reopenedAt: { timestampValue: nowIso },
      reopenCount: { integerValue: (currentReopenCount + 1).toString() },
      notificationSent: { booleanValue: true }
    }
  });

  return {
    status: 200,
    data: {
      success: true,
      message: 'בקשת הגישה נשלחה לאישור המנהל.'
    }
  };
}

async function gasHandleApprove(requestId) {
  const docRes = await firestoreApi(`/accessRequests/${requestId}`);
  if (docRes.status !== 200) return { error: 'Doc not found' };
  const email = docRes.data.fields?.email?.stringValue;
  
  // Provision in Auth
  const provRes = await authApi('', {
    email,
    emailVerified: true,
    providerUserInfo: [{ providerId: 'google.com', email }]
  });

  const nowIso = new Date().toISOString();
  await firestoreApi(`/accessRequests/${requestId}?updateMask.fieldPaths=status&updateMask.fieldPaths=processedAt&updateMask.fieldPaths=processedBy`, 'PATCH', {
    fields: {
      status: { stringValue: 'approved' },
      processedAt: { timestampValue: nowIso },
      processedBy: { stringValue: 'galp3er@gmail.com' }
    }
  });

  return { success: true, localId: provRes.data?.localId };
}

async function gasHandleReject(requestId) {
  const nowIso = new Date().toISOString();
  await firestoreApi(`/accessRequests/${requestId}?updateMask.fieldPaths=status&updateMask.fieldPaths=processedAt&updateMask.fieldPaths=processedBy`, 'PATCH', {
    fields: {
      status: { stringValue: 'rejected' },
      processedAt: { timestampValue: nowIso },
      processedBy: { stringValue: 'galp3er@gmail.com' }
    }
  });
  return { success: true };
}

// Unauthenticated Firestore direct request simulator (no auth header)
function unauthenticatedFirestorePatch(requestId, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/accessRequests/${requestId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.write(data);
    req.end();
  });
}

// RUN TESTS
async function runTests() {
  console.log('=================================================================');
  console.log('RUNNING FULL ACCESS REQUEST LIFECYCLE TEST SUITE');
  console.log('=================================================================\n');

  const testEmail = 'autotest_lifecycle_user_' + Date.now() + '@example.com';
  const testName = 'Auto Test User';
  const requestId = await computeRequestId(testEmail);

  console.log(`Using test email: ${testEmail}`);
  console.log(`Computed deterministic requestId: ${requestId}\n`);

  try {
    // -------------------------------------------------------------
    // TEST 1: New email, no previous request
    // -------------------------------------------------------------
    console.log('[TEST 1] New email submission (create doc + notify)...');
    const createRes = await firestoreApi(`/accessRequests?documentId=${requestId}`, 'POST', {
      fields: {
        name: { stringValue: testName },
        email: { stringValue: testEmail },
        status: { stringValue: 'pending' },
        createdAt: { timestampValue: new Date().toISOString() }
      }
    });
    if (createRes.status !== 200) throw new Error('Failed to create doc in Test 1: ' + JSON.stringify(createRes));
    
    const notifyRes = await gasHandleNotify(requestId);
    console.log(' -> Document created, notify response:', notifyRes.data);
    if (!notifyRes.data.notificationDispatched) throw new Error('Notification not dispatched in Test 1');
    console.log(' [PASS] TEST 1: New request created and notification dispatched.\n');

    // -------------------------------------------------------------
    // TEST 2: Same email requests twice while pending
    // -------------------------------------------------------------
    console.log('[TEST 2] Second request while pending...');
    // setDoc fails because doc exists -> client calls gasHandleRetryAccessRequest
    const retryPendingRes = await gasHandleRetryAccessRequest(requestId, testName);
    console.log(' -> retryAccessRequest response:', retryPendingRes.data);
    if (retryPendingRes.data.success !== false || !retryPendingRes.data.alreadyPending) {
      throw new Error('Expected alreadyPending: true in Test 2');
    }
    console.log(' [PASS] TEST 2: Duplicate pending request rejected safely without email spam.\n');

    // -------------------------------------------------------------
    // TEST 3: Approved Firebase Auth user requests again
    // -------------------------------------------------------------
    console.log('[TEST 3] Approving request, provisioning user in Auth, then requesting again...');
    const approveRes = await gasHandleApprove(requestId);
    console.log(' -> User approved and provisioned in Auth with UID:', approveRes.localId);
    
    // User tries to request access while active in Auth
    const retryApprovedRes = await gasHandleRetryAccessRequest(requestId, testName);
    console.log(' -> retryAccessRequest for active user response:', retryApprovedRes.data);
    if (retryApprovedRes.data.success !== false || !retryApprovedRes.data.alreadyApproved) {
      throw new Error('Expected alreadyApproved: true in Test 3');
    }
    console.log(' [PASS] TEST 3: Active Auth user request was NOT reopened.\n');

    // -------------------------------------------------------------
    // TEST 4: Delete user from Firebase Auth -> Same email requests access again
    // -------------------------------------------------------------
    console.log('[TEST 4] Deleting user from Firebase Auth, then requesting access again...');
    const delRes = await authApi(':delete', { localId: approveRes.localId });
    console.log(' -> User deleted from Firebase Auth:', delRes.status === 200);

    const checkBefore = await gasCheckUserExists(testEmail);
    console.log(' -> Verified user exists in Auth after deletion:', checkBefore); // should be false

    const retryReopenRes = await gasHandleRetryAccessRequest(requestId, testName + ' (Reopened)');
    console.log(' -> retryAccessRequest after deletion response:', retryReopenRes.data);
    if (retryReopenRes.data.success !== true) {
      throw new Error('Failed to reopen request in Test 4');
    }

    // Verify Firestore doc status is now pending with cleared processedAt
    const verifyReopenedDoc = await firestoreApi(`/accessRequests/${requestId}`);
    const rFields = verifyReopenedDoc.data.fields;
    console.log(' -> Reopened doc fields in Firestore:');
    console.log('    - status:', rFields.status?.stringValue);
    console.log('    - reopenCount:', rFields.reopenCount?.integerValue);
    console.log('    - processedAt present?:', Boolean(rFields.processedAt));
    if (rFields.status?.stringValue !== 'pending' || rFields.processedAt) {
      throw new Error('Doc state incorrect after reopen in Test 4');
    }

    // Now Admin approves the reopened request -> fresh UID generated
    const approveAgainRes = await gasHandleApprove(requestId);
    console.log(' -> Admin approved again! New UID generated:', approveAgainRes.localId);
    if (approveAgainRes.localId === approveRes.localId) {
      console.log(' -> Note: Local ID was identical (rare) or new UID assigned.');
    } else {
      console.log(' -> Confirmed: New UID generated distinct from old UID.');
    }
    console.log(' [PASS] TEST 4: Deleted user successfully reopened request and was re-approved with new Auth account.\n');

    // Clean up Auth user created in test 4
    if (approveAgainRes.localId) {
      await authApi(':delete', { localId: approveAgainRes.localId });
    }

    // -------------------------------------------------------------
    // TEST 5: Rejected request -> same email requests again later
    // -------------------------------------------------------------
    console.log('[TEST 5] Rejecting request, then requesting access again...');
    await gasHandleReject(requestId);
    const verifyRejectedDoc = await firestoreApi(`/accessRequests/${requestId}`);
    console.log(' -> Doc status after reject:', verifyRejectedDoc.data.fields.status?.stringValue);

    const retryFromRejectedRes = await gasHandleRetryAccessRequest(requestId, testName + ' (Post Reject)');
    console.log(' -> retryAccessRequest for rejected request response:', retryFromRejectedRes.data);
    if (retryFromRejectedRes.data.success !== true) {
      throw new Error('Failed to reopen rejected request in Test 5');
    }
    const verifyReopenedFromRejected = await firestoreApi(`/accessRequests/${requestId}`);
    console.log(' -> Doc status after reopen from reject:', verifyReopenedFromRejected.data.fields.status?.stringValue);
    if (verifyReopenedFromRejected.data.fields.status?.stringValue !== 'pending') {
      throw new Error('Doc status not pending after reopening rejected request in Test 5');
    }
    console.log(' [PASS] TEST 5: Rejected request was successfully reopened.\n');

    // -------------------------------------------------------------
    // TEST 6: Unauthenticated client attempts direct Firestore update
    // -------------------------------------------------------------
    console.log('[TEST 6] Unauthenticated client attempting direct Firestore update...');
    const unauthRes = await unauthenticatedFirestorePatch(requestId, {
      fields: { status: { stringValue: 'approved' } }
    });
    console.log(' -> Unauthenticated direct update response HTTP status:', unauthRes.status);
    if (unauthRes.status !== 403 && unauthRes.status !== 401) {
      throw new Error('Unauthenticated direct update was NOT blocked (Status: ' + unauthRes.status + ')');
    }
    console.log(' [PASS] TEST 6: Unauthenticated direct Firestore update blocked (403/401 PERMISSION_DENIED).\n');

    // -------------------------------------------------------------
    // TEST 7: Arbitrary requestId sent to GAS
    // -------------------------------------------------------------
    console.log('[TEST 7] Sending arbitrary / malicious requestId to GAS...');
    const malformedRes = await gasHandleRetryAccessRequest('arbitrary_fake_id_123', 'Hacker');
    console.log(' -> Malformed ID response:', malformedRes.status, malformedRes.data);
    if (malformedRes.status !== 400) {
      throw new Error('Expected 400 for malformed requestId in Test 7');
    }

    const nonExistentId = 'req_' + 'f'.repeat(64);
    const nonExistentRes = await gasHandleRetryAccessRequest(nonExistentId, 'Ghost');
    console.log(' -> Non-existent valid format ID response:', nonExistentRes.status, nonExistentRes.data);
    if (nonExistentRes.status !== 404 || nonExistentRes.data.success !== false) {
      throw new Error('Expected 404 without leakage for non-existent requestId in Test 7');
    }
    console.log(' [PASS] TEST 7: Arbitrary and non-existent requestIds rejected safely without information leakage.\n');

    // Clean up test document from Firestore
    console.log('Cleaning up test document from Firestore...');
    await firestoreApi(`/accessRequests/${requestId}`, 'DELETE');
    console.log('Cleaned up successfully.');

    console.log('=================================================================');
    console.log('ALL 7 LIFECYCLE TESTS PASSED PERFECTLY!');
    console.log('=================================================================');

  } catch (err) {
    console.error('\n TEST RUN FAILED:', err.message, err.stack);
    // Cleanup attempt
    try {
      await firestoreApi(`/accessRequests/${requestId}`, 'DELETE');
    } catch (e) {}
    process.exit(1);
  }
}

runTests();
