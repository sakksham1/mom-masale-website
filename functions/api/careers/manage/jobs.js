// Flutter/ERP management API. No website dashboard is coupled to this route.
// GET /api/careers/manage/jobs?status=&slug=
// POST /api/careers/manage/jobs  { title, location, summary, description, ... }
// PATCH /api/careers/manage/jobs { id, ...job fields }
import { requireCareerManager, jsonError, slugify, validateJob, publicJob } from '../../_utils/careers.js';
import { logAudit } from '../../_utils/admin.js';

async function uniqueSlug(env, requested, title, omitId = null) {
  const base = slugify(requested || title);
  if (!base) return null;
  let candidate = base;
  for (let n = 2; n < 100; n++) {
    const found = await env.DB.prepare(`SELECT id FROM career_jobs WHERE slug = ?${omitId ? ' AND id != ?' : ''}`).bind(...(omitId ? [candidate, omitId] : [candidate])).first();
    if (!found) return candidate;
    candidate = `${base}-${n}`;
  }
  return null;
}

function managedJob(row) {
  return { id: row.id, ...publicJob(row, true), status: row.status, closesAt: row.closes_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireCareerManager(request, env);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  const status = url.searchParams.get('status');
  if (slug) {
    const job = await env.DB.prepare('SELECT * FROM career_jobs WHERE slug = ?').bind(slug).first();
    if (!job) return jsonError('Job not found', 404);
    return Response.json({ job: managedJob(job) });
  }
  const binds = [];
  let query = 'SELECT * FROM career_jobs';
  if (status) { query += ' WHERE status = ?'; binds.push(status); }
  query += ' ORDER BY CASE status WHEN \'published\' THEN 0 WHEN \'draft\' THEN 1 ELSE 2 END, updated_at DESC';
  const result = await env.DB.prepare(query).bind(...binds).all();
  return Response.json({ jobs: (result.results || []).map(managedJob) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await requireCareerManager(request, env);
  if (!auth.ok) return auth.response;
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const parsed = validateJob(body);
  if (parsed.error) return jsonError(parsed.error);
  const job = parsed.value;
  const slug = await uniqueSlug(env, body.slug, job.title);
  if (!slug) return jsonError('Could not create a unique job slug', 409);
  const publishedAt = job.status === 'published' ? new Date().toISOString() : null;
  const result = await env.DB.prepare(`INSERT INTO career_jobs
    (slug, title, department, location, workplace_type, employment_type, experience_level, summary, description, responsibilities, qualifications, skills, salary_min, salary_max, salary_currency, salary_period, application_deadline, status, published_at, closes_at, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(slug, job.title, job.department, job.location, job.workplaceType, job.employmentType, job.experienceLevel, job.summary, job.description, JSON.stringify(job.responsibilities), JSON.stringify(job.qualifications), JSON.stringify(job.skills), job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod, job.applicationDeadline, job.status, publishedAt, job.closesAt, auth.user.id, auth.user.id).run();
  await logAudit(env, { userId: auth.user.id, action: 'create', resource: 'career_job', resourceId: slug, diff: { title: job.title, status: job.status } });
  const created = await env.DB.prepare('SELECT * FROM career_jobs WHERE id = ?').bind(result.meta.last_row_id).first();
  return Response.json({ ok: true, job: managedJob(created) }, { status: 201 });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const auth = await requireCareerManager(request, env);
  if (!auth.ok) return auth.response;
  let body; try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const id = Number(body.id);
  if (!Number.isInteger(id)) return jsonError('id is required');
  const existing = await env.DB.prepare('SELECT * FROM career_jobs WHERE id = ?').bind(id).first();
  if (!existing) return jsonError('Job not found', 404);
  const parsed = validateJob(body, existing);
  if (parsed.error) return jsonError(parsed.error);
  const job = parsed.value;
  const slug = body.slug !== undefined ? await uniqueSlug(env, body.slug, job.title, id) : existing.slug;
  if (!slug) return jsonError('Could not create a unique job slug', 409);
  const publishedAt = job.status === 'published' ? (existing.published_at || new Date().toISOString()) : existing.published_at;
  await env.DB.prepare(`UPDATE career_jobs SET slug = ?, title = ?, department = ?, location = ?, workplace_type = ?, employment_type = ?, experience_level = ?, summary = ?, description = ?, responsibilities = ?, qualifications = ?, skills = ?, salary_min = ?, salary_max = ?, salary_currency = ?, salary_period = ?, application_deadline = ?, status = ?, published_at = ?, closes_at = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .bind(slug, job.title, job.department, job.location, job.workplaceType, job.employmentType, job.experienceLevel, job.summary, job.description, JSON.stringify(job.responsibilities), JSON.stringify(job.qualifications), JSON.stringify(job.skills), job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod, job.applicationDeadline, job.status, publishedAt, job.closesAt, auth.user.id, id).run();
  await logAudit(env, { userId: auth.user.id, action: 'update', resource: 'career_job', resourceId: slug, diff: { title: job.title, status: job.status } });
  const updated = await env.DB.prepare('SELECT * FROM career_jobs WHERE id = ?').bind(id).first();
  return Response.json({ ok: true, job: managedJob(updated) });
}
