import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEngine } from '../js/engine.js';
import { consoleFiles } from '../js/py/lite.js';
import { createRunner } from '../js/py/runner.js';
import { createPyodideRunner, pyodideFiles } from '../js/py/pyodide-runner.js';
import { createTransport, pack, unpack } from '../js/py/transport.js';
import { PYODIDE } from '../js/py/pyodide-files.js';
import { scanImports, codeOnly, beyondMicroPython, packagesFor, downloadFor, fallbackReason, MICROPYTHON_MODULES } from '../js/py/detect.js';
import { runScript } from '../js/py/dispatch.js';
import { unmark } from './fixtures/pyparity/compare.mjs';

/* The Python console's full runtime, in Node: the pinned Pyodide and the
   package's own Python layer (pinned, unchanged), _native_js over the transport with every double
   crossing exactly, matplotlib's figures in the output in order, the detection that picks the
   runtime, and the dispatch: a lite script stays on MicroPython, a numpy script asks before
   anything is downloaded and then runs on Pyodide, and a script that fails partway on MicroPython
   re-runs once and shows one clean output. Numbers against pip: tests/parity/. */
const root = new URL('../', import.meta.url);
const index = new URL(PYODIDE.dir, root);
if (!existsSync(new URL('pyodide.asm.wasm', index)))
  throw new Error(`Pyodide ${PYODIDE.version} is not in ${PYODIDE.dir}: run npm run pyodide (node tools/fetch-pyodide.mjs) once`);
const engine = await loadEngine(await readFile(new URL('cufsm.wasm', root)));
const read = (files) => Promise.all(Object.entries(files).map(async ([n, u]) => [n, await readFile(u, 'utf8')])).then(Object.fromEntries);
const pyFiles = await read(pyodideFiles());
const { loadPyodide } = await import(new URL('pyodide.mjs', index));
const pyo = createPyodideRunner({ engine, files: pyFiles, indexURL: index.pathname, loadPyodide });
const mp = createRunner({ engine, files: await read(consoleFiles()), loadMicroPython: (await import('../vendor/civilkit/micropython.mjs')).loadMicroPython });
/* typed arrays as arrays, everything else as it is (-0 stays -0) */
const plainJs = (v) => (ArrayBuffer.isView(v) || Array.isArray(v) ? [...v].map(plainJs)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainJs(x)])) : v);
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('the pinned Pyodide: every file present with its SHA-256, each under Cloudflare Pages\' 25 MiB', () => {
  assert.match(PYODIDE.version, /^\d+\.\d+\.\d+$/);
  assert.equal(PYODIDE.dir, `vendor/pyodide/${PYODIDE.version}/`);
  for (const f of PYODIDE.core) assert.ok(PYODIDE.files[f], f);
  for (const [f, { size, sha256 }] of Object.entries(PYODIDE.files)) {
    const p = new URL(f, index);
    assert.ok(existsSync(p), `${f} missing`);
    assert.equal(statSync(p).size, size, f);
    assert.equal(sha(readFileSync(p)), sha256, f);
    assert.ok(size < 25 * 1048576, `${f}: ${size} bytes`);
  }
  for (const k of ['numpy', 'matplotlib', 'scipy']) assert.ok(PYODIDE.packages[k], k);
  for (const p of Object.values(PYODIDE.packages)) for (const d of p.depends) assert.ok(PYODIDE.packages[d], `${p.name} needs ${d}`);
  // the lock the release ships agrees with the pins
  const lock = JSON.parse(readFileSync(new URL('pyodide-lock.json', index), 'utf8'));
  for (const [k, p] of Object.entries(PYODIDE.packages)) {
    assert.equal(lock.packages[k].file_name, p.file);
    assert.equal(lock.packages[k].sha256, PYODIDE.files[p.file].sha256);
  }
  assert.equal(lock.info.python, PYODIDE.python);
  assert.match(readFileSync(new URL('.gitignore', root), 'utf8'), /^vendor\/pyodide\/$/m, 'Pyodide is not committed');
});

test('the package\'s Python layer is cufsm-rs-py 0.1.0\'s, unchanged; _native_js has the .pyi\'s 8 functions', () => {
  const v = readFileSync(new URL('py/cufsm-rs-py/VERSION', root), 'utf8').trim().split('\n');
  assert.match(v[0], /^cufsm-rs-py v0\.1\.0 [0-9a-f]{40}$/);
  for (const line of v.slice(1)) {
    const [h, f] = line.split(/\s+/);
    assert.equal(sha(readFileSync(new URL(`py/cufsm-rs-py/${f}`, root))), h, f);
  }
  assert.deepEqual(v.slice(1).map((l) => l.split(/\s+/)[1]).sort(), ['cufsm_rs/__init__.py', 'cufsm_rs/_display.py', 'cufsm_rs/plot.py']);
  // the tag itself, when the package's repository is beside this one
  const repo = new URL('../cufsm-py/', root);
  if (existsSync(new URL('.git', repo))) {
    for (const f of ['__init__.py', '_display.py', 'plot.py']) {
      const tagged = execFileSync('git', ['show', `v0.1.0:python/cufsm_rs/${f}`], { cwd: repo.pathname });
      assert.ok(tagged.equals(readFileSync(new URL(`py/cufsm-rs-py/cufsm_rs/${f}`, root))), `${f} differs from the v0.1.0 tag`);
    }
  }
  const nat = pyFiles['cufsm_rs/_native.py'];
  for (const fn of ['section_properties', 'stress', 'first_yield', 'stress_to_action', 'strip', 'signature', 'classify', 'template'])
    assert.match(nat, new RegExp(`^def ${fn}\\(`, 'm'), fn);
  assert.match(nat, /^class MechanismError\(ValueError\)/m);
});

test('_native over Pyodide\'s bridge returns exactly what the transport returns, for every parity case', async () => {
  const cases = JSON.parse(await readFile(new URL('tests/fixtures/pyparity/cases.json', root), 'utf8'));
  const T = createTransport(engine);
  const done = {};
  const ours = {};
  for (const c of cases.ops) {
    const args = { ...unmark(c.args) };
    if (c.op !== 'template') { const m = cases.models[c.model]; args.arrays = c.arrays ? unmark(c.arrays) : [m.prop, m.node, m.elem, m.constraints, m.springs]; }
    if (c.from) args.results = done[c.from];
    const r = JSON.parse(T.call(c.op, JSON.stringify(pack(args))));
    if (r.ok !== undefined) { done[c.id] = unpack(r.ok); ours[c.id] = { value: done[c.id] }; } else ours[c.id] = { error: r.error };
  }
  const helper = readFileSync(new URL('parity/capture.py', import.meta.url), 'utf8');
  const driver = `${helper}
import json
from cufsm_rs import _native
cases = json.loads(${JSON.stringify(JSON.stringify(cases))})
def unmark(x):
    if isinstance(x, list):
        return [unmark(v) for v in x]
    if isinstance(x, dict):
        return {k: unmark(v) for k, v in x.items()}
    if x in ("NaN", "Infinity", "-Infinity"):
        return float(x.replace("Infinity", "inf").replace("NaN", "nan"))
    return x
done, out = {}, {}
for c in cases["ops"]:
    args = dict(unmark(c["args"]))
    try:
        if c["op"] == "template":
            v = _native.template(**args)
        else:
            m = cases["models"].get(c.get("model"))
            arrays = tuple(unmark(c["arrays"])) if c.get("arrays") is not None else (m["prop"], m["node"], m["elem"], m["constraints"], m["springs"])
            if "from" in c:
                args["results"] = done[c["from"]]
            elif c["op"] == "classify":
                args["results"] = [tuple(r) for r in args["results"]]
            v = getattr(_native, c["op"])(arrays, **args)
        done[c["id"]] = v
        out[c["id"]] = {"value": _parity_plain(v)}
    except Exception as e:
        out[c["id"]] = {"error": {"type": type(e).__name__, "message": str(e)}}
import sys
sys._ckb_parity = json.dumps(out)
`;
  const r = await pyo.run(driver);
  assert.equal(r.error, null, r.error?.text);
  // (read back from the interpreter: more than the console's 1 MB of output)
  const theirs = JSON.parse(pyo.pyodide.runPython('import sys\nsys._ckb_parity'));
  let values = 0, errors = 0;
  for (const c of cases.ops) {
    const a = ours[c.id], b = theirs[c.id];
    if (a.error) {
      assert.deepEqual(b.error, a.error, c.id);
      errors++;
    } else {
      // bit for bit: the same doubles (deepStrictEqual compares numbers with Object.is); the
      // package's rows are tuples and its values floats, which plain() turns into lists
      assert.ok(!b.error, `${c.id}: ${JSON.stringify(b.error)}`);
      assert.deepStrictEqual(unpack(b.value), plainJs(a.value), c.id);
      values++;
    }
  }
  console.log(`_native over the bridge: ${values} results bit for bit, ${errors} errors with the transport's type and message`);
  assert.equal(values + errors, cases.ops.length);
  assert.ok(values > 250);
});

test('the README quickstart verbatim (numpy, the plots): its numbers, its reprs, and three matplotlib figures in order', async () => {
  const src = readFileSync(new URL('py/examples/full/readme_quickstart.py', root), 'utf8');
  const r = await pyo.run(src);
  assert.equal(r.error, null, r.error?.text);
  assert.equal(r.runtime, 'pyodide');
  assert.match(r.stdout, /^StripResult\(signature, bc=S-S, 80 lengths 1 to 1000, neigs=1, 2 minima\)$/m);
  assert.match(r.stdout, /\[\[ 7\.26981342 {2}0\.35324649\]\n \[43\.87331372 {2}0\.54410451\]\]/);
  assert.match(r.stdout, /^Model\(37 nodes, 36 elements, 1 materials, 0 constraints, 0 springs\)$/m);
  assert.deepEqual(r.packages, ['contourpy', 'cycler', 'fonttools', 'kiwisolver', 'matplotlib', 'numpy', 'packaging', 'pillow',
    'pyparsing', 'python-dateutil', 'pytz', 'six'], 'numpy and matplotlib with its dependencies, no scipy');
  const kinds = r.output.map((o) => (o.image ? 'image' : 'text'));
  assert.deepEqual(kinds, ['text', 'image', 'image', 'image'], 'the figures come where plt.show() put them');
  for (const { image } of r.output.filter((o) => o.image)) {
    assert.match(image.svg, /^<\?xml[\s\S]*<svg [\s\S]*<\/svg>\s*$/);
    assert.ok(image.svg.length > 5000);
    assert.match(image.alt, /^matplotlib figure: /);
  }
  assert.match(r.output[2].image.alt, /load factor against half-wavelength, log scale/);
});

test('figures: at plt.show() between the printed lines, and those left open at the end', async () => {
  const r = await pyo.run('import matplotlib.pyplot as plt\nprint("one")\nplt.plot([1, 2], [3, 4], label="a")\nplt.title("T")\n'
    + 'plt.legend()\nplt.show()\nprint("two", end="")\nplt.figure()\nplt.bar([1], [2])\n');
  assert.equal(r.error, null, r.error?.text);
  assert.deepEqual(r.output.map((o) => o.text ?? 'image'), ['one\n', 'image', 'two', 'image']);
  assert.equal(r.output[1].image.alt, 'matplotlib figure: T, 1 line, legend: a.');
  // the next run starts with no figure open and its own globals
  const q = await pyo.run('import matplotlib.pyplot as plt\nprint(plt.get_fignums())\nprint("r" in globals())\n');
  assert.equal(q.stdout, '[]\nFalse');
});

test('errors on the full runtime are CPython\'s tracebacks, the script\'s line read; an unhosted package is named', async () => {
  let r = await pyo.run('import numpy as np\n\nnp.zeros(2) @ np.zeros(3)\n');
  assert.equal(r.error.type, 'ValueError');
  assert.equal(r.error.line, 3);
  assert.match(r.error.text, /^Traceback \(most recent call last\):\n {2}File "<stdin>", line 3, in <module>\n {4}np\.zeros\(2\) @ np\.zeros\(3\)/);
  assert.doesNotMatch(r.error.text, /_ckb_console|_pyodide/, 'the console\'s own frames are left out');
  r = await pyo.run('print("x")\nimport pandas\n');
  assert.equal(r.error.type, 'ModuleNotFoundError');
  assert.equal(r.stdout, 'x');
  assert.equal(r.error.fullRuntime.hosted, false);
  assert.match(r.error.fullRuntime.text, /^pandas \(pandas\): not hosted by the console/);
  r = await pyo.run('import sys\nsys.exit()\n');
  assert.equal(r.error, null);
});

test('detection: the import scan, strings and comments skipped', () => {
  const src = 'import cufsm_rs as fsm, json\nfrom math import pi\n# import numpy\ns = """\nimport scipy\n"""\n'
    + 'def f():\n    import numpy.linalg as la; from collections import deque\nfrom . import x\nfrom cufsm_rs import plot\n';
  assert.deepEqual(scanImports(src), ['cufsm_rs', 'json', 'math', 'numpy.linalg', 'collections', 'cufsm_rs.plot']);
  assert.equal(codeOnly('a = "import x" # import y\n').length, 'a = "import x" # import y\n'.length);
  assert.deepEqual(scanImports('import cufsm_rs as fsm\nfsm.plot.plot_signature(s)\n'), ['cufsm_rs', 'cufsm_rs.plot']);
  assert.deepEqual(beyondMicroPython(['cufsm_rs.plot', 'dsm', 'math', 'numpy.linalg', 'typing']), ['numpy', 'typing']);
  for (const m of ['json', 'math', 'cufsm_rs', 'dsm', 'time']) assert.ok(MICROPYTHON_MODULES.has(m), m);
});

test('detection: the packages and the bytes a script needs; nothing for what is on the device', () => {
  const lite = packagesFor(scanImports('import cufsm_rs\n'));
  assert.deepEqual(lite, { packages: ['numpy'], notHosted: [] });
  const plot = packagesFor(scanImports('from cufsm_rs.plot import plot_signature\nimport scipy.optimize\n'));
  assert.ok(['numpy', 'matplotlib', 'scipy', 'pillow', 'six'].every((k) => plot.packages.includes(k)));
  assert.deepEqual(packagesFor(['pandas', 'json']).notHosted, [{ module: 'pandas', package: 'pandas' }]);
  const all = downloadFor(lite.packages);
  const core = PYODIDE.core.reduce((s, f) => s + PYODIDE.files[f].size, 0);
  assert.equal(all.bytes, core + PYODIDE.files[PYODIDE.packages.numpy.file].size);
  assert.equal(downloadFor(lite.packages, new Set(all.files)).bytes, 0);
  assert.equal(downloadFor(lite.packages, new Set(PYODIDE.core)).coreMissing, false);
});

test('detection: which MicroPython failures re-run on the full runtime', () => {
  const r = (type, message) => ({ ok: false, error: { type, message, fullRuntime: null } });
  assert.equal(fallbackReason(r('ImportError', "no module named 'numpy'")).why, 'import');
  assert.equal(fallbackReason(r('AttributeError', "'str' object has no attribute 'zfill'")).why, 'attribute');
  assert.equal(fallbackReason(r('AttributeError', "type object 'str' has no attribute 'maketrans'")).why, 'attribute');
  assert.equal(fallbackReason(r('NameError', "name 'aiter' isn't defined")).why, 'builtin');
  assert.equal(fallbackReason(r('TypeError', 'extra keyword arguments given')).why, 'builtin');
  // the script's own mistakes stay on MicroPython
  assert.equal(fallbackReason(r('NameError', "name 'myvar' isn't defined")), null);
  assert.equal(fallbackReason(r('AttributeError', "'Model' object has no attribute 'nodez'")), null);
  assert.equal(fallbackReason(r('ZeroDivisionError', 'divide by zero')), null);
  assert.equal(fallbackReason({ ok: true, error: null }), null);
});

/* the dispatch, with the real runners and a consent that records what it was asked */
function harness(answer = true) {
  const asked = [], runs = [];
  const opts = {
    mp: { run: (s) => { runs.push('micropython'); return mp.run(s); }, compile: (s) => mp.compile(s) },
    full: {
      plan: async (s) => { const { packages, notHosted } = packagesFor(scanImports(s)); return { ...downloadFor(packages), packages, notHosted }; },
      run: (s) => { runs.push('pyodide'); return pyo.run(s); },
    },
    consent: async (need) => { asked.push(need); return answer; },
  };
  return { asked, runs, opts };
}

test('dispatch: a lite script stays on MicroPython and nothing is asked', async () => {
  const h = harness();
  const r = await runScript('import cufsm_rs, math, json\nprint(cufsm_rs.lipped_c(200, 76, 15, 1.9))\n', h.opts);
  assert.equal(r.runtime, 'micropython');
  assert.equal(r.error, null);
  assert.deepEqual(h.runs, ['micropython']);
  assert.equal(h.asked.length, 0);
});

test('dispatch: a numpy script asks first (with its size), then runs on Pyodide; Not now runs MicroPython', async () => {
  const src = 'import numpy as np\nimport cufsm_rs as fsm\nprint(np.round(fsm.signature(fsm.lipped_c(200, 76, 15, 1.9), np.logspace(1, 3, 20)).minima, 3))\n';
  let h = harness(true);
  let r = await runScript(src, h.opts);
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0].reason.why, 'import');
  assert.deepEqual(h.asked[0].packages, ['numpy']);
  assert.ok(h.asked[0].bytes > 10e6, `${h.asked[0].bytes} bytes`);
  assert.deepEqual(h.runs, ['pyodide'], 'the import scan sends it straight to Pyodide');
  assert.equal(r.runtime, 'pyodide');
  assert.equal(r.fallback.why, 'import');
  assert.match(r.stdout, /^\[\[/);
  h = harness(false);
  r = await runScript(src, h.opts);
  assert.deepEqual(h.runs, ['micropython']);
  assert.equal(r.runtime, 'micropython');
  assert.equal(r.declined.why, 'import');
  assert.equal(r.error.type, 'ImportError');
  assert.equal(r.error.line, 1);
});

test('dispatch: a script that fails partway on MicroPython re-runs once on Pyodide, with one clean output', async () => {
  const h = harness(true);
  const r = await runScript('import cufsm_rs\nprint("before")\nprint("7".zfill(3))\n', h.opts);
  assert.deepEqual(h.runs, ['micropython', 'pyodide']);
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0].reason.why, 'attribute');
  assert.equal(r.runtime, 'pyodide');
  assert.equal(r.error, null);
  assert.equal(r.stdout, 'before\n007', 'the MicroPython run\'s "before" is not shown twice');
});

test('dispatch: syntax MicroPython cannot read goes to Pyodide after the compile-only pass, before anything runs', async () => {
  const h = harness(true);
  const r = await runScript('import cufsm_rs\nmatch 2:\n    case 2:\n        print("matched")\n', h.opts);
  assert.deepEqual(h.runs, ['pyodide']);
  assert.equal(h.asked[0].reason.why, 'syntax');
  assert.equal(r.stdout, 'matched');
  // nothing to download (all on the device): no question
  const k = harness(true);
  k.opts.full.plan = async () => ({ packages: ['numpy'], notHosted: [], files: [], missing: [], bytes: 0 });
  await runScript('import numpy\nprint(1)\n', k.opts);
  assert.equal(k.asked.length, 0);
  assert.deepEqual(k.runs, ['pyodide']);
});

test('the full-Python examples: in the menu, labelled, each a headed script stating its units and the runtime it needs', async () => {
  const { FULL_EXAMPLES, EXAMPLES } = await import('../js/py/examples.js');
  const { readdirSync } = await import('node:fs');
  const onDisk = readdirSync(new URL('py/examples/full/', root)).filter((f) => f.endsWith('.py')).map((f) => `full/${f}`).sort();
  assert.deepEqual(FULL_EXAMPLES.map((x) => x.file).sort(), onDisk);
  assert.ok(FULL_EXAMPLES.every((x) => x.full) && !EXAMPLES.some((x) => x.full));
  for (const { file } of FULL_EXAMPLES) {
    const s = readFileSync(new URL(`py/examples/${file}`, root), 'utf8');
    assert.match(s, /^# .+\n#/, `${file}: a header comment first`);
    assert.match(s, /^# Units: /m, `${file}: states its units`);
    assert.match(s, /needs full Python|This needs full Python/, `${file}: says it needs the full runtime`);
    assert.ok(beyondMicroPython(scanImports(s)).length > 0, `${file} would run on MicroPython: not a full-Python example`);
    assert.ok(s.split('\n').length <= 160, `${file}: ${s.split('\n').length} lines`);
  }
  // the README quickstart is the README's code, verbatim, at the pinned tag
  const repo = new URL('../cufsm-py/', root);
  if (existsSync(new URL('.git', repo))) {
    const readme = execFileSync('git', ['show', 'v0.1.0:README.md'], { cwd: repo.pathname }).toString();
    const blocks = [...readme.matchAll(/```python\n([\s\S]*?)```/g)].map((m) => m[1]).slice(1);
    const s = readFileSync(new URL('py/examples/full/readme_quickstart.py', root), 'utf8');
    for (const b of blocks) assert.ok(s.includes(b), `the README block starting ${JSON.stringify(b.slice(0, 40))} is not verbatim`);
  }
});
