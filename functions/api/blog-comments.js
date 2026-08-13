// functions/api/blog-comments.js
// GET  /api/blog-comments?blogSlug=xxx&limit=20&beforeId=&mine=1
// POST /api/blog-comments  { blogSlug, body }
import { getUserFromSession } from './_utils/session.js';
import { createNotification } from './_utils/notify.js';
import { readStagedOrLive } from './_utils/content-staging.js';

function jsonError(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}
async function blogExists(env, slug) {
  const { content } = await readStagedOrLive(env, 'blog', 'data/blog.json');
  return JSON.parse(content).some(b => b.slug === slug);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const blogSlug = url.searchParams.get('blogSlug');
  if (!blogSlug) return jsonError('blogSlug is required');

  if (url.searchParams.get('mine') === '1') {
    const user = await getUserFromSession(request, env);
    if (!user) return jsonError('Login required', 401);
    const mine = await env.DB.prepare(
      `SELECT id, body, status, created_at FROM blog_comments WHERE blog_slug = ? AND user_id = ? ORDER BY created_at DESC LIMIT 5`
    ).bind(blogSlug, user.id).all();
    return new Response(JSON.stringify({ comments: mine.results || [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const beforeId = Number(url.searchParams.get('beforeId')) || null;

  let query = `
    SELECT bc.id, bc.body, bc.created_at, u.name as author_name
    FROM blog_comments bc JOIN users u ON u.id = bc.user_id
    WHERE bc.blog_slug = ? AND bc.status = 'approved'`;
  const binds = [blogSlug];
  if (beforeId) { query += ' AND bc.id < ?'; binds.push(beforeId); }
  query += ' ORDER BY bc.id DESC LIMIT ?';
  binds.push(limit + 1);

  const result = await env.DB.prepare(query).bind(...binds).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const comments = (hasMore ? rows.slice(0, limit) : rows).map(r => ({
    id: r.id, body: r.body, authorName: r.author_name, createdAt: r.created_at,
  }));

  return new Response(JSON.stringify({ comments, hasMore }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await getUserFromSession(request, env);
  if (!user) return jsonError('Login required', 401);

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const blogSlug = String(body.blogSlug || '').trim();
  const text = String(body.body || '').trim();

  if (!blogSlug) return jsonError('blogSlug is required');
  if (!text || text.length < 3) return jsonError('Please write a short comment (at least 3 characters)');
  if (text.length > 1000) return jsonError('Comment is too long (max 1000 characters)');
  if (!(await blogExists(env, blogSlug))) return jsonError('Article not found', 404);

  const insert = await env.DB.prepare(
    `INSERT INTO blog_comments (blog_slug, user_id, body) VALUES (?, ?, ?)`
  ).bind(blogSlug, user.id, text).run();

  context.waitUntil(createNotification(env, {
    type: 'blog_comment_pending',
    title: 'New comment awaiting approval',
    body: `${user.name} commented on "${blogSlug}"`,
    referenceType: 'blog_comment',
    referenceId: insert.meta.last_row_id,
  }));

  return new Response(JSON.stringify({ ok: true, commentId: insert.meta.last_row_id, status: 'pending' }), {
    status: 201, headers: { 'Content-Type': 'application/json' },
  });
}