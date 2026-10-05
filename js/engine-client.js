const CANCELLABLE = new Set(['signatureChunked', 'modes']);
export function startEngine(wasmUrl) { return new EngineClient(wasmUrl); }

class EngineClient {
  constructor(wasmUrl) { this.wasmUrl = String(wasmUrl); this.#spawn(); }
  #w; #next = 1; #pending = new Map(); #dead = false; #deadMsg = null;
  #spawn() {
    this.#dead = false;
    this.#deadMsg = null;
    this.#w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.ready = new Promise((res, rej) => { this.#boot = { res, rej }; });
    this.ready.catch(() => {});                    // a caller that never awaits ready is not an unhandled rejection
    this.#w.onmessage = (ev) => this.#on(ev.data);
    this.#w.onerror = (e) => this.#die(`the worker script failed to load${e?.message ? `: ${e.message}` : ''}`);
    this.#w.postMessage({ boot: this.wasmUrl });
  }
  #boot;
  #on(m) {
    if ('ready' in m) {
      if (m.ready) { this.#boot?.res(); this.#boot = null; }
      else this.#die(m.error || 'the engine failed to load');   // dead: later calls fail at once
      return;
    }
    const p = this.#pending.get(m.id);
    if (!p) return;
    if (m.progress != null) { p.onProgress?.(m.progress); return; }
    this.#pending.delete(m.id);
    m.error ? p.rej(new Error(m.error)) : p.res(m.result);
  }
  /* The worker is gone and will not come back: reject ready exactly once, then every
     pending call, and make later calls fail immediately instead of hanging. */
  #die(msg) {
    this.#dead = true;
    this.#deadMsg = msg;
    if (this.#boot) { this.#boot.rej(new Error(msg)); this.#boot = null; }
    this.#failAll(msg);
  }
  #failAll(msg) { for (const p of this.#pending.values()) p.rej(new Error(msg)); this.#pending.clear(); }
  /* Every call keeps the message it posted, so a cancel that replaces the worker can send the
     calls it did not mean to cancel again. */
  #post(msg, extra = {}) {
    return new Promise((res, rej) => {
      if (this.#dead) { rej(new Error(this.#deadMsg || 'the engine stopped: the worker terminated')); return; }
      this.#pending.set(msg.id, { res, rej, msg, ...extra });
      this.#w.postMessage(msg);
    });
  }
  call(method, ...args) { return this.#post({ id: this.#next++, method, args }); }
  signatureChunked(buffers, opts, { chunk = 15, onProgress } = {}) {
    const id = this.#next++;
    return this.#post({ id, method: 'signatureChunked', args: [buffers, opts, chunk] }, { onProgress });
  }
  /* Cancel what belongs to the solve on screen: the chunked signature and every modes call (the
     minima's classification and the mode browser's rows), all of which a model change makes
     useless. The worker only sees a cancel message between chunks, and one modes call on a big
     model runs for many seconds, so the worker is terminated and a fresh one started instead:
     those calls reject with 'cancelled' now, and every other call in flight (props, stresgen,
     firstYield - usually the new model's own) is posted again to the new worker, which queues it
     until the engine has booted. With nothing cancellable running this does nothing. */
  cancel() {
    if (this.#dead) return;
    const doomed = [...this.#pending.values()].filter((p) => CANCELLABLE.has(p.msg.method));
    if (!doomed.length) return;
    for (const p of doomed) this.#pending.delete(p.msg.id);
    this.#w.onmessage = this.#w.onerror = null;
    this.#w.terminate();
    for (const p of doomed) p.rej(new Error('cancelled'));
    const keep = [...this.#pending.values()];
    this.#spawn();
    for (const p of keep) this.#w.postMessage(p.msg);
  }
  restart() { this.#w.terminate(); this.#failAll('restarted'); this.#spawn(); }
  /* Kill the worker without restarting it (the test hook's error-state evidence): every
     in-flight call rejects now, later calls reject immediately, Retry restarts. */
  crash() { if (this.#dead) return; this.#w.terminate(); this.#die('the engine stopped: the worker terminated'); }
}
