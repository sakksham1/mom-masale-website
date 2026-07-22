// functions/api/_utils/fcm.js
// Firebase Cloud Messaging via the HTTP v1 API. Workers can't use the
// firebase-admin SDK (it assumes a Node runtime), so this hand-rolls the
// OAuth2 service-account exchange and signed push send using Web Crypto —
// same pattern as razorpay.js's HMAC signing, just RSA instead.
//
// Requires env var (wrangler secret put FCM_SERVICE_ACCOUNT_JSON):
//   The full JSON key from Firebase Console → Project Settings →
//   Service Accounts → Generate new private key. Paste the whole file
//   content as the secret value.

let cachedToken = null; // { accessToken, expiresAt } — resets on worker restart, that's fine

function base64urlFromBytes(bytes) {
  let str = btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(str) {
  return base64urlFromBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }
  if (!env.FCM_SERVICE_ACCOUNT_JSON) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON is not configured for this environment');
  }
  const serviceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const signingInput = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64urlFromBytes(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed (${res.status}): ${await res.text()}`);
  const data = await res.json();

  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

// Sends to one FCM registration token.
// invalidToken=true means the token is dead (app uninstalled etc) —
// callers should delete it from push_tokens.
export async function sendPushToToken(env, token, { title, body, data }) {
  const serviceAccount = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
  const accessToken = await getAccessToken(env);

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)])),
          android: { priority: 'high' },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    }
  );

  if (res.ok) return { ok: true, invalidToken: false };

  const errBody = await res.json().catch(() => ({}));
  const status = errBody?.error?.status;
  const invalidToken = status === 'UNREGISTERED' || status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT';
  console.error('FCM send failed:', res.status, JSON.stringify(errBody));
  return { ok: false, invalidToken };
}

// Sends to every registered token belonging to users whose role is in
// `roles`, pruning any tokens FCM reports as dead. Never throws — a push
// failure should never break the caller's main request flow.
export async function sendPushToRoles(env, roles, { title, body, data }) {
  try {
    const placeholders = roles.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT pt.id, pt.token FROM push_tokens pt
       JOIN users u ON u.id = pt.user_id
       WHERE u.role IN (${placeholders})`
    ).bind(...roles).all();

    const tokens = rows.results || [];
    const deadIds = [];

    await Promise.all(tokens.map(async (row) => {
      const result = await sendPushToToken(env, row.token, { title, body, data });
      if (!result.ok && result.invalidToken) deadIds.push(row.id);
    }));

    if (deadIds.length) {
      const ph = deadIds.map(() => '?').join(',');
      await env.DB.prepare(`DELETE FROM push_tokens WHERE id IN (${ph})`).bind(...deadIds).run();
    }
  } catch (err) {
    console.error('sendPushToRoles failed:', err.message);
  }
}