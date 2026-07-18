// functions/api/admin/recipes.js
import { requireAdmin, forbidden, jsonError } from '../_utils/admin.js';
import { readRepoFile, writeRepoFile } from '../_utils/github.js';
import { logAudit } from '../_utils/admin.js';

const RECIPES_PATH = 'data/recipes.json';
const PRODUCTS_PATH = 'data/products.json';
const EDITABLE_FIELDS = ['title', 'category', 'cuisine', 'description', 'image', 'imageAlt',
  'servings', 'prepTime', 'cookTime', 'trending', 'essentials', 'ingredients', 'steps', 'relatedProducts'];

function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { isAdmin } = await requireAdmin(request, env);
  if (!isAdmin) return forbidden();
  try {
    const { content } = await readRepoFile(env, RECIPES_PATH);
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

  try {
    const { content, sha } = await readRepoFile(env, RECIPES_PATH);
    const recipes = JSON.parse(content);

    const slug = slugify(title);
    if (!slug) return jsonError('Could not derive a valid slug from that title');
    if (recipes.some(r => r.slug === slug)) return jsonError(`A recipe with slug "${slug}" already exists`, 409);

    const newRecipe = {
      slug, title, category, cuisine: body.cuisine || 'Indian',
      prepTime: body.prepTime || 'PT10M', cookTime: body.cookTime || 'PT20M',
      servings: Number(body.servings) || 4,
      image: body.image || `images/recipes/${slug}.webp`,
      imageAlt: title, description,
      trending: !!body.trending, essentials: !!body.essentials,
      ingredients: body.ingredients || [], steps: body.steps || [],
      relatedProducts: body.relatedProducts || [],
      seo: {
        title: `${title} Recipe | Mom Masale`,
        metaDescription: `Learn how to make ${title} at home with this easy Mom Masale recipe.`,
        keywords: [title.toLowerCase(), 'mom masale'],
      },
    };

    recipes.push(newRecipe);
    const newContent = JSON.stringify(recipes, null, 2) + '\n';
    await writeRepoFile(env, RECIPES_PATH, newContent, sha, `chore(studio): add recipe "${title}"`);
    await logAudit(env, { userId: user.id, action: 'create', resource: 'recipe', resourceId: slug, diff: newRecipe });

    return new Response(JSON.stringify({ ok: true, recipe: newRecipe }), {
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

  try {
    const { content, sha } = await readRepoFile(env, RECIPES_PATH);
    const recipes = JSON.parse(content);
    const idx = recipes.findIndex(r => r.slug === slug);
    if (idx === -1) return jsonError('Recipe not found', 404);

    for (const key of EDITABLE_FIELDS) {
      if (key in updates) recipes[idx][key] = updates[key];
    }

    const newContent = JSON.stringify(recipes, null, 2) + '\n';
    await writeRepoFile(env, RECIPES_PATH, newContent, sha, `chore(studio): update recipe "${slug}"`);
    await logAudit(env, { userId: user.id, action: 'update', resource: 'recipe', resourceId: slug, diff: updates });

    return new Response(JSON.stringify({ ok: true, recipe: recipes[idx] }), {
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
  const force = url.searchParams.get('force') === '1';
  if (!slug) return jsonError('slug query param is required');

  try {
    // Recipes referencing this recipe: none by design (products/blog reference
    // recipes, not the other way around) — check blog.relatedRecipes only.
    if (!force) {
      const { content: blogContent } = await readRepoFile(env, 'data/blog.json');
      const blogPosts = JSON.parse(blogContent);
      const refs = blogPosts.filter(b => (b.relatedRecipes || []).includes(slug)).map(b => `blog post "${b.title}"`);
      if (refs.length) {
        return jsonError(`Can't delete — referenced by ${refs.join(', ')}. Resend with ?force=1 to delete anyway.`, 409);
      }
    }

    const { content, sha } = await readRepoFile(env, RECIPES_PATH);
    const recipes = JSON.parse(content);
    const filtered = recipes.filter(r => r.slug !== slug);
    if (filtered.length === recipes.length) return jsonError('Recipe not found', 404);

    const newContent = JSON.stringify(filtered, null, 2) + '\n';
    await writeRepoFile(env, RECIPES_PATH, newContent, sha, `chore(studio): delete recipe "${slug}"`);
    await logAudit(env, { userId: user.id, action: 'delete', resource: 'recipe', resourceId: slug });

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(err.message, 502);
  }
}