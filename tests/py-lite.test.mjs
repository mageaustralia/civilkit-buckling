import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../js/engine.js';
import { createTransport, unpack } from '../js/py/transport.js';
import { installLite, LITE_FILES, liteUrl } from '../js/py/lite.js';
import { compare, unmark, worst, TOL, LIBM_TOL } from './fixtures/pyparity/compare.mjs';

/* cufsm_rs lite on MicroPython (the vendored wasm build), against CPython and the published
   cufsm-rs-py 0.1.0 (tests/fixtures/pyparity, written by tools/pyparity/gen.py): the report's
   script (js/python.js pythonScript) for every starter section and the README quickstart run
   unchanged, the captured values match to 1e-9 (compare.mjs, with its documented exceptions), the
   package's errors come back with its types and messages, and what needs numpy raises naming the
   full runtime. The quickstart's cFSM line (spaces="D"), lipped_c and the templates run too. */
const engine = await loadEngine(await readFile(new URL('../cufsm.wasm', import.meta.url)));
const micropython = await import('../vendor/civilkit/micropython.mjs');
const fx = (n) => readFile(new URL(`./fixtures/pyparity/${n}`, import.meta.url), 'utf8').then(JSON.parse);
const cases = await fx('cases.json');
const expected = await fx('expected.json');
const files = Object.fromEntries(await Promise.all(LITE_FILES.map(async (n) => [n, await readFile(liteUrl(n), 'utf8')])));

let stdout = [];
const mp = await micropython.loadMicroPython({ heapsize: 64 * 1024 * 1024, stdout: (s) => stdout.push(s), stderr: (s) => stdout.push(s) });
installLite(mp, createTransport(engine), files);
mp.runPython(`
import cufsm_rs as _c
def _cap(x):
    if isinstance(x, (_c.Array, _c._Column)):
        return x.tolist()
    if isinstance(x, _c._DictLike):
        return {k: _cap(v) for k, v in x.as_dict().items()}
    if isinstance(x, dict):
        return {k: _cap(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_cap(v) for v in x]
    return x
def _try(src):
    try:
        exec(src, globals())
    except Exception as e:
        return [type(e).__name__, str(e)]
    return None
`);
const KEEP = ['_c', '_cap', '_try', 'json'];
function fresh() {
  mp.runPython(`for _k in [k for k in globals() if not k.startswith("__") and k not in ${JSON.stringify(KEEP)}]:\n    del globals()[_k]`);
  stdout = [];
}
const capture = (expr) => {
  mp.globals.set('_E', expr);
  mp.runPython('_OUT = _c._dumps(_cap(eval(_E)))');
  return unpack(JSON.parse(String(mp.globals.get('_OUT'))));
};
const attempt = (src) => {
  mp.globals.set('_E', src);
  mp.runPython('_OUT = json.dumps(_try(_E))');
  return JSON.parse(String(mp.globals.get('_OUT')));
};
mp.runPython('import json');

/* numbers printed by a script: compared within 1e-9 and the printed precision (MicroPython's own
   float formatting is not correctly rounded, so a last printed digit may differ); the text
   around them exactly */
const NUM = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
function sameStdout(ours, pip, where) {
  const a = ours.join('\n').trim().split('\n'), b = pip.trim().split('\n');
  assert.equal(a.length, b.length, `${where}: ${a.length} lines, pip ${b.length}`);
  a.forEach((line, i) => {
    assert.equal(line.replace(NUM, '#'), b[i].replace(NUM, '#'), `${where} line ${i + 1}`);
    const na = line.match(NUM) ?? [], nb = b[i].match(NUM) ?? [];
    nb.forEach((t, k) => {
      const digits = t.replace(/^-/, '').replace(/e.*$/i, '').replace('.', '').replace(/^0+/, '').length || 1;
      const tol = Math.max(TOL, 0.51 * 10 ** (1 - digits));
      assert.ok(Math.abs(Number(na[k]) - Number(t)) <= tol * Math.abs(Number(t)) || Number(na[k]) === Number(t),
        `${where} line ${i + 1}: ${na[k]} vs pip ${t}`);
    });
  });
}

/* the report's scripts run their curve to 5000 mm, beyond 50 x the widest strip (37.5 mm), where
   the documented libm divergence shows (compare.mjs); the values that come from those lengths
   are held to LIBM_TOL, the rest to 1e-9 */
const LONG = new Set(['lf', 'res.load_factors']);
let measured = {};
function runScript(s, { long = new Set() } = {}) {
  fresh();
  mp.runPython(s.source);
  const exp = expected.scripts[s.id];
  const flips = [];
  for (const expr of s.captures) {
    const ours = capture(expr), pip = unmark(exp.captures[expr]);
    const tol = expr.includes('classify') ? LIBM_TOL.classify : long.has(expr) ? LIBM_TOL.longLength : TOL;
    const floor = /shape\.|\.at\(|mode_shape/.test(expr) ? 1 : 0;     // mode components: relative to the mode's peak, 1
    compare(ours, pip, `${s.id}: ${expr}`, { tol, flips, floor });
    const k = tol === TOL ? 'held to 1e-9' : expr.includes('classify') ? 'classify (libm)' : 'beyond 50 x widest strip (libm)';
    measured[k] = Math.max(measured[k] ?? 0, worst(ours, pip, floor));
  }
  return { exp, flips };
}

test('the report\'s script runs unchanged for every starter section and matches pip', () => {
  measured = {};
  const report = cases.scripts.filter((s) => s.id.startsWith('report/'));
  assert.ok(report.length >= 6);
  for (const s of report) {
    const { exp } = runScript(s, { long: s.id === 'report/tutorial-springs' ? new Set() : LONG });
    sameStdout(stdout, exp.stdout, s.id);
    assert.ok(stdout.length > 0, `${s.id} printed nothing`);
  }
  console.log('report scripts, largest relative difference:', JSON.stringify(measured));
});

const quick = cases.scripts.find((s) => s.id === 'readme/quickstart');
test('the README quickstart (np.logspace as a list) matches pip', () => {
  measured = {};
  const { flips } = runScript(quick);
  console.log('quickstart, largest relative difference:', JSON.stringify(measured), 'sign flips:', flips.length);
  // the README's own comments
  assert.equal(capture('repr(sig)'), 'StripResult(signature, bc=S-S, 80 lengths 1 to 1000, neigs=1, 2 minima)');
  assert.deepEqual(capture('r.load_factors.shape'), [2, 3]);
  assert.deepEqual(capture('cc.classify().shape'), [2, 2, 4]);
  assert.equal(capture('p.A'), capture('p["A"]'));
});

test('the quickstart\'s cFSM line, its lipped_c and the other templates run and match pip', () => {
  // captured and compared with the rest above; here the README's own comments
  assert.equal(capture('len(lc.node)'), 37);
  assert.deepEqual(capture('dist.load_factors.shape'), [1, 1]);
  assert.match(capture('repr(dist)'), /^StripResult\(strip, bc=S-S, 1 lengths 43\.9 to 43\.9, neigs=1\)$/);
});

test('errors are the package\'s: the same type and message', () => {
  mp.runPython(quick.setup);
  for (const stmt of quick.errors) {
    const want = expected.scripts[quick.id].errors[stmt];
    const e = attempt(stmt);
    assert.ok(e, `${stmt} did not raise`);
    assert.deepEqual(e, [want.type, want.message], stmt);
  }
  assert.equal(capture('isinstance(_c.MechanismError("x"), ValueError)'), true);
});

test('what needs numpy raises, naming the full runtime; pip answers it', () => {
  for (const stmt of quick.numpy) {
    const e = attempt(stmt);
    assert.ok(e, `${stmt} answered instead of raising`);
    assert.match(e[1], /full Python runtime \(Pyodide/, `${stmt}: ${e}`);
  }
  // cufsm_rs.plot imports (it draws in the console's output, tests/py-plot.test.mjs); matplotlib
  // axes are what need the full runtime
  for (const stmt of ['import cufsm_rs.plot', 'from cufsm_rs.plot import plot_signature', '_c.plot'])
    assert.equal(attempt(stmt), null, stmt);
  for (const stmt of ['_c.plot.plot_signature(None, ax=1)', '_c.plot.plot_section(None, ax=1)', '_c.plot.plot_mode(None, 0, ax=1)']) {
    const e = attempt(stmt);
    assert.equal(e?.[0], 'NotImplementedError', `${stmt}: ${e}`);
    assert.match(e[1], /matplotlib axes needs the full Python runtime/, stmt);
  }
});

test('arrays index, slice, iterate and write through as the package\'s do', () => {
  assert.deepEqual(capture('[len(sig.minima), len(sig.minima[0]), sig.minima[-1][0] == sig.minima[1][0]]'), [2, 2, true]);
  assert.deepEqual(capture('sig.minima[0:1].shape'), [1, 2]);
  assert.equal(capture('sum(r.curve) == r.load_factors[0][0] + r.load_factors[1][0]'), true);
  assert.equal(capture('[row[0] for row in r.load_factors] == list(r.curve)'), true);
  // a model's tables and column views write through, as numpy's views do
  mp.runPython('_m2 = m.copy()\n_m2.node[0][7] = 5.0\n_m2.stress[1] = 6.0\n_m2.x[2] = 7.0');
  assert.deepEqual(capture('[_m2.node[0][7], _m2.node[1][7], _m2.node[2][1], m.node[0][7]]'), [5, 6, 7, 0]);
  assert.match(attempt('_m2.node[0] = [1, 2]')[1], /cannot take a value of shape/);
  assert.equal(attempt('bool(sig.minima)')?.[0], 'ValueError');
  assert.equal(attempt('p.A = 3')?.[0], 'AttributeError');      // results are frozen, as the dataclasses are
});
