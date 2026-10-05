#!/usr/bin/env node
/* The headless .ckext tool: the same MicroPython runtime and cufsm-rs engine the app's sandbox
   worker runs, under Node, with no browser.

     node tools/ckext.mjs pack <folder> [-o out.ckext]
     node tools/ckext.mjs test <file.ckext | folder> [--inputs '{"fy":450}'] [--model model.json] [--json]

   test runs the worked examples (they decide the badge), builds the form, runs one check (on
   --inputs against --model, or on the first worked example and its fixture) and reports which
   capabilities the module used. --json prints the report Studio's run_extension gives.
   Exit: 0 verified with no undeclared capability calls, 1 otherwise, 2 on a usage error. */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundle } from '../vendor/civilkit/registry.js';
import { zipSync } from '../vendor/civilkit/fflate.js';
import { loadEngine } from '../js/engine.js';
import { createRuntime } from '../js/ext/runtime.js';
import { errorText, examplesOf, runWorkedExamples } from '../js/ext/examples.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const POINTS = ['buckling.tool'];
const USAGE = `usage: ckext pack <folder> [-o out.ckext]
       ckext test <file.ckext | folder> [--inputs '{"fy":450}'] [--model model.json] [--json]`;

class Usage extends Error {}

function parse(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd, path: null, out: null, inputs: null, model: null, json: false };
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k];
    const val = () => { if (k + 1 >= rest.length) throw new Usage(`${a} needs a value`); return rest[++k]; };
    if (a === '-o' || a === '--out') o.out = val();
    else if (a === '--inputs') {
      try { o.inputs = JSON.parse(val()); } catch (e) { throw new Usage(`--inputs is not JSON: ${e.message}`); }
    } else if (a === '--model') o.model = val();
    else if (a === '--json') o.json = true;
    else if (a.startsWith('-')) throw new Usage(`unknown option ${a}`);
    else if (o.path === null) o.path = a;
    else throw new Usage(`unexpected argument ${a}`);
  }
  if (cmd !== 'pack' && cmd !== 'test') throw new Usage(cmd ? `unknown command ${cmd}` : 'no command');
  if (!o.path) throw new Usage(`${cmd} needs a ${cmd === 'pack' ? 'folder' : '.ckext file or folder'}`);
  return o;
}

/* A module folder's files as a bundle would hold them: manifest.json, main.py and tests/. */
function folderFiles(dir) {
  const files = {};
  for (const name of ['manifest.json', 'main.py']) {
    try { files[name] = new Uint8Array(readFileSync(join(dir, name))); } catch { /* readBundle names what is missing */ }
  }
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files[relative(dir, p).split(sep).join('/')] = new Uint8Array(readFileSync(p));
    }
  };
  try { if (statSync(join(dir, 'tests')).isDirectory()) walk(join(dir, 'tests')); } catch { /* no tests */ }
  return files;
}

/* Read a folder or a .ckext into validated { bytes, manifest, files }: a folder is zipped first,
   so both go through the registry's own readBundle (the same check the app makes at install). */
function load(path) {
  const st = statSync(path);
  const bytes = st.isDirectory() ? zipSync(folderFiles(path)) : new Uint8Array(readFileSync(path));
  const { manifest, files } = readBundle(bytes, { points: POINTS });
  if (!files['main.py']) throw new Error('the bundle has no main.py');
  return { bytes, manifest, files };
}

function pack(o) {
  if (!statSync(o.path).isDirectory()) throw new Usage(`pack needs a folder; ${o.path} is a file`);
  const { bytes, manifest } = load(o.path);
  const out = o.out ?? `${basename(resolve(o.path))}.ckext`;
  writeFileSync(out, bytes);
  console.log(`packed ${manifest.id} ${manifest.version} -> ${out} (${bytes.length} bytes)`);
  return 0;
}

/* The form a module's build_ui draws: its fields and buttons, from a walk of the UI tree. */
function formOf(tree) {
  const fields = [], buttons = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'field') fields.push({ id: n.id, label: n.label, inputType: n.inputType || 'string', default: n.default });
    if (n.type === 'button') buttons.push({ id: n.id, label: n.label, action: n.action });
    for (const c of Array.isArray(n.children) ? n.children : []) walk(c);
    for (const t of Array.isArray(n.tabs) ? n.tabs : []) walk(t);
  })(tree);
  return { title: tree?.title ?? null, fields, buttons };
}

async function testModule(o) {
  const { manifest, files } = load(o.path);
  const main = new TextDecoder().decode(files['main.py']);
  const examples = examplesOf(manifest, files);
  const engine = await loadEngine(readFileSync(join(ROOT, 'cufsm.wasm')));
  const micropython = await import('../vendor/civilkit/micropython.mjs');
  const used = new Set(), undeclared = new Set(), usedInRun = new Set();
  let inRun = false;
  const stdout = [];
  const rt = await createRuntime({
    micropython, engine, stdout: (l) => stdout.push(l),
    onCapability: (name, ok) => {
      if (name === 'log') return;
      (ok ? used : undeclared).add(name);
      if (inRun && ok) usedInRun.add(name);
    },
  });
  const bundle = { manifest, main, examples };
  const report = await runWorkedExamples(rt, bundle);

  let form = null, run = null;
  try {
    rt.load(bundle);
    const tree = rt.buildUi({}, [], []);
    form = formOf(tree);
    const defaults = Object.fromEntries(form.fields.filter((f) => f.default !== undefined).map((f) => [f.id, f.default]));
    const model = o.model ? JSON.parse(readFileSync(o.model, 'utf8')) : examples[0]?.model ?? null;
    const inputs = o.inputs ?? examples[0]?.input ?? defaults;
    inRun = true;
    try {
      const out = rt.check(inputs, { model, results: null });
      run = { inputs, fixture: !o.model && !!examples[0]?.model, result: out.result ?? [], calcLines: out.calcLines ?? [],
              proposals: out.proposals ?? [], logs: out.logs ?? [], error: null };
    } catch (e) {
      run = { inputs, fixture: !o.model && !!examples[0]?.model, result: [], calcLines: [], proposals: [], logs: [], error: errorText(e) };
    } finally { inRun = false; }
  } catch (e) {
    form = form ?? { error: errorText(e) };
  }
  const declared = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const out = {
    id: manifest.id, name: manifest.name, version: manifest.version,
    badge: report.badge,
    examples: report.examples,
    form,
    run,
    capabilities: { declared, used: [...used], undeclaredCalls: [...undeclared],
                    unusedInThisRun: declared.filter((c) => !usedInRun.has(c)) },
    note: run?.fixture
      ? 'The run used the first worked example and its fixture, which is never solved, so hasResults is false and getResults is empty. Pass --model (and --inputs) to run on another model.'
      : null,
  };
  if (o.json) console.log(JSON.stringify(out, null, 2));
  else print(out, stdout);
  return report.badge === 'verified' && undeclared.size === 0 ? 0 : 1;
}

/* MicroPython prints some floats with last-digit noise; show 12 significant figures (display only) */
const tidyNum = (v) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(12)) : v);

/* a calc line is a string, or Studio's { standard, year, clause, label, eq } */
function calcText(c) {
  if (!c || typeof c !== 'object') return String(c);
  const ref = [c.standard && `${c.standard}${c.year ? ':' + c.year : ''}`, c.clause].filter(Boolean).join(' ');
  return [ref && `[${ref}]`, c.label && `${c.label}:`, c.eq].filter(Boolean).join(' ');
}

function print(r, stdout) {
  const L = (s = '') => console.log(s);
  L(r.badge);
  L(`${r.name} ${r.version} (${r.id})`);
  L(`worked examples: ${r.examples.filter((x) => x.pass).length} of ${r.examples.length} pass`);
  for (const x of r.examples) {
    L(`  ${x.pass ? 'pass' : 'FAIL'} ${x.id}`);
    for (const d of x.diffs) L(`       ${d}`);
  }
  if (r.form?.error) L(`form: build_ui failed: ${r.form.error}`);
  else if (r.form) L(`form: ${r.form.fields.map((f) => f.id).join(', ') || 'no fields'}; buttons: ${r.form.buttons.map((b) => b.label).join(', ') || 'none'}`);
  if (r.run) {
    L(`run on ${JSON.stringify(r.run.inputs)}${r.run.fixture ? ' (the first worked example and its fixture)' : ''}:`);
    if (r.run.error) L(`  error: ${r.run.error}`);
    for (const row of r.run.result) L(`  ${row.label} = ${tidyNum(row.value)}${row.unit ? ' ' + row.unit : ''}`);
    for (const c of r.run.calcLines) L(`    ${calcText(c)}`);
    for (const p of r.run.proposals) L(`  proposal: ${p.error ? 'refused: ' + p.error : `${p.model.nodes.length} nodes, ${p.model.elems.length} elements`}`);
    for (const l of r.run.logs) L(`  log: ${l}`);
  }
  const c = r.capabilities;
  L(`capabilities: declared ${c.declared.join(', ') || 'none'}; used ${c.used.join(', ') || 'none'}`);
  if (c.undeclaredCalls.length) L(`  called without declaring: ${c.undeclaredCalls.join(', ')}`);
  if (stdout.length) L(`stdout:\n  ${stdout.join('\n  ')}`);
  if (r.note) L(r.note);
}

let o;
try { o = parse(process.argv.slice(2)); }
catch (e) { console.error(`${e.message}\n${USAGE}`); process.exit(2); }
try {
  process.exitCode = o.cmd === 'pack' ? pack(o) : await testModule(o);
} catch (e) {
  console.error(e instanceof Usage ? `${e.message}\n${USAGE}` : `ckext ${o.cmd}: ${errorText(e)}`);
  process.exitCode = e instanceof Usage ? 2 : 1;
}
