import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../js/engine.js';
import { LITE_FILES, liteUrl } from '../js/py/lite.js';
import { createRunner, FIGURES_MAX } from '../js/py/runner.js';
import { unpack } from '../js/py/transport.js';
import { figureAlt, figureName, placeholder, g4 } from '../js/py/figures.js';

/* cufsm_rs.plot in the console (py/cufsm_rs_lite/plot.py): each plot function hands the console a
   figure spec holding the numbers the script's own results hold, bit for bit; the figures sit in
   the run's output in the order the script made them, between its printed text; ax= and an
   argument the package does not take raise, and so does an Axes method on the returned Figure.
   The labels are the package's own text (cufsm-rs-py 0.1.0 plot.py, f"{lf:.4g} at {L:.4g}"). */
const engine = await loadEngine(await readFile(new URL('../cufsm.wasm', import.meta.url)));
const micropython = await import('../vendor/civilkit/micropython.mjs');
const files = Object.fromEntries(await Promise.all(LITE_FILES.map(async (n) => [n, await readFile(liteUrl(n), 'utf8')])));
const runner = createRunner({ engine, files, loadMicroPython: micropython.loadMicroPython });

/* CUFSM's tutorial C (the cufsm-rs-py README quickstart), 9 x 5 x 1 in, t = 0.1 in */
const C = `import cufsm_rs as fsm
from cufsm_rs.plot import plot_section, plot_signature, plot_mode
xz = [(5, 1), (5, 0), (2.5, 0), (0, 0), (0, 3), (0, 6), (0, 9), (2.5, 9), (5, 9), (5, 8)]
m = fsm.Model(prop=[[100, 29500, 29500, 0.3, 0.3, 11346.15]],
              node=[[i + 11, x, z, 1, 1, 1, 1, 0] for i, (x, z) in enumerate(xz)],
              elem=[[i + 1, i + 11, i + 12, 0.1, 100] for i in range(9)])
mc = fsm.stress(m, P=fsm.first_yield(m, fy=50).Py)
sig = fsm.signature(mc, [10 ** (3 * i / 79) for i in range(80)])
`;
/* a value the script holds, printed bit for bit (the transport's packing) */
const keep = (expr) => `print("HELD " + fsm._dumps(${expr}))\n`;
const run = async (src) => {
  const r = await runner.run(src);
  const held = r.stdout.split('\n').filter((l) => l.startsWith('HELD ')).map((l) => unpack(JSON.parse(l.slice(5))));
  return { r, figs: r.output.filter((o) => o.figure).map((o) => o.figure), held };
};

test('plot_section: the model\'s tables, element ends as node rows, the stress and the package\'s legend', async () => {
  const { r, figs, held } = await run(`${C}f = plot_section(mc, node_numbers=True)\nprint(f)\nplot_section(m, stress=False)\n`
    + keep('[[float(v) for v in mc.x], [float(v) for v in mc.z], [float(v) for v in mc.stress]]'));
  assert.equal(r.error, null, r.error?.text);
  assert.equal(figs.length, 2);
  const [s, plain] = figs;
  const [x, z, stress] = held[0];
  assert.equal(s.kind, 'section');
  assert.deepEqual(s.x, x); assert.deepEqual(s.z, z); assert.deepEqual(s.stress, stress);
  assert.deepEqual(s.numbers, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);       // CUFSM's node numbers, not rows
  assert.deepEqual(s.elems, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]]);
  assert.deepEqual(s.t, Array(9).fill(0.1));
  assert.equal(s.show_stress, true);
  assert.equal(s.node_numbers, true);
  assert.equal(s.legend, 'reference stress (max 50)');            // the package's: Py's stress is fy
  assert.equal(plain.show_stress, false);
  assert.equal(plain.legend, null);
  assert.equal(plain.node_numbers, false);
  assert.match(r.stdout, /^<Figure section: cross-section, 10 nodes, 9 elements \(drawn in the console output\)>$/m);
  assert.equal(figureAlt(s), 'Cross-section: 10 nodes and 9 elements, 5 wide and 9 deep, shaded by the reference '
    + 'stress (compression; max 50), with the node numbers.');
});

test('plot_signature: the curve, the package\'s minima and its classify_minima(), labelled as the package labels them', async () => {
  const { r, figs, held } = await run(`${C}plot_signature(sig)\nplot_signature(sig, classify=True)\n`
    + keep('[list(sig.lengths), list(sig.curve), sig.minima.tolist(), sig.classify_minima().tolist()]'));
  assert.equal(r.error, null, r.error?.text);
  const [lengths, curve, minima, cls] = held[0];
  const [plain, classed] = figs;
  for (const f of figs) {
    assert.equal(f.kind, 'signature');
    assert.deepEqual(f.lengths, lengths);                        // bit for bit: the engine's numbers
    assert.deepEqual(f.curve, curve);
    assert.deepEqual(f.minima, minima);
    assert.equal(f.xlabel, 'half-wavelength');
    assert.equal(f.ylabel, 'load factor');
  }
  assert.deepEqual(plain.labels, ['0.3532 at 7.27', '0.5441 at 43.87']);
  assert.equal(plain.classes, null);
  assert.deepEqual(classed.classes, cls);
  assert.deepEqual(classed.labels, ['L 98%: 0.3532 at 7.27', 'D 94%: 0.5441 at 43.87']);
  assert.equal(figureAlt(classed), 'Signature curve: load factor against half-wavelength on a log scale, 80 lengths '
    + 'from 1 to 1000; 2 minima: L 98%: 0.3532 at 7.27; D 94%: 0.5441 at 43.87.');
  assert.equal(figureName(classed), 'signature curve');
  assert.equal(placeholder(classed), '[figure: signature curve]');
  // a strip() result with several terms is drawn against "length", as the package labels it
  const g = await run(`${C}plot_signature(fsm.strip(mc, [100.0, 200.0, 400.0], m_all=3, bc="C-C", neigs=1))\n`);
  assert.equal(g.r.error, null, g.r.error?.text);
  assert.equal(g.figs[0].xlabel, 'length');
  assert.deepEqual(g.figs[0].minima, []);
});

test('plot_mode: the mode\'s displacements from ModeShape.at(), at the package\'s default scale and title', async () => {
  const { r, figs, held } = await run(`${C}plot_mode(sig, 20)\nplot_mode(sig, 20, scale=2.5, y=1.0)\n`
    + 'ms = sig.mode_shape(20)\nd = ms.at()\nd1 = ms.at(1.0)\n'
    + keep('[list(d.u), list(d.w), d.y, list(d1.u), list(d1.w), ms.load_factor, ms.length]'));
  assert.equal(r.error, null, r.error?.text);
  const [u, w, y, u1, w1, lf, L] = held[0];
  const [a, b] = figs;
  assert.equal(a.kind, 'mode');
  assert.deepEqual(a.u, u); assert.deepEqual(a.w, w); assert.equal(a.y, y);
  const peak = Math.max(...u.map((v, i) => Math.hypot(v, w[i])));
  assert.ok(Math.abs(a.scale - 0.1 * 9 / peak) <= 1e-12 * a.scale, `scale ${a.scale}`);   // 10 % of the 9 in depth
  assert.equal(a.title, `mode 1: load factor ${g4(lf)} at length ${g4(L)}`);
  assert.equal(a.title, 'mode 1: load factor 0.3753 at length 5.748');
  assert.deepEqual(b.u, u1); assert.deepEqual(b.w, w1); assert.equal(b.y, 1);
  assert.equal(b.scale, 2.5);
  assert.deepEqual(a.elems, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]]);
  assert.match(figureAlt(a), /^mode 1: load factor 0\.3753 at length 5\.748: the deformed cross-section over the undeformed one/);
});

test('the figures sit in the output between the printed text, in the order the script made them', async () => {
  const { r } = await run(`${C}print("one")\nprint("two, then", end=" ")\nplot_section(mc)\nprint("three")\n`
    + 'plot_signature(sig)\nplot_mode(sig, 20)\nprint("four")\n');
  assert.equal(r.error, null, r.error?.text);
  const seq = r.output.map((o) => (o.figure ? `[${o.figure.kind}]` : o.text));
  assert.deepEqual(seq, ['one\ntwo, then ', '[section]', 'three\n', '[signature]', '[mode]', 'four']);
  assert.equal(r.stdout, 'one\ntwo, then three\nfour');                   // the text alone, as before figures
  // an error after a figure keeps both, in order
  const e = await run(`${C}plot_section(mc)\nprint("after")\n1 / 0\n`);
  assert.deepEqual(e.r.output.map((o) => (o.figure ? 'fig' : o.text)), ['fig', 'after']);
  assert.equal(e.r.error.type, 'ZeroDivisionError');
});

test('ax= raises, naming the full runtime; so does an Axes method on the Figure', async () => {
  for (const call of ['plot_section(mc, ax=1)', 'plot_signature(sig, ax="axes")', 'plot_mode(sig, 0, 0, object())']) {
    const { r, figs } = await run(`${C}${call}\n`);
    assert.equal(figs.length, 0, call);
    assert.equal(r.error.type, 'NotImplementedError', call);
    assert.match(r.error.message, /\(ax=\.\.\.\): drawing on matplotlib axes needs the full Python runtime/, call);
    assert.equal(r.error.line, 9, call);
    assert.match(r.error.fullRuntime.text, /full Python runtime \(Pyodide, with matplotlib\)/);
  }
  const { r } = await run(`${C}f = plot_signature(sig)\nf.set_title("mine")\n`);
  assert.equal(r.error.type, 'AttributeError');
  assert.match(r.error.message, /^Figure\.set_title: the console draws its figures in the page.*Axes need the full Python runtime/);
});

test('an argument the package does not take raises, and so does a wrong type, never drawing anything', async () => {
  const cases = [
    ['plot_section(mc, colour="red")', 'TypeError', /unexpected keyword argument 'colour'/],
    ['plot_signature(sig, classify=True, log=False)', 'TypeError', /unexpected keyword argument 'log'/],
    ['plot_mode(sig, 0, 0, None, 1.0, 2.0, 3)', 'TypeError', /function takes|positional/],
    ['plot_section(sig)', 'TypeError', /plot_section expected a cufsm_rs\.Model, got StripResult/],
    ['plot_signature(mc)', 'TypeError', /plot_signature expected a cufsm_rs\.StripResult/],
    ['plot_mode(sig, 500)', 'IndexError', /i_length 500 is out of range for 80 lengths/],
    ['plot_mode(sig, 0, 3)', 'IndexError', /k_mode 3: only 1 modes were found/],
  ];
  for (const [call, type, msg] of cases) {
    const { r, figs } = await run(`${C}${call}\n`);
    assert.equal(figs.length, 0, call);
    assert.equal(r.error?.type, type, `${call}: ${r.error?.text}`);
    assert.match(r.error.message, msg, call);
  }
});

test('cufsm_rs.plot imports as the package\'s does: on first use, by any import form', async () => {
  const { r, figs } = await run(`${C}import cufsm_rs\ncufsm_rs.plot.plot_section(mc)\nimport cufsm_rs.plot as cp\ncp.plot_section(mc)\n`
    + 'print(cufsm_rs.plot.__all__)\n');
  assert.equal(r.error, null, r.error?.text);
  assert.equal(figs.length, 2);
  assert.match(r.stdout, /\['plot_section', 'plot_signature', 'plot_mode'\]/);
});

test(`a run draws at most ${FIGURES_MAX} figures`, async () => {
  const { r, figs } = await run(`${C}for i in range(${FIGURES_MAX + 5}):\n    plot_section(mc)\n`);
  assert.equal(figs.length, FIGURES_MAX);
  assert.match(r.error.text, new RegExp(`at most ${FIGURES_MAX} figures`));
});
