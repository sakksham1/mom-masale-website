// GET /api/careers/jobs?slug=...  Public endpoint: only currently open published jobs.
import { jsonError, publicJob } from '../_utils/careers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slug = String(url.searchParams.get('slug') || '').trim();
  const where = `status = 'published' AND published_at IS NOT NULL AND (application_deadline IS NULL OR application_deadline = '' OR application_deadline >= date('now')) AND (closes_at IS NULL OR closes_at = '' OR closes_at >= date('now'))`;
  if (slug) {
    const job = await env.DB.prepare(`SELECT * FROM career_jobs WHERE slug = ? AND ${where}`).bind(slug).first();
    if (!job) return jsonError('Job not found', 404);
    return Response.json({ job: publicJob(job, true) });
  }
  const result = await env.DB.prepare(`SELECT * FROM career_jobs WHERE ${where} ORDER BY published_at DESC, id DESC`).all();
  return Response.json({ jobs: (result.results || []).map(row => publicJob(row)) });
}
