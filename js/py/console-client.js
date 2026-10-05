/* The page's side of the Python console's workers: MicroPython's (js/py/console-worker.js) and,
   once the user has agreed to it, the full runtime's (Pyodide, js/py/pyodide-worker.js). Nothing
   starts until the first run() or warm(): a page whose console is never opened fetches no extra
   byte, and Pyodide's worker starts only on a full run (after consent: js/py/dispatch.js).

   run(source) -> Promise<result>    MicroPython: js/py/runner.js's result; rejects with 'stopped' if stopped
   compile(source) -> { ok, error }  MicroPython's compile-only pass
   plan(source) -> need              what a full run of this script needs, and what is still to download
   runFull(source) -> Promise<result>  the full runtime (Pyodide): js/py/pyodide-runner.js's result
   onProgress = (text) => {}         what the full runtime is loading
   dropFull()                        end the full runtime's worker (Remove full Python from this device)
   stop()                            terminate both workers (a runaway script) and start a fresh MicroPython one
   warm()                            start the MicroPython worker now (the console was opened) */
import { consoleFiles } from './lite.js';
import { pyodideFiles } from './pyodide-runner.js';
import { scanImports, packagesFor, downloadFor } from './detect.js';
import { cachedFiles, indexUrl } from './pyodide-cache.js';
import { PYODIDE } from './pyodide-files.js';

const text = (url, what) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`the console's ${what} did not load (${r.status})`);
  return r.text();
});
const texts = (files) => Promise.all(Object.entries(files).map(async ([n, url]) => [n, await text(url, n)])).then(Object.fromEntries);
const engineBytes = () => fetch(new URL('../../cufsm.wasm', import.meta.url)).then((r) => r.arrayBuffer());

/* one worker: spawned on demand, sent its boot message, then id'd requests */
function workerPort(url, bootMessage, onEvent = () => {}) {
  let w = null, ready = null, next = 1;
  const pending = new Map();
  const spawn = () => {
    const worker = new Worker(url, { type: 'module' });
    w = worker;
    ready = new Promise((res, rej) => {
      worker.onmessage = ({ data: m }) => {
        if (m?.type === 'ready') { res(); return; }
        if (m?.type === 'boot-error') { rej(new Error(m.error)); return; }
        if (m?.type === 'progress') { onEvent(m); return; }
        const p = pending.get(m?.id);
        if (!p) return;
        pending.delete(m.id);
        m.error ? p.rej(new Error(m.error)) : p.res(m.result);
      };
      worker.onerror = (e) => rej(new Error(e.message || 'the console worker failed to load'));
    });
    ready.catch(() => {});
    bootMessage().then((msg) => worker.postMessage(msg.message, msg.transfer ?? []),
      (e) => { worker.onerror?.({ message: String(e?.message ?? e) }); });
    return ready;
  };
  const kill = (why) => {
    if (w) { w.onmessage = w.onerror = null; w.terminate(); }
    w = null; ready = null;
    for (const p of pending.values()) p.rej(new Error(why));
    pending.clear();
  };
  return {
    warm() { if (!w) spawn(); return ready; },
    async ask(type, source) {
      if (!w) spawn();
      try { await ready; } catch (e) { kill('failed'); throw e; }   // the next run tries again
      return new Promise((res, rej) => {
        const id = next++;
        pending.set(id, { res, rej });
        w.postMessage({ type, id, source: String(source) });
      });
    },
    kill,
    spawn,
    get started() { return !!w; },
  };
}

export function createConsoleClient() {
  let mpBytes = null, fullBytes = null;
  const loadMp = () => mpBytes ??= Promise.all([
    engineBytes(),
    fetch(new URL('../../vendor/civilkit/micropython.wasm', import.meta.url)).then((r) => r.arrayBuffer()),
    texts(consoleFiles()),
  ]).catch((e) => { mpBytes = null; throw e; });
  const loadFull = () => fullBytes ??= Promise.all([engineBytes(), texts(pyodideFiles())])
    .catch((e) => { fullBytes = null; throw e; });

  const mp = workerPort(new URL('./console-worker.js', import.meta.url),
    () => loadMp().then(([wasm, mpWasm, files]) => ({ message: { type: 'boot', wasm, mpWasm, files } })));
  const client = {
    onProgress: () => {},
    warm() { return mp.warm(); },
    run(source) { return mp.ask('run', source); },
    compile(source) { return mp.ask('compile', source); },
    /* what a full run needs: its packages, the files still to download and their bytes (the core
       and packages neither on the device nor loaded in the running full-runtime worker) */
    async plan(source) {
      const { packages, notHosted } = packagesFor(scanImports(source));
      const have = await cachedFiles();
      for (const f of loadedFiles) have.add(f);
      return { ...downloadFor(packages, have), packages, notHosted, version: PYODIDE.version, python: PYODIDE.python };
    },
    async runFull(source) {
      const r = await full.ask('run', source);
      if (r) {
        PYODIDE.core.forEach((f) => loadedFiles.add(f));
        (r.packages ?? []).forEach((k) => loadedFiles.add(PYODIDE.packages[k].file));
      }
      return r;
    },
    stop() {
      mp.kill('stopped');
      if (full.started) { full.kill('stopped'); loadedFiles.clear(); }
      mp.spawn();
    },
    /* the full runtime's worker ended and forgotten (the device's copy is being removed) */
    dropFull() { if (full.started) full.kill('stopped'); loadedFiles.clear(); },
    get started() { return mp.started; },
    get fullStarted() { return full.started; },
  };
  const loadedFiles = new Set();
  const full = workerPort(new URL('./pyodide-worker.js', import.meta.url),
    () => loadFull().then(([wasm, files]) => ({ message: { type: 'boot', wasm, files, indexURL: indexUrl() } })),
    (m) => client.onProgress(m.text));
  return client;
}
