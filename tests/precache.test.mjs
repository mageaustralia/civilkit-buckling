import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { precacheFiles, buildSw } from '../tools/precache.mjs';

const files = precacheFiles('.');

test('the precache list covers the page, the engine, the extension runtime, the Python console, the store and the guide', () => {
  for (const f of ['./', 'index.html', 'manifest.webmanifest', 'app.js', 'styles.css', 'styles/shell.css',
    'cufsm.wasm', 'js/worker.js', 'js/ext/worker.js', 'js/py/console-worker.js', 'js/py/console-ui.js',
    'py/cufsm_rs_lite/__init__.py', 'py/cufsm_rs_lite/plot.py', 'vendor/civilkit/micropython.mjs',
    'vendor/civilkit/micropython.wasm', 'vendor/civilkit/fflate.js', 'store/index.json',
    'store/civilkit.dsm-compression.ckext', 'guide/', 'guide/index.html', 'guide/guide.css',
    'icons/192.png', 'icons/512.png', 'icons/maskable-512.png', 'icons/apple-touch-180.png'])
    assert.ok(files.includes(f), `${f} is not precached`);
  assert.ok(!files.includes('sw.js'), 'the worker must not precache itself');
  for (const f of files) if (!f.endsWith('/')) assert.ok(existsSync(f), `${f} is listed but missing`);
  assert.equal(new Set(files).size, files.length, 'duplicates in the list');
});

test('every icon the manifest names is precached', () => {
  const m = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  for (const i of m.icons) assert.ok(files.includes(i.src), i.src);
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
});

test('sw.js is up to date with the files (run npm run precache after changing any app file)', () => {
  const want = buildSw(files, (f) => readFileSync(f));
  assert.equal(readFileSync('sw.js', 'utf8'), want);
});

test('the version changes when any precached file changes', () => {
  const a = buildSw(files, (f) => readFileSync(f));
  const b = buildSw(files, (f) => (f === 'js/labels.js' ? Buffer.from('changed') : readFileSync(f)));
  const v = (s) => /const VERSION = '([0-9a-f]+)'/.exec(s)[1];
  assert.notEqual(v(a), v(b));
});
