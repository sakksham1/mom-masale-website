// functions/api/_utils/password.js
// Mirrored on the client by js/password-rules.js — keep both in sync.

export function validatePassword(password) {
  const errors = [];
  if (!password || password.length < 8) errors.push('At least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('At least one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('At least one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('At least one number');
  if (!/[!@#$%^&*(),.?":{}|<>_\-+=~`\[\]\\;'/]/.test(password)) errors.push('At least one special character');
  if (/(.)\1\1/.test(password)) errors.push('No character repeated 3+ times in a row');
  if (/\s/.test(password)) errors.push('No spaces');
  return { valid: errors.length === 0, errors };
}