/* The Python console's full runtime: Pyodide (CPython in WebAssembly) with cufsm-rs-py's own Python
   layer, unchanged (py/cufsm-rs-py/cufsm_rs, pinned), whose compiled _native is replaced by
   py/pyodide/_native_js.py over the page's transport (js/py/transport.js), the same engine and the
   same JSON as the MicroPython lite layer. numpy arrays, the package's reprs and its matplotlib
   plots are the package's own.

   Pure of the DOM and of the worker: the Pyodide worker (js/py/pyodide-worker.js) and the Node
   tests drive the same createPyodideRunner(). Pyodide boots once (seconds); each run gets fresh
   globals and a clean matplotlib (py/pyodide/console.py), and loads only the packages its
   imports need (loadPackagesFromImports, plus what the console's own modules imply: cufsm_rs
   needs numpy, cufsm_rs.plot matplotlib).

   A run's result is js/py/runner.js's, with runtime 'pyodide'; output may also hold
   { image: { svg, alt } }, a matplotlib figure (SVG text), where the script showed it. */
import { createTransport } from './transport.js';
import { readTraceback, OUTPUT_MAX } from './runner.js';
import { scanImports, packagesFor } from './detect.js';

/* the files the full runtime installs, as { path under /console/lib: url } */
/* (written out whole: the site's sync stamps a ../py/ URL with the release, as for the lite files) */
const PKG = ['__init__.py', '_display.py', 'plot.py'];
const OWN = { '_native.py': '_native_js.py', '_ckb_console.py': 'console.py', '_ckb_backend.py': 'mpl_backend.py' };
export const pyodideFiles = () => ({
  ...Object.fromEntries(PKG.map((f) => [`cufsm_rs/${f}`, new URL(`../../py/cufsm-rs-py/cufsm_rs/${f}`, import.meta.url)])),
  'cufsm_rs/_native.py': new URL(`../../py/pyodide/${OWN['_native.py']}`, import.meta.url),
  'dsm.py': new URL(`../../py/examples/dsm.py`, import.meta.url),
  '_ckb_console.py': new URL(`../../py/pyodide/${OWN['_ckb_console.py']}`, import.meta.url),
  '_ckb_backend.py': new URL(`../../py/pyodide/${OWN['_ckb_backend.py']}`, import.meta.url),
});
const LIB = '/console/lib';

/* engine: loadEngine()'s; loadPyodide(options): Pyodide's (its pyodide.mjs), called once with
   indexURL; files: { path: text } for pyodideFiles(); onProgress(text): what is loading */
export function createPyodideRunner({ engine, loadPyodide, indexURL, files, onProgress = () => {} }) {
  const transport = createTransport(engine);
  let py = null, booting = null, host = null;
  const loaded = new Set();                         // package keys this Pyodide has loaded

  async function boot() {
    const t0 = performance.now();
    onProgress('Starting the full Python runtime…');
    const p = await loadPyodide({ indexURL: String(indexURL), fullStdLib: false,
      env: { MPLBACKEND: 'module://_ckb_backend', HOME: '/home/pyodide' } });
    for (const path of Object.keys(pyodideFiles())) {
      if (typeof files[path] !== 'string') throw new Error(`the full runtime's ${path} is missing`);
      const full = `${LIB}/${path}`;
      p.FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
      p.FS.writeFile(full, files[path]);
    }
    p.registerJsModule('_cufsm_native', { call: (op, json) => transport.call(String(op), String(json)) });
    p.registerJsModule('_ckb_host', { image: (svg, alt) => host?.image(String(svg), String(alt)) });
    p.runPython(`import sys\nsys.path.insert(0, ${JSON.stringify(LIB)})\nimport _ckb_console`);
    py = p;
    return Math.round(performance.now() - t0);
  }

  return {
    get booted() { return !!py; },
    get pyodide() { return py; },                   // the interpreter itself, for the tests
    loaded,
    /* boot (once) and load what this script imports; resolves to { bootMs, loadMs, packages } */
    async prepare(source) {
      let bootMs = 0;
      if (!py) { booting ??= boot().catch((e) => { booting = null; throw e; }); bootMs = await booting; }
      const mods = scanImports(source);
      const { packages, notHosted } = packagesFor(mods);
      const t0 = performance.now();
      const fresh = packages.filter((k) => !loaded.has(k));
      if (fresh.length) {
        onProgress(`Loading ${fresh.join(', ')}…`);
        // only what the script imports is downloaded; the console's own modules' needs are named
        // (a package the console does not host is left to the script's own ImportError)
        const quiet = { messageCallback: () => {}, errorCallback: () => {} };
        if (!notHosted.length) await py.loadPackagesFromImports(String(source), quiet);
        await py.loadPackage(packages, quiet);
        packages.forEach((k) => loaded.add(k));
      }
      return { bootMs, loadMs: Math.round(performance.now() - t0), packages, notHosted };
    },
    async run(source) {
      const t0 = performance.now();
      const prep = await this.prepare(source);
      const output = [];
      let size = 0, truncated = false;
      const text = (s) => {
        if (truncated || !s) return;
        if (size + s.length > OUTPUT_MAX) { s = s.slice(0, OUTPUT_MAX - size); truncated = true; }
        size += s.length;
        const last = output[output.length - 1];
        if (last && 'text' in last) last.text += s; else output.push({ text: s });
      };
      const dec = new TextDecoder();
      const write = { write: (buf) => { text(dec.decode(buf, { stream: true })); return buf.length; } };
      py.setStdout(write);
      py.setStderr(write);
      host = { image: (svg, alt) => output.push({ image: { svg, alt } }) };
      let error = null;
      try {
        const run = py.globals.get('_ckb_console').run;
        const tb = run(String(source));
        run.destroy?.();
        if (tb != null) error = { text: String(tb).replace(/\s+$/, ''), ...readTraceback(tb) };
      } catch (e) {
        const t = String(e?.message ?? e);
        error = { text: t.replace(/\s+$/, ''), ...readTraceback(t) };
      } finally {
        host = null;
        text(dec.decode());
      }
      if (error && prep.notHosted.length) {
        const n = prep.notHosted.map((x) => `${x.module} (${x.package})`).join(', ');
        error.fullRuntime = { module: prep.notHosted[0].module, hosted: false,
          text: `${n}: not hosted by the console. The full runtime here has numpy, scipy and matplotlib; `
            + 'install the others with pip on your own machine.' };
      }
      const stdout = output.filter((o) => 'text' in o).map((o) => o.text).join('').replace(/\n$/, '');
      const last = output[output.length - 1];
      if (last && 'text' in last) last.text = last.text.replace(/\n$/, '');
      return { runtime: 'pyodide', ok: !error, stdout, output, error, truncated,
               ms: Math.round(performance.now() - t0), bootMs: prep.bootMs, loadMs: prep.loadMs, packages: prep.packages };
    },
  };
}
