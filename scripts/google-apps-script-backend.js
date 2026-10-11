/**
 * =========================================================================
 * Shift Arranger - Production Google Apps Script Backend
 * =========================================================================
 * 
 * Includes:
 * 1. Safe Token Metadata & Diagnostic Logging
 * 2. Official Identity Toolkit Token Verification (accounts:lookup)
 * 3. Canonical Firestore Document Retrieval & Mutation
 * 4. User Provisioning via Identity Toolkit API
 * 5. Notification & Welcome Email Delivery via MailApp
 * =========================================================================
 */

const CONFIG = {
  PROJECT_ID: 'shift-arranger',
  ADMIN_EMAIL: 'galp3er@gmail.com',
  MAX_NOTIFICATIONS_PER_HOUR: 20
};

/**
 * Main HTTP POST Router
 */
function doPost(e) {
  console.log('--- [doPost] Incoming Request Received ---');
  try {
    const rawContent = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    console.log('[doPost] Raw payload length:', rawContent.length);

    const payload = JSON.parse(rawContent || '{}');
    const action = payload.action;
    console.log('[doPost] Action:', action);

    let result;
    if (action === 'notify') {
      result = handleNotify(payload);
    } else if (action === 'retryAccessRequest') {
      result = handleRetryAccessRequest(payload);
    } else if (action === 'approve') {
      result = handleApprove(payload);
    } else if (action === 'reject') {
      result = handleReject(payload);
    } else {
      console.warn('[doPost] Unknown action requested:', action);
      result = jsonResponse({ error: 'Unknown action: ' + action }, 400);
    }

    console.log('--- [doPost] Execution Completed Successfully ---');
    return result;
  } catch (err) {
    console.error('--- [doPost] FATAL ERROR ---:', err.message, err.stack);
    return jsonResponse({ error: err.message || 'Internal server error' }, 500);
  }
}

/**
 * Health check endpoint
 */
function doGet(e) {
  console.log('[doGet] Health check ping received');
  return ContentService.createTextOutput('Shift Arranger Backend is active and operational.')
    .setMimeType(ContentService.MimeType.TEXT);
}

// =========================================================================
// 1. NOTIFICATION HANDLER
// =========================================================================
function handleNotify(payload) {
  console.log('[handleNotify] Processing notify request...');
  const requestId = payload.requestId;
  console.log('[handleNotify] RequestId received:', requestId);

  if (!requestId || typeof requestId !== 'string' || !requestId.startsWith('req_')) {
    console.error('[handleNotify] Invalid or missing requestId format:', requestId);
    return jsonResponse({ error: 'Invalid or missing requestId' }, 400);
  }

  // 1. Rate-limit check in CacheService
  const cache = CacheService.getScriptCache();
  const hourlyCountKey = 'notif_count_' + new Date().getUTCHours();
  const currentCount = parseInt(cache.get(hourlyCountKey) || '0', 10);
  console.log('[handleNotify] Current hourly notification count:', currentCount);

  if (currentCount >= CONFIG.MAX_NOTIFICATIONS_PER_HOUR) {
    console.warn('[handleNotify] Hourly notification limit reached, skipping email alert.');
    return jsonResponse({ success: true, rateLimited: true });
  }

  // 2. Fetch canonical document from Firestore
  console.log('[handleNotify] Fetching Firestore document for:', requestId);
  const doc = getFirestoreDoc(requestId);
  if (!doc) {
    console.error('[handleNotify] Document not found in Firestore for ID:', requestId);
    return jsonResponse({ error: 'Request document not found in Firestore' }, 404);
  }

  const fields = doc.fields || {};
  const status = fields.status ? fields.status.stringValue : '';
  const name = fields.name ? fields.name.stringValue : 'ללא שם';
  const email = fields.email ? fields.email.stringValue : '';
  const notificationSent = fields.notificationSent ? fields.notificationSent.booleanValue : false;

  console.log('[handleNotify] Document parsed successfully:');
  console.log(' - Name:', name);
  console.log(' - Email:', email);
  console.log(' - Status:', status);
  console.log(' - NotificationSent:', notificationSent);

  // 3. Validation: Must be pending and not previously notified
  if (status !== 'pending') {
    console.warn('[handleNotify] Document is not in pending status. Status:', status);
    return jsonResponse({ error: 'Request is not in pending status' }, 400);
  }

  if (notificationSent) {
    console.log('[handleNotify] Notification already marked as sent. Skipping duplicate email.');
    return jsonResponse({ success: true, alreadyNotified: true });
  }

  // 4. Send email notification to Admin
  const adminEmail = getScriptProp('ADMIN_EMAIL', CONFIG.ADMIN_EMAIL);
  console.log('[handleNotify] Sending notification email to admin:', adminEmail);

  const subject = `בקשת גישה חדשה למערכת סידור המשמרות: ${name}`;
  const htmlBody = `
    <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
      <h2 style="color: #1a365d; margin-top: 0;">בקשת גישה חדשה למערכת סידור המשמרות</h2>
      <p style="color: #4a5568; font-size: 15px;">הוגשה בקשת גישה חדשה למערכת:</p>
      
      <div style="background: #f7fafc; border-radius: 8px; padding: 16px; margin: 20px 0; border: 1px solid #edf2f7;">
        <p style="margin: 6px 0; font-size: 15px;"><strong>שם:</strong> ${escapeHtml(name)}</p>
        <p style="margin: 6px 0; font-size: 15px;"><strong>אימייל:</strong> ${escapeHtml(email)}</p>
        <p style="margin: 6px 0; font-size: 15px;"><strong>תאריך:</strong> ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</p>
      </div>

      <p style="color: #4a5568; font-size: 14px;">לאישור או דחיית הבקשה, היכנס לסידור המשמרות כמנהל:</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="https://shift-arranger.web.app" style="background: #0071e3; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">פתח את סידור המשמרות</a>
      </div>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="color: #a0aec0; font-size: 12px; margin: 0; text-align: center;">הודעה אוטומטית ממערכת סידור המשמרות</p>
    </div>
  `;

  try {
    MailApp.sendEmail({
      to: adminEmail,
      subject: subject,
      htmlBody: htmlBody
    });
    console.log('[handleNotify] MailApp.sendEmail executed successfully.');
  } catch (mailErr) {
    console.error('[handleNotify] MailApp.sendEmail FAILED:', mailErr.message, mailErr.stack);
    throw mailErr;
  }

  // 5. Update Firestore document setting notificationSent = true
  console.log('[handleNotify] Updating Firestore document notificationSent=true for:', requestId);
  updateFirestoreDoc(requestId, {
    notificationSent: { booleanValue: true }
  }, ['notificationSent']);
  console.log('[handleNotify] Firestore update completed.');

  cache.put(hourlyCountKey, (currentCount + 1).toString(), 3600);
  return jsonResponse({ success: true, message: 'Notification sent successfully' });
}

// =========================================================================
// 1.1 RETRY / REOPEN ACCESS REQUEST HANDLER
// =========================================================================
function handleRetryAccessRequest(payload) {
  console.log('[handleRetryAccessRequest] Processing retryAccessRequest...');
  const requestId = payload.requestId;
  const clientProvidedName = (payload.name && typeof payload.name === 'string') ? payload.name.trim() : '';

  console.log('[handleRetryAccessRequest] RequestId received:', requestId);

  // 1. Strict validation of requestId structure: must be req_<64 hex chars>
  if (!requestId || typeof requestId !== 'string' || !/^req_[a-f0-9]{64}$/i.test(requestId)) {
    console.error('[handleRetryAccessRequest] Invalid requestId format:', requestId);
    return jsonResponse({ error: 'Invalid or malformed requestId' }, 400);
  }

  // 2. Fetch canonical document from Firestore
  console.log('[handleRetryAccessRequest] Fetching Firestore document for:', requestId);
  const doc = getFirestoreDoc(requestId);
  if (!doc) {
    console.warn('[handleRetryAccessRequest] Document not found in Firestore for ID:', requestId);
    return jsonResponse({
      success: false,
      message: 'בקשת גישה אינה קיימת או שחלה שגיאה בעיבודה.'
    }, 404);
  }

  const fields = doc.fields || {};
  const currentStatus = fields.status ? fields.status.stringValue : '';
  const canonicalEmail = (fields.email ? fields.email.stringValue : '').trim().toLowerCase();
  const canonicalName = fields.name ? fields.name.stringValue : '';
  const currentReopenCount = fields.reopenCount ? parseInt(fields.reopenCount.integerValue || '0', 10) : 0;

  console.log('[handleRetryAccessRequest] Canonical document parsed:');
  console.log(' - Email:', canonicalEmail);
  console.log(' - Current Status:', currentStatus);
  console.log(' - Reopen Count:', currentReopenCount);

  if (!canonicalEmail || !canonicalEmail.includes('@')) {
    console.error('[handleRetryAccessRequest] Canonical email missing or corrupt in doc:', canonicalEmail);
    return jsonResponse({ error: 'Corrupt email in canonical request record' }, 500);
  }

  // 3. Evaluate Request Status
  // Case A: Already in pending status
  if (currentStatus === 'pending') {
    console.log('[handleRetryAccessRequest] Request is already pending. No changes made.');
    return jsonResponse({
      success: false,
      alreadyPending: true,
      message: 'בקשת גישה כבר קיימת עבור כתובת זו וממתינה לאישור המנהל.'
    });
  }

  // Case B: Request was approved - check if user currently exists in Firebase Authentication
  if (currentStatus === 'approved') {
    console.log('[handleRetryAccessRequest] Checking if approved user still exists in Firebase Auth...');
    const userExistsInAuth = checkFirebaseAuthUserExists(canonicalEmail);
    console.log('[handleRetryAccessRequest] User exists in Firebase Auth:', userExistsInAuth);

    if (userExistsInAuth) {
      console.log('[handleRetryAccessRequest] User is actively provisioned in Auth. Not reopening.');
      return jsonResponse({
        success: false,
        alreadyApproved: true,
        message: 'החשבון כבר מורשה במערכת. באפשרותך להתחבר ישירות באמצעות Google.'
      });
    }

    console.log('[handleRetryAccessRequest] User was deleted from Firebase Auth! Proceeding to reopen request...');
  } else if (currentStatus === 'rejected') {
    console.log('[handleRetryAccessRequest] Request was previously rejected. Proceeding to reopen request...');
  } else {
    // Unknown or other status
    console.log('[handleRetryAccessRequest] Unknown status (' + currentStatus + '). Checking Auth before reopen...');
    const userExists = checkFirebaseAuthUserExists(canonicalEmail);
    if (userExists) {
      return jsonResponse({
        success: false,
        alreadyApproved: true,
        message: 'החשבון כבר מורשה במערכת. באפשרותך להתחבר ישירות באמצעות Google.'
      });
    }
  }

  // 4. Rate-limit check in CacheService for notification delivery
  const cache = CacheService.getScriptCache();
  const hourlyCountKey = 'notif_count_' + new Date().getUTCHours();
  const currentCount = parseInt(cache.get(hourlyCountKey) || '0', 10);
  const isRateLimited = currentCount >= CONFIG.MAX_NOTIFICATIONS_PER_HOUR;

  // 5. Reopen the request in Firestore
  const nowIso = new Date().toISOString();
  const finalName = clientProvidedName || canonicalName || 'ללא שם';
  const newReopenCount = currentReopenCount + 1;

  console.log('[handleRetryAccessRequest] Updating Firestore document back to pending...');
  const updatedFields = {
    status: { stringValue: 'pending' },
    name: { stringValue: finalName },
    createdAt: { timestampValue: nowIso },
    reopenedAt: { timestampValue: nowIso },
    reopenCount: { integerValue: newReopenCount.toString() },
    notificationSent: { booleanValue: !isRateLimited }
  };

  const fieldMask = [
    'status',
    'name',
    'createdAt',
    'reopenedAt',
    'reopenCount',
    'notificationSent',
    'processedAt',
    'processedBy',
    'reason'
  ];

  updateFirestoreDoc(requestId, updatedFields, fieldMask);
  console.log('[handleRetryAccessRequest] Firestore request reopened successfully.');

  // 6. Send notification email to Admin (if not rate limited)
  if (!isRateLimited) {
    const adminEmail = getScriptProp('ADMIN_EMAIL', CONFIG.ADMIN_EMAIL);
    console.log('[handleRetryAccessRequest] Sending notification email to admin:', adminEmail);

    const subject = `בקשת גישה מחודשת למערכת סידור המשמרות: ${finalName}`;
    const htmlBody = `
      <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <h2 style="color: #1a365d; margin-top: 0;">בקשת גישה מחודשת למערכת סידור המשמרות</h2>
        <p style="color: #4a5568; font-size: 15px;">הוגשה בקשת גישה מחודשת עבור כתובת שהייתה רשומה בעבר:</p>
        
        <div style="background: #f7fafc; border-radius: 8px; padding: 16px; margin: 20px 0; border: 1px solid #edf2f7;">
          <p style="margin: 6px 0; font-size: 15px;"><strong>שם:</strong> ${escapeHtml(finalName)}</p>
          <p style="margin: 6px 0; font-size: 15px;"><strong>אימייל:</strong> ${escapeHtml(canonicalEmail)}</p>
          <p style="margin: 6px 0; font-size: 15px;"><strong>סטטוס קודם:</strong> ${escapeHtml(currentStatus)}</p>
          <p style="margin: 6px 0; font-size: 15px;"><strong>תאריך הגשה חוזרת:</strong> ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}</p>
        </div>

        <p style="color: #4a5568; font-size: 14px;">לאישור או דחיית הבקשה, היכנס לסידור המשמרות כמנהל:</p>
        <div style="text-align: center; margin: 24px 0;">
          <a href="https://shift-arranger.web.app" style="background: #0071e3; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">פתח את סידור המשמרות</a>
        </div>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #a0aec0; font-size: 12px; margin: 0; text-align: center;">הודעה אוטומטית ממערכת סידור המשמרות</p>
      </div>
    `;

    try {
      MailApp.sendEmail({
        to: adminEmail,
        subject: subject,
        htmlBody: htmlBody
      });
      console.log('[handleRetryAccessRequest] Notification email dispatched successfully.');
    } catch (mailErr) {
      console.error('[handleRetryAccessRequest] MailApp.sendEmail failed:', mailErr.message);
    }

    cache.put(hourlyCountKey, (currentCount + 1).toString(), 3600);
  } else {
    console.warn('[handleRetryAccessRequest] Rate limit exceeded, notification skipped.');
  }

  return jsonResponse({
    success: true,
    message: 'בקשת הגישה נשלחה לאישור המנהל.'
  });
}

// =========================================================================
// 2. ADMIN APPROVAL HANDLER
// =========================================================================
function handleApprove(payload) {
  console.log('[handleApprove] Processing approval request...');
  const requestId = payload.requestId;
  const idToken = payload.idToken;

  console.log('[handleApprove] RequestId:', requestId);
  console.log('[handleApprove] ID Token present:', !!idToken, 'Length:', idToken ? idToken.length : 0);

  if (!requestId || !idToken) {
    console.error('[handleApprove] Missing requestId or idToken');
    return jsonResponse({ error: 'Missing requestId or idToken' }, 400);
  }

  // 1. Verify Admin Firebase ID Token using Google Identity Toolkit
  console.log('[handleApprove] Verifying Firebase ID token...');
  const adminClaims = verifyFirebaseIdToken(idToken);
  const adminEmail = getScriptProp('ADMIN_EMAIL', CONFIG.ADMIN_EMAIL);

  if (!adminClaims) {
    console.error('[handleApprove] Token verification returned null (invalid or expired)');
    return jsonResponse({ error: 'Unauthorized: Invalid Firebase ID token' }, 401);
  }

  console.log('[handleApprove] Token claims verified successfully:');
  console.log(' - Token Email:', adminClaims.email);
  console.log(' - Email Verified:', adminClaims.email_verified);
  console.log(' - Configured Admin Email:', adminEmail);

  if (adminClaims.email !== adminEmail || !adminClaims.email_verified) {
    console.error('[handleApprove] Caller is not authorized super admin. Claim email:', adminClaims.email);
    return jsonResponse({ error: 'Unauthorized: Caller is not the verified super admin' }, 403);
  }

  // 2. Fetch canonical document from Firestore
  console.log('[handleApprove] Fetching Firestore request document for:', requestId);
  const doc = getFirestoreDoc(requestId);
  if (!doc) {
    console.error('[handleApprove] Request document not found in Firestore:', requestId);
    return jsonResponse({ error: 'Request document not found in Firestore' }, 404);
  }

  const fields = doc.fields || {};
  const status = fields.status ? fields.status.stringValue : '';
  const requesterEmail = (fields.email ? fields.email.stringValue : '').trim().toLowerCase();
  const requesterName = fields.name ? fields.name.stringValue : '';

  console.log('[handleApprove] Canonical request details:');
  console.log(' - Name:', requesterName);
  console.log(' - Email:', requesterEmail);
  console.log(' - Current Status:', status);

  if (status !== 'pending') {
    console.warn('[handleApprove] Request is not pending. Status is:', status);
    return jsonResponse({ error: 'Request is already ' + status }, 400);
  }

  if (!requesterEmail || !requesterEmail.includes('@')) {
    console.error('[handleApprove] Invalid requester email in document:', requesterEmail);
    return jsonResponse({ error: 'Invalid requester email in document' }, 400);
  }

  // 3. Provision user in Firebase Authentication (Identity Toolkit API)
  console.log('[handleApprove] Provisioning user in Firebase Auth for:', requesterEmail);
  const provisionResult = provisionFirebaseAuthUser(requesterEmail);
  console.log('[handleApprove] Provisioning result:', JSON.stringify(provisionResult));

  if (!provisionResult.success) {
    console.error('[handleApprove] User provisioning FAILED:', provisionResult.error);
    return jsonResponse({ error: 'Failed to provision user in Firebase Auth: ' + provisionResult.error }, 500);
  }

  // 4. Update Firestore document to approved
  const nowIso = new Date().toISOString();
  console.log('[handleApprove] Updating Firestore request to approved at:', nowIso);
  updateFirestoreDoc(requestId, {
    status: { stringValue: 'approved' },
    processedAt: { timestampValue: nowIso },
    processedBy: { stringValue: adminEmail }
  }, ['status', 'processedAt', 'processedBy']);
  console.log('[handleApprove] Firestore status updated to approved.');

  // 5. Send welcome email to newly approved user
  console.log('[handleApprove] Sending welcome email to requester:', requesterEmail);
  try {
    MailApp.sendEmail({
      to: requesterEmail,
      subject: 'בקשתך למערכת סידור המשמרות אושרה',
      htmlBody: `
        <div dir="rtl" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #1a365d; margin-top: 0;">שלום ${escapeHtml(requesterName)},</h2>
          <p style="color: #2d3748; font-size: 15px;">בקשת הגישה שלך למערכת <strong>סידור המשמרות</strong> אושרה בהצלחה!</p>
          <p style="color: #4a5568; font-size: 14px;">כעת באפשרותך להיכנס למערכת באמצעות כפתור <strong>"התחבר עם Google"</strong>:</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="https://shift-arranger.web.app" style="background: #245f39; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block;">כניסה לסידור המשמרות</a>
          </div>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          <p style="color: #a0aec0; font-size: 12px; margin: 0; text-align: center;">מערכת סידור המשמרות</p>
        </div>
      `
    });
    console.log('[handleApprove] Welcome email sent successfully.');
  } catch (emailErr) {
    console.warn('[handleApprove] Could not send welcome email (non-fatal):', emailErr.message);
  }

  return jsonResponse({
    success: true,
    message: `המשתמש ${requesterEmail} אושר ונוצר בהצלחה ב-Firebase Authentication.`
  });
}

// =========================================================================
// 3. ADMIN REJECTION HANDLER
// =========================================================================
function handleReject(payload) {
  console.log('[handleReject] Processing rejection request...');
  const requestId = payload.requestId;
  const idToken = payload.idToken;

  if (!requestId || !idToken) {
    return jsonResponse({ error: 'Missing requestId or idToken' }, 400);
  }

  const adminClaims = verifyFirebaseIdToken(idToken);
  const adminEmail = getScriptProp('ADMIN_EMAIL', CONFIG.ADMIN_EMAIL);

  if (!adminClaims || adminClaims.email !== adminEmail || !adminClaims.email_verified) {
    console.error('[handleReject] Unauthorized caller for rejection.');
    return jsonResponse({ error: 'Unauthorized: Caller is not the verified super admin' }, 403);
  }

  const doc = getFirestoreDoc(requestId);
  if (!doc) {
    return jsonResponse({ error: 'Request document not found in Firestore' }, 404);
  }

  const nowIso = new Date().toISOString();
  console.log('[handleReject] Updating Firestore request to rejected:', requestId);
  updateFirestoreDoc(requestId, {
    status: { stringValue: 'rejected' },
    processedAt: { timestampValue: nowIso },
    processedBy: { stringValue: adminEmail }
  }, ['status', 'processedAt', 'processedBy']);

  return jsonResponse({ success: true, message: 'הבקשה סומנה כנדחתה.' });
}

// =========================================================================
// 4. FIREBASE & OAUTH UTILITIES
// =========================================================================

function getServiceAccountAccessToken() {
  const cache = CacheService.getScriptCache();
  const cachedToken = cache.get('sa_oauth_token');
  if (cachedToken) {
    return cachedToken;
  }

  console.log('[getServiceAccountAccessToken] Reading SERVICE_ACCOUNT_KEY from Script Properties...');
  const saJsonStr = getScriptProp('SERVICE_ACCOUNT_KEY');
  if (!saJsonStr) {
    console.warn('[getServiceAccountAccessToken] SERVICE_ACCOUNT_KEY not found in Script Properties! Falling back to ScriptApp.getOAuthToken()');
    return ScriptApp.getOAuthToken();
  }

  let sa;
  try {
    sa = JSON.parse(saJsonStr);
  } catch (parseErr) {
    console.error('[getServiceAccountAccessToken] JSON parse error on SERVICE_ACCOUNT_KEY:', parseErr.message);
    throw new Error('Invalid JSON in SERVICE_ACCOUNT_KEY Script Property.');
  }

  console.log('[getServiceAccountAccessToken] Service Account client_email:', sa.client_email);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const toSign = Utilities.base64EncodeWebSafe(JSON.stringify(header)) + '.' +
                 Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
  
  const signatureBytes = Utilities.computeRsaSha256Signature(toSign, sa.private_key);
  const assertion = toSign + '.' + Utilities.base64EncodeWebSafe(signatureBytes);

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion
    },
    muteHttpExceptions: true
  });

  const statusCode = res.getResponseCode();
  const resBody = res.getContentText();
  console.log('[getServiceAccountAccessToken] OAuth exchange status:', statusCode);

  if (statusCode !== 200) {
    console.error('[getServiceAccountAccessToken] OAuth exchange FAILED:', resBody);
    throw new Error('OAuth token exchange failed (' + statusCode + '): ' + resBody);
  }

  const tokenData = JSON.parse(resBody);
  const token = tokenData.access_token;
  console.log('[getServiceAccountAccessToken] Token acquired successfully (length: ' + token.length + '). Caching for 50 mins.');
  cache.put('sa_oauth_token', token, 3000);
  return token;
}

function getFirestoreDoc(requestId) {
  const projectId = getScriptProp('FIREBASE_PROJECT_ID', CONFIG.PROJECT_ID);
  console.log('[getFirestoreDoc] Project ID:', projectId, '| Request ID:', requestId);
  const token = getServiceAccountAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/accessRequests/${requestId}`;

  console.log('[getFirestoreDoc] Executing GET request to Firestore REST API...');
  const res = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true
  });

  const statusCode = res.getResponseCode();
  const resBody = res.getContentText();
  console.log('[getFirestoreDoc] Firestore GET response code:', statusCode);

  if (statusCode === 200) {
    console.log('[getFirestoreDoc] Document found and loaded.');
    return JSON.parse(resBody);
  }

  console.warn('[getFirestoreDoc] Document fetch failed or not found. Response body:', resBody);
  return null;
}

function updateFirestoreDoc(requestId, fields, fieldMaskPaths) {
  const projectId = getScriptProp('FIREBASE_PROJECT_ID', CONFIG.PROJECT_ID);
  console.log('[updateFirestoreDoc] Updating doc:', requestId, '| Fields:', fieldMaskPaths.join(', '));
  const token = getServiceAccountAccessToken();
  
  const maskQuery = fieldMaskPaths.map(p => 'updateMask.fieldPaths=' + encodeURIComponent(p)).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/accessRequests/${requestId}?${maskQuery}`;

  const payload = { fields: fields };

  console.log('[updateFirestoreDoc] Executing PATCH request to Firestore REST API...');
  const res = UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const statusCode = res.getResponseCode();
  const resBody = res.getContentText();
  console.log('[updateFirestoreDoc] Firestore PATCH response code:', statusCode);

  if (statusCode !== 200) {
    console.error('[updateFirestoreDoc] Firestore PATCH FAILED:', resBody);
    throw new Error('Firestore update failed (' + statusCode + '): ' + resBody);
  }

  console.log('[updateFirestoreDoc] Firestore PATCH succeeded.');
}

function provisionFirebaseAuthUser(email) {
  try {
    const projectId = getScriptProp('FIREBASE_PROJECT_ID', CONFIG.PROJECT_ID);
    console.log('[provisionFirebaseAuthUser] Project ID:', projectId, '| Email:', email);
    const token = getServiceAccountAccessToken();
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`;

    console.log('[provisionFirebaseAuthUser] Calling Identity Toolkit accounts endpoint...');
    const res = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        email: email,
        emailVerified: true,
        providerUserInfo: [
          {
            providerId: 'google.com',
            email: email
          }
        ]
      }),
      muteHttpExceptions: true
    });

    const statusCode = res.getResponseCode();
    const resText = res.getContentText();
    console.log('[provisionFirebaseAuthUser] Identity Toolkit response code:', statusCode);
    console.log('[provisionFirebaseAuthUser] Response body:', resText);

    const data = JSON.parse(resText || '{}');

    if (statusCode === 200) {
      console.log('[provisionFirebaseAuthUser] User created successfully. UID (localId):', data.localId);
      return { success: true, localId: data.localId };
    }

    const errMsg = data.error ? data.error.message : resText;
    if (errMsg.includes('EMAIL_EXISTS')) {
      console.log('[provisionFirebaseAuthUser] Account already exists in Firebase Auth. Existing account is Google-ready.');
      return { success: true, alreadyExists: true };
    }

    console.error('[provisionFirebaseAuthUser] Account creation returned error:', errMsg);
    return { success: false, error: errMsg };
  } catch (err) {
    console.error('[provisionFirebaseAuthUser] Exception during account creation:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Checks whether an email currently exists in Firebase Authentication
 * via Google Identity Toolkit accounts:lookup API.
 */
function checkFirebaseAuthUserExists(email) {
  try {
    const projectId = getScriptProp('FIREBASE_PROJECT_ID', CONFIG.PROJECT_ID);
    const cleanEmail = (email || '').trim().toLowerCase();
    console.log('[checkFirebaseAuthUserExists] Checking existence for email:', cleanEmail);
    const token = getServiceAccountAccessToken();
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`;

    const res = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        email: [cleanEmail]
      }),
      muteHttpExceptions: true
    });

    const statusCode = res.getResponseCode();
    const resBody = res.getContentText();
    console.log('[checkFirebaseAuthUserExists] accounts:lookup response status:', statusCode);

    if (statusCode === 200) {
      const data = JSON.parse(resBody || '{}');
      const users = data.users || [];
      const userExists = users.length > 0;
      console.log('[checkFirebaseAuthUserExists] User found in Auth:', userExists);
      return userExists;
    }

    console.warn('[checkFirebaseAuthUserExists] Unexpected status code:', statusCode, 'body:', resBody);
    return false;
  } catch (err) {
    console.error('[checkFirebaseAuthUserExists] Exception during user check:', err.message);
    return false;
  }
}

/**
 * Verifies Firebase ID Token using Google Identity Toolkit accounts:lookup API
 * and asserts all claims (alg, aud, iss, sub, exp, iat).
 */
function verifyFirebaseIdToken(token) {
  try {
    console.log('[verifyFirebaseIdToken] Decoding token structure...');
    const parts = (token || '').split('.');
    if (parts.length !== 3) {
      console.error('[verifyFirebaseIdToken] Invalid JWT format, segment count:', parts.length);
      return null;
    }

    const header = JSON.parse(decodeBase64UrlSafe(parts[0]));
    const payload = JSON.parse(decodeBase64UrlSafe(parts[1]));

    const projectId = getScriptProp('FIREBASE_PROJECT_ID', CONFIG.PROJECT_ID);
    const now = Math.floor(Date.now() / 1000);

    // Safe Token Metadata Logging
    console.log('[verifyFirebaseIdToken] Safe Token Metadata:');
    console.log(' - alg:', header.alg);
    console.log(' - kid:', header.kid);
    console.log(' - aud:', payload.aud);
    console.log(' - iss:', payload.iss);
    console.log(' - sub:', payload.sub);
    console.log(' - email:', payload.email);
    console.log(' - email_verified:', payload.email_verified);
    console.log(' - iat:', payload.iat);
    console.log(' - exp:', payload.exp, '(current time:', now, ')');

    // 1. Claims validation
    if (header.alg !== 'RS256') {
      console.error('[verifyFirebaseIdToken] Unsupported alg:', header.alg);
      return null;
    }
    if (payload.aud !== projectId) {
      console.error('[verifyFirebaseIdToken] Audience mismatch. Expected:', projectId, 'Got:', payload.aud);
      return null;
    }
    if (payload.iss !== 'https://securetoken.google.com/' + projectId) {
      console.error('[verifyFirebaseIdToken] Issuer mismatch. Expected: https://securetoken.google.com/' + projectId, 'Got:', payload.iss);
      return null;
    }
    if (!payload.sub || typeof payload.sub !== 'string') {
      console.error('[verifyFirebaseIdToken] Missing or invalid sub claim');
      return null;
    }
    if (payload.exp < now) {
      console.error('[verifyFirebaseIdToken] Token expired. exp:', payload.exp, 'now:', now);
      return null;
    }

    // 2. Official Google Identity Toolkit server-side verification
    console.log('[verifyFirebaseIdToken] Calling Identity Toolkit accounts:lookup to verify token...');
    const saToken = getServiceAccountAccessToken();
    const lookupUrl = `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`;

    const res = UrlFetchApp.fetch(lookupUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + saToken,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ idToken: token }),
      muteHttpExceptions: true
    });

    const statusCode = res.getResponseCode();
    const resBody = res.getContentText();
    console.log('[verifyFirebaseIdToken] Identity Toolkit accounts:lookup response status:', statusCode);

    if (statusCode === 200) {
      const data = JSON.parse(resBody);
      if (data.users && data.users.length > 0) {
        const verifiedUser = data.users[0];
        console.log('[verifyFirebaseIdToken] Token successfully verified for email:', verifiedUser.email);
        return {
          email: verifiedUser.email,
          email_verified: verifiedUser.emailVerified === true || verifiedUser.emailVerified === 'true',
          sub: verifiedUser.localId,
          uid: verifiedUser.localId
        };
      }
    }

    console.error('[verifyFirebaseIdToken] Identity Toolkit verification failed. Response body:', resBody);
    return null;
  } catch (err) {
    console.error('[verifyFirebaseIdToken] Exception during token verification:', err.message, err.stack);
    return null;
  }
}

function decodeBase64UrlSafe(str) {
  let output = str.replace(/-/g, '+').replace(/_/g, '/');
  switch (output.length % 4) {
    case 0: break;
    case 2: output += '=='; break;
    case 3: output += '='; break;
    default: throw new Error('Illegal base64url string!');
  }
  return Utilities.newBlob(Utilities.base64Decode(output)).getDataAsString();
}

// =========================================================================
// HELPERS
// =========================================================================

function getScriptProp(key, fallback = '') {
  try {
    const val = PropertiesService.getScriptProperties().getProperty(key);
    return val || fallback;
  } catch (e) {
    console.warn('[getScriptProp] Could not read property:', key, e.message);
    return fallback;
  }
}

function jsonResponse(obj, status = 200) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
