/* The Python console's full-runtime worker: the engine and Pyodide (js/py/pyodide-runner.js), for
   the user's own scripts only. A second worker beside the MicroPython one (js/py/console-worker.js),
   started by js/py/console-client.js only once the user has agreed to the download; Stop ends it
   and the next full run starts a fresh one (from the device's copy, no download).

   Pyodide's files come from the app's own vendor/pyodide/<version>/ (js/py/pyodide-files.js).
   Every fetch of one goes through the device's Pyodide cache first (Cache Storage, a cache of its
   own, PY_CACHE, so the app's precache and size are unchanged): a file found there is used as it
   is, and a file fetched from the network is stored there, since fetching it means the user has
   agreed to it. The service worker (sw.js) answers from the same cache, so the module Pyodide
   imports (pyodide.asm.mjs, which no fetch here sees) works offline too.

   Messages in: boot { wasm, files, indexURL }, run { id, source }. Out: ready | boot-error,
   progress { text }, { id, result | error }. */
import { loadEngine } from '../engine.js';
import { createPyodideRunner } from './pyodide-runner.js';
import { PY_CACHE } from './pyodide-cache.js';

let INDEX = null;
const realFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = String(input && (input.url !== undefined ? input.url : input));
  if (!INDEX || !url.startsWith(INDEX) || typeof caches === 'undefined') return realFetch(input, init);
  const key = url.split(/[?#]/)[0];
  let cache = null;
  try { cache = await caches.open(PY_CACHE); } catch { /* no Cache Storage (a private window): the network only */ }
  const hit = cache && await cache.match(key).catch(() => null);
  if (hit) return hit;
  const res = await realFetch(input, init);
  if (cache && res.ok) {
    try { await cache.put(key, res.clone()); } catch { /* full or refused: it still runs, online */ }
  }
  return res;
};

let runner = null;
const progress = (text) => self.postMessage({ type: 'progress', text });
self.onmessage = async ({ data: m }) => {
  if (m?.type === 'boot') {
    try {
      INDEX = String(m.indexURL);
      const engine = await loadEngine(m.wasm);
      // the two modules Pyodide imports (import(), which no fetch here sees) go through the cache
      // first, so the device's copy has them and sw.js can answer them offline
      await Promise.all(['pyodide.mjs', 'pyodide.asm.mjs'].map((f) => self.fetch(new URL(f, INDEX).href).then((r) => {
        if (!r.ok) throw new Error(`the full runtime's ${f} did not load (${r.status})`);
      })));
      const { loadPyodide } = await import(new URL('pyodide.mjs', INDEX).href);
      runner = createPyodideRunner({ engine, files: m.files, indexURL: INDEX, loadPyodide, onProgress: progress });
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'boot-error', error: String(e?.message ?? e) });
    }
    return;
  }
  if (m?.type === 'run') {
    try {
      self.postMessage({ id: m.id, result: await runner.run(m.source) });
    } catch (e) {
      self.postMessage({ id: m.id, error: String(e?.message ?? e) });
    }
  }
};
