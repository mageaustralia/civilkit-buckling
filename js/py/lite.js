/* cufsm_rs lite on MicroPython: how the console makes `import cufsm_rs` work.

   The lite package (py/cufsm_rs_lite/: __init__.py and plot.py, which draws in the console) is written into
   MicroPython's own filesystem at /lib/cufsm_rs/, which is on MicroPython's sys.path, so a script
   imports it as the published package (`import cufsm_rs`, `import cufsm_rs as fsm`). The engine
   transport (js/py/transport.js) is registered as the JS module `_cufsm_native`, the name the
   lite package imports; JSON strings cross the boundary, with numbers packed bit for bit.

   The example scripts' shared module (py/examples/dsm.py: the lipped C builder and the DSM
   column strength) is written to /lib/ beside it, so an example, or the user's own script, can
   `import dsm` as it would from the script's folder under CPython.

   Files are passed in as text, so this module does no I/O and runs in a worker, the page or
   Node: LITE_FILES and liteUrl(), LIB_FILES and libUrl() name the files for the caller to read. */
export const LITE_FILES = ['__init__.py', 'plot.py'];
export const liteUrl = (name) => new URL(`../../py/cufsm_rs_lite/${name}`, import.meta.url);
export const LIB_FILES = ['dsm.py'];
export const libUrl = (name) => new URL(`../../py/examples/${name}`, import.meta.url);
/* every file the console installs, as { name: url }: the caller reads these and passes the text */
export const consoleFiles = () => Object.fromEntries([...LITE_FILES.map((n) => [n, liteUrl(n)]), ...LIB_FILES.map((n) => [n, libUrl(n)])]);

/* mp: a loadMicroPython() instance; transport: createTransport(engine); files: { name: text },
   LITE_FILES required, LIB_FILES installed when given;
   figure(json): where cufsm_rs.plot hands a figure spec (JSON, numbers packed as the transport's),
   in the run's output order (js/py/runner.js); without one, a plot raises */
export function installLite(mp, transport, files, { figure } = {}) {
  for (const name of LITE_FILES) if (typeof files[name] !== 'string') throw new Error(`cufsm_rs lite: ${name} is missing`);
  mp.registerJsModule('_cufsm_native', {
    call: (op, json) => transport.call(String(op), String(json)),
    figure: (json) => {
      if (!figure) throw new Error('this Python has nowhere to draw a figure');
      figure(String(json));
    },
  });
  for (const dir of ['/lib', '/lib/cufsm_rs']) {
    try { mp.FS.mkdir(dir); } catch { /* it exists */ }
  }
  for (const name of LITE_FILES) mp.FS.writeFile(`/lib/cufsm_rs/${name}`, files[name]);
  for (const name of LIB_FILES) if (typeof files[name] === 'string') mp.FS.writeFile(`/lib/${name}`, files[name]);
}
