/* The extension sandbox: MicroPython, the engine and one module. Started from a blob URL so the page
   CSP applies (connect-src 'self', no unsafe-eval). Globals a module could reach through MicroPython's
   `js` module are removed before any module code runs. */
import { loadEngine } from '../engine.js';
import { createRuntime } from './runtime.js';
import { runWorkedExamples } from './examples.js';
import * as micropython from '../../vendor/civilkit/micropython.mjs';

const post = self.postMessage.bind(self);
const TOKEN = crypto.randomUUID();          // the host only accepts messages that carry it
for (const k of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'indexedDB', 'caches',
                 'Worker', 'SharedWorker', 'BroadcastChannel', 'WebTransport', 'navigator', 'eval']) {
  try { delete self[k]; } catch { /* */ }
  try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch { /* */ }
  for (let p = Object.getPrototypeOf(self); p; p = Object.getPrototypeOf(p)) try { delete p[k]; } catch { /* */ }
}
self.postMessage = undefined;               // modules cannot forge host messages
/* importScripts must be a function while MicroPython's loader runs: it detects its environment at
   call time, and deleting it outright makes it see a shell and abort. The moment the runtime is up
   it becomes `undefined` like everything else - a module calling it then gets None in Python
   (catchable), not a JS exception unwrapped through runPython. Module workers cannot importScripts
   anyway, and the sandbox would refuse the URL regardless (script-src 'self'). */
Object.defineProperty(self, 'importScripts', {
  value: () => { throw new TypeError('importScripts is not available in the sandbox'); },
  configurable: true, writable: false,
});

/* MicroPython loads its .wasm through fetch, and fetch is removed for module code. The vendored
   loadMicroPython() takes only a `url` for locating it (no wasmBinary-style bytes option), so the
   page sends the bytes in `boot` and a wrapper serves them under the sentinel name
   'micropython.wasm' - and nothing else, to nothing else. The wrapper is replaced by the permanent
   `undefined` the moment the runtime is up, so no fetch stays reachable for module code. The
   original fetch survives until then because no module can run before boot completes. */
let MP_WASM = null;
Object.defineProperty(self, 'fetch', {
  value: (input) => {
    const url = String(input && (input.url !== undefined ? input.url : input));
    if (MP_WASM && url.endsWith('micropython.wasm'))
      return Promise.resolve(new Response(new Uint8Array(MP_WASM), { headers: { 'Content-Type': 'application/wasm' } }));
    return Promise.reject(new TypeError('fetch is not available in the sandbox'));
  },
  configurable: true, writable: false,
});

let rt = null;
let current = null;                         // the bundle the open session runs
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'boot') {
      MP_WASM = m.mpWasm;
      const engine = await loadEngine(m.wasm);           // bytes, sent by the host: no fetch needed
      rt = await createRuntime({ micropython: { loadMicroPython: (o) => micropython.loadMicroPython({ ...o, url: 'micropython.wasm' }) },
                                 engine, stdout: (l) => post({ token: TOKEN, type: 'log', line: l }) });
      MP_WASM = null;
      delete self.fetch;
      Object.defineProperty(self, 'fetch', { value: undefined, configurable: false, writable: false });
      Object.defineProperty(self, 'importScripts', { value: undefined, configurable: false, writable: false });
      post({ token: TOKEN, type: 'ready' });
      return;
    }
    if (m.type === 'load') { rt.load(m.bundle); current = m.bundle; post({ token: TOKEN, id: m.id, value: rt.buildUi({}, [], []) }); return; }
    if (m.type === 'ui') { post({ token: TOKEN, id: m.id, value: rt.buildUi(m.inputs, m.result, m.calcLines) }); return; }
    /* the badge: run a bundle's worked examples here, in the sandbox, then put back the module an
       open session is running (examples load theirs over it) */
    if (m.type === 'examples') {
      const report = await runWorkedExamples(rt, m.bundle);
      if (current) { try { rt.load(current); } catch { /* its next call reports it */ } }
      post({ token: TOKEN, id: m.id, value: report });
      return;
    }
    if (m.type === 'check') { post({ token: TOKEN, id: m.id, value: rt.check(m.inputs, m.snapshot) }); return; }
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (m?.type === 'boot') post({ token: TOKEN, type: 'boot-error', error: msg });
    else post({ token: TOKEN, id: m?.id, error: msg });
  }
};
