import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../js/engine.js';
import { createRuntime } from '../js/ext/runtime.js';
import * as M from '../js/model.js';

const engine = await loadEngine(await readFile(new URL('../cufsm.wasm', import.meta.url)));
const micropython = await import('../vendor/civilkit/micropython.mjs');
const video = JSON.parse(await readFile(new URL('./fixtures/video-c.json', import.meta.url)));
const model = { ...M.fromCufsmText(video), loads: { P: 1 }, fy: 50,
                analysis: { solution: 'signature', bc: 'S-S', terms: 1, neigs: 5, lengths: [] } };
const src = (name) => readFile(new URL(`./fixtures/ckext/${name}.py`, import.meta.url), 'utf8');
const manifest = (caps) => ({ id: 't.t', name: 'T', version: '1.0.0', civilkitApi: '^1.0',
                              contributes: [{ point: 'buckling.tool', id: 't' }], capabilities: caps });

test('hello: first yield through the capability', async () => {
  const rt = await createRuntime({ micropython, engine });
  rt.load({ manifest: manifest(['firstYield']), main: await src('hello') });
  const out = rt.check({ fy: 50 }, { model, results: null });
  const py = out.result.find((r) => r.label === 'Py');
  assert.ok(Math.abs(py.value - 105) < 1e-6, JSON.stringify(out));
});

test('an undeclared capability throws inside the module', async () => {
  const rt = await createRuntime({ micropython, engine });
  rt.load({ manifest: manifest([]), main: await src('hello') });
  assert.throws(() => rt.check({ fy: 50 }, { model, results: null }), /not declared/);
});

test('proposeModel is validated and recorded, never applied', async () => {
  const rt = await createRuntime({ micropython, engine });
  rt.load({ manifest: manifest(['proposeModel']), main: 'import civilkit, json\ndef build_ui(i,r,c):\n    return {"type":"panel","children":[]}\ndef check(i):\n    civilkit.proposeModel(json.dumps({"mats":[],"nodes":[],"elems":[{"i":0,"j":9,"t":1,"mat":1}]}))\n    return {"result":[],"calcLines":[]}\n' });
  const out = rt.check({}, { model, results: null });
  assert.equal(out.proposals.length, 1);
  assert.match(out.proposals[0].error, /node/);
});

test('result rows drop MicroPython float noise for display, and nothing else', async () => {
  const { tidy } = await import('../js/ext/ui.js');
  const t = tidy({ type: 'panel', children: [{ type: 'result', items: [
    { label: 'a', value: 0.5440899999999999 }, { label: 'b', value: 'text' }, { label: 'c', value: 4160691.6250779536 }] }] });
  assert.deepEqual(t.children[0].items.map((i) => i.value), [0.54409, 'text', 4160691.62508]);
});
