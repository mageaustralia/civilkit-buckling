#!/usr/bin/env node
/* Pyodide for the Python console's full runtime, self-hosted: fetches a pinned Pyodide release
   (the official distribution's files, from Pyodide's CDN) into vendor/pyodide/<version>/, which git
   ignores, and checks every file's SHA-256 against the pins in js/py/pyodide-files.js.

     node tools/fetch-pyodide.mjs              fetch what is missing or wrong     (npm run pyodide)
     node tools/fetch-pyodide.mjs --check      verify only; exit 1 if a file is missing or wrong
     node tools/fetch-pyodide.mjs --out DIR    fetch into DIR instead (the site's sync script)
     node tools/fetch-pyodide.mjs --pin [VER]  maintainers: pin a release (default: the pinned one),
                                               writing js/py/pyodide-files.js

   Only the core (the interpreter and its standard library) and the packages the console offers
   are fetched: numpy, matplotlib with its dependencies, and scipy (PACKAGES below, closed over
   their dependencies from the release's own pyodide-lock.json). A package's hash is also checked
   against the lock's. Every file is far below Cloudflare Pages' 25 MiB per-file limit (checked
   here too). Nothing here runs in the page. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PIN_FILE = join(ROOT, 'js/py/pyodide-files.js');
const CDN = (v) => `https://cdn.jsdelivr.net/pyodide/v${v}/full/`;
const CORE = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const PACKAGES = ['numpy', 'matplotlib', 'scipy'];
const PAGES_LIMIT = 25 * 1024 * 1024;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/* the hosted packages, closed over their dependencies, from a release's lock */
export function closure(lock, names) {
  const out = new Map();
  const add = (n) => {
    const key = n.toLowerCase();
    if (out.has(key)) return;
    const p = lock.packages[key];
    if (!p) throw new Error(`${n} is not in this Pyodide release`);
    out.set(key, p);
    p.depends.forEach(add);
  };
  names.forEach(add);
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function pin(version) {
  const base = CDN(version);
  const lock = JSON.parse(await get(base + 'pyodide-lock.json'));
  const files = {};
  const packages = {};
  const local = (f) => { const p = join(ROOT, `vendor/pyodide/${version}/`, f); return existsSync(p) ? readFileSync(p) : null; };
  for (const f of CORE) {
    const b = f === 'pyodide-lock.json' ? await get(base + f) : local(f) ?? await get(base + f);
    files[f] = { size: b.length, sha256: sha256(b) };
  }
  for (const [key, p] of closure(lock, PACKAGES)) {
    const b = local(p.file_name) ?? await get(base + p.file_name);
    const h = sha256(b);
    if (h !== p.sha256) throw new Error(`${p.file_name}: SHA-256 ${h}, the lock says ${p.sha256}`);
    files[p.file_name] = { size: b.length, sha256: h };
    packages[key] = { name: p.name, version: p.version, file: p.file_name, imports: p.imports,
      depends: p.depends.map((d) => d.toLowerCase()) };
  }
  for (const [f, { size }] of Object.entries(files))
    if (size >= PAGES_LIMIT) throw new Error(`${f} is ${size} bytes, over Cloudflare Pages' 25 MiB per-file limit`);
  // the release's other packages, by import name: a script that imports one is told it is not hosted
  const others = {};
  for (const [key, p] of Object.entries(lock.packages))
    if (!packages[key] && p.package_type === 'package') for (const i of p.imports) others[i] = p.name;
  const P = { version, python: lock.info.python, source: base, dir: `vendor/pyodide/${version}/`, core: CORE, files, packages,
    others: Object.fromEntries(Object.entries(others).sort()) };
  writeFileSync(PIN_FILE, `/* The Pyodide release the Python console's full runtime self-hosts, pinned: every file's size
   and SHA-256, and the packages hosted with it (their import names and dependencies, from the
   release's pyodide-lock.json). Written by node tools/fetch-pyodide.mjs --pin; do not edit.
   tools/fetch-pyodide.mjs fetches the files into PYODIDE.dir and checks them against these. */
export const PYODIDE = ${JSON.stringify(P, null, 1)};
`);
  console.log(`pinned Pyodide ${version} (Python ${lock.info.python}): ${Object.keys(files).length} files, `
    + `${(Object.values(files).reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)} MB`);
}

async function fetchInto(out, { check = false } = {}) {
  const { PYODIDE } = await import(PIN_FILE);
  mkdirSync(out, { recursive: true });
  let bad = 0, got = 0;
  for (const [f, { size, sha256: want }] of Object.entries(PYODIDE.files)) {
    const path = join(out, f);
    if (existsSync(path) && sha256(readFileSync(path)) === want) continue;
    if (check) { console.error(`${f}: ${existsSync(path) ? 'wrong SHA-256' : 'missing'}`); bad++; continue; }
    const b = await get(PYODIDE.source + f);
    const h = sha256(b);
    if (h !== want || b.length !== size) throw new Error(`${f}: SHA-256 ${h} (${b.length} bytes), pinned ${want} (${size} bytes)`);
    writeFileSync(path + '.part', b);
    renameSync(path + '.part', path);
    got++;
  }
  if (bad) { console.error(`${bad} Pyodide file(s) missing or wrong in ${out}: run node tools/fetch-pyodide.mjs`); process.exit(1); }
  console.log(`Pyodide ${PYODIDE.version} in ${out}: ${Object.keys(PYODIDE.files).length} files verified${got ? `, ${got} fetched` : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a[0] === '--pin') {
    const cur = existsSync(PIN_FILE) ? (await import(PIN_FILE)).PYODIDE.version : null;
    const v = a[1] || cur;
    if (!v) { console.error('usage: --pin <version>'); process.exit(1); }
    await pin(v);
  } else {
    const { PYODIDE } = await import(PIN_FILE);
    const at = a.indexOf('--out');
    const out = at >= 0 ? a[at + 1] : join(ROOT, PYODIDE.dir);
    await fetchInto(out, { check: a.includes('--check') });
  }
}
