/* The guide (guide/*.html) cannot drift silently: every internal link and anchor resolves, every
   capability the host offers has its entry in the capability reference, every node type the
   renderer draws (and each Buckling host node) has its entry in the UI reference, every public name
   of cufsm_rs and every export of cufsm.wasm has its entry in the Python and engine references,
   every ?py= link names a shipped example, every page's nav and pager agree, and every Python
   snippet marked data-check="micropython" runs on the console's MicroPython. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCapabilities } from '../js/ext/capabilities.js';
import { loadEngine } from '../js/engine.js';
import { consoleFiles } from '../js/py/lite.js';
import { createRunner } from '../js/py/runner.js';
import { EXAMPLES, FULL_EXAMPLES } from '../js/py/examples.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GUIDE = join(ROOT, 'guide');
const pages = readdirSync(GUIDE).filter((f) => f.endsWith('.html'));
const read = (p) => readFileSync(p, 'utf8');
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

test('the guide has its pages', () => {
  for (const p of ['index.html', 'using.html', 'tutorial.html', 'capabilities.html', 'ui.html',
                   'worked-examples.html', 'cli.html', 'reference-modules.html', 'faq.html',
                   'console.html', 'runtimes.html', 'python-api.html', 'examples.html', 'engine-api.html'])
    assert.ok(pages.includes(p), `guide/${p} is missing`);
});

test('every internal link and anchor in the guide resolves', () => {
  const bad = [];
  for (const page of pages) {
    const file = join(GUIDE, page);
    const html = read(file);
    const own = ids(html);
    const dupes = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((id, i, a) => a.indexOf(id) !== i);
    if (dupes.length) bad.push(`${page}: duplicate ids ${dupes.join(', ')}`);
    for (const [, attr, url] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
      if (/^(https?:|mailto:|data:)/.test(url)) continue;
      const [pathq, hash] = url.split('#');
      const path = pathq.split('?')[0];
      let target = path ? resolve(dirname(file), path) : file;
      if (path && (path.endsWith('/') || (existsSync(target) && statSync(target).isDirectory()))) target = join(target, 'index.html');
      if (!target.startsWith(ROOT)) { bad.push(`${page}: ${attr}="${url}" leaves the app`); continue; }
      if (!existsSync(target)) { bad.push(`${page}: ${attr}="${url}" (no such file)`); continue; }
      if (hash && target.endsWith('.html')) {
        const there = target === file ? own : ids(read(target));
        if (!there.has(hash)) bad.push(`${page}: ${attr}="${url}" (no id "${hash}")`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('every capability the host offers is documented in the capability reference', () => {
  const offered = Object.keys(makeCapabilities(null, { model: null, results: null }, {}));
  const doc = ids(read(join(GUIDE, 'capabilities.html')));
  assert.ok(offered.length >= 10);
  assert.deepEqual(offered.filter((k) => !doc.has(`cap-${k}`)), []);
});

test('every node type the host renders is documented in the UI reference', () => {
  const host = read(join(ROOT, 'vendor/civilkit/host.js'));
  const body = host.slice(host.indexOf('function renderNode('), host.indexOf('function renderChildren('));
  const types = [...body.matchAll(/case '([^']+)':/g)].map((m) => m[1]);
  const ui = read(join(ROOT, 'js/ext/ui.js'));
  const custom = [...ui.slice(ui.indexOf('const customNodes')).matchAll(/'(buckling\.[a-z]+)':/g)].map((m) => m[1]);
  assert.ok(types.length >= 16, `found only ${types.length} node types in host.js`);
  assert.deepEqual(custom.sort(), ['buckling.section', 'buckling.signature']);
  const doc = ids(read(join(GUIDE, 'ui.html')));
  assert.deepEqual([...types, ...custom].filter((t) => !doc.has(`node-${t}`)), []);
});

test('the guide stores the theme where the app reads it', () => {
  const key = /getItem\('([^']+)'\)/.exec(read(join(ROOT, 'js/theme.js')))[1];
  assert.match(read(join(GUIDE, 'guide.js')), new RegExp(`setItem\\('${key}'`));
});

const html = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const all = (src) => [.../__all__ = \[([^\]]*)\]/.exec(src)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);

test('every public name of cufsm_rs and cufsm_rs.plot is documented in the Python API reference', () => {
  const pkg = join(ROOT, 'py/cufsm-rs-py/cufsm_rs');
  const names = [...all(read(join(pkg, '__init__.py'))), ...all(read(join(pkg, 'plot.py')))];
  assert.ok(names.length >= 23, `found only ${names.length} names`);
  const doc = ids(read(join(GUIDE, 'python-api.html')));
  assert.deepEqual(names.filter((n) => !doc.has(`py-${n}`)), []);
});

test('every export of cufsm.wasm is documented in the engine API reference', async () => {
  const { instance } = await WebAssembly.instantiate(readFileSync(join(ROOT, 'cufsm.wasm')), {});
  const exports = Object.keys(instance.exports).filter((k) => k.startsWith('cufsm_'));
  assert.ok(exports.length >= 19);
  const doc = ids(read(join(GUIDE, 'engine-api.html')));
  assert.deepEqual(exports.filter((k) => !doc.has(`abi-${k}`)), []);
  assert.match(read(join(GUIDE, 'engine-api.html')), new RegExp(`<b>${instance.exports.cufsm_abi_version()}</b>: the buffer layouts`));
  assert.match(read(join(GUIDE, 'engine-api.html')), new RegExp(`<b>${instance.exports.cufsm_abi_minor()}</b>: which exports`));
});

test('every ?py= link in the guide names an example the console ships', () => {
  const files = new Set([...EXAMPLES, ...FULL_EXAMPLES].map((x) => x.file));
  const bad = [];
  let n = 0;
  for (const page of pages)
    for (const [, f] of read(join(GUIDE, page)).matchAll(/href="[^"]*\?py=([^"#&]+)"/g)) {
      n++;
      if (!files.has(decodeURIComponent(f))) bad.push(`${page}: ?py=${f}`);
    }
  assert.ok(n >= files.size, 'the examples page links every example');
  assert.deepEqual(bad, []);
});

test('every page carries the same nav, in the same order, and its pager follows it', () => {
  const navOf = (page) => {
    const nav = /<nav class="g-nav"[\s\S]*?<\/nav>/.exec(read(join(GUIDE, page)))[0];
    return [...nav.matchAll(/<li><a href="([\w-]+\.html)"[^>]*><span class="g-num">(\d+)<\/span> ([^<]+)<\/a>/g)].map((m) => [m[1], m[3]]);
  };
  const order = navOf('index.html');
  assert.deepEqual(order.map(([f]) => f).sort(), [...pages].sort(), 'the nav lists every page');
  for (const page of pages) {
    assert.deepEqual(navOf(page), order, `${page}: its nav differs from the index's`);
    const i = order.findIndex(([f]) => f === page);
    const pager = /<nav class="g-pager"[\s\S]*?<\/nav>/.exec(read(join(GUIDE, page)))[0];
    const prev = /class="prev" href="([^"]+)"/.exec(pager)?.[1], next = /class="next" href="([^"]+)"/.exec(pager)?.[1];
    assert.equal(prev, order[i - 1]?.[0], `${page}: Previous`);
    assert.equal(next, order[i + 1]?.[0], `${page}: Next`);
  }
});

test('every Python snippet marked data-check="micropython" runs on the console\'s MicroPython', async () => {
  const engine = await loadEngine(readFileSync(join(ROOT, 'cufsm.wasm')));
  const micropython = await import('../vendor/civilkit/micropython.mjs');
  const files = Object.fromEntries(Object.entries(consoleFiles()).map(([n, u]) => [n, readFileSync(u, 'utf8')]));
  const runner = createRunner({ engine, files, loadMicroPython: micropython.loadMicroPython });
  const bad = [];
  let n = 0;
  for (const page of pages)
    for (const [, code] of read(join(GUIDE, page)).matchAll(/<code class="language-python" data-check="micropython">([\s\S]*?)<\/code>/g)) {
      n++;
      const r = await runner.run(html(code));
      if (!r.ok) bad.push(`${page} snippet ${n}: ${r.error.text}`);
    }
  assert.ok(n >= 8, `found only ${n} checked snippets`);
  assert.deepEqual(bad, []);
});
