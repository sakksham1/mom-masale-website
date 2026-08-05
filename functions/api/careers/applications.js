// POST /api/careers/applications  Public, account-free application submission.
import { createNotification } from '../_utils/notify.js';
import { sendEmail } from '../_utils/email.js';
import { jsonError, text } from '../_utils/careers.js';

const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESUME_TYPES = new Map([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/msword', 'doc'],
]);

function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function escapeHtml(value) { return String(value || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]); }
async function hashIp(request, env) {
  const source = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bytes = new TextEncoder().encode(`${env.CAREERS_RATE_LIMIT_SALT || 'career-rate-limit'}:${source}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.CAREER_FILES) return jsonError('Career file storage is not configured', 503);
  let form;
  try { form = await request.formData(); } catch { return jsonError('Expected multipart/form-data'); }
  if (text(form.get('website'), 100)) return Response.json({ ok: true }, { status: 201 }); // honeypot

  const jobSlug = text(form.get('jobSlug'), 110);
  const name = text(form.get('name'), 140);
  const email = text(form.get('email'), 254).toLowerCase();
  const phone = text(form.get('phone'), 30);
  const location = text(form.get('location'), 180);
  const resume = form.get('resume');
  const portfolioUrl = text(form.get('portfolioUrl'), 500);
  if (!jobSlug || !name || !validEmail(email) || !phone || !location || phone.replace(/\D/g, '').length < 7) return jsonError('name, a valid email, phone, location, and CV are required');
  if (portfolioUrl) { try { new URL(portfolioUrl); } catch { return jsonError('Portfolio / LinkedIn must be a valid URL'); } }
  if (!resume || typeof resume === 'string') return jsonError('A CV is required');
  if (!ALLOWED_RESUME_TYPES.has(resume.type) || resume.size > MAX_RESUME_BYTES) return jsonError('CV must be a PDF, DOC, or DOCX up to 5MB');

  const job = await env.DB.prepare(`SELECT id, title FROM career_jobs WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL AND (application_deadline IS NULL OR application_deadline = '' OR application_deadline >= date('now')) AND (closes_at IS NULL OR closes_at = '' OR closes_at >= date('now'))`).bind(jobSlug).first();
  if (!job) return jsonError('This role is no longer accepting applications', 410);

  const ipHash = await hashIp(request, env);
  const attempts = await env.DB.prepare(`SELECT COUNT(*) AS count FROM career_application_attempts WHERE ip_hash = ? AND created_at >= datetime('now', '-1 hour')`).bind(ipHash).first();
  if (Number(attempts?.count || 0) >= 6) return jsonError('Too many submissions. Please try again later.', 429);
  await env.DB.prepare('INSERT INTO career_application_attempts (ip_hash) VALUES (?)').bind(ipHash).run();

  const duplicate = await env.DB.prepare(`SELECT id FROM career_applications WHERE job_id = ? AND lower(email) = lower(?) AND created_at >= datetime('now', '-7 days')`).bind(job.id, email).first();
  if (duplicate) return jsonError('An application for this role was already received from this email recently.', 409);

  const extension = ALLOWED_RESUME_TYPES.get(resume.type);
  const safeName = resume.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120) || `resume.${extension}`;
  const resumeKey = `applications/${job.id}/${crypto.randomUUID()}.${extension}`;
  try {
    await env.CAREER_FILES.put(resumeKey, await resume.arrayBuffer(), { httpMetadata: { contentType: resume.type, contentDisposition: `attachment; filename="${safeName.replace(/"/g, '')}"` } });
  } catch (err) { console.error('Career CV upload failed:', err.message); return jsonError('Unable to save CV. Please try again.', 503); }

  let application;
  try {
    application = await env.DB.prepare(`INSERT INTO career_applications
      (job_id, applicant_name, email, phone, location, education, experience, portfolio_url, expected_salary, cover_letter, resume_key, resume_filename, resume_mime, resume_bytes, source, consent_at, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`)
      .bind(job.id, name, email, phone, location, text(form.get('education'), 1000) || null, text(form.get('experience'), 3000) || null, portfolioUrl || null, text(form.get('expectedSalary'), 100) || null, text(form.get('coverLetter'), 4000) || null, resumeKey, safeName, resume.type, resume.size, text(form.get('source'), 100) || 'careers_site', ipHash).run();
  } catch (err) {
    await env.CAREER_FILES.delete(resumeKey).catch(() => {});
    throw err;
  }
  const applicationId = application.meta.last_row_id;
  await env.DB.prepare(`INSERT INTO career_application_events (application_id, event_type, note) VALUES (?, 'applied', 'Application submitted through careers site')`).bind(applicationId).run();

  context.waitUntil((async () => {
    await createNotification(env, { type: 'career_application', title: `New application: ${job.title}`, body: `${name} · ${location}`, referenceType: 'career_application', referenceId: applicationId });
    if (env.RESEND_API_KEY) await sendEmail(env, { to: email, subject: `We received your application — ${job.title}`, html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2 style="color:#7b1120">Thank you for applying</h2><p>Hi ${escapeHtml(name)},</p><p>We received your application for <strong>${escapeHtml(job.title)}</strong> at Mom Masale. Our team will review it and contact you if your profile is a fit.</p><p>Warmly,<br>Mom Masale</p></div>` });
  })());
  return Response.json({ ok: true, applicationId }, { status: 201 });
}
