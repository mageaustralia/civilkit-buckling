/* The Python console's worker: the engine, MicroPython and the lite cufsm_rs package, for the
   user's own scripts. It is not the extension sandbox (js/ext/worker.js), which runs modules other
   people publish with the page's globals removed: this one runs only what the user typed or
   pasted, and holds nothing a module could reach. Started by js/py/console-client.js on the
   console's first open; Stop terminates it and starts a fresh one.

   The host sends every byte it needs in `boot` (the engine and MicroPython wasm, the lite
   package's .py files), as the extension worker's host does, so the worker fetches nothing. */
import { loadEngine } from '../engine.js';
import { createRunner } from './runner.js';
import * as micropython from '../../vendor/civilkit/micropython.mjs';

/* MicroPython's loader locates its wasm by URL and fetches it; it takes no bytes option. The
   bytes from `boot` are served under that name, and every other fetch goes to the real one. */
let MP_WASM = null;
const realFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = String(input && (input.url !== undefined ? input.url : input));
  if (MP_WASM && url.endsWith('micropython.wasm'))
    return Promise.resolve(new Response(new Uint8Array(MP_WASM), { headers: { 'Content-Type': 'application/wasm' } }));
  return realFetch(input, init);
};

let runner = null;
self.onmessage = async ({ data: m }) => {
  if (m?.type === 'boot') {
    try {
      MP_WASM = m.mpWasm;
      const engine = await loadEngine(m.wasm);
      runner = createRunner({ engine, files: m.files,
        loadMicroPython: (o) => micropython.loadMicroPython({ ...o, url: 'micropython.wasm' }) });
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'boot-error', error: String(e?.message ?? e) });
    }
    return;
  }
  if (m?.type === 'run' || m?.type === 'compile') {
    try {
      self.postMessage({ id: m.id, result: await runner[m.type](m.source) });
    } catch (e) {
      self.postMessage({ id: m.id, error: String(e?.message ?? e) });
    }
  }
};
