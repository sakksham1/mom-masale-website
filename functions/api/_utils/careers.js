import { requireRole, forbidden, jsonError } from './admin.js';

// Keep this deliberately narrow until an HR role is formally introduced.
// Add 'hr' here (and to the role-assignment policy) when that launch happens.
export const CAREER_ROLES = ['admin', 'manager'];
export const JOB_STATUSES = new Set(['draft', 'published', 'paused', 'closed', 'archived']);
export const APPLICATION_STATUSES = new Set(['new', 'screening', 'shortlisted', 'interview', 'offered', 'hired', 'rejected', 'withdrawn']);
export const EMPLOYMENT_TYPES = new Set(['full_time', 'part_time', 'contract', 'internship']);
export const WORKPLACE_TYPES = new Set(['on_site', 'hybrid', 'remote']);

export async function requireCareerManager(request, env) {
  const auth = await requireRole(request, env, CAREER_ROLES);
  return auth.ok ? auth : { ...auth, response: forbidden() };
}

export function slugify(value) {
  return String(value || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 110);
}

export function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

export function jsonArray(value, maxItems = 30, maxItemLength = 500) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(v => text(v, maxItemLength)).filter(Boolean);
}

export function safeJsonArray(value) {
  try { return Array.isArray(JSON.parse(value || '[]')) ? JSON.parse(value || '[]') : []; } catch { return []; }
}

export function publicJob(row, detailed = false) {
  const job = {
    slug: row.slug, title: row.title, department: row.department, location: row.location,
    workplaceType: row.workplace_type, employmentType: row.employment_type,
    experienceLevel: row.experience_level, summary: row.summary,
    applicationDeadline: row.application_deadline, publishedAt: row.published_at,
  };
  if (row.salary_min || row.salary_max) job.salary = { min: row.salary_min, max: row.salary_max, currency: row.salary_currency, period: row.salary_period };
  if (detailed) Object.assign(job, {
    description: row.description, responsibilities: safeJsonArray(row.responsibilities),
    qualifications: safeJsonArray(row.qualifications), skills: safeJsonArray(row.skills),
  });
  return job;
}

export function validateJob(body, existing = null) {
  const has = key => Object.prototype.hasOwnProperty.call(body, key);
  const salaryMinRaw = has('salaryMin') ? body.salaryMin : existing?.salary_min;
  const salaryMaxRaw = has('salaryMax') ? body.salaryMax : existing?.salary_max;
  const next = {
    title: text(body.title ?? existing?.title, 140),
    department: text(body.department ?? existing?.department, 100) || null,
    location: text(body.location ?? existing?.location, 180),
    workplaceType: body.workplaceType ?? existing?.workplace_type ?? 'on_site',
    employmentType: body.employmentType ?? existing?.employment_type ?? 'full_time',
    experienceLevel: text(body.experienceLevel ?? existing?.experience_level, 100) || null,
    summary: text(body.summary ?? existing?.summary, 500),
    description: text(body.description ?? existing?.description, 12000),
    responsibilities: jsonArray(body.responsibilities ?? safeJsonArray(existing?.responsibilities)),
    qualifications: jsonArray(body.qualifications ?? safeJsonArray(existing?.qualifications)),
    skills: jsonArray(body.skills ?? safeJsonArray(existing?.skills)),
    salaryMin: salaryMinRaw === '' || salaryMinRaw == null ? null : Number(salaryMinRaw),
    salaryMax: salaryMaxRaw === '' || salaryMaxRaw == null ? null : Number(salaryMaxRaw),
    salaryCurrency: text(body.salaryCurrency ?? existing?.salary_currency ?? 'INR', 8) || 'INR',
    salaryPeriod: text(body.salaryPeriod ?? existing?.salary_period, 20) || null,
    applicationDeadline: text(body.applicationDeadline ?? existing?.application_deadline, 30) || null,
    closesAt: text(body.closesAt ?? existing?.closes_at, 30) || null,
    status: body.status ?? existing?.status ?? 'draft',
  };
  if (!next.title || !next.location || !next.summary || !next.description) return { error: 'title, location, summary, and description are required' };
  if (!WORKPLACE_TYPES.has(next.workplaceType) || !EMPLOYMENT_TYPES.has(next.employmentType) || !JOB_STATUSES.has(next.status)) return { error: 'Invalid job type or status' };
  if ((next.salaryMin != null && (!Number.isInteger(next.salaryMin) || next.salaryMin < 0)) || (next.salaryMax != null && (!Number.isInteger(next.salaryMax) || next.salaryMax < 0)) || (next.salaryMin != null && next.salaryMax != null && next.salaryMin > next.salaryMax)) return { error: 'Invalid salary range' };
  return { value: next };
}

export { jsonError };
