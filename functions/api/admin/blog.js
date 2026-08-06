// functions/api/admin/blog.js
// GET    /api/admin/blog                — full data/blog.json (admin only)
// POST   /api/admin/blog                { title, category, description, body?, image?, relatedProducts?, relatedRecipes? }
// PATCH  /api/admin/blog                { slug, updates: { ...whitelisted fields } }
// DELETE /api/admin/blog?slug=...
//
// Mirrors admin/recipes.js exactly: data/blog.json is still GitHub-JSON
// (not migrated to D1 like products), so this commits directly and lets
// generate-site.yml pick it up. Category is validated against the same
// BLOG_CATEGORIES list build-site.js's validateBlog() enforces, so a bad
// category here fails fast instead of breaking the next site build.

import { requireAdmin, forbidden, jsonError, logAudit } from '../_utils/admin.js';
import { readRepoFile, writeRepoFile } from '../_utils/github.js';

const BLOG_PATH = 'data/blog.json';
const PRODUCTS_PATH = 'data/products.json';
const RECIPES_PATH = 'data/recipes.json';

const BLOG_CATEGORIES = ['Articles', 'FAQs', 'Buying Guides', 'Cooking Tips', 'Ingredient Comparisons'];

const EDITABLE_FIELDS = [
  'title', 'category', 'description', 'image', 'imageAlt',
  'body', 'relatedProducts', 'relatedRecipes', 'seo',
];

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

function defaultSeo(title, description) {
  return {
    title: `${title} | Mom Masale`,
    metaDescription: description,
    keywords: [title.toLowerCase(), 'mom masale'],
  };
}

// relatedProducts/relatedRecipes must point at real slugs, or the next
// build-site.js run throws (see validateBlog in scripts/build-site.js).
// Checking here means a bad slug fails the API call, not the next deploy.
async function validateReferences(env, { relatedProducts, relatedRecipes }) {
  if (relatedProducts?.length) {
    const { content } = await readRepoFile(env, PRODUCTS_PATH);
    const productSlugs = new Set(JSON.parse(content).map(p => p.slug));
    const bad = relatedProducts.filter(s => !productSlugs.has(s));
    if (bad.length) return `relatedProducts references unknown product slug(s): ${bad.join(', ')}`;
  }
  if (relatedRecipes?.length) {
    const { content } = await readRepoFile(env, RECIPES_PATH);
    const recipeSlugs = new Set(JSON.parse(content).map(r => r.slug));
    const bad = relatedRecipes.filter(s => !recipeSlugs.has(s));
    if (bad.length) return `relatedRecipes references unknown recipe slug(s): ${bad.join(', ')}`;
  }
  return null;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  try {
    const { content } = await readRepoFile(env, BLOG_PATH);
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }

  const { title, category, description } = body;
  if (!title || !category || !description) return jsonError('title, category, and description are required');
  if (!BLOG_CATEGORIES.includes(category)) {
    return jsonError(`category must be one of: ${BLOG_CATEGORIES.join(', ')}`);
  }

  const relatedProducts = Array.isArray(body.relatedProducts) ? body.relatedProducts : [];
  const relatedRecipes = Array.isArray(body.relatedRecipes) ? body.relatedRecipes : [];
  const refError = await validateReferences(env, { relatedProducts, relatedRecipes });
  if (refError) return jsonError(refError);

  try {
    const { content, sha } = await readRepoFile(env, BLOG_PATH);
    const blogPosts = JSON.parse(content);

    const slug = slugify(title);
    if (!slug) return jsonError('Could not derive a valid slug from that title');
    if (blogPosts.some(b => b.slug === slug)) return jsonError(`A blog post with slug "${slug}" already exists`, 409);

    const newPost = {
      slug, title, category,
      image: body.image || `images/blog/${slug}.webp`,
      imageAlt: body.imageAlt || title,
      description,
      body: Array.isArray(body.body) ? body.body : [],
      relatedProducts, relatedRecipes,
      seo: body.seo || defaultSeo(title, description),
    };

    blogPosts.push(newPost);
    const newContent = JSON.stringify(blogPosts, null, 2) + '\n';
    await writeRepoFile(env, BLOG_PATH, newContent, sha, `chore(studio): add blog post "${title}"`);
    await logAudit(env, { userId: user.id, action: 'create', resource: 'blog', resourceId: slug, diff: newPost });

    return new Response(JSON.stringify({ ok: true, post: newPost }), {
      status: 201, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body'); }
  const { slug, updates } = body;
  if (!slug || !updates) return jsonError('slug and an updates object are required');

  if ('category' in updates && !BLOG_CATEGORIES.includes(updates.category)) {
    return jsonError(`category must be one of: ${BLOG_CATEGORIES.join(', ')}`);
  }
  if ('body' in updates && !Array.isArray(updates.body)) {
    return jsonError('body must be an array of paragraph strings');
  }

  const refError = await validateReferences(env, {
    relatedProducts: updates.relatedProducts,
    relatedRecipes: updates.relatedRecipes,
  });
  if (refError) return jsonError(refError);

  try {
    const { content, sha } = await readRepoFile(env, BLOG_PATH);
    const blogPosts = JSON.parse(content);
    const idx = blogPosts.findIndex(b => b.slug === slug);
    if (idx === -1) return jsonError('Blog post not found', 404);

    for (const key of EDITABLE_FIELDS) {
      if (key in updates) blogPosts[idx][key] = updates[key];
    }

    const newContent = JSON.stringify(blogPosts, null, 2) + '\n';
    await writeRepoFile(env, BLOG_PATH, newContent, sha, `chore(studio): update blog post "${slug}"`);
    await logAudit(env, { userId: user.id, action: 'update', resource: 'blog', resourceId: slug, diff: updates });

    return new Response(JSON.stringify({ ok: true, post: blogPosts[idx] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  const { user, isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();

  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');
  if (!slug) return jsonError('slug query param is required');

  try {
    const { content, sha } = await readRepoFile(env, BLOG_PATH);
    const blogPosts = JSON.parse(content);
    const filtered = blogPosts.filter(b => b.slug !== slug);
    if (filtered.length === blogPosts.length) return jsonError('Blog post not found', 404);

    const newContent = JSON.stringify(filtered, null, 2) + '\n';
    await writeRepoFile(env, BLOG_PATH, newContent, sha, `chore(studio): delete blog post "${slug}"`);
    await logAudit(env, { userId: user.id, action: 'delete', resource: 'blog', resourceId: slug });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}