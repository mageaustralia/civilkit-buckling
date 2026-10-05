import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../js/engine.js';

const wasm = await readFile(new URL('../cufsm.wasm', import.meta.url));
const eng = await loadEngine(wasm);

// 100 x 50 x 15 lipped channel, t = 1.5, one isotropic material, sigma = 1
const pts = [[50, 15], [50, 0], [0, 0], [0, 100], [50, 100], [50, 85]];
const E = 203e3, nu = 0.3;
const buffers = {
  mats: Float64Array.from([E, E, nu, nu, E / (2 * (1 + nu))]),
  nodes: Float64Array.from(pts.flatMap(([x, z]) => [x, z, 1, 1, 1, 1, 1])),
  elems: Float64Array.from([0, 1, 2, 3, 4].flatMap((i) => [i, i + 1, 1.5, 0])),
  springs: new Float64Array(0), constraints: new Float64Array(0),
};

test('props: A = t * total length', () => {
  const p = eng.props(buffers);
  assert.ok(Math.abs(p.A - 1.5 * (15 + 50 + 100 + 50 + 15)) < 1e-9, `A = ${p.A}`);
});

test('signature: one row per length, lambda positive', () => {
  const r = eng.signature(buffers, { bc: 'S-S', terms: 1, spaces: 0, lengths: [50, 500] });
  assert.equal(r.length, 4);
  assert.ok(r[1] > 0 && r[3] > 0);
});

test('modes: neigs modes, ascending', () => {
  const [m] = eng.modes(buffers, { bc: 'S-S', terms: 1, neigs: 3, lengths: [120] });
  assert.equal(m.modes.length, m.found);
  assert.ok(m.found >= 2 && m.modes[1].lf >= m.modes[0].lf);
  assert.equal(m.modes[0].dofs.length, 4 * pts.length);
});

test('first yield: Py = fy A, and the face yields first', () => {
  const A = eng.props(buffers).A;
  const c = eng.firstYield(buffers, { fy: 345, restrained: false, extremeFibre: false });
  const x = eng.firstYield(buffers, { fy: 345, restrained: false, extremeFibre: true });
  assert.ok(Math.abs(c.Py - 345 * A) < 1e-6);
  assert.ok(x.Mxx < c.Mxx);
});

test('engine errors surface as Error with the engine message', () => {
  assert.throws(() => eng.signature(buffers, { bc: 'X-X', terms: 1, spaces: 0, lengths: [50] }),
                /unknown boundary condition/);
});

/* ABI 2 minor 1: the Python console's exports */
test('the module is ABI 2 with minor 1 or later', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {});
  assert.equal(instance.exports.cufsm_abi_version(), 2);
  assert.ok(instance.exports.cufsm_abi_minor() >= 1);
});

test('strip: with 1..n at every length it is modes(), classes included; without classify, NaN', () => {
  const lengths = [120, 600];
  const a = eng.modes(buffers, { bc: 'C-C', terms: 3, neigs: 2, lengths });
  const b = eng.strip(buffers, { bc: 'c-c', terms: 3, neigs: 2, lengths });
  assert.deepEqual(b.map((r) => [r.found, r.m, r.modes.map((m) => [m.lf, ...m.cls, ...m.dofs])]),
                   a.map((r) => [r.found, r.m, r.modes.map((m) => [m.lf, ...m.cls, ...m.dofs])]));
  const c = eng.strip(buffers, { bc: 'C-C', mAll: [[3, 0, 1, 1], [2]], neigs: 2, lengths, classify: false });
  assert.deepEqual(c.map((r) => r.m), [[1, 3], [2]], 'each row reports the terms it used (msort)');
  assert.ok(c[0].modes[0].cls.every(Number.isNaN));
  assert.equal(c[1].modes[0].dofs.length, 4 * pts.length);
});

test('strip with spaces: restricted to D, the load factor is no lower than the free one', () => {
  const [free] = eng.strip(buffers, { bc: 'S-S', terms: 1, neigs: 1, lengths: [300] });
  const [d] = eng.strip(buffers, { bc: 'S-S', terms: 1, spaces: 2, neigs: 1, lengths: [300] });
  assert.ok(d.modes[0].lf >= free.modes[0].lf * (1 - 1e-12));
});

test('classify: the defaults give modes()\' own classes for its vectors', () => {
  const [r] = eng.modes(buffers, { bc: 'S-S', terms: 1, neigs: 2, lengths: [120] });
  const cls = eng.classify(buffers, { bc: 'S-S', results: [{ L: 120, m: r.m, modes: r.modes.map((m) => m.dofs) }] });
  cls.forEach((c, k) => c.forEach((v, i) => assert.ok(Math.abs(v - r.modes[k].cls[i]) < 1e-9)));
  const other = eng.classify(buffers, { bc: 'S-S', orth: 1, norm: 2, ospace: 2, results: [{ L: 120, m: r.m, modes: [r.modes[0].dofs] }] });
  assert.equal(other.length, 1);
  assert.ok(Math.abs(other[0].reduce((s, v) => s + v, 0) - 100) < 1e-6);
});

test('template, propsWn, signatureLengths and signatureMinima', () => {
  const t = eng.template([1, 9, 5, 5, 1, 1, 0, 0, 0, 0, 90, 90, 0.1, 4, 2, 2, 2, 2, 0, 0, 0, 0, 1]);
  assert.equal(t.nodes.length / 7, 13);
  assert.equal(t.elems.length / 4, 12);
  const p = eng.propsWn(buffers);
  assert.equal(p.wn.length, pts.length);
  assert.equal(p.A, eng.props(buffers).A);
  const ls = eng.signatureLengths(buffers);
  assert.equal(ls.length, 100);
  assert.ok(Math.abs(ls[0] - 15) < 1e-9 && Math.abs(ls[99] - 100000) < 1e-6, `${ls[0]} to ${ls[99]}`);
  assert.deepEqual(eng.signatureMinima([[1, 3], [2, 1], [4, 2], [8, NaN]]).length, 1);
  assert.deepEqual(eng.signatureMinima([]), []);
});
