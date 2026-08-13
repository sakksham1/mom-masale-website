// functions/api/wheel.js
// GET /api/wheel — public, unauthenticated. Returns every active wheel mode
// (in cycle order) with its wedge items, for the homepage hero wheel.
// Never breaks the page — on any DB hiccup this returns an empty modes
// array and js/spice-wheel.js falls back to its built-in DEFAULT_MODES.

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const modesResult = await env.DB.prepare(
      `SELECT id, key, center_label, center_label_hover, center_glyph, hub_href
       FROM wheel_modes WHERE is_active = 1 ORDER BY sort_order, id`
    ).all();
    const modes = modesResult.results || [];

    const itemsResult = await env.DB.prepare(
      `SELECT wi.mode_id, wi.label, wi.href, wi.color
       FROM wheel_items wi
       JOIN wheel_modes wm ON wm.id = wi.mode_id
       WHERE wm.is_active = 1
       ORDER BY wi.mode_id, wi.sort_order, wi.id`
    ).all();

    const itemsByMode = new Map();
    for (const row of itemsResult.results || []) {
      if (!itemsByMode.has(row.mode_id)) itemsByMode.set(row.mode_id, []);
      itemsByMode.get(row.mode_id).push({ label: row.label, href: row.href, color: row.color });
    }

    const out = modes
      .map(m => ({
        key: m.key,
        centerLabel: m.center_label,
        centerLabelHover: m.center_label_hover,
        centerGlyph: m.center_glyph,
        hubHref: m.hub_href,
        items: itemsByMode.get(m.id) || [],
      }))
      .filter(m => m.items.length > 0); // a mode with no wedges yet is skipped, not shown broken

    return new Response(JSON.stringify({ modes: out }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    });
  } catch (err) {
    console.error('GET /api/wheel failed:', err.message);
    return new Response(JSON.stringify({ modes: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
}