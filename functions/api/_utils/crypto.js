// functions/api/_utils/crypto.js
// Password hashing + session tokens, built on Web Crypto — bcrypt/argon2 libraries
// generally don't run in the Cloudflare Workers runtime, so we use PBKDF2 which is
// natively supported and secure enough at this scale.

const ITERATIONS = 100000;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

async function deriveBits(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
}

// Returns { hash, salt } — both hex strings, safe to store in D1.
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivedBits = await deriveBits(password, salt);
  return { hash: toHex(derivedBits), salt: toHex(salt) };
}

// Constant-time-ish comparison to avoid leaking match length via timing.
export async function verifyPassword(password, storedHashHex, storedSaltHex) {
  const salt = fromHex(storedSaltHex);
  const derivedBits = await deriveBits(password, salt);
  const computedHex = toHex(derivedBits);

  if (computedHex.length !== storedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
  }
  return diff === 0;
}

// 32 bytes of randomness, hex-encoded — used as both the session cookie value
// and the sessions.id primary key in D1.
export function generateSessionToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}
