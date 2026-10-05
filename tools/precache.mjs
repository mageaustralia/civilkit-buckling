#!/usr/bin/env node
/* Writes sw.js, the offline service worker: the list of files the app needs and a version made
   from their contents, so any change to any of them is a new worker and so a new release.

     node tools/precache.mjs           write sw.js            (npm run precache)
     node tools/precache.mjs --check   exit 1 if sw.js is stale (npm test checks the same)

   Run it after changing any file the page loads, and commit sw.js with the change. The list
   is every file the deploy sync ships (the same extensions, the same folders), plus the
   manifest and its icons, less vendor/pyodide/: the full Python runtime is never precached with the
   app. Its files join a cache of their own (js/py/pyodide-cache.js PY_CACHE) only once the user
   has agreed to download them; the worker answers from that cache too. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PY_CACHE, PY_CACHE_PREFIX } from '../js/py/pyodide-cache.js';
import { PYODIDE } from '../js/py/pyodide-files.js';

const SHIP = /\.(js|mjs|css|wasm|json|ckext|html|svg|png|webp|webmanifest|py)$/;

export function precacheFiles(root = '.') {
  const walk = (dir) => !existsSync(join(root, dir)) ? [] : readdirSync(join(root, dir), { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? walk(`${dir}/${e.name}`) : SHIP.test(e.name) ? [`${dir}/${e.name}`] : [])
    .sort();
  return ['./', 'index.html', 'manifest.webmanifest', 'styles.css', 'app.js', 'cufsm.wasm',
    ...walk('styles'), ...walk('js'), ...walk('py'), ...walk('vendor').filter((f) => !f.startsWith('vendor/pyodide/')), ...walk('store'), 'guide/', ...walk('guide'),
    ...walk('icons')];
}

/* The worker. Every request inside the app folder is answered from one cache per release, matched
   without its query (the deploy stamps ?v=<hash> on the page's URLs), so a page and the files it
   loads always come from the same release: an old page never meets a newer module, and a new
   page never asks for a file the old cache lacks. A new release installs beside the running one
   and waits; the page offers Reload, which activates it (skipWaiting) and drops the old cache. */
const WORKER = `
const CACHE = 'ckb-' + VERSION;
const BASE = new URL('./', self.location).href;
const abs = (f) => new URL(f, BASE).href;
// the full Python runtime (Pyodide): its own cache, filled by the console once the user agrees
const PY_BASE = abs(PY_DIR);
const GUIDE = abs('guide/');

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.all(FILES.map(async (f) => {
    // the version in the query and cache: 'reload' get past every HTTP cache on the way
    const res = await fetch(abs(f) + '?sw=' + VERSION, { cache: 'reload' });
    if (!res.ok) throw new Error(f + ': ' + res.status);
    // a host that redirects index.html to ./ gives a redirected response, which a navigation
    // must not be answered with: keep the body and headers only
    await cache.put(abs(f), res.redirected
      ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
      : res);
  }));
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys())
    if ((k.startsWith('ckb-') && k !== CACHE) || (k.startsWith(PY_PREFIX) && k !== PY_CACHE)) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(BASE)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // the guide is documentation with no update prompt: the network first, so a reader sees the
    // pages deployed now, and the cached copy only offline
    if (req.url.startsWith(GUIDE)) {
      try { const res = await fetch(req); if (res.ok) return res; } catch { /* offline: the cache below */ }
    }
    const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
    if (req.url.startsWith(PY_BASE)) {
      const py = await (await caches.open(PY_CACHE)).match(req, { ignoreSearch: true, ignoreVary: true });
      if (py) return py;
    }
    // a folder asked for as its index.html, or the other way round
    const path = new URL(req.url).pathname;
    const alt = path.endsWith('/') ? path + 'index.html' : path.endsWith('/index.html') ? path.slice(0, -10) : null;
    const alias = alt && await cache.match(new URL(alt, req.url).href, { ignoreSearch: true, ignoreVary: true });
    return alias || fetch(req);
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
`;

export function buildSw(files, read) {
  const h = createHash('sha256').update(WORKER);
  for (const f of files) if (!f.endsWith('/')) h.update(f).update('\0').update(read(f));
  const version = h.digest('hex').slice(0, 12);
  return `/* CivilKit Buckling's offline service worker. Generated by tools/precache.mjs: do not edit.
   Run npm run precache after changing any file the page loads. */
const VERSION = '${version}';
const FILES = ${JSON.stringify(files, null, 1)};
const PY_DIR = '${PYODIDE.dir}', PY_CACHE = '${PY_CACHE}', PY_PREFIX = '${PY_CACHE_PREFIX}';
${WORKER}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(import.meta.url), '..', '..');
  process.chdir(root);
  const files = precacheFiles('.');
  const sw = buildSw(files, (f) => readFileSync(f));
  const version = /const VERSION = '([0-9a-f]+)'/.exec(sw)[1];
  if (process.argv.includes('--check')) {
    const cur = existsSync('sw.js') ? readFileSync('sw.js', 'utf8') : '';
    if (cur !== sw) { console.error('sw.js is stale: run npm run precache'); process.exit(1); }
    console.log('sw.js is current', version);
  } else {
    writeFileSync('sw.js', sw);
    console.log('sw.js', version, files.length, 'files');
  }
}
