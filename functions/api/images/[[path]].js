// functions/api/images/[[path]].js
// GET /api/images/{key} — public read proxy for R2. Long cache since uploaded
// images are content-hashed by timestamp in the key (never overwritten).

export async function onRequestGet(context) {
  const { env, params } = context;
  const key = Array.isArray(params.path) ? params.path.join('/') : params.path;
  if (!env.IMAGES) return new Response('Not configured', { status: 502 });

  const object = await env.IMAGES.get(key);
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);

  return new Response(object.body, { headers });
}