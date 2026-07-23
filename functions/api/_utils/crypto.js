// functions/api/_utils/crypto.js
// Password hashing + session tokens, built on Web Crypto — bcrypt/argon2 libraries
// generally don't run in the Cloudflare Workers runtime, so we use PBKDF2 which is
// natively supported and secure enough at this scale.
//
// CURRENT_ITERATIONS follows current PBKDF2-SHA256 guidance. Accounts created
// before this was raised from 100,000 keep working — verifyPassword() takes
// the iteration count that account's hash was actually created with — and
// get opportunistically re-hashed at the new standard the next time they log
// in successfully (see functions/api/auth/login.js).

const CURRENT_ITERATIONS = 210000;
const LEGACY_ITERATIONS = 100000; // default for rows created before the bump

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

async function deriveBits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
}

// Returns { hash, salt, iterations } — all safe to store in D1. Always hashes
// at the current standard; used for new accounts and password resets.
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derivedBits = await deriveBits(password, salt, CURRENT_ITERATIONS);
  return { hash: toHex(derivedBits), salt: toHex(salt), iterations: CURRENT_ITERATIONS };
}

// Constant-time-ish comparison to avoid leaking match length via timing.
// `iterations` must be the count the stored hash was actually created with —
// pass users.password_iterations, not the current constant.
export async function verifyPassword(password, storedHashHex, storedSaltHex, iterations = LEGACY_ITERATIONS) {
  const salt = fromHex(storedSaltHex);
  const derivedBits = await deriveBits(password, salt, iterations || LEGACY_ITERATIONS);
  const computedHex = toHex(derivedBits);

  if (computedHex.length !== storedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
  }
  return diff === 0;
}

// True if an account's stored hash predates the current iteration standard —
// login.js uses this to trigger an opportunistic rehash.
export function needsRehash(iterations) {
  return !iterations || iterations < CURRENT_ITERATIONS;
}

// 32 bytes of randomness, hex-encoded — used as both the session cookie value
// and the sessions.id primary key in D1.
export function generateSessionToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}