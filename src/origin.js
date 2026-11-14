// Origin resolution for akari-x402.
//
// Order: AKARI_ORIGIN (explicit) -> AKARI_ORIGIN_FILE (a file containing the URL) -> built-in stable URL.
// The built-in URL is the Akash ingress that fronts the desk's origin, not the retired
// *.workers.dev host: a package that ships a dead default is worse than no package.

import fs from 'node:fs';

export const STABLE_ORIGIN = 'https://03s9tr085tfe5agke0tpqng34o.ingress.quanglong.org';

export function resolveOrigin() {
  const env = (process.env.AKARI_ORIGIN || '').trim();
  if (env) return env.replace(/\/+$/, '');
  const file = (process.env.AKARI_ORIGIN_FILE || '').trim();
  if (file) {
    try {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return v.replace(/\/+$/, '');
    } catch {
      /* fall through to the stable default */
    }
  }
  return STABLE_ORIGIN;
}

export async function getJson(origin, path, { headers = {}, timeoutMs = 25000 } = {}) {
  const url = origin.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'akari-x402-mcp/1.0.0', accept: 'application/json', ...headers },
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body: keep raw */
    }
    return { status: res.status, headers: res.headers, text, json, url };
  } finally {
    clearTimeout(t);
  }
}
