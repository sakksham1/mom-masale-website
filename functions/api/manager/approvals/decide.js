import { requireApprover, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { applyRawMaterialDecision, applyPackagingDecision, applyProductCoreDecision, applyCouponDecision } from './_handlers.js';

const HANDLERS = {
  raw_material: applyRawMaterialDecision,
  packaging: applyPackagingDecision,
  product_core: applyProductCoreDecision,
  coupon: applyCouponDecision,
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok, role } = await requireApprover(request, env);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { type, id, decision } = body;

  if (!HANDLERS[type]) return jsonError(`type must be one of: ${Object.keys(HANDLERS).join(', ')}`);
  if (!['approved', 'rejected'].includes(decision)) return jsonError('decision must be approved or rejected');
  if (!Number.isInteger(id)) return jsonError('id is required');

  // Catalog changes go straight to the publish queue (and eventually the
  // live website), so — unlike raw material / packaging approvals, which
  // any manager or admin can decide — product_core requests are reserved
  // for admins only.
  if ((type === 'product_core' || type === 'coupon') && role !== 'admin') {
    return forbidden('Only an admin can approve this type of change');
  }

  try {
    await HANDLERS[type](env, id, decision, user);
    await logAudit(env, { userId: user.id, action: decision, resource: type, resourceId: id });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, err.status || 400);
  }
}