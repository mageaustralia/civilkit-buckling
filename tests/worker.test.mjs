import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeHandler } from '../js/worker.js';

const wasm = await readFile(new URL('../cufsm.wasm', import.meta.url));
const pts = [[50, 15], [50, 0], [0, 0], [0, 100], [50, 100], [50, 85]];
const buffers = {
  mats: Float64Array.from([203e3, 203e3, 0.3, 0.3, 203e3 / 2.6]),
  nodes: Float64Array.from(pts.flatMap(([x, z]) => [x, z, 1, 1, 1, 1, 1])),
  elems: Float64Array.from([0, 1, 2, 3, 4].flatMap((i) => [i, i + 1, 1.5, 0])),
  springs: new Float64Array(0), constraints: new Float64Array(0),
};

test('chunked signature reports progress and matches one call', async () => {
  const sent = [];
  const h = await makeHandler(wasm, (m) => sent.push(m));
  const lengths = Array.from({ length: 30 }, (_, i) => 10 * (i + 1));
  await h({ id: 1, method: 'signatureChunked', args: [buffers, { bc: 'S-S', terms: 1, spaces: 0, lengths }, 10] });
  const done = sent.find((m) => m.id === 1 && m.result);
  assert.equal(done.result.length, 60);
  assert.deepEqual(sent.filter((m) => m.progress != null).map((m) => m.progress), [1 / 3, 2 / 3, 1]);
});

test('cancel stops the worker loop', async () => {
  const sent = [];
  const h = await makeHandler(wasm, (m) => sent.push(m));
  const lengths = Array.from({ length: 90 }, (_, i) => 10 * (i + 1));
  const run = h({ id: 2, method: 'signatureChunked', args: [buffers, { bc: 'S-S', terms: 1, spaces: 0, lengths }, 5] });
  await h({ id: 3, method: 'cancel', args: [2] });
  await run;
  assert.ok(sent.some((m) => m.id === 2 && m.error === 'cancelled'));
  assert.ok(sent.filter((m) => m.id === 2 && m.progress != null).length < 18);
});

/* Defect 10 (worker half): messages queued while the engine boots must settle when the boot
   fails, and so must messages that arrive after the failure. */
import { bootLoop } from '../js/worker.js';
test('a failed boot rejects the queued messages and every later one', async () => {
  const sent = [];
  let fail;
  const make = () => new Promise((_, rej) => { fail = rej; });
  const on = bootLoop((m) => sent.push(m), make);
  const booting = on({ boot: 'x.wasm' });
  await on({ id: 1, method: 'props', args: [] });          // queued before init settles
  fail(new Error('bad wasm'));
  await booting;
  await on({ id: 2, method: 'props', args: [] });          // after the failure
  assert.deepEqual(sent.find((m) => 'ready' in m), { ready: false, error: 'bad wasm' });
  assert.match(sent.find((m) => m.id === 1)?.error ?? '', /bad wasm/);
  assert.match(sent.find((m) => m.id === 2)?.error ?? '', /bad wasm/);
});
