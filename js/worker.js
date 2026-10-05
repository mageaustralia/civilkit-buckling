/* The engine's worker. In a browser it is started with new Worker(url, { type: 'module' });
   makeHandler is exported so Node tests can drive it without a DOM Worker. */
import { loadEngine } from './engine.js';

export async function makeHandler(wasmSource, post) {
  const eng = await loadEngine(wasmSource);
  const cancelled = new Set();
  const active = new Set();                     // chunked runs a cancel may target
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));   // lets a cancel message in
  return async function handle({ id, method, args }) {
    try {
      if (method === 'cancel') {
        if (active.has(args[0])) cancelled.add(args[0]);
        post({ id, result: true });
        return;
      }
      if (method === 'signatureChunked') {
        const [b, opts, chunk] = args;
        active.add(id);
        try {
          const L = opts.lengths, parts = [];
          for (let i = 0; i < L.length; i += chunk) {
            await yieldNow();
            if (cancelled.has(id)) { cancelled.delete(id); post({ id, error: 'cancelled' }); return; }
            parts.push(eng.signature(b, { ...opts, lengths: L.slice(i, i + chunk) }));
            post({ id, progress: Math.min(1, (i + chunk) / L.length) });
          }
          const out = new Float64Array(parts.reduce((n, p) => n + p.length, 0));
          let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
          post({ id, result: out });
        } finally {
          active.delete(id);
          cancelled.delete(id);
        }
        return;
      }
      post({ id, result: eng[method](...args) });
    } catch (e) {
      post({ id, error: String(e?.message ?? e) });
    }
  };
}

/* The worker's message loop: { boot } loads the engine, and calls that arrive before it is up
   wait in a queue. A failed boot is final: the queued calls and every later one get the boot
   error back, so nothing on the page waits on an answer that will never come. */
export function bootLoop(post, make = makeHandler) {
  let handle = null, bootErr = null;
  const queue = [];
  const refuse = (m) => post({ id: m?.id, error: `the engine failed to load: ${bootErr}` });
  return async function onmessage(data) {
    if (data?.boot) {
      try { handle = await make(data.boot, post); post({ ready: true }); }
      catch (e) { bootErr = String(e?.message ?? e); post({ ready: false, error: bootErr }); }
      for (const m of queue.splice(0)) (handle ? handle(m) : refuse(m));
      return;
    }
    if (handle) return handle(data);
    if (bootErr != null) return refuse(data);
    queue.push(data);
  };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined') {
  const on = bootLoop((m) => self.postMessage(m));
  self.onmessage = (ev) => { on(ev.data); };
}
