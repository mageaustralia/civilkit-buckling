import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/projects.js';

/* the smallest model validateState accepts: one material, one strip */
const model = () => ({
  mats: [{ id: 100, ex: 200000, ey: 200000, vx: 0.3, vy: 0.3, g: 76923.08 }],
  nodes: [{ x: 0, z: 0, free: [1, 1, 1, 1], stress: 1 }, { x: 0, z: 100, free: [1, 1, 1, 1], stress: 1 }],
  elems: [{ i: 0, j: 1, t: 1.5, mat: 100 }],
  springs: [], constraints: [],
});
const state = { v: 2, model: model(), loads: { P: 1 }, analysis: { solution: 'signature' }, ui: { tab: 'sig' } };
const file = (body, name = 'x.ckb.json') => new File([typeof body === 'string' ? body : JSON.stringify(body)], name);

test('save, list, load, delete', async () => {
  const db = await P.openDb('t1');
  const id = await P.saveProject(db, { name: 'C 150', state });
  await P.saveProject(db, { name: 'Z 200', state });
  const list = await P.listProjects(db);
  assert.equal(list[0].name, 'Z 200');
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'name', 'updated']);
  assert.deepEqual((await P.loadProject(db, id)).state, state);
  await P.deleteProject(db, id);
  assert.equal((await P.listProjects(db)).length, 1);
});

test('a save keeps the id and moves the project to the top', async () => {
  const db = await P.openDb('t2');
  const a = await P.saveProject(db, { name: 'A', state });
  await P.saveProject(db, { name: 'B', state });
  assert.equal(await P.saveProject(db, { id: a, name: 'A renamed', state }), a);
  const list = await P.listProjects(db);
  assert.deepEqual(list.map((p) => p.name), ['A renamed', 'B']);
});

test('a record can be put back as it was (the undo of a delete)', async () => {
  const db = await P.openDb('t3');
  const id = await P.saveProject(db, { name: 'Keep', state });
  const rec = await P.loadProject(db, id);
  await P.deleteProject(db, id);
  await P.restoreProject(db, rec);
  assert.deepEqual(await P.loadProject(db, id), rec);
});

test('the memory store behaves like the database (no IndexedDB: private browsing)', async () => {
  const db = P.memoryDb();
  assert.equal(db.memory, true);
  const id = await P.saveProject(db, { name: 'M', state });
  await P.saveProject(db, { name: 'N', state });
  assert.deepEqual((await P.listProjects(db)).map((p) => p.name), ['N', 'M']);
  const got = await P.loadProject(db, id);
  assert.deepEqual(got.state, state);
  got.state.model.nodes[0].x = 99;                      // a copy: the store is not edited through it
  assert.equal((await P.loadProject(db, id)).state.model.nodes[0].x, 0);
  await P.deleteProject(db, id);
  assert.equal((await P.listProjects(db)).length, 1);
  assert.equal(await P.loadProject(db, 'nope'), undefined);
});

test('file round trip and old-version file', async () => {
  const f = P.toFile({ name: 'C 150', state });
  assert.equal(f.type, 'application/json');
  const back = await P.fromFile(file(await f.text(), 'C 150.ckb.json'));
  assert.deepEqual(back.state, state);
  assert.equal(back.name, 'C 150');
  const old = file({ format: 'civilkit-buckling', version: 1, state: {} });
  await assert.rejects(P.fromFile(old), /older version/);
  await assert.rejects(P.fromFile(file('nope')), /not a CivilKit Buckling file/);
  await assert.rejects(P.fromFile(file({ hello: 1 })), /not a CivilKit Buckling file/);
});

test('a file from a newer version says so', async () => {
  await assert.rejects(P.fromFile(file({ format: 'civilkit-buckling', version: 3, state })), /newer version/);
});

test('a file name without a name of its own comes from the file', async () => {
  const back = await P.fromFile(file({ format: 'civilkit-buckling', version: 2, state }, 'Purlin Z200.ckb.json'));
  assert.equal(back.name, 'Purlin Z200');
});

test('a file goes through the share-link checks and caps', async () => {
  const big = structuredClone(state);
  big.model.nodes = Array.from({ length: 501 }, (_, i) => ({ x: i, z: 0, free: [1, 1, 1, 1], stress: 1 }));
  await assert.rejects(P.fromFile(file({ format: 'civilkit-buckling', version: 2, state: big })),
    /This file’s model is too large to open: 501 nodes; the limit is 500/);
  const broken = structuredClone(state);
  broken.model.elems[0].j = 7;
  await assert.rejects(P.fromFile(file({ format: 'civilkit-buckling', version: 2, state: broken })),
    /element 1 points at node 8/);
  await assert.rejects(P.fromFile(file({ format: 'civilkit-buckling', version: 2, state: { ...state, v: 1 } })),
    /older version/);
});

test('a file far too large to be a project is refused before it is read', async () => {
  const huge = new File(['x'.repeat(P.FILE_MAX + 1)], 'huge.ckb.json');
  await assert.rejects(P.fromFile(huge), /too large/);
});

test('checkState: what a project restore and a save are held to', () => {
  assert.equal(P.checkState(structuredClone(state)), null);
  assert.match(P.checkState({ v: 2, model: { ...model(), nodes: [] } }), /This project contains no section/);
  assert.match(P.checkState(null), /cannot be read/);
});

test('fileName keeps the name readable and safe on every system', () => {
  assert.equal(P.fileName('C 150'), 'C 150.ckb.json');
  assert.equal(P.fileName('a/b:c*?'), 'a-b-c--.ckb.json');
  assert.equal(P.fileName('   '), 'project.ckb.json');
});
