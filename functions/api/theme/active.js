// functions/api/theme/active.js
// GET /api/theme/active — public, unauthenticated. Returns the active theme
// or { theme: null } if the site is running its default look. Cached briefly
// since every page load will call this.

import { getActiveTheme } from '../_utils/active-theme.js';

export async function onRequestGet(context) {
  const { env } = context;
  let theme = null;
  try {
    theme = await getActiveTheme(env);
  } catch {
    theme = null; // belt-and-suspenders — getActiveTheme already can't throw
  }

  return new Response(JSON.stringify({ theme }), {
    status: 200, // ALWAYS 200 — a theme failure is never a page failure
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
  });
}