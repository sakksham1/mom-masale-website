// Flutter/ERP applicant inbox API. CV bytes are intentionally excluded; use
// /api/careers/manage/resume?applicationId=... after authorisation instead.
import { requireCareerManager, jsonError, APPLICATION_STATUSES } from '../../_utils/careers.js';
import { logAudit } from '../../_utils/admin.js';

function view(row) {
  return { id: row.id, jobId: row.job_id, jobSlug: row.job_slug, jobTitle: row.job_title, name: row.applicant_name, email: row.email, phone: row.phone, location: row.location, education: row.education, experience: row.experience, portfolioUrl: row.portfolio_url, expectedSalary: row.expected_salary, coverLetter: row.cover_letter, resume: { filename: row.resume_filename, mime: row.resume_mime, bytes: row.resume_bytes }, status: row.status, source: row.source, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireCareerManager(request, env);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  const status = url.searchParams.get('status');
  const jobId = Number(url.searchParams.get('jobId'));
  if (id) {
    const application = await env.DB.prepare(`SELECT a.*, j.slug AS job_slug, j.title AS job_title FROM career_applications a JOIN career_jobs j ON j.id = a.job_id WHERE a.id = ?`).bind(id).first();
    if (!application) return jsonError('Application not found', 404);
    const events = await env.DB.prepare(`SELECT e.id, e.event_type, e.from_status, e.to_status, e.note, e.created_at, u.name AS created_by_name FROM career_application_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.application_id = ? ORDER BY e.created_at ASC, e.id ASC`).bind(id).all();
    return Response.json({ application: view(application), events: events.results || [] });
  }
  const conditions = [], binds = [];
  if (status) { if (!APPLICATION_STATUSES.has(status)) return jsonError('Invalid application status'); conditions.push('a.status = ?'); binds.push(status); }
  if (jobId) { conditions.push('a.job_id = ?'); binds.push(jobId); }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await env.DB.prepare(`SELECT a.*, j.slug AS job_slug, j.title AS job_title FROM career_applications a JOIN career_jobs j ON j.id = a.job_id ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  return Response.json({ applications: (result.results || []).map(view), limit, offset });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const auth = await requireCareerManager(request, env);
  if (!auth.ok) return auth.response;
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const id = Number(body.id);
  const status = String(body.status || '');
  const note = String(body.note || '').trim().slice(0, 3000);
  if (!Number.isInteger(id) || !APPLICATION_STATUSES.has(status)) return jsonError('A valid id and status are required');
  const existing = await env.DB.prepare('SELECT id, status FROM career_applications WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Application not found', 404);
  await env.DB.prepare(`UPDATE career_applications SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run();
  if (existing.status !== status || note) await env.DB.prepare(`INSERT INTO career_application_events (application_id, event_type, from_status, to_status, note, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, existing.status !== status ? 'status_changed' : 'note_added', existing.status, status, note || null, auth.user.id).run();
  await logAudit(env, { userId: auth.user.id, action: 'update', resource: 'career_application', resourceId: id, diff: { from: existing.status, to: status, hasNote: !!note } });
  return Response.json({ ok: true, id, status });
}
