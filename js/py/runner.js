/* The Python console's runs: one script on a fresh interpreter, its output buffered and handed
   back whole when it finishes (no side effects until
   a run finishes, so a later runtime fallback can re-run a script safely).

   Pure of the DOM and of the worker: the console worker (js/py/console-worker.js) and the Node
   tests drive the same createRunner(). Each run gets a new MicroPython (about 5 ms), so nothing a
   script defines or patches leaks into the next run; the engine and its transport are shared.

   A run's result:
     { runtime: 'micropython', ok, stdout, output, error: null | { text, type, message, line, fullRuntime }, ms, truncated }
   stdout is everything printed; output is the same text with the figures (cufsm_rs.plot) where the
   script drew them, in order: [{ text } | { figure: spec }], spec as js/py/figures.js reads it.
   runtime is a key of RUNTIMES: 'micropython' here, 'pyodide' (shown as "full Python") for
   js/py/pyodide-runner.js's runs. */
import { createTransport, unpack } from './transport.js';
import { installLite } from './lite.js';

export const RUNTIMES = { micropython: 'MicroPython', pyodide: 'full Python' };
export const OUTPUT_MAX = 1 << 20;           // characters kept of a run's output; a runaway print loop stops here
export const FIGURES_MAX = 50;               // figures one run may draw
export const FIGURE_KINDS = ['section', 'signature', 'mode'];

/* A MicroPython traceback, read for the console: the exception's type and message (its last
   line), the line of the user's script it points at (the innermost "<stdin>" frame; frames in
   the cufsm_rs package are not the script's), and, for an import of a module MicroPython does
   not have or an error that names the full runtime, what the full runtime would do for it. */
export function readTraceback(text) {
  const t = String(text ?? '').replace(/\s+$/, '');
  const lines = t.split(/\r?\n/);
  const last = lines[lines.length - 1] ?? '';
  const m = /^(\w+(?:\.\w+)*): ?(.*)$/.exec(last);
  const type = m ? m[1] : null;
  const message = m ? m[2] : last;
  let line = null;
  for (const l of lines) {
    const f = /^\s*File "<stdin>", line (\d+)/.exec(l);
    if (f) line = +f[1];
  }
  let fullRuntime = null;
  const missing = type === 'ImportError' && /^no module named '([\w.]+)'/.exec(message);
  if (missing) {
    const mod = missing[1].split('.')[0];
    fullRuntime = { module: mod, text: `${mod} is not available on MicroPython, the console's default runtime. `
      + `Scripts that import ${mod} need the full Python runtime (Pyodide), which the console downloads when you agree. `
      + 'MicroPython runs scripts that use cufsm_rs, math and json.' };
  } else if (/full Python runtime/.test(message)) {
    fullRuntime = { module: null, text: /matplotlib/.test(message)
      ? 'This needs the full Python runtime (Pyodide, with matplotlib), which the console downloads when you agree. '
        + 'Here cufsm_rs.plot draws its figures in the output, without matplotlib axes.'
      : 'This needs the full Python runtime (Pyodide, with numpy), which the console downloads when you '
        + 'agree. The lite cufsm_rs here returns plain lists where the package returns numpy arrays.' };
  }
  return { type, message, line, fullRuntime };
}

/* engine: loadEngine()'s; loadMicroPython(options): the vendored loader (the worker passes the
   wasm bytes in through it); files: the text of the files the console installs (js/py/lite.js consoleFiles()) */
export function createRunner({ engine, loadMicroPython, files, heapsize = 64 * 1024 * 1024 }) {
  const transport = createTransport(engine);
  return {
    /* a compile-only pass (js/py/detect.js step 2): { ok, error } with the SyntaxError read as
       run()'s, on a fresh interpreter; nothing of the script runs */
    async compile(source) {
      const mp = await loadMicroPython({ heapsize, stdout: () => {}, stderr: () => {}, linebuffer: false });
      mp.globals.set('_ckb_src', String(source));
      try {
        mp.runPython('compile(_ckb_src, "<stdin>", "exec")');
        return { ok: true, error: null };
      } catch (e) {
        const t = String(e?.message ?? e);
        return { ok: false, error: { text: t.replace(/\s+$/, ''), ...readTraceback(t) } };
      }
    },
    async run(source) {
      const t0 = performance.now();
      let size = 0, truncated = false;
      /* MicroPython writes byte by byte (linebuffer off), so a figure drawn after a print with
         end="" still lands after that text: the pending bytes are flushed before the figure */
      const output = [];
      let pend = [];
      const dec = new TextDecoder();
      const text = (s) => {
        if (truncated || !s) return;
        if (size + s.length > OUTPUT_MAX) { s = s.slice(0, OUTPUT_MAX - size); truncated = true; }
        size += s.length;
        const last = output[output.length - 1];
        if (last && 'text' in last) last.text += s; else output.push({ text: s });
      };
      const flush = () => { if (pend.length) { text(dec.decode(Uint8Array.from(pend))); pend = []; } };
      const write = (bytes) => {
        if (truncated) return;
        for (const c of bytes) { pend.push(c); if (c === 10) flush(); }
      };
      let figures = 0;
      const figure = (json) => {
        flush();
        if (figures >= FIGURES_MAX) throw new Error(`the console shows at most ${FIGURES_MAX} figures in one run`);
        const spec = unpack(JSON.parse(String(json)));
        if (!spec || !FIGURE_KINDS.includes(spec.kind)) throw new Error(`not a figure the console draws: ${spec?.kind}`);
        figures++;
        output.push({ figure: spec });
      };
      const mp = await loadMicroPython({ heapsize, stdout: write, stderr: write, linebuffer: false });
      installLite(mp, transport, files, { figure });
      let error = null;
      try {
        mp.runPython(String(source));
      } catch (e) {
        const t = String(e?.message ?? e);
        error = { text: t.replace(/\s+$/, ''), ...readTraceback(t) };
      }
      flush();
      const stdout = output.filter((o) => 'text' in o).map((o) => o.text).join('').replace(/\n$/, '');
      const last = output[output.length - 1];
      if (last && 'text' in last) last.text = last.text.replace(/\n$/, '');
      return { runtime: 'micropython', ok: !error, stdout, output, error, truncated,
               ms: Math.round(performance.now() - t0) };
    },
  };
}
