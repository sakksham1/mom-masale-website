// functions/api/_utils/active-theme.js
// Single read used by the public endpoint and checkout.js. NEVER throws —
// any DB error, malformed JSON, or missing row all resolve to `null`,
// which every caller treats as "use the default site look."

function safeParseColors(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

// Only these keys are ever forwarded to the frontend — an admin typo or a
// stray key in the colors JSON can't inject something unexpected.
const ALLOWED_COLOR_KEYS = ['maroon', 'maroonDark', 'gold', 'goldLight', 'cream', 'creamDark', 'brown'];

function sanitizeColors(colors) {
  const out = {};
  for (const key of ALLOWED_COLOR_KEYS) {
    if (typeof colors[key] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(colors[key].trim())) {
      out[key] = colors[key].trim();
    }
  }
  return out;
}

export async function getActiveTheme(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM site_themes WHERE is_active = 1 LIMIT 1`
    ).first();
    if (!row) return null;

    // A window has passed but nobody deactivated it — treat as inactive
    // rather than surprising a visitor with stale festival branding.
    const now = new Date();
    if (row.ends_at && new Date(row.ends_at) < now) return null;
    if (row.starts_at && new Date(row.starts_at) > now) return null;

    return {
      id: row.id,
      key: row.key,
      name: row.name,
      colors: sanitizeColors(safeParseColors(row.colors)),
      featuredSectionTitle: row.featured_section_title || null,
      promoBannerText: row.promo_banner_text || null,
      hero: {
        title: row.hero_title || null,
        ctaLabel: row.hero_cta_label || null,
        ctaUrl: row.hero_cta_url || null,
        image: row.hero_image || null,
      },
      banner: row.banner_enabled ? {
        title: row.banner_title || null,
        body: row.banner_body || null,
        image: row.banner_image || null,
        ctaLabel: row.banner_cta_label || null,
        ctaUrl: row.banner_cta_url || null,
      } : null,
      discountPercent: Number.isInteger(row.discount_percent) && row.discount_percent >= 0 && row.discount_percent <= 90
        ? row.discount_percent : null,
      couponCode: row.coupon_code || null,
    };
  } catch (err) {
    // Any failure here (DB unreachable, corrupt row, etc) — never let a
    // theme problem take down the storefront or checkout.
    console.error('getActiveTheme failed, falling back to default:', err.message);
    return null;
  }
}