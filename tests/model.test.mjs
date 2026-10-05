import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as M from '../js/model.js';

const video = JSON.parse(await readFile(new URL('./fixtures/video-c.json', import.meta.url)));

test('fromCufsmText reads the video model', () => {
  const m = M.fromCufsmText(video);
  assert.equal(m.nodes.length, 10);
  assert.equal(m.elems.length, 9);
  assert.deepEqual(m.mats[0], { id: 100, ex: 29500, ey: 29500, vx: 0.3, vy: 0.3, g: 11346.15 });
  assert.equal(m.nodes[0].stress, -38.889);
  assert.deepEqual(m.elems[0], { i: 0, j: 1, t: 0.1, mat: 100 });
});

test('fromCufsmText maps node numbers, not rows', () => {
  const m = M.fromCufsmText({
    prop: '100 200000 200000 0.3 0.3 76923',
    node: '1 0 0 1 1 1 1 1\n5 10 0 1 1 1 1 1\n9 10 10 1 1 1 1 1',
    elem: '1 1 5 1 100\n2 5 9 1 100',
  });
  assert.deepEqual(m.elems.map((e) => [e.i, e.j]), [[0, 1], [1, 2]]);
});

test('fromCufsmText names the bad line', () => {
  assert.throws(() => M.fromCufsmText({ prop: '100 1 1 .3 .3 1', node: '1 0 0 1 1 1 1 1', elem: '1 1 7 1 100' }),
                /elem line 1: node 7/);
});

test('text round trip', () => {
  const m = M.fromCufsmText(video);
  assert.deepEqual(M.fromCufsmText(M.toCufsmText(m)), m);
});

test('toBuffers: 7 per node, 4 per element, mat id to row', () => {
  const m = M.fromCufsmText(video);
  m.mats.push(M.isotropic(7, 1000, 0.25));
  m.elems[2].mat = 7;
  const b = M.toBuffers(m);
  assert.equal(b.nodes.length, 70);
  assert.equal(b.elems.length, 36);
  assert.equal(b.elems[2 * 4 + 3], 1);
  assert.equal(b.mats.length, 10);
});

test('fromPolylines meshes each segment', () => {
  const m = M.fromPolylines([[[0, 0], [0, 100], [50, 100]]], { t: 1.5, mat: M.isotropic(100, 2e5, 0.3), mesh: 4 });
  assert.equal(m.elems.length, 8);
  assert.equal(m.nodes.length, 9);
});

test('doubleElems and divideElem', () => {
  const m = M.fromCufsmText(video);
  assert.equal(M.doubleElems(m).elems.length, 18);
  const d = M.divideElem(m, 3, 3);
  assert.equal(d.elems.length, 11);
  assert.equal(d.nodes.length, 12);
});

test('deleteNode renumbers springs and drops constraints that name it', () => {
  const m = M.fromCufsmText(video);
  m.springs = [[5, -1, 1, 0, 0, 0, 0, 1, 0.5], [2, -1, 1, 0, 0, 0, 0, 1, 0.5]];
  m.constraints = [[2, 1, 1, 8, 1]];
  const d = M.deleteNode(m, 2);
  assert.deepEqual(d.springs, [[4, -1, 1, 0, 0, 0, 0, 1, 0.5]]);
  assert.deepEqual(d.constraints, []);
});

test('validateModel: a node index out of range is refused', () => {
  const m = M.fromCufsmText(video);
  m.elems[0].j = 99;
  assert.throws(() => M.validateModel(m), /node 100, which does not exist/);
});

test('validateModel: a non-positive thickness is refused', () => {
  const m = M.fromCufsmText(video);
  m.elems[2].t = 0;
  assert.throws(() => M.validateModel(m), /thickness/);
});

test('validateModel: an undefined material is refused', () => {
  const m = M.fromCufsmText(video);
  m.elems[1].mat = 999;
  assert.throws(() => M.validateModel(m), /material 999, which is not defined/);
});

test('validateModel: more than maxNodes nodes is refused', () => {
  const m = M.fromCufsmText(video);
  m.nodes = Array.from({ length: 12 }, (_, i) => ({ x: i, z: 0, free: [1,1,1,1], stress: 0 }));
  assert.throws(() => M.validateModel(m, { maxNodes: 10 }), /the limit is 10/);
});

test('validateModel: no elements is refused', () => {
  const m = M.fromCufsmText(video);
  m.elems = [];
  assert.throws(() => M.validateModel(m), /no elements/);
});

test('validateModel: a node without finite coordinates is refused', () => {
  const m = M.fromCufsmText(video);
  m.nodes[3].z = NaN;
  assert.throws(() => M.validateModel(m), /node 4 has no finite x and z/);
});

test('validateModel: a material without a modulus is refused', () => {
  const m = M.fromCufsmText(video);
  delete m.mats[0].ex;
  assert.throws(() => M.validateModel(m), /needs finite ex/);
});

test('appendNode joins a new node to the given one, with its stress and its element\'s t and material', () => {
  const m0 = M.fromCufsmText(video);
  const m = M.appendNode(m0, 7.5, 2, 9);
  assert.equal(m0.nodes.length, 10);                       // the input is untouched
  assert.equal(m.nodes.length, 11);
  assert.deepEqual(m.nodes[10], { x: 7.5, z: 2, free: [1, 1, 1, 1], stress: m0.nodes[9].stress });
  assert.deepEqual(m.elems.at(-1), { i: 9, j: 10, t: m0.elems.at(-1).t, mat: m0.elems.at(-1).mat });
  M.validateModel(m);
});

test('appendNode on a model with no nodes starts it without an element', () => {
  const m0 = { mats: [M.isotropic(100, 200000, 0.3)], nodes: [], elems: [], springs: [], constraints: [] };
  const m = M.appendNode(m0, 0, 0, -1);
  assert.equal(m.nodes.length, 1);
  assert.equal(m.elems.length, 0);
  const m2 = M.appendNode(m, 0, 50, 0, { t: 1.5 });
  assert.deepEqual(m2.elems, [{ i: 0, j: 1, t: 1.5, mat: 100 }]);
});

test('setNode and setElem change one row and copy the rest', () => {
  const m0 = M.fromCufsmText(video);
  const m = M.setNode(m0, 2, { x: 12, free: [0, 1, 1, 1] });
  assert.equal(m.nodes[2].x, 12);
  assert.deepEqual(m.nodes[2].free, [0, 1, 1, 1]);
  assert.equal(m0.nodes[2].x, M.fromCufsmText(video).nodes[2].x);
  assert.deepEqual(m0.nodes[2].free, [1, 1, 1, 1]);
  const e = M.setElem(m0, 3, { t: 0.2 });
  assert.equal(e.elems[3].t, 0.2);
  assert.equal(m0.elems[3].t, 0.1);
});
