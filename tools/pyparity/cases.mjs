#!/usr/bin/env node
/* The Python console's parity cases: models, transport operations and whole scripts, written to
   tests/fixtures/pyparity/cases.json. tools/pyparity/gen.py runs them on CPython with the pinned
   cufsm-rs-py and writes expected.json; tests/py-transport.test.mjs and tests/py-lite.test.mjs
   check the page's engine (and MicroPython) against it, so npm test needs no Python.

     node tools/pyparity/cases.mjs
     tools/pyparity/.venv/bin/python tools/pyparity/gen.py     # venv: see gen.py

   The starter sections are built as a fresh page builds them (app.js buildModel): the template
   meshed by fromPolylines, the reference stresses from the engine's stresgen at P = A. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadEngine } from '../../js/engine.js';
import { fromPolylines, fromCufsmText, isotropic, toBuffers } from '../../js/model.js';
import { SHAPES, SECTION_DEFAULTS } from '../../js/shapes.js';
import { logLengths } from '../../js/lengths.js';
import { pythonScript, cufsmTables } from '../../js/python.js';

const here = new URL('.', import.meta.url);
const root = new URL('../../', import.meta.url);
const engine = await loadEngine(await readFile(new URL('cufsm.wasm', root)));
const P = SECTION_DEFAULTS;

/* ---- models: CUFSM tables, 1-based */
const arr = (t) => [t.prop, t.node, t.elem, t.constraints, t.springs];
const video = JSON.parse(await readFile(new URL('tests/fixtures/video-c.json', root), 'utf8'));
const tutorial = cufsmTables(fromCufsmText(video));

// unsymmetric: unequal flanges and lips at odd angles, two materials (one orthotropic), three
// thicknesses, and a reference stress with axial and both bending parts
const unsym = (() => {
  const pts = [[30, 14], [36, 0], [0, 0], [3, 90], [52, 96], [58, 81], [50, 75]];
  const node = pts.map(([x, z], k) => [k + 1, x, z, 1, 1, 1, 1, 1 - z / 120 + x / 400]);
  const elem = pts.slice(1).map((_, k) => [k + 1, k + 1, k + 2, [1.2, 1.5, 1.9][k % 3], k < 3 ? 1 : 2]);
  return { prop: [[1, 203000, 203000, 0.3, 0.3, 78076.92307692308], [2, 70000, 52000, 0.33, 0.25, 26000]],
           node, elem, constraints: [], springs: [] };
})();
const withSprings = { ...tutorial,
  springs: [[1, 1, 0, 0, 0, 5, 0, 1, 0, 0], [2, 4, 0, 0.5, 0, 0, 0, 0, 0, 0]],
  constraints: [[10, 2, 1, 1, 2]] };
const mechanism = { ...tutorial, node: [...tutorial.node, [11, 10, 10, 1, 1, 1, 1, 0]] };

const starters = {};
for (const k of Object.keys(SHAPES).filter((s) => !['tube', 'custom', 'model'].includes(s))) {
  const m = fromPolylines(SHAPES[k].path(P), { t: P.t, mat: isotropic(100, P.E, P.nu), mesh: P.mesh });
  const A = engine.props(toBuffers(m)).A;
  const s = engine.stresgen(toBuffers(m), { P: A });
  m.nodes.forEach((n, i) => { n.stress = s[i]; });
  starters[k] = m;
}
const models = { tutorial_c: tutorial, unsym, springs_constraints: withSprings, mechanism,
  ...Object.fromEntries(Object.entries(starters).map(([k, m]) => [`starter_${k}`, cufsmTables(m)])) };

/* ---- transport operations, in the .pyi's argument names */
const ops = [];
const add = (id, op, model, args, extra = {}) => ops.push({ id, op, model, args, ...extra });
const scaleOf = (name) => (name === 'tutorial_c' || name === 'springs_constraints' || name === 'mechanism' ? 0.1 : 1);
for (const name of Object.keys(models).filter((n) => n !== 'mechanism')) {
  const s = scaleOf(name);
  add(`${name}/props`, 'section_properties', name, {});
  add(`${name}/stress`, 'stress', name, { p: 1, mxx: 100 * s, mzz: -40 * s, m11: 0, m22: 0, b: 50 * s * s, unsymmetric: true });
  add(`${name}/stress-restrained`, 'stress', name, { p: 0, mxx: 0, mzz: 0, m11: 30 * s, m22: 20 * s, b: 0, unsymmetric: false });
  add(`${name}/yield`, 'first_yield', name, { fy: 345, unsymmetric: true, extreme_fibre: true });
  add(`${name}/yield-centreline`, 'first_yield', name, { fy: 345, unsymmetric: false, extreme_fibre: false });
  add(`${name}/s2a`, 'stress_to_action', name, {});
  add(`${name}/signature`, 'signature', name, { lengths: [20, 50, 80, 120, 200, 400, 800, 1500, 3000].map((L) => L * s), neigs: 3 });
  add(`${name}/strip-cc`, 'strip', name, { lengths: [300, 1200, 4000].map((L) => L * s), m_all: [[1, 2, 3], [1, 2, 3], [3, 1, 2]], bc: 'C-C', neigs: 4, spaces: null });
  add(`${name}/classify-cc`, 'classify', name, { bc: 'C-C', orth: 'axial', norm: 'vector', ospace: 'st' }, { from: `${name}/strip-cc` });
}
for (const name of ['tutorial_c', 'unsym', 'starter_c', 'starter_plate', 'starter_hat', 'springs_constraints'])
  add(`${name}/signature-default`, 'signature', name, { lengths: null, neigs: 1 });
for (const name of ['tutorial_c', 'unsym']) {
  add(`${name}/strip-ss`, 'strip', name, { lengths: [7.27, 43.9, 150].map((L) => L * (name === 'unsym' ? 10 : 1)), m_all: [[1], [1], [1]], bc: 'S-S', neigs: 5, spaces: null });
  add(`${name}/classify-ss`, 'classify', name, { bc: 'S-S', orth: 'axial', norm: 'vector', ospace: 'st' }, { from: `${name}/strip-ss` });
  add(`${name}/strip-cf`, 'strip', name, { lengths: [500, 2000].map((L) => L * scaleOf(name)), m_all: [[1, 2, 3, 4], [1, 2, 3, 4]], bc: 'c-f', neigs: 2, spaces: null });
  add(`${name}/classify-cf`, 'classify', name, { bc: 'C-F', orth: 'axial', norm: 'vector', ospace: 'st' }, { from: `${name}/strip-cf` });
}
// The engine's minor 1 exports (cufsm_strip, cufsm_classify, cufsm_template, cufsm_props_wn and
// the signature lengths and minima): cFSM spaces, alone and in unions, lower case too; term lists
// with gaps, different at each length, unsorted, with zeros and repeats; every classification
// option, on the engine's modes and on given vectors; the templates; neigs and terms past the
// old fixed caps (50 and 100).
const tc = 'tutorial_c';
for (const name of ['tutorial_c', 'unsym', 'springs_constraints']) {
  const k = name === 'unsym' ? 10 : 1;
  for (const sp of ['G', 'D', 'L', 'O', 'GD', 'lo', 'GDLO'])
    add(`spaces/${name}/${sp}`, 'strip', name, { lengths: [7.27, 43.9, 150].map((L) => L * k), m_all: [[1], [1], [1]], bc: 'S-S', neigs: 2, spaces: sp });
  add(`spaces/${name}/D-cc`, 'strip', name, { lengths: [100, 400].map((L) => L * k), m_all: [[1, 2, 3], [2, 4]], bc: 'C-C', neigs: 2, spaces: 'D' });
  add(`spaces/${name}/classify-D-cc`, 'classify', name, { bc: 'C-C', orth: 'axial', norm: 'vector', ospace: 'st' }, { from: `spaces/${name}/D-cc` });
}
add('m_all/gap', 'strip', tc, { lengths: [100, 200], m_all: [[1, 3], [1, 3]], bc: 'C-C', neigs: 2, spaces: null });
add('m_all/ragged', 'strip', tc, { lengths: [100, 200], m_all: [[1], [1, 2]], bc: 'C-C', neigs: 2, spaces: null });
add('m_all/unsorted', 'strip', tc, { lengths: [100, 200, 300], m_all: [[3, 0, 1, 1], [2], [5, 1, 3]], bc: 's-c', neigs: 3, spaces: null });
add('m_all/unsym-ss', 'strip', 'unsym', { lengths: [300, 3000], m_all: [[1, 2], [1, 3, 5]], bc: 'S-S', neigs: 3, spaces: null });
add('m_all/springs-cf', 'strip', 'springs_constraints', { lengths: [50, 300], m_all: [[1, 2, 3], [2, 5]], bc: 'C-F', neigs: 2, spaces: null });
add('m_all/springs-cg', 'strip', 'springs_constraints', { lengths: [80], m_all: [[1, 4]], bc: 'C-G', neigs: 2, spaces: null });
const ORTHS = ['natural', 'axial', 'load'], NORMS = ['none', 'vector', 'strain_energy', 'work'], OSPACES = ['st', 'k', 'kg', 'vector'];
for (const [from, bc] of [['tutorial_c/strip-ss', 'S-S'], ['unsym/strip-cc', 'C-C'], ['m_all/ragged', 'C-C'], ['starter_c/strip-cc', 'C-C']])
  for (const orth of ORTHS) for (const norm of NORMS) for (const ospace of OSPACES)
    add(`classify-options/${from}/${orth}-${norm}-${ospace}`, 'classify', from.split('/')[0] === 'm_all' ? tc : from.split('/')[0],
        { bc, orth, norm, ospace }, { from, either: true });   // some combinations are refused, as in CUFSM
add('classify-options/upper-case', 'classify', tc, { bc: 's-s', orth: 'Natural', norm: 'WORK', ospace: 'Kg' }, { from: 'tutorial_c/strip-ss' });
// given vectors, not the engine's modes: smooth made-up shapes, one and two terms
const given = (n, nt, seed) => Array.from({ length: 4 * n * nt }, (_, i) => Math.sin(0.37 * i + seed) + 0.25 * Math.cos(1.3 * i));
const nTc = models.tutorial_c.node.length;
add('classify-given/one-term', 'classify', tc, { results: [[43.9, [1], [0.5, 0.7], [given(nTc, 1, 0), given(nTc, 1, 1)]]], bc: 'S-S', orth: 'axial', norm: 'vector', ospace: 'st' });
add('classify-given/two-terms', 'classify', tc, { results: [[150, [1, 2], [1], [given(nTc, 2, 2)]], [300, [2], [], []]], bc: 'C-C', orth: 'natural', norm: 'strain_energy', ospace: 'k' });
// templates: CUFSM's defaults, outside dimensions with radii, Z, unequal flanges and lips, lips at
// other angles, no lips
const tpl = (o) => ({ shape: 'C', h: 9, b1: 5, b2: 5, d1: 1, d2: 1, r1: 0, r2: 0, r3: 0, r4: 0, q1: 90, q2: 90, t: 0.1,
  nh: 4, nb1: 2, nb2: 2, nd1: 2, nd2: 2, nr1: 0, nr2: 0, nr3: 0, nr4: 0, centerline: true, ...o });
add('template/default', 'template', null, tpl({}));
add('template/c-outside-radii', 'template', null, tpl({ h: 200, b1: 76, b2: 76, d1: 15, d2: 15, r1: 3, r2: 3, r3: 3, r4: 3, t: 1.9, nh: 12, nb1: 6, nb2: 6, nr1: 2, nr2: 2, nr3: 2, nr4: 2, centerline: false }));
add('template/z-unequal', 'template', null, tpl({ shape: 'z', h: 250, b1: 70, b2: 64, d1: 20, d2: 17, r1: 4, r2: 5, r3: 4, r4: 5, q1: 50, q2: 45, t: 2.4, nh: 10, nb1: 5, nb2: 4, nd1: 3, nd2: 2, nr1: 3, nr2: 2, nr3: 1, nr4: 4 }));
add('template/c-angled-lips', 'template', null, tpl({ q1: 120, q2: 75, d1: 1.2, d2: 0.8, r1: 0.2, r2: 0.1, r3: 0.3, r4: 0, nr1: 2, nr2: 1, nr3: 3, nr4: 0, centerline: false }));
add('template/plain', 'template', null, tpl({ d1: 0, d2: 0, nd1: 0, nd2: 0, h: 150, b1: 50, b2: 50, t: 1.5, nh: 8, nb1: 4, nb2: 4, centerline: false }));
// past the old caps: 60 load factors (more than the problem has: every one comes back), and 101
// longitudinal terms on a three-node strip
const flat3 = { prop: [[1, 203000, 203000, 0.3, 0.3, 78076.92307692308]], node: [[1, 0, 0, 1, 1, 1, 1, 1], [2, 25, 0, 1, 1, 1, 1, 1], [3, 50, 0, 1, 1, 1, 1, 1]],
  elem: [[1, 1, 2, 2, 1], [2, 2, 3, 2, 1]], constraints: [], springs: [] };
models.flat3 = flat3;
add('caps/neigs-60', 'strip', tc, { lengths: [43.9, 150], m_all: [[1, 2, 3, 4], [1, 2, 3, 4]], bc: 'C-C', neigs: 60, spaces: null });
add('caps/neigs-500', 'strip', 'unsym', { lengths: [500], m_all: [[1]], bc: 'S-S', neigs: 500, spaces: null });
add('caps/terms-101', 'strip', 'flat3', { lengths: [2000], m_all: [Array.from({ length: 101 }, (_, k) => k + 1)], bc: 'S-S', neigs: 3, spaces: null });
// errors: pip's exception type and message
const err = (id, op, arrays, args) => ops.push({ id: `error/${id}`, op, arrays, args, error: true });
const T = arr(tutorial);
err('prop-empty', 'section_properties', [[], ...T.slice(1)], {});
err('node-columns', 'section_properties', [T[0], [[1, 0, 0, 1, 1, 1, 1]], ...T.slice(2)], {});
err('node-twice', 'section_properties', [T[0], [...T[1], T[1][0]], ...T.slice(2)], {});
err('elem-node', 'section_properties', [T[0], T[1], [...T[2], [10, 9, 99, 0.1, 100]], T[3], T[4]], {});
err('elem-mat', 'section_properties', [T[0], T[1], [[1, 1, 2, 0.1, 5]], T[3], T[4]], {});
err('elem-zero-width', 'section_properties', [T[0], T[1], [[1, 1, 1, 0.1, 100]], T[3], T[4]], {});
err('constraint-dof', 'strip', [...T.slice(0, 3), [[10, 7, 1, 1, 2]], T[4]], { lengths: [10], m_all: [[1]], bc: 'S-S', neigs: 1, spaces: null });
err('spring-columns', 'strip', [...T.slice(0, 4), [[1, 1, 0, 0, 0, 5]]], { lengths: [10], m_all: [[1]], bc: 'S-S', neigs: 1, spaces: null });
err('node-not-finite', 'section_properties', [T[0], [['NaN', 5, 1, 1, 1, 1, 1, 1], ...T[1].slice(1)], ...T.slice(2)], {});
err('bc', 'strip', T, { lengths: [10], m_all: [[1]], bc: 'X-X', neigs: 1, spaces: null });
err('neigs-0', 'strip', T, { lengths: [10], m_all: [[1]], bc: 'S-S', neigs: 0, spaces: null });
err('length-negative', 'strip', T, { lengths: [10, -5], m_all: [[1], [1]], bc: 'S-S', neigs: 1, spaces: null });
err('signature-length', 'signature', T, { lengths: [0], neigs: 1 });
err('m_all-count', 'strip', T, { lengths: [10, 20], m_all: [[1]], bc: 'S-S', neigs: 1, spaces: null });
err('spaces-letter', 'strip', T, { lengths: [10], m_all: [[1]], bc: 'S-S', neigs: 1, spaces: 'X' });
err('mechanism-strip', 'strip', arr(mechanism), { lengths: [10], m_all: [[1]], bc: 'S-S', neigs: 1, spaces: null });
err('mechanism-signature', 'signature', arr(mechanism), { lengths: [10, 20], neigs: 1 });
err('orth', 'classify', T, { results: [], bc: 'S-S', orth: 'diagonal', norm: 'vector', ospace: 'st' });
err('norm', 'classify', T, { results: [], bc: 'S-S', orth: 'axial', norm: 'l2', ospace: 'st' });
err('ospace', 'classify', T, { results: [], bc: 'S-S', orth: 'axial', norm: 'vector', ospace: 'null' });
err('classify-bc', 'classify', T, { results: [], bc: 'S-X', orth: 'axial', norm: 'vector', ospace: 'st' });
err('classify-mode-size', 'classify', T, { results: [[10, [1], [1], [[1, 2, 3]]]], bc: 'S-S', orth: 'axial', norm: 'vector', ospace: 'st' });
err('classify-load-kg', 'classify', T, { results: [[150, [1, 2], [1], [given(nTc, 2, 2)]]], bc: 'C-C', orth: 'load', norm: 'strain_energy', ospace: 'k' });
err('spaces-empty', 'strip', T, { lengths: [10], m_all: [[1]], bc: 'S-S', neigs: 1, spaces: '' });
err('m_all-zeros', 'strip', T, { lengths: [10, 20], m_all: [[1], [0, 0]], bc: 'C-C', neigs: 1, spaces: null });
const terr = (id, o) => ops.push({ id: `error/template-${id}`, op: 'template', arrays: null, args: tpl(o), error: true });
terr('shape', { shape: 'U' });
terr('h', { h: 0 });
terr('t', { t: -0.1 });
terr('lip', { d2: -1 });
terr('radius', { r3: -0.5 });
terr('nh', { nh: 0 });

/* ---- whole scripts: the report's script for every starter, and the README quickstart */
const scripts = [];
const reportCaptures = ['lf', 'minima(lengths, lf)', 'res.minima', 'res.load_factors', 'repr(res)', 'repr(model)'];
for (const [k, m] of Object.entries(starters)) {
  scripts.push({ id: `report/${k}`, source: pythonScript({ model: m, solution: 'signature', bc: 'S-S', terms: 1, lengths: logLengths(10, 5000, 90) }),
                 captures: [...reportCaptures, 'res.classify_minima()'], stdout: true });
}
scripts.push({ id: 'report/c-general', stdout: true, captures: [...reportCaptures, 'res.classify()'],
               source: pythonScript({ model: starters.c, solution: 'general', bc: 'C-C', terms: 3, lengths: logLengths(100, 5000, 12) }) });
scripts.push({ id: 'report/tutorial-springs', stdout: true, captures: reportCaptures,
               source: pythonScript({ model: { ...fromCufsmText(video),
                 springs: [[0, -1, 0, 0, 5, 0, 1, 0, 0]], constraints: [[9, 2, 1, 0, 2]] },
                 solution: 'signature', bc: 'S-S', terms: 1, lengths: logLengths(1, 1000, 40) }) });

// The cufsm-rs-py README quickstart, with np.logspace(0, 3, 80) as a list (MicroPython has no
// numpy), its pure-distortional line and its lipped_c line included.
const quickstart = `import cufsm_rs as fsm

# CUFSM's tutorial C: 9 x 5 x 1 in, t = 0.1 in (inches and ksi)
xz = [(5, 1), (5, 0), (2.5, 0), (0, 0), (0, 3), (0, 6), (0, 9), (2.5, 9), (5, 9), (5, 8)]
m = fsm.Model(
    prop=[[100, 29500, 29500, 0.3, 0.3, 11346.15]],
    node=[[i + 1, x, z, 1, 1, 1, 1, 0] for i, (x, z) in enumerate(xz)],
    elem=[[i + 1, i + 1, i + 2, 0.1, 100] for i in range(9)],
)

p = fsm.section_properties(m)          # p.A, p.Ixx, p.J, p.Cw, p.xs, ... (also p["Ixx"])
y = fsm.first_yield(m, fy=50)          # y.Py = 105, y.Mxx = 324.64 (element faces, as CUFSM)

mc = fsm.stress(m, P=y.Py)             # a new Model with the reference stresses set
sig = fsm.signature(mc, [10 ** (3 * i / 79) for i in range(80)])
sig                                    # StripResult(signature, bc=S-S, 80 lengths 1 to 1000, neigs=1, 2 minima)
sig.minima                             # [[7.27, 0.353], [43.9, 0.544]]: [half-wavelength, load factor]
sig.classify_minima()                  # [G, D, L, O] percent of each minimum's mode: L 98%, D 94%

r = fsm.strip(mc, [7.27, 43.9], neigs=3)   # any lengths, several modes
r.load_factors                             # (2, 3)
shape = r.mode_shape(0)                    # the lowest mode at the first length
shape.u, shape.v, shape.w, shape.theta     # each (terms, nodes)
shape.dofs                                 # the raw vector, CUFSM's DOF order
shape.at()                                 # displacements summed over terms at mid-length

dist = fsm.strip(mc, [43.9], spaces="D", neigs=1)                  # pure distortional (cFSM)
cc = fsm.strip(mc, [100.0, 200.0], m_all=10, bc="C-C", neigs=2)    # general end conditions
cc.classify()                                                       # (2, 2, 4): G, D, L, O percent

lc = fsm.lipped_c(200, 76, 15, 1.9, ri=3)    # mm; 37 nodes
`;
scripts.push({ id: 'readme/quickstart', source: quickstart, stdout: false,
  captures: ['p.as_dict()', 'p["Ixx"]', 'y.as_dict()', 'mc.node', 'repr(m)', 'repr(mc)', 'repr(sig)', 'sig.lengths',
             'sig.load_factors', 'sig.minima', 'sig.classify_minima()', 'sig.m_terms', 'r.load_factors',
             'r.load_factors.shape', 'r.modes', 'repr(r)', 'r.neigs', 'shape.u', 'shape.v', 'shape.w', 'shape.theta',
             'shape.dofs', 'shape.m_terms', 'shape.length', 'shape.load_factor', 'list(shape.at())', 'list(shape.at(2.0))',
             'list(r.mode_shape(1, 2).at())', 'cc.load_factors', 'cc.classify()', 'cc.classify().shape',
             'list(cc.mode_shape(1, 1).at())', 'fsm.stress_to_action(mc).as_dict()',
             'fsm.stress(m, Mxx=100, as_array=True)', 'm.copy().with_stress([1] * 10).node',
             'fsm.Model.from_dicts([{"x": x, "z": z} for x, z in xz], [{"i": i, "j": i + 1, "t": 0.1} for i in range(9)], E=29500).node',
             'fsm.signature(mc).lengths', 'fsm.signature(mc).minima',
             'dist.load_factors', 'dist.m_terms', 'repr(dist)', 'dist.modes', 'list(dist.mode_shape(0).at())',
             'lc.node', 'lc.elem', 'lc.prop', 'len(lc.node)', 'repr(lc)', 'fsm.section_properties(lc).as_dict()',
             'fsm.lipped_z(200, 76, 15, 1.9, ri=3).node', 'fsm.plain_c(150, 50, 1.5, ri=2, mesh=8).node',
             'fsm.template().node', 'fsm.template().elem', 'fsm.template("Z", h=8, b1=3, d1=0.8, q1=50, centerline=False).node',
             'cc.classify(orth="natural")', 'cc.classify(norm="work", ospace="kg")',
             'fsm.strip(mc, [100.0, 200.0], m_all=[1, 3, 5], bc="C-C", neigs=2).load_factors',
             'fsm.strip(mc, [100.0, 200.0], m_all=[[1], [2, 4]], bc="C-C", neigs=2).m_terms',
             'fsm.strip(mc, [7.27, 43.9], spaces="GD", neigs=2).load_factors',
             'fsm.strip(mc, [43.9], spaces="D", neigs=1).classify()'],
  // run after the script in both runtimes: the error cases, with pip's types and messages
  setup: `node = [[i + 1, x, z, 1, 1, 1, 1, 1] for i, (x, z) in enumerate(xz)]
elem = [[i + 1, i + 1, i + 2, 0.1, 100] for i in range(9)]
mech = fsm.Model(prop=[[100, 29500, 29500, 0.3, 0.3, 11346.15]], node=node + [[11, 10, 10, 1, 1, 1, 1, 0]], elem=elem)
`,
  errors: ['fsm.Model(prop=[[1, 2, 3]], node=node, elem=elem)', 'fsm.Model(prop=[], node=node, elem=elem)',
           'fsm.Model(prop=[[100, 29500, 29500, 0.3, 0.3, 11346.15]], node=[[1, 2, 3, 4, 5, 6, 7]], elem=elem)',
           'm.with_stress([1, 2])', 'fsm.first_yield(m, fy=-1)', 'fsm.first_yield(m, fy=0.0)', 'fsm.section_properties([1])',
           'fsm.strip(mech, [10.0], neigs=1)', 'fsm.signature(mech, [10.0, 20.0])', 'fsm.strip(m, [10.0], bc="X-Y")',
           'fsm.strip(m, [10.0, 20.0], m_all=[[1], [1, 2], [1]])', 'fsm.strip(m, [10.0], neigs=2).mode_shape(5)',
           'fsm.strip(m, [10.0], neigs=2).mode_shape(0, 7)', 'fsm.strip(m, [10.0], neigs=0)', 'fsm.strip(m, [-10.0])',
           'fsm.section_properties(fsm.Model(prop=[[1, 1, 1, 0.3, 0.3, 0.4]], node=node, elem=[[1, 1, 2, 0.1, 7]]))',
           'fsm.section_properties(fsm.Model(prop=[[1, 1, 1, 0.3, 0.3, 0.4]], node=node, elem=[[1, 1, 12, 0.1, 1]]))',
           'fsm.strip(mc, [10.0], spaces="Q")', 'cc.classify(orth="sideways")', 'fsm.strip(mc, [10.0], spaces="")',
           'cc.classify(norm="l2")', 'cc.classify(ospace="null")', 'fsm.template(shape="U")', 'fsm.template(h=-9.0)',
           'fsm.lipped_c(200, 76, -15, 1.9)', 'fsm.template(nh=0)', 'fsm.strip(m, [10.0, 20.0], m_all=[[1], [0]])'],
  // whole-array operations: pip answers with numpy, the lite layer must refuse, naming the full runtime
  numpy: ['sig.minima * 2', 'sig.minima[:, 0]', 'r.load_factors.min()', 'm.x * 2', 'sig.curve + sig.curve',
          'r.load_factors == r.load_factors', 'mc.node[0, 7]', '-shape.u'] });

await mkdir(new URL('../../tests/fixtures/pyparity/', here), { recursive: true });
const out = new URL('../../tests/fixtures/pyparity/cases.json', here);
await writeFile(out, `${JSON.stringify({ about: 'tools/pyparity/cases.mjs writes this; tools/pyparity/gen.py runs it on CPython', models, ops, scripts }, null, 1)}\n`);
console.log(`${Object.keys(models).length} models, ${ops.length} operations, ${scripts.length} scripts -> ${out.pathname}`);
