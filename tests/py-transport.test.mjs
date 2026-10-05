import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../js/engine.js';
import { createTransport, pack, unpack } from '../js/py/transport.js';
import { compare, unmark, worst, TOL, LIBM_TOL } from './fixtures/pyparity/compare.mjs';

/* The Python console's transport against the published package: every operation of cufsm-rs-py's
   native module (_native.pyi), on the same models, compared with what CPython and the pinned
   cufsm-rs-py 0.1.0 returned (tests/fixtures/pyparity, written by tools/pyparity/gen.py).
   Tolerance 1e-9 relative, with two documented exceptions (compare.mjs). Every call the package
   answers, the page answers: cFSM spaces, any term lists, every classification option, the
   templates, and no fixed limit on neigs or terms (the engine's ABI 2 minor 1 exports). */
const engine = await loadEngine(await readFile(new URL('../cufsm.wasm', import.meta.url)));
const fx = (n) => readFile(new URL(`./fixtures/pyparity/${n}`, import.meta.url), 'utf8').then(JSON.parse);
const cases = await fx('cases.json');
const expected = await fx('expected.json');
const T = createTransport(engine);

const arraysOf = (c) => {
  if (c.arrays) return unmark(c.arrays);
  const m = cases.models[c.model];
  return [m.prop, m.node, m.elem, m.constraints, m.springs];
};
/* requests go packed, as the Python layers send them (NaN in an error case's table included) */
const call = (op, args) => {
  const r = JSON.parse(T.call(op, JSON.stringify(pack(args))));
  return r.error ? { error: r.error } : { value: unpack(r.ok) };
};
const done = {};
const runCase = (c) => {
  const args = { ...unmark(c.args) };
  if (c.op !== 'template') args.arrays = arraysOf(c);
  if (c.from) args.results = done[c.from];
  const r = call(c.op, args);
  if (r.value !== undefined) done[c.id] = r.value;
  return r;
};

/* The documented platform divergence (compare.mjs LIBM_TOL): rows at lengths over 50 times the
   widest strip (on these models it first shows above 1e-9 between 63 and 322 times), and the
   classification percentages. Everything else is held to 1e-9. */
const widest = (m) => Math.max(...m.elem.map((e) => {
  const at = (n) => m.node.find((r) => r[0] === n);
  const [a, b] = [at(e[1]), at(e[2])];
  return Math.hypot(b[1] - a[1], b[2] - a[2]);
}));
const strict = {}, libm = {}, flips = [];
const note = (bag, op, w) => { bag[op] = Math.max(bag[op] ?? 0, w); };
/* the operations the engine's minor 1 exports brought, reported apart (the case ids' prefixes) */
const GROUPS = ['spaces/', 'm_all/', 'classify-options/', 'classify-given/', 'template/', 'caps/'];
const groupOf = (c) => GROUPS.find((g) => c.id.startsWith(g))?.slice(0, -1) ?? c.op;
function check(c, ours, pip) {
  const opts = { flips };
  const g = groupOf(c);
  if (c.op === 'classify') {
    const energy = String(c.args.norm).toLowerCase() === 'strain_energy';
    compare(ours, pip, c.id, { ...opts, tol: energy ? LIBM_TOL.classifyEnergy : LIBM_TOL.classify });
    note(libm, `${g === 'classify' ? 'classify' : `classify (${g})`}${energy ? ', strain-energy norm' : ''}`, worst(ours, pip));
    return;
  }
  if (c.op !== 'strip' && c.op !== 'signature') {
    compare(ours, pip, c.id, opts);
    note(strict, g, worst(ours, pip));
    return;
  }
  const [rowsA, rowsE] = c.op === 'signature' ? [ours[0], pip[0]] : [ours, pip];
  if (c.op === 'signature') {
    compare(ours[1], pip[1], `${c.id} minima`, opts);
    note(strict, c.id.endsWith('signature-default') ? 'signature minima (default lengths)' : 'signature minima', worst(ours[1], pip[1]));
  }
  assert.equal(rowsA.length, rowsE.length, c.id);
  const w = widest(cases.models[c.model]);
  const label = c.id.endsWith('signature-default') ? 'signature (default lengths)' : g;
  const constrained = c.op === 'strip' && c.args.spaces != null;   // cFSM spaces (compare.mjs)
  rowsE.forEach((re, i) => {
    const long = re[0] > 50 * w;
    const tol = long ? LIBM_TOL.longLength : constrained ? LIBM_TOL.constrained : TOL;
    compare(rowsA[i], re, `${c.id} L = ${re[0]}`, { ...opts, tol });
    note(tol === TOL ? strict : libm, long ? `${label} beyond 50 x widest strip` : constrained ? `${label} (cFSM-constrained)` : label,
         worst(rowsA[i], re));
  });
}

test('every operation matches cufsm-rs-py 0.1.0 to 1e-9, but for the documented libm divergence', () => {
  let n = 0;
  for (const c of cases.ops.filter((o) => !o.error && !(o.either && expected.ops[o.id].error))) {
    const r = runCase(c);
    assert.equal(r.error, undefined, `${c.id}: ${JSON.stringify(r.error)}`);
    check(c, r.value, unmark(expected.ops[c.id].value));
    n++;
  }
  console.log(`${n} operations`);
  console.log('largest relative difference, held to 1e-9:', JSON.stringify(strict, null, 1));
  console.log('largest relative difference, libm divergence:', JSON.stringify(libm, null, 1));
  console.log(`mode vectors accepted with the opposite sign (a +1/-1 tie): ${flips.length}`, flips.slice(0, 6).join('; '));
  for (const [op, w] of Object.entries(strict)) assert.ok(w <= TOL, `${op} ${w}`);
});

test('errors are the package\'s errors: the same type and message', () => {
  const errs = cases.ops.filter((o) => o.error || (o.either && expected.ops[o.id].error));
  assert.ok(errs.filter((o) => o.either).length >= 30, 'the refused classification options are checked too');
  for (const c of errs) {
    const r = runCase(c);
    const e = expected.ops[c.id].error;
    assert.ok(r.error, `${c.id}: expected ${e.type}, got a value`);
    assert.equal(r.error.type, e.type, `${c.id}: ${r.error.message}`);
    assert.equal(r.error.message, e.message, c.id);
  }
});

test('nothing raises NotImplementedError: every call the package answers, the page answers', async () => {
  const src = await readFile(new URL('../js/py/transport.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /NotImplementedError|not implemented yet/i);
  for (const id of ['spaces/tutorial_c/D', 'm_all/gap', 'm_all/ragged', 'template/default', 'caps/neigs-60', 'caps/terms-101',
                    'classify-given/one-term', 'classify-options/tutorial_c/strip-ss/natural-work-kg'])
    assert.ok(done[id], `${id} answered`);
  assert.equal(done['caps/terms-101'][0][1].length, 101);
  assert.ok(done['caps/neigs-60'].every((r) => r[2].length > 50), 'more than the old 50 load factors');
});

test('a classification of edited mode vectors is the engine\'s answer for those vectors', () => {
  const c = cases.ops.find((o) => o.id === 'tutorial_c/strip-ss');
  const rows = done[c.id];
  const args = { arrays: arraysOf(c), bc: 'S-S', orth: 'axial', norm: 'vector', ospace: 'st' };
  const base = call('classify', { ...args, results: rows }).value;
  const edited = structuredClone(rows);
  edited[1][3][0][5] += 1e-12;                         // one entry of one mode, nudged
  const near = call('classify', { ...args, results: edited }).value;
  assert.ok(worst(near, base) < 1e-6, 'a nudge moves the percentages by a nudge');
  const other = call('classify', { ...args, arrays: arraysOf({ model: 'unsym' }), results: rows });
  assert.equal(other.error?.type, 'ValueError', 'another model\'s modes are the wrong size');
});

test('an engine trap is a RuntimeError, and the engine carries on', () => {
  // cFSM on a model with a node on no element panics inside cufsm-rs (cfsm.rs meta-elements; the
  // package raises PanicException there), which traps the wasm instance
  const m = cases.models.mechanism;
  const r = call('strip', { arrays: [m.prop, m.node, m.elem, m.constraints, m.springs], lengths: [10], m_all: [[1]], bc: 'S-S', neigs: 1, spaces: 'D' });
  assert.equal(r.error?.type, 'RuntimeError');
  assert.match(r.error.message, /the engine stopped/);
  const again = runCase(cases.ops.find((o) => o.id === 'tutorial_c/strip-cc'));
  compare(again.value, unmark(expected.ops['tutorial_c/strip-cc'].value), 'after the trap');
});

test('numbers cross bit for bit, NaN and infinities too; plain JSON numbers are accepted', () => {
  const v = [0.1 + 0.2, 1 / 3, -0, NaN, Infinity, -Infinity, 5e-324, 1.7976931348623157e308];
  const back = unpack(JSON.parse(JSON.stringify(pack(v))));
  v.forEach((x, i) => assert.ok(Object.is(back[i], x), `${x}`));
  assert.ok(Object.is(unpack(pack(-0)), -0));
  const m = cases.models.tutorial_c;
  const plain = JSON.parse(T.call('section_properties', JSON.stringify({ arrays: [m.prop, m.node, m.elem, [], []] })));
  assert.equal(unpack(plain.ok).A, 2.1);
});

test('the default signature lengths are the package\'s, to the last bit or within an ulp', () => {
  let worstUlps = 0;
  for (const id of cases.ops.filter((o) => o.id.endsWith('/signature-default')).map((o) => o.id)) {
    const ours = done[id][0].map((r) => r[0]);
    const theirs = expected.ops[id].value[0].map((r) => r[0]);
    assert.equal(ours.length, 100);
    ours.forEach((L, i) => {
      const d = Math.abs(L - theirs[i]) / (Number.EPSILON * theirs[i]);
      worstUlps = Math.max(worstUlps, d);
      assert.ok(d <= 2, `${id} ${i}`);
    });
  }
  console.log(`default signature lengths: largest difference ${worstUlps.toFixed(2)} ulp`);
});

test('an unknown operation and bad JSON are ValueErrors, not crashes', () => {
  assert.equal(JSON.parse(T.call('nope', '{}')).error.type, 'ValueError');
  assert.equal(JSON.parse(T.call('section_properties', '{not json')).error.type, 'ValueError');
  assert.deepEqual([...T.ops].sort(), ['classify', 'first_yield', 'section_properties', 'signature', 'stress',
    'stress_to_action', 'strip', 'template']);
});
