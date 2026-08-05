// GET /api/careers/manage/resume?applicationId=123 — authorised private CV download.
import { requireCareerManager, jsonError } from '../../_utils/careers.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const auth = await requireCareerManager(request, env);
  if (!auth.ok) return auth.response;
  if (!env.CAREER_FILES) return jsonError('Career file storage is not configured', 503);
  const id = Number(new URL(request.url).searchParams.get('applicationId'));
  if (!Number.isInteger(id)) return jsonError('applicationId is required');
  const application = await env.DB.prepare('SELECT resume_key, resume_filename, resume_mime FROM career_applications WHERE id = ?').bind(id).first();
  if (!application) return jsonError('Application not found', 404);
  const object = await env.CAREER_FILES.get(application.resume_key);
  if (!object) return jsonError('CV file not found', 404);
  const safeFilename = application.resume_filename.replace(/["\\\r\n]/g, '_');
  return new Response(object.body, { headers: { 'Content-Type': application.resume_mime || 'application/octet-stream', 'Content-Length': String(object.size), 'Content-Disposition': `attachment; filename="${safeFilename}"`, 'Cache-Control': 'private, no-store' } });
}
