// functions/api/auth/me.js
// GET /api/auth/me — returns the logged-in user (or null) based on the session cookie.
// Frontend calls this on page load to decide whether to show "Login" or "My Account".

import { getUserFromSession } from '../_utils/session.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);

  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
