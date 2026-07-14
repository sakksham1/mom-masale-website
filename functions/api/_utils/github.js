// functions/api/_utils/github.js
// Reads and writes files in the site's own GitHub repo via the Contents API.
//
// WHY: products live in data/products.json, not in D1 — the whole
// build-site.js / generate-site.yml pipeline is built around that file being
// the single source of truth for products + recipes. Rather than fork that
// (products in D1, recipes still in JSON — a split-brain setup), the admin
// dashboard commits directly to data/products.json. Cloudflare Pages'
// existing GitHub Actions workflow (generate-site.yml) then rebuilds the
// product pages + sitemap automatically, exactly as if Sakksham had edited
// the file by hand and pushed.
//
// Requires two env vars (see ADMIN_AND_LIVE_PAYMENTS_SETUP.md):
//   GITHUB_TOKEN  — a fine-grained PAT with Contents: Read & Write on this repo only
//   GITHUB_REPO   — "owner/repo", e.g. "sakksham1/sakksham1-mom-masale-website"
//   GITHUB_BRANCH — optional, defaults to "main"

const API = 'https://api.github.com';

function b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

export async function readRepoFile(env, path) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    throw new Error('GITHUB_TOKEN / GITHUB_REPO are not configured for this environment');
  }
  const branch = env.GITHUB_BRANCH || 'main';
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${branch}`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'mom-masale-admin-dashboard',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return { content: b64DecodeUtf8(data.content), sha: data.sha };
}

export async function writeRepoFile(env, path, newContent, sha, message) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    throw new Error('GITHUB_TOKEN / GITHUB_REPO are not configured for this environment');
  }
  const branch = env.GITHUB_BRANCH || 'main';
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'mom-masale-admin-dashboard',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: b64EncodeUtf8(newContent),
      sha,
      branch,
      committer: { name: 'Mom Masale Admin Dashboard', email: 'admin-bot@mommasale.com' },
    }),
  });
  if (!res.ok) {
    throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
