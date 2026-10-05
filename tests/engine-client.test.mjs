import { test } from 'node:test';
import assert from 'node:assert/strict';

/* A stand-in for the browser's Worker: records what the client posts and lets the test answer. */
const workers = [];
class FakeWorker {
  constructor() { this.posted = []; this.terminated = false; workers.push(this); }
  postMessage(m) { this.posted.push(m); }
  terminate() { this.terminated = true; }
  reply(m) { this.onmessage?.({ data: m }); }
}
globalThis.Worker = FakeWorker;
const { startEngine } = await import('../js/engine-client.js');
const settle = () => new Promise((r) => setTimeout(r, 0));

test('a worker that reports ready:false leaves the client dead, not hanging', async () => {
  const c = startEngine('x.wasm');
  const w = workers.at(-1);
  const early = c.call('props', {});                        // queued before the boot answer
  w.reply({ ready: false, error: 'bad wasm' });
  await assert.rejects(c.ready, /bad wasm/);
  await assert.rejects(early, /bad wasm/);
  const later = c.call('props', {});
  const out = await Promise.race([later.then(() => 'resolved', (e) => e.message), settle().then(() => 'hung')]);
  assert.match(out, /bad wasm/);
});

/* Defect 8 (cancel): the worker only looks for a cancel between chunks, so a cancel waited out a
   whole chunk of a heavy model. Cancel now terminates the worker and starts a fresh one; the
   cancelled run rejects at once and the other calls in flight are sent again to the new worker. */
test('cancel terminates a running chunked solve and re-sends the other calls', async () => {
  const c = startEngine('x.wasm');
  const w1 = workers.at(-1);
  w1.reply({ ready: true });
  await c.ready;
  const run = c.signatureChunked({}, { lengths: [1, 2, 3] });
  const props = c.call('props', { a: 1 });
  c.cancel();
  await assert.rejects(run, /cancelled/);
  assert.equal(w1.terminated, true);
  const w2 = workers.at(-1);
  assert.notEqual(w2, w1);
  assert.ok(w2.posted[0].boot, 'the new worker boots first');
  const resent = w2.posted.find((m) => m.method === 'props');
  assert.deepEqual(resent?.args, [{ a: 1 }]);
  assert.ok(!w2.posted.some((m) => m.method === 'signatureChunked'));
  w2.reply({ ready: true });
  w2.reply({ id: resent.id, result: 42 });
  assert.equal(await props, 42);
  c.cancel();                                                // nothing running: no restart
  assert.equal(workers.at(-1), w2);
});

test('cancel also stops a long modes call, and keeps stresgen', async () => {
  const c = startEngine('x.wasm');
  const w1 = workers.at(-1);
  w1.reply({ ready: true });
  await c.ready;
  const modes = c.call('modes', {}, { lengths: [100] });
  const stress = c.call('stresgen', {}, { P: 1 });
  c.cancel();
  await assert.rejects(modes, /cancelled/);
  const w2 = workers.at(-1);
  assert.notEqual(w2, w1);
  assert.deepEqual(w2.posted.slice(1).map((m) => m.method), ['stresgen']);
  w2.reply({ ready: true });
  w2.reply({ id: w2.posted[1].id, result: 'ok' });
  assert.equal(await stress, 'ok');
});
