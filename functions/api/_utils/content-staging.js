// Generic staging layer so GitHub-JSON content (recipes/blog/settings) can
// be gated behind the same publish queue products already use. Unlike
// products (D1 is truth, JSON is generated), these files ARE the source of
// truth — so "staging" means: hold the next full file content in D1 until
// an admin explicitly publishes, instead of committing on every edit.

import { readRepoFile, writeRepoFile } from './github.js';

// What every GET/POST/PATCH/DELETE handler should read/write against, so
// the admin UI always reflects the latest state, published or not.
export async function readStagedOrLive(env, sourceType, path) {
  const staged = await env.DB.prepare(
    `SELECT content FROM content_staging WHERE source_type = ?`
  ).bind(sourceType).first();
  if (staged) return { content: staged.content, staged: true };
  const { content } = await readRepoFile(env, path);
  return { content, staged: false };
}

// Upserts pending content — never touches GitHub.
export async function stageContent(env, sourceType, content, userId) {
  await env.DB.prepare(
    `INSERT INTO content_staging (source_type, content, updated_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(source_type) DO UPDATE SET
       content = excluded.content, updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).bind(sourceType, content, userId ?? null).run();
}

// Called from sync-queue/run.js for each source_type with pending staged
// content — commits to GitHub (this is what actually triggers the rebuild),
// then clears staging. Returns false if nothing was staged for this type.
export async function publishStagedContent(env, sourceType, path, commitMessage) {
  const staged = await env.DB.prepare(
    `SELECT content FROM content_staging WHERE source_type = ?`
  ).bind(sourceType).first();
  if (!staged) return false;

  const { sha } = await readRepoFile(env, path); // fresh sha at publish time
  await writeRepoFile(env, path, staged.content, sha, commitMessage);
  await env.DB.prepare(`DELETE FROM content_staging WHERE source_type = ?`).bind(sourceType).run();
  return true;
}

// Discards pending staged content without publishing it.
export async function discardStagedContent(env, sourceType) {
  await env.DB.prepare(`DELETE FROM content_staging WHERE source_type = ?`).bind(sourceType).run();
}