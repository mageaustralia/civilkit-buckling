import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadEngine } from '../../js/engine.js';
import { consoleFiles } from '../../js/py/lite.js';
import { createRunner } from '../../js/py/runner.js';
import { createPyodideRunner, pyodideFiles } from '../../js/py/pyodide-runner.js';
import { unpack } from '../../js/py/transport.js';
import { PYODIDE } from '../../js/py/pyodide-files.js';
import { compare, worst, TOL, LIBM_TOL } from '../fixtures/pyparity/compare.mjs';
import { SCRIPTS, withCaptures, captured } from './scripts.mjs';

/* The parity suite: every example script and the README quickstart (verbatim,
   numpy included), run whole on Pyodide in Node and, where it needs no numpy, on MicroPython in
   Node, the way the console runs them (js/py/pyodide-runner.js, js/py/runner.js), their captures
   (tests/parity/scripts.mjs) compared with CPython's and pip's cufsm-rs-py 0.1.0
   (tests/fixtures/pyparity/examples.json, tools/pyparity/examples.mjs) within compare.mjs's
   named tolerances: numbers, never printed text. Pyodide and MicroPython run the same engine
   through the same transport, so they are also held to each other at 1e-9. */
const root = new URL('../../', import.meta.url);
const index = new URL(PYODIDE.dir, root);
if (!existsSync(new URL('pyodide.asm.wasm', index)))
  throw new Error(`Pyodide ${PYODIDE.version} is not in ${PYODIDE.dir}: run npm run pyodide (node tools/fetch-pyodide.mjs) once`);

const engine = await loadEngine(await readFile(new URL('cufsm.wasm', root)));
const read = (files) => Promise.all(Object.entries(files).map(async ([n, u]) => [n, await readFile(u, 'utf8')])).then(Object.fromEntries);
const mp = createRunner({ engine, files: await read(consoleFiles()), loadMicroPython: (await import('../../vendor/civilkit/micropython.mjs')).loadMicroPython });
const { loadPyodide } = await import(new URL('pyodide.mjs', index));
const pyo = createPyodideRunner({ engine, files: await read(pyodideFiles()), indexURL: index.pathname, loadPyodide });
const cpython = JSON.parse(await readFile(new URL('tests/fixtures/pyparity/examples.json', root), 'utf8'));

const legs = { pyodide: pyo, micropython: mp };
const report = [];
for (const s of SCRIPTS) {
  test(`${s.id}: ${s.runtimes.join(', ')}`, async (t) => {
    const want = unpack(cpython.scripts[s.id]);
    assert.ok(want, `${s.id}: no CPython capture (run node tools/pyparity/examples.mjs)`);
    const got = {};
    for (const rt of s.runtimes.filter((r) => r !== 'cpython')) {
      const r = await legs[rt].run(withCaptures(s));
      assert.equal(r.error, null, `${s.id} on ${rt}: ${r.error?.text}`);
      assert.equal(r.runtime, rt);
      got[rt] = unpack(captured(r.stdout));
      const row = { script: s.id, runtime: rt, seconds: +(r.ms / 1000).toFixed(1) };
      for (const [name, [expr, tolName]] of Object.entries(s.captures)) {
        const tol = tolName ? LIBM_TOL[tolName] : TOL;
        const floor = /shape\.|\.at\(|mode_shape/.test(expr) ? 1 : 0;     // mode components: relative to the mode's peak, 1
        compare(got[rt][expr], want[expr], `${s.id} on ${rt}: ${name}`, { tol, floor, flips: [] });
        const w = worst(got[rt][expr], want[expr], floor);
        const k = tolName ?? 'TOL';
        row[k] = Math.max(row[k] ?? 0, w);
      }
      report.push(row);
    }
    // the same engine and transport: the two Node legs agree to 1e-9 whatever libm the package has
    if (got.pyodide && got.micropython) {
      let w = 0;
      for (const [expr] of Object.values(s.captures)) {
        compare(got.micropython[expr], got.pyodide[expr], `${s.id}: MicroPython against Pyodide`, { tol: TOL });
        w = Math.max(w, worst(got.micropython[expr], got.pyodide[expr]));
      }
      t.diagnostic(`MicroPython against Pyodide: ${w}`);
      report.push({ script: s.id, runtime: 'micropython vs pyodide', TOL: w });
    }
  });
}

test('the parity report', () => {
  const fmt = (v) => (v === undefined ? '' : typeof v === 'number' && v < 1 ? v.toExponential(1) : String(v));
  const keys = ['script', 'runtime', 'seconds', 'TOL', 'longLength', 'classify'];
  console.log(`parity against CPython ${cpython.python}, cufsm-rs-py ${cpython.cufsm_rs_py}, numpy ${cpython.numpy} `
    + `(largest relative difference per tolerance; TOL ${TOL}, longLength ${LIBM_TOL.longLength}, classify ${LIBM_TOL.classify}):`);
  const w = [18, 24, 8, 9, 11, 9];
  const line = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join(' ').trimEnd();
  console.log(line(keys));
  for (const r of report) console.log(line(keys.map((k) => fmt(r[k]))));
  assert.ok(report.length >= SCRIPTS.length);
});
