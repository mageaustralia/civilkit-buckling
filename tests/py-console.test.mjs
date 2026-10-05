import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadEngine } from '../js/engine.js';
import { LITE_FILES, liteUrl } from '../js/py/lite.js';
import { createRunner, readTraceback, RUNTIMES, OUTPUT_MAX } from '../js/py/runner.js';

/* The Python console's runner (js/py/runner.js), the code the console worker runs: a script's
   output comes back whole with the runtime that ran it, each run starts on a fresh interpreter,
   errors are read from their traceback, and a module MicroPython lacks names the full runtime. */
const engine = await loadEngine(await readFile(new URL('../cufsm.wasm', import.meta.url)));
const micropython = await import('../vendor/civilkit/micropython.mjs');
const files = Object.fromEntries(await Promise.all(LITE_FILES.map(async (n) => [n, await readFile(liteUrl(n), 'utf8')])));
const runner = createRunner({ engine, files, loadMicroPython: micropython.loadMicroPython });

test('a run returns its whole output and the runtime that ran it', async () => {
  const r = await runner.run('import cufsm_rs\nprint("a")\nprint(cufsm_rs.__version__)\n');
  assert.equal(r.ok, true);
  assert.equal(r.runtime, 'micropython');
  assert.equal(RUNTIMES[r.runtime], 'MicroPython');
  assert.equal(RUNTIMES.pyodide, 'full Python');
  assert.equal(r.stdout, 'a\n0.1.0');
  assert.equal(r.error, null);
  assert.ok(Number.isInteger(r.ms));
});

test('each run starts on a fresh interpreter', async () => {
  await runner.run('x = 41\nimport cufsm_rs\ncufsm_rs.signature = None\n');
  const r = await runner.run('import cufsm_rs\nprint(callable(cufsm_rs.signature))\nprint(x)\n');
  assert.equal(r.stdout, 'True');
  assert.equal(r.error.type, 'NameError');
  assert.equal(r.error.line, 3);
});

test('an error is its traceback: the type, the message and the script\'s line, not the package\'s', async () => {
  const r = await runner.run('import cufsm_rs\n\ncufsm_rs.lipped_c(200, 76, -15, 1.9)\n');
  assert.equal(r.ok, false);
  assert.equal(r.error.type, 'ValueError');
  assert.equal(r.error.message, 'd1 = -15 must be zero or positive');
  assert.equal(r.error.line, 3);
  assert.match(r.error.text, /^Traceback \(most recent call last\):/);
  assert.match(r.error.text, /\/lib\/cufsm_rs\/__init__\.py/);
  assert.equal(r.error.fullRuntime, null);
});

test('an import MicroPython lacks says it needs the full Python runtime', async () => {
  for (const mod of ['numpy', 'scipy.linalg', 'matplotlib.pyplot', 'pandas']) {
    const r = await runner.run(`print("before")\nimport ${mod}\n`);
    const top = mod.split('.')[0];
    assert.equal(r.stdout, 'before', 'output before the error is kept');
    assert.equal(r.error.type, 'ImportError');
    assert.equal(r.error.line, 2);
    assert.equal(r.error.fullRuntime.module, top);
    assert.match(r.error.fullRuntime.text, new RegExp(`^${top} is not available on MicroPython`));
    assert.match(r.error.fullRuntime.text, /full Python runtime \(Pyodide\), which the console downloads when you agree/);
  }
  // the lite layer's own refusals (an array operation, matplotlib axes in cufsm_rs.plot) name it too
  let r = await runner.run('import cufsm_rs\nm = cufsm_rs.Model([[1, 1, 1, 0.3, 0.3, 0.4]], [[1, 0, 0, 1, 1, 1, 1, 1]], [[1, 1, 1, 1, 1]])\nm.node * 2\n');
  assert.ok(r.error.fullRuntime && r.error.fullRuntime.module === null, JSON.stringify(r.error));
  assert.match(r.error.fullRuntime.text, /with numpy/);
  r = await runner.run('import cufsm_rs.plot\ncufsm_rs.plot.plot_section(None, ax=1)\n');
  assert.ok(r.error.fullRuntime && r.error.fullRuntime.module === null, JSON.stringify(r.error));
  assert.match(r.error.fullRuntime.text, /with matplotlib/);
});

test('readTraceback: a syntax error and a frameless message', () => {
  assert.deepEqual(readTraceback('Traceback (most recent call last):\n  File "<stdin>", line 2\nSyntaxError: invalid syntax\n'),
    { type: 'SyntaxError', message: 'invalid syntax', line: 2, fullRuntime: null });
  assert.equal(readTraceback('something broke').line, null);
});

test('a runaway print loop is cut off at OUTPUT_MAX characters', async () => {
  const r = await runner.run(`for i in range(${Math.ceil(OUTPUT_MAX / 1000) + 50}):\n    print("x" * 999)\n`);
  assert.equal(r.truncated, true);
  assert.ok(r.stdout.length <= OUTPUT_MAX + 1000);
});
