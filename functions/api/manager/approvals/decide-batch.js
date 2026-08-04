// functions/api/manager/approvals/decide-batch.js
// POST /api/manager/approvals/decide-batch   { items: [{type, id, decision}] }
//
// Batch version of decide.js — lets an admin/manager clear many pending
// approvals in one request. Reuses the exact same per-type decision logic
// as decide.js (see _handlers.js), so a batch approval and a single
// approval always behave identically. A mixed batch (e.g. a manager
// selecting packaging + product_core items) partially succeeds: disallowed
// items come back as per-item failures rather than failing the whole batch.

import { requireApprover, forbidden, jsonError, logAudit } from '../../_utils/admin.js';
import { applyRawMaterialDecision, applyPackagingDecision, applyProductCoreDecision } from './_handlers.js';
import { createNotification } from '../../_utils/notify.js';

const HANDLERS = {
  raw_material: applyRawMaterialDecision,
  packaging: applyPackagingDecision,
  product_core: applyProductCoreDecision,
};

const MAX_ITEMS = 100;

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, ok, role } = await requireApprover(request, env);
  if (!ok) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) return jsonError('items array is required');
  if (items.length > MAX_ITEMS) return jsonError(`Too many items in one batch (max ${MAX_ITEMS})`);

  for (const item of items) {
    if (!HANDLERS[item?.type]) return jsonError(`type must be one of: ${Object.keys(HANDLERS).join(', ')}`);
    if (!['approved', 'rejected'].includes(item?.decision)) return jsonError('decision must be approved or rejected');
    if (!Number.isInteger(item?.id)) return jsonError('each item needs an integer id');
  }

  const results = [];
  let succeeded = 0;

  for (const item of items) {
    if (item.type === 'product_core' && role !== 'admin') {
      results.push({ id: item.id, type: item.type, ok: false, error: 'Only an admin can approve product catalog changes' });
      continue;
    }
    try {
      await HANDLERS[item.type](env, item.id, item.decision, user);
      results.push({ id: item.id, type: item.type, ok: true });
      succeeded++;
    } catch (err) {
      results.push({ id: item.id, type: item.type, ok: false, error: err.message });
    }
  }

  await logAudit(env, {
    userId: user.id, action: 'decide_batch', resource: 'approvals', resourceId: null,
    diff: { total: items.length, succeeded, failed: items.length - succeeded },
  });

  if (succeeded > 0) {
    context.waitUntil(createNotification(env, {
      type: 'approval_batch_decided',
      title: `${succeeded} request${succeeded === 1 ? '' : 's'} decided`,
      body: `${succeeded} of ${items.length} request(s) decided by ${user.name}`,
      referenceType: 'approvals_batch',
      referenceId: null,
    }));
  }

  return new Response(JSON.stringify({ ok: true, results, succeeded, failed: items.length - succeeded }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}