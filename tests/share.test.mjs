import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeState, decodeState, validateState } from '../js/share.js';

const state = { v: 2, model: { mats: [{ id: 100, ex: 1, ey: 1, vx: 0.3, vy: 0.3, g: 0.4 }], nodes: [], elems: [], springs: [], constraints: [] },
                loads: { P: 1 }, analysis: { solution: 'signature', bc: 'S-S', terms: 1, neigs: 10, lengths: [10, 20] }, ui: { tab: 'sig' } };

test('state round trips through the hash', async () => {
  const h = await encodeState(state);
  assert.match(h, /^#v2\./);
  assert.deepEqual(await decodeState(h), state);
});

test('decodeState rejects unknown versions', async () => {
  await assert.rejects(decodeState('#v1.abc'), /older version/);
  await assert.rejects(decodeState('#garbage'), /not a CivilKit Buckling link/);
});

test('decodeState reports a damaged payload plainly, not with engine text', async () => {
  await assert.rejects(decodeState('#v2.!!!!'), /damaged/);
  await assert.rejects(decodeState('#v2.AAAA'), /damaged/);
  await assert.rejects(decodeState('#v2.' + 'A'.repeat(40)), /damaged/);
});

test('a 2,000-node model round trips', async () => {
  const nodes = Array.from({ length: 2000 }, (_, i) =>
    ({ x: +(i * 7.3 % 500).toFixed(6), z: +(i * 1.7 % 300).toFixed(6), free: [1, 1, 1, 1],
       stress: +(Math.sin(i) * 42.5).toFixed(9) }));
  const elems = Array.from({ length: 1999 }, (_, i) => ({ i, j: i + 1, t: 1.5, mat: 100 }));
  const big = { v: 2,
                model: { mats: [{ id: 100, ex: 200000, ey: 200000, vx: 0.3, vy: 0.3, g: 76923.0769230769 }],
                         nodes, elems, springs: [], constraints: [] },
                loads: { P: 105, Mxx: 328.25 },
                analysis: { solution: 'general', bc: 'C-C', terms: 4, neigs: 20, lengths: [10, 20, 30] },
                ui: { tab: 'mode' } };
  const h = await encodeState(big);
  assert.match(h, /^#v2\./);
  assert.deepEqual(await decodeState(h), big);
});

/* A model big enough that the old whole-array encoder threw: btoa(String.fromCharCode(...bytes))
   ran out of call stack above about 110 KB of compressed bytes in Node (124 KB in Chromium).
   Full-precision coordinates keep the JSON close to random, so it compresses little. */
function bigState(n) {
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const nodes = Array.from({ length: n }, () =>
    ({ x: rnd() * 1e6, z: rnd() * 1e6, free: [1, 1, 1, 1], stress: rnd() * 1e3 }));
  const elems = Array.from({ length: n - 1 }, (_, i) =>
    ({ i, j: i + 1, t: +(1 + rnd() * 3).toFixed(6), mat: 100 }));
  return { v: 2,
           model: { mats: [{ id: 100, ex: 200000, ey: 200000, vx: 0.3, vy: 0.3, g: 76923.0769230769 }],
                    nodes, elems, springs: [], constraints: [] },
           loads: { P: 105, Mxx: 328.25 },
           analysis: { solution: 'general', bc: 'C-C', terms: 4, neigs: 20, lengths: [10, 20, 30] },
           ui: { tab: 'mode' } };
}
const big = bigState(4000);
const bigRaw = new TextEncoder().encode(JSON.stringify(big));

test('a model too big for the old encoder round trips (chunked base64)', async () => {
  const comp = new Uint8Array(await new Response(new Blob([bigRaw]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  assert.throws(() => String.fromCharCode(...comp), RangeError);   // what the old encoder did
  const h = await encodeState(big);
  assert.match(h, /^#v2\./);
  assert.ok(comp.length > 150_000, `compressed ${comp.length} B`);
  console.log(`big model: raw ${bigRaw.length} B, compressed ${comp.length} B, hash ${h.length} chars`);
  assert.deepEqual(await decodeState(h), big);
});

test('decodeState handles a payload over 200 KB', async () => {
  const h = await encodeState(big);
  const payload = h.slice('#v2.'.length);
  assert.ok(payload.length > 200_000, `payload ${payload.length} chars`);
  const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  assert.ok(bytes.length > 150_000, `decoded ${bytes.length} B`);
  assert.deepEqual(await decodeState(h), big);
});

/* validateState: the model is checked before boot commits it, so a malformed link becomes a
   footer note instead of a TypeError inside geometry(). */
const good = () => ({
  v: 2,
  model: {
    mats: [{ id: 100, ex: 200000, ey: 200000, vx: 0.3, vy: 0.3, g: 76923.0769230769 }],
    nodes: [{ x: 0, z: 0, free: [1, 1, 1, 1], stress: 1 }, { x: 60, z: 0, free: [1, 1, 1, 1], stress: 2 }],
    elems: [{ i: 0, j: 1, t: 1.5, mat: 100 }],
    springs: [[0, -1, 1000, 1000, 0, 0, 0, 1, 0]],
    constraints: [[0, 1, 1, 1, 1]],
  },
  loads: { P: 1 }, analysis: { solution: 'signature' }, ui: { tab: 'sig' },
});

test('validateState accepts the state this app writes', () => {
  assert.equal(validateState(good()), null);
});

test('validateState rejects a node with no fixity data', () => {
  const s = good();
  delete s.model.nodes[1].free;
  assert.match(validateState(s), /node 2 has no fixity data/);
  const t = good();
  t.model.nodes[0].free = [1, 1];
  assert.match(validateState(t), /node 1 has no fixity data/);
});

test('validateState rejects an element that points past the nodes', () => {
  const s = good();
  s.model.elems[0].j = 5;
  assert.match(validateState(s), /element 1 points at node 6, which is not in the model/);
});

test('validateState rejects missing arrays and an empty section', () => {
  assert.match(validateState({ v: 2 }), /model cannot be read/);
  assert.match(validateState(null), /model cannot be read/);
  const s = good();
  s.model.elems = [];
  assert.match(validateState(s), /no section to analyse/);
});

test('validateState rejects non-numbers a geometry() call would choke on', () => {
  const s = good();
  s.model.nodes[0].x = 'left';
  assert.match(validateState(s), /node 1 has no usable coordinates/);
  const t = good();
  t.model.elems[0].t = 0;
  assert.match(validateState(t), /element 1 has no usable thickness/);
  const u = good();
  u.model.elems[0].mat = 101;
  assert.match(validateState(u), /element 1 uses material 101/);
});

/* Defect 8: a short link can describe a model big enough to tie the engine up for minutes (or
   overflow the call stack); validateState refuses it with a plain message. */
import { LIMITS } from '../js/share.js';
const chain = (n) => {
  const s = good();
  s.model.nodes = Array.from({ length: n }, (_, i) => ({ x: i, z: 0, free: [1, 1, 1, 1], stress: 1 }));
  s.model.elems = Array.from({ length: n - 1 }, (_, i) => ({ i, j: i + 1, t: 1, mat: 100 }));
  return s;
};
test('validateState caps nodes, elements and lengths', () => {
  assert.equal(LIMITS.nodes, 500);
  assert.equal(validateState(chain(LIMITS.nodes)), null);
  assert.match(validateState(chain(LIMITS.nodes + 1)), /501 nodes.*limit is 500/);
  assert.match(validateState(chain(200_000)), /200000 nodes/);
  const e = chain(300);
  e.model.elems = Array.from({ length: LIMITS.elems + 1 }, () => ({ i: 0, j: 1, t: 1, mat: 100 }));
  assert.match(validateState(e), /501 elements.*limit is 500/);
  const l = good();
  l.analysis.lengths = Array.from({ length: LIMITS.lengths + 1 }, (_, i) => i + 1);
  assert.match(validateState(l), /lengths.*limit is 1000/);
  l.analysis.lengths.pop();
  assert.equal(validateState(l), null);
});

/* Defect 7: a link's analysis settings are taken as the UI takes them (terms up to 100, not 8),
   and every value that is clamped or dropped is named so the footer can say so. */
import { readAnalysis } from '../js/share.js';
const BCS = ['S-S', 'C-C', 'S-C', 'C-F', 'C-G'];
test('readAnalysis keeps what the UI accepts', () => {
  const r = readAnalysis({ solution: 'general', bc: 'C-C', terms: 20, neigs: 30, lengths: [100, 10, 1000] }, BCS);
  assert.equal(r.terms, 20);
  assert.equal(r.neigs, 30);
  assert.equal(r.bc, 'C-C');
  assert.deepEqual(r.lengths, [10, 100, 1000]);
  assert.deepEqual(r.notes, []);
});
test('readAnalysis names every clamp and drop', () => {
  const r = readAnalysis({ solution: 'odd', bc: 'X-Y', terms: 150, neigs: 0, lengths: [5, -1],
    tube: { D: 500, p: 2.5, q: 0, nmodes: 3, base: 7 } }, BCS);
  assert.equal(r.terms, 100);
  assert.equal(r.neigs, 1);
  assert.equal(r.bc, undefined);
  assert.equal(r.lengths, undefined);
  assert.equal(r.tube.D, 500);
  assert.equal(r.tube.nmodes, 3);
  assert.ok(!('p' in r.tube) && !('q' in r.tube) && !('base' in r.tube));
  const all = r.notes.join(' | ');
  for (const want of [/terms 150.*100/, /eigenvalues 0.*1/, /boundary condition X-Y/, /solution/,
                      /fewer than two/, /harmonics around 2\.5/, /terms along 0/, /base end 7/])
    assert.match(all, want);
});
