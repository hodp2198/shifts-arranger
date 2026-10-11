const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'shift-arranger';

function getAccessToken() {
  const p1 = path.join(process.env.APPDATA || '', 'configstore', 'firebase-tools.json');
  const p2 = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
  let tokenFile = fs.existsSync(p2) ? p2 : (fs.existsSync(p1) ? p1 : null);
  if (!tokenFile) {
    throw new Error('Firebase CLI credentials not found. Please run: npx -y firebase-tools login');
  }
  const authData = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  const token = authData.tokens?.access_token;
  if (!token) {
    throw new Error('Access token not found in Firebase CLI config.');
  }
  return token;
}

function request(url, method = 'GET', payload = null) {
  return new Promise((resolve, reject) => {
    const token = getAccessToken();
    const data = payload ? JSON.stringify(payload) : null;
    const req = https.request(url, {
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error?.message || ('HTTP ' + res.statusCode + ': ' + body)));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          if (res.statusCode >= 400) {
            reject(new Error('HTTP ' + res.statusCode + ': ' + body));
          } else {
            resolve(body);
          }
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function listUsers() {
  console.log(`Fetching users from Firebase Authentication (project: ${PROJECT_ID})...\n`);
  const res = await request(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet`);
  const users = res.users || [];
  if (users.length === 0) {
    console.log('No users found in Firebase Authentication.');
    return;
  }
  console.log(`=== Approved Firebase Auth Users (${users.length}) ===`);
  users.forEach((u, i) => {
    const providers = (u.providerUserInfo || []).map(p => p.providerId).join(', ') || 'none';
    console.log(`${i + 1}. Email: ${u.email} | UID: ${u.localId} | Verified: ${Boolean(u.emailVerified)} | Providers: ${providers}`);
  });
}

async function addUser(email) {
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/manage-users.js add <email>');
    process.exit(1);
  }
  const cleanEmail = email.trim().toLowerCase();
  console.log(`Adding approved Google user: ${cleanEmail} to Firebase Auth...`);
  const res = await request(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`, 'POST', {
    email: cleanEmail,
    emailVerified: true,
    providerUserInfo: [
      {
        providerId: 'google.com',
        email: cleanEmail
      }
    ]
  });
  console.log(`\nSuccess! User added to Firebase Auth with UID: ${res.localId}`);
  console.log(`This user can now sign in immediately using the "התחבר עם Google" button.`);
}

async function deleteUser(email) {
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/manage-users.js delete <email>');
    process.exit(1);
  }
  const cleanEmail = email.trim().toLowerCase();
  console.log(`Searching for user: ${cleanEmail} in Firebase Auth...`);
  const batch = await request(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet`);
  const user = (batch.users || []).find(u => u.email?.toLowerCase() === cleanEmail);
  if (!user) {
    console.error(`Error: User ${cleanEmail} not found in Firebase Auth.`);
    process.exit(1);
  }
  console.log(`Deleting user ${cleanEmail} (UID: ${user.localId})...`);
  await request(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`, 'POST', {
    localId: user.localId
  });
  console.log(`\nSuccess! User deleted from Firebase Auth. They can no longer sign in.`);
}

async function main() {
  const [,, cmd, arg] = process.argv;
  try {
    switch (cmd) {
      case 'list':
        await listUsers();
        break;
      case 'add':
        await addUser(arg);
        break;
      case 'delete':
        await deleteUser(arg);
        break;
      default:
        console.log('Firebase Authentication User Management CLI');
        console.log('Usage:');
        console.log('  node scripts/manage-users.js list');
        console.log('  node scripts/manage-users.js add <email>');
        console.log('  node scripts/manage-users.js delete <email>');
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
