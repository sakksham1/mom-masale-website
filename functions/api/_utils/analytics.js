// functions/api/_utils/analytics.js
// Shared contract + validation for first-party analytics events, and small
// query helpers reused by the admin/analytics/* read endpoints.
//
// Adding a new event type: add it to ANALYTICS_EVENT_TYPES and describe its
// payload shape in validateEventPayload() below — every other file in this
// feature reads from these two exports, so nothing else needs to change.
// Unknown fields in a payload are silently dropped (only what's explicitly
// validated here ever reaches D1), so the client can't smuggle extra data in.

export const ANALYTICS_EVENT_TYPES = [
  'search_zero_result',
  'filter_applied',
  'coming_soon_click',
  'checkout_step',
  'recipe_ingredient_click',
];

// Canonical funnel order — used by admin/analytics/checkout-funnel.js to
// sort steps and compute drop-off between consecutive stages. "cart_opened"
// through "payment_opened" are all pre-payment; log "order_placed" right
// after checkout.js returns 201, and "payment_completed" once
// verify-payment.js/the Razorpay handler confirms (or immediately for COD).
export const CHECKOUT_FUNNEL_STEPS = [
  'cart_opened',
  'checkout_started',
  'pincode_checked',
  'payment_opened',
  'order_placed',
  'payment_completed',
];

const SEARCH_SCOPES = ['products', 'recipes', 'site'];

function isNonEmptyString(v, maxLen = 200) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= maxLen;
}
function isStringArray(v, maxLen = 30, maxItemLen = 60) {
  return Array.isArray(v) && v.length <= maxLen && v.every(s => typeof s === 'string' && s.length <= maxItemLen);
}

// Validates + normalizes a payload for the given event type.
// Returns { valid: true, payload } or { valid: false, error }.
export function validateEventPayload(type, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'payload must be an object' };
  }

  switch (type) {
    // { scope: 'products'|'recipes', query: string }
    // Fire when a search on products.html/recipes.html returns 0 results.
    case 'search_zero_result': {
      if (!SEARCH_SCOPES.includes(payload.scope)) {
        return { valid: false, error: `scope must be one of: ${SEARCH_SCOPES.join(', ')}` };
      }
      if (!isNonEmptyString(payload.query, 150)) {
        return { valid: false, error: 'query is required (string, max 150 chars)' };
      }
      return { valid: true, payload: { scope: payload.scope, query: payload.query.trim().toLowerCase() } };
    }

    // { scope: 'products'|'recipes', categories?: string[], sizes?: string[] }
    // Fire when applyFilters() runs with at least one active category/size
    // checkbox. Categories/sizes are sorted server-side so identical combos
    // group together regardless of the order they were clicked in.
    case 'filter_applied': {
      if (!SEARCH_SCOPES.includes(payload.scope)) {
        return { valid: false, error: `scope must be one of: ${SEARCH_SCOPES.join(', ')}` };
      }
      const categories = isStringArray(payload.categories) ? [...payload.categories].sort() : [];
      const sizes = isStringArray(payload.sizes) ? [...payload.sizes].sort() : [];
      if (categories.length === 0 && sizes.length === 0) {
        return { valid: false, error: 'at least one of categories/sizes must be non-empty' };
      }
      return { valid: true, payload: { scope: payload.scope, categories, sizes } };
    }

    // { productSlug: string, productName?: string }
    // Fire on click of the "Launching Soon" panel / ribbon on a coming-soon product.
    case 'coming_soon_click': {
      if (!isNonEmptyString(payload.productSlug, 120)) {
        return { valid: false, error: 'productSlug is required' };
      }
      const out = { productSlug: payload.productSlug.trim() };
      if (isNonEmptyString(payload.productName, 150)) out.productName = payload.productName.trim();
      return { valid: true, payload: out };
    }

    // { step: one of CHECKOUT_FUNNEL_STEPS, orderId?: integer }
    // Fire once per session at each funnel stage — see CHECKOUT_FUNNEL_STEPS
    // for exactly when. sessionId should be the SAME id across all steps of
    // one checkout attempt so the funnel query can group them.
    case 'checkout_step': {
      if (!CHECKOUT_FUNNEL_STEPS.includes(payload.step)) {
        return { valid: false, error: `step must be one of: ${CHECKOUT_FUNNEL_STEPS.join(', ')}` };
      }
      const out = { step: payload.step };
      if (Number.isInteger(payload.orderId)) out.orderId = payload.orderId;
      return { valid: true, payload: out };
    }

    // { recipeSlug: string, productSlug: string }
    // Fire when someone clicks "🛒 Shop {product}" from a recipe's ingredient list.
    case 'recipe_ingredient_click': {
      if (!isNonEmptyString(payload.recipeSlug, 120)) {
        return { valid: false, error: 'recipeSlug is required' };
      }
      if (!isNonEmptyString(payload.productSlug, 120)) {
        return { valid: false, error: 'productSlug is required' };
      }
      return { valid: true, payload: { recipeSlug: payload.recipeSlug.trim(), productSlug: payload.productSlug.trim() } };
    }

    default:
      return { valid: false, error: 'unhandled event type' };
  }
}

// Shared "?days=" parsing for every admin/analytics/* GET endpoint.
// sinceClause is a safe SQL fragment — `days` is always a bounded integer by
// the time it's interpolated, never raw user input.
export function parseDaysParam(url, defaultDays = 30, maxDays = 180) {
  const requested = Math.floor(Number(url.searchParams.get('days')));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, maxDays) : defaultDays;
  return { days, sinceClause: `datetime('now', '-${days} days')` };
}