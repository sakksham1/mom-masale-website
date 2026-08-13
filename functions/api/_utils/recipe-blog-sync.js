// functions/api/_utils/recipe-blog-sync.js
import { readStagedOrLive, stageContent } from './content-staging.js';

const MAX_EMBEDDED = 5;

function shortAuthorName(fullName) {
  const parts = String(fullName || 'Customer').trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// Recomputes aggregateRating + up to MAX_EMBEDDED reviews for one recipe and
// writes them into the staged recipes.json — mirrors products-sync.js's
// per-product review embedding, just scoped to a single slug instead of a
// full rebuild (recipes.json isn't otherwise regenerated from D1).
export async function syncRecipeReviewsIntoStaged(env, recipeSlug, userId) {
  const { content } = await readStagedOrLive(env, 'recipes', 'data/recipes.json');
  const recipes = JSON.parse(content);
  const idx = recipes.findIndex(r => r.slug === recipeSlug);
  if (idx === -1) return;

  const agg = await env.DB.prepare(
    `SELECT COUNT(*) as cnt, AVG(rating) as avg_rating FROM recipe_reviews WHERE recipe_slug = ? AND status = 'approved'`
  ).bind(recipeSlug).first();

  const top = await env.DB.prepare(
    `SELECT rr.rating, rr.body, rr.created_at, u.name as author_name
     FROM recipe_reviews rr JOIN users u ON u.id = rr.user_id
     WHERE rr.recipe_slug = ? AND rr.status = 'approved'
     ORDER BY rr.created_at DESC LIMIT ?`
  ).bind(recipeSlug, MAX_EMBEDDED).all();

  if (agg.cnt > 0) {
    recipes[idx].aggregateRating = { reviewCount: agg.cnt, ratingValue: Math.round(agg.avg_rating * 10) / 10 };
    recipes[idx].reviews = (top.results || []).map(r => ({
      rating: r.rating, body: r.body,
      authorName: shortAuthorName(r.author_name),
      datePublished: String(r.created_at).slice(0, 10),
    }));
  } else {
    delete recipes[idx].aggregateRating;
    delete recipes[idx].reviews;
  }

  await stageContent(env, 'recipes', JSON.stringify(recipes, null, 2) + '\n', userId);
}

// Same idea for blog comments — no rating, just the most recent approved
// comments embedded so the static page can SSR them.
const MAX_EMBEDDED_COMMENTS = 20;

export async function syncBlogCommentsIntoStaged(env, blogSlug, userId) {
  const { content } = await readStagedOrLive(env, 'blog', 'data/blog.json');
  const posts = JSON.parse(content);
  const idx = posts.findIndex(b => b.slug === blogSlug);
  if (idx === -1) return;

  const rows = await env.DB.prepare(
    `SELECT bc.body, bc.created_at, u.name as author_name
     FROM blog_comments bc JOIN users u ON u.id = bc.user_id
     WHERE bc.blog_slug = ? AND bc.status = 'approved'
     ORDER BY bc.created_at DESC LIMIT ?`
  ).bind(blogSlug, MAX_EMBEDDED_COMMENTS).all();

  posts[idx].comments = (rows.results || []).map(c => ({
    body: c.body,
    authorName: shortAuthorName(c.author_name),
    datePublished: String(c.created_at).slice(0, 10),
  }));

  await stageContent(env, 'blog', JSON.stringify(posts, null, 2) + '\n', userId);
}