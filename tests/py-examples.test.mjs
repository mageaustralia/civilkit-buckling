import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { loadEngine } from '../js/engine.js';
import { LIB_FILES, consoleFiles } from '../js/py/lite.js';
import { createRunner } from '../js/py/runner.js';
import { EXAMPLES, exampleUrl, readScriptFile, scriptName, OPEN_MAX } from '../js/py/examples.js';

/* The Python console's example scripts (py/examples/, the Examples menu) on today's MicroPython
   lite layer, run the way the console runs them (js/py/runner.js): each finishes with no error
   and prints the numbers checked here. The DSM study's equations, ported from the DSM compression
   module (extensions/dsm-compression/main.py), are checked against that module's worked examples
   (its tests/worked-examples.json): AISI DSM Design Guide Examples 8.1-4, 8.1-5 and 8.5-3, the
   last with the minima read off the engine's curve by the study's own column(), which lives in
   py/examples/dsm.py with the builder, shared by the DSM examples. The search for the lightest
   section and the catalogue check: their winners and pass counts, and how long they take. Also:
   the file checks behind Open. */
const engine = await loadEngine(await readFile(new URL('../cufsm.wasm', import.meta.url)));
const micropython = await import('../vendor/civilkit/micropython.mjs');
const files = Object.fromEntries(await Promise.all(Object.entries(consoleFiles()).map(async ([n, url]) => [n, await readFile(url, 'utf8')])));
const runner = createRunner({ engine, files, loadMicroPython: micropython.loadMicroPython });
const source = (file) => readFile(exampleUrl(file), 'utf8');

const runs = new Map();
const result = async (file) => {
  if (!runs.has(file)) runs.set(file, runner.run(await source(file)));
  const r = await runs.get(file);
  assert.equal(r.error, null, `${file}: ${r.error?.text}`);
  return r;
};
const run = async (file) => (await result(file)).stdout.split('\n');
/* the figures an example draws (cufsm_rs.plot), in order, each after the line printed before it */
const figures = async (file) => {
  const out = (await result(file)).output;
  return out.flatMap((o, k) => (o.figure ? [{ ...o.figure, after: (out[k - 1]?.text ?? '').trimEnd().split('\n').pop() }] : []));
};
const NUM = /-?\d+(?:\.\d+)?/g;
const nums = (line) => (line.match(NUM) ?? []).map(Number);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a}, expected ${b} ± ${tol}`);
const row = (lines, re, what) => {
  const l = lines.find((x) => re.test(x));
  assert.ok(l, `${what}: no line matching ${re}`);
  return l;
};

test('the menu lists every script in py/examples/, each with a header comment, in the lite subset', async () => {
  const onDisk = (await readdir(new URL('../py/examples/', import.meta.url)))
    .filter((f) => f.endsWith('.py') && !LIB_FILES.includes(f)).sort();       // dsm.py is a module, not a script
  assert.deepEqual(EXAMPLES.map((x) => x.file).sort(), onDisk);
  assert.ok(EXAMPLES.length >= 3 && EXAMPLES.length <= 5);
  assert.ok(!onDisk.includes('signature_chart.py'), 'no text charts: cufsm_rs.plot draws them');
  for (const { file, label } of EXAMPLES) {
    const s = await source(file);
    assert.ok(label && /^# .+\n#/.test(s), `${file}: a header comment first`);
    assert.match(s, /^# Units: N, mm, MPa/m, `${file}: states its units`);
    assert.doesNotMatch(s, /arrives with cufsm_rs\.plot/, `${file}: the plots have arrived`);
    assert.ok(s.split('\n').length <= 160, `${file}: ${s.split('\n').length} lines`);
  }
  assert.deepEqual(EXAMPLES.slice(0, 2).map((x) => x.file), ['lightest_section.py', 'catalogue_check.py'], 'the showcases first');
  // the DSM examples share one builder and one DSM port: no copy of either in a script
  for (const file of ['dsm_lip_study.py', 'lightest_section.py', 'catalogue_check.py']) {
    const s = await source(file);
    assert.match(s, /^(from dsm import|import dsm)/m, `${file} imports dsm`);
    assert.doesNotMatch(s, /def (lipped_c|dsm_pn[eld]|column|grid_minima)\(/, `${file} defines its own copy`);
  }
});

test('Lightest section: the search, its pruning, the winner and how long it takes', async (t) => {
  const r = await result('lightest_section.py');
  const lines = r.stdout.split('\n');
  // per thickness: analyses so far, and the lightest pass (the 1.0 mm sections never pass)
  const per = lines.filter((l) => /^ {2}t = \d\.\d: +\d+ analyses, /.test(l));
  assert.deepEqual(per.map((l) => nums(l).slice(0, 2)), [[1.0, 110], [1.2, 152], [1.5, 155], [1.9, 156], [2.4, 157]]);
  assert.match(per[0], /none of 110 passes/);
  assert.match(per[2], /100 x 50 x 13 x 1\.5 passes/);
  const total = row(lines, /^\d+ analyses of /, 'total');
  assert.match(total, /^157 analyses of 559 pre-qualified sections in [\d.]+ s\.$/);
  // the sections with no distinct distortional minimum are settled by a D-only cFSM run, so none
  // is left unchecked (38 of the 157, 10 of them lighter than the winner: none of those passes)
  assert.equal(lines[lines.indexOf(total) + 1], '38 had no distinct distortional minimum: Pcrd from');
  assert.ok(!lines.some((l) => /unchecked/.test(l)), 'no section is left unchecked');
  // the table: the lightest pass at each thickness, lightest first
  const table = lines.filter((l) => /^ {2}\d+ x \d+ x \d+ x \d\.\d +[\d.]+ /.test(l));
  assert.deepEqual(table.map((l) => l.trim().split(/ {2,}/)[0]), ['100 x 50 x 13 x 1.5', '100 x 80 x 32 x 1.2', '100 x 50 x 8 x 1.9', '100 x 50 x 10 x 2.4']);
  const kg = table.map((l) => nums(l)[4]);
  assert.deepEqual([...kg].sort((a, b) => a - b), kg, 'sorted by mass');
  for (const l of table) assert.ok(nums(l)[7] >= 80, `every row carries 80 kN: ${l}`);
  assert.match(table[0], / 2\.59 +100\.\d +96\.3 +81\.8 +distortional$/);
  assert.equal(row(lines, /^Winner/, 'winner'), 'Winner: 100 x 50 x 13 x 1.5 mm, 2.59 kg/m');
  assert.equal(row(lines, /^ {2}A = /, 'A'), '  A = 330 mm² (the model\'s), Py = 148.5 kN');
  assert.equal(row(lines, /^ {2}φc Pn = /, 'φPn'), '  φc Pn = 0.85 × 96.3 = 81.8 kN >= 80 kN,');
  assert.equal(lines[lines.indexOf('  φc Pn = 0.85 × 96.3 = 81.8 kN >= 80 kN,') + 1], '  distortional governs.');
  assert.equal(row(lines, /^ {2}On the fine grid/, 'fine'), '  On the fine grid: φc Pn = 81.8 kN, distortional governs.');
  assert.deepEqual((await figures('lightest_section.py')).map((f) => [f.kind, f.after]),
    [['section', 'signature curve (fine grid), the minima classified:'], ['signature', '']]);   // the curve right after the section
  // the page's budget is about 30 s; Node runs the same MicroPython and wasm (the browser test
  // holds the page to 30 s). Here a guard against a slowdown, with the time reported.
  t.diagnostic(`lightest_section.py: ${(r.ms / 1000).toFixed(1)} s on MicroPython in Node (${total})`);
  assert.ok(r.ms < 60000, `the search took ${r.ms} ms`);
});

test('Catalogue check: twelve sections against 60 kN, sorted by mass, and the lightest that passes', async (t) => {
  const r = await result('catalogue_check.py');
  const lines = r.stdout.split('\n');
  const table = lines.filter((l) => /^ {2}C\d{5} /.test(l)).map((l) => l.trim().split(/ +/));
  assert.equal(table.length, 12);
  const kg = table.map((c) => +c[1]);
  assert.deepEqual([...kg].sort((a, b) => a - b), kg, 'sorted by mass');
  const result_ = Object.fromEntries(table.map((c) => [c[0], c[c.length - 1]]));
  assert.deepEqual(Object.keys(result_).filter((k) => result_[k] === 'PASS').length, 10);
  assert.deepEqual(Object.keys(result_).filter((k) => result_[k] === 'fail'), ['C10010', 'C15012']);
  assert.ok(!lines.some((l) => /unchecked/.test(l)), 'no section is left unchecked');
  // C25019 has no distinct distortional minimum: Pcrd from the D-only cFSM run, and it passes, local governing
  assert.deepEqual(table.find((c) => c[0] === 'C25019').slice(1, 7), ['6.45', '154.4', '165.5', '131.2', '0.46', 'local']);
  const at = lines.findIndex((l) => /^ {2}C25019 /.test(l));
  assert.deepEqual(lines.slice(at + 1, at + 3), ['    no distortional minimum on the curve: Pcrd from', '    cFSM D-only, 0.329 Py at 799 mm']);
  assert.equal(lines.filter((l) => /D-only/.test(l)).length, 1, 'only C25019 needs it');
  // C15012 just misses: N*/φcPn 1.01
  assert.deepEqual(table.find((c) => c[0] === 'C15012').slice(1, 7), ['2.84', '69.8', '69.7', '59.3', '1.01', 'distortional']);
  // C10015 is the search's winner, 100 x 50 x 13 x 1.5, on the same grid: the same numbers
  assert.deepEqual(table.find((c) => c[0] === 'C10015').slice(1, 7), ['2.59', '100.1', '96.3', '81.8', '0.73', 'distortional']);
  assert.equal(row(lines, /sections pass\.$/, 'count'), '10 of 12 sections pass.');
  assert.equal(row(lines, /^Lightest that passes/, 'lightest'), 'Lightest that passes: C10015, 2.59 kg/m,');
  assert.equal(row(lines, /^ {2}φc Pn = /, 'its φPn'), '  φc Pn = 81.8 kN, utilisation 0.73, distortional governs.');
  assert.deepEqual((await figures('catalogue_check.py')).map((f) => [f.kind, f.after]), [['signature', 'Its signature curve, the minima classified:']]);
  t.diagnostic(`catalogue_check.py: ${(r.ms / 1000).toFixed(1)} s on MicroPython in Node`);
});

test('DSM design study: the lip sweep, its table and the best lip', async () => {
  const lines = await run('dsm_lip_study.py');
  const buck = lines.filter((l) => /^ +\d+ +0\.\d{3} /.test(l)).map(nums);
  const str = lines.filter((l) => /^ +\d+ +[\d.]+ +[\d.]+ +[\d.]+ +[\d.]+ +(local|distortional|yield)$/.test(l));
  assert.equal(buck.length, 9, 'nine lips in the buckling table');
  assert.equal(str.length, 9, 'nine lips in the strength table');
  // lip 8: d/B, A, Py, Lcrl, Pcrl/Py, Lcrd, Pcrd/Py
  const [d, dB, A, Py, Lcrl, rl, Lcrd, rd] = buck[0];
  assert.equal(d, 8); near(dB, 0.125, 0, 'd/B'); near(A, 432, 0.5, 'A'); near(Py, 194.4, 0.05, 'Py');
  near(Lcrl, 119, 0.5, 'Lcrl'); near(rl, 0.223, 0.0005, 'Pcrl/Py'); near(Lcrd, 350, 0.5, 'Lcrd'); near(rd, 0.250, 0.0005, 'Pcrd/Py');
  assert.match(str[0], /^ +8 +97\.8 +75\.3 +75\.3 +174\.4 +distortional$/);
  // a deeper lip lifts the distortional load factor at every step
  for (let i = 1; i < buck.length; i++) assert.ok(buck[i][7] > buck[i - 1][7], `Pcrd/Py rises with the lip (${i})`);
  assert.equal(row(lines, /^Best lip/, 'best'), 'Best lip: d = 16 mm, d/B = 0.250.');
  assert.match(row(lines, /^ {2}Pn = /, 'Pn'), /^ {2}Pn = 103\.9 kN, Pn\/A = 227\.8 MPa/);
  assert.match(row(lines, /^Design/, 'design'), /0\.85 × 103\.9 = 88\.3 kN/);
});

/* the worked examples' model (CivilKit's JSON, 0-based) as a cufsm_rs.Model in Python */
const modelPy = (m) => `cufsm_rs.Model(prop=${JSON.stringify(m.mats.map((q) => [q.id, q.ex, q.ey, q.vx, q.vy, q.g]))},
  node=${JSON.stringify(m.nodes.map((n, k) => [k + 1, n.x, n.z, ...n.free, n.stress]))},
  elem=${JSON.stringify(m.elems.map((e, k) => [k + 1, e.i + 1, e.j + 1, e.t, e.mat]))})`;

test('DSM design study: its equations and minima give the DSM module\'s worked examples', async () => {
  const worked = JSON.parse(await readFile(new URL('../extensions/dsm-compression/tests/worked-examples.json', import.meta.url), 'utf8'));
  const study = 'import cufsm_rs\nfrom dsm import dsm_pne, dsm_pnl, dsm_pnd, column';   // the study's functions (dsm.py)
  const tail = worked.map((w) => {
    const { fy, Fcre = 0, pcrl_py: rl = 0, pcrd_py: rd = 0 } = w.input;
    return rl
      ? `m = ${modelPy(w.model)}
Py = cufsm_rs.first_yield(m, ${fy}).Py
Pcre = ${Fcre ? `Py / ${fy} * ${Fcre}` : 'None'}          # A Fcre, with A = Py / fy (the module's)
Pne = dsm_pne(Py, Pcre)
Pnl, Pnd = dsm_pnl(Pne, ${rl} * Py), dsm_pnd(Py, ${rd} * Py)
Pn = min(Pne, Pnl, Pnd)
out.append({"Py": Py, "Pcre": Pcre, "Pne": Pne, "Pnl": Pnl, "Pnd": Pnd, "Pn": Pn,
            "Governs": "local" if Pn == Pnl else "distortional" if Pn == Pnd else "global"})
`
      : `r = column(${modelPy(w.model)}, ${fy}, ${JSON.stringify(w.model.analysis.lengths)})
out.append({"Py": r["Py"], "Pnl": r["Pnl"], "Pnd": r["Pnd"], "Pn": r["Pn"], "Governs": r["governs"],
            "Pcrl/Py": r["local"][1], "Lcrl": r["local"][0], "Pcrd/Py": r["dist"][1], "Lcrd": r["dist"][0]})
`;
  }).join('');
  const r = await runner.run(`${study}\nimport json\nout = []\n${tail}print(json.dumps(out))\n`);
  assert.equal(r.error, null, r.error?.text);
  const got = JSON.parse(r.stdout.split('\n').pop());
  worked.forEach((w, i) => {
    for (const { label, value, unit } of w.expected.result) {
      const v = got[i][label];
      if (typeof value === 'string') { assert.equal(v, value, `${w.id} ${label}`); continue; }
      const ours = unit === 'kN' ? v / 1000 : v;
      // the module's own worked-example tolerance, 0.1 %: the expected values are hand calcs
      // from the guide's printed Py, 0.01 % from the engine's (the module's README)
      assert.ok(Math.abs(ours - value) <= 1e-3 * Math.abs(value), `${w.id} ${label}: ${ours} vs ${value}`);
    }
  });
});

test('DSM design study: its equations reproduce the DSM module\'s hand calcs to their five figures', async () => {
  // extensions/dsm-compression/README.md, hand calcs 1 to 3, in kip as printed there
  const study = 'from dsm import dsm_pne, dsm_pnl, dsm_pnd';
  const r = await runner.run(`${study}
import json
print(json.dumps([dsm_pnl(48.42, 0.12 * 48.42), dsm_pnd(48.42, 0.27 * 48.42), dsm_pne(48.42, 52.047),
                  dsm_pnl(dsm_pne(48.42, 52.047), 0.12 * 48.42), dsm_pnl(45.23, 0.157494 * 45.23),
                  dsm_pnd(45.23, 0.287045 * 45.23), dsm_pne(48.42), dsm_pnd(48.42, 48.42 / 0.561 ** 2 * 1.0001)]))
`);
  assert.equal(r.error, null, r.error?.text);
  const [pnl1, pnd1, pne2, pnl2, pnl3, pnd3, braced, stocky] = JSON.parse(r.stdout);
  const five = (v, x, what) => assert.ok(Math.abs(v - x) <= 0.5 * 10 ** (Math.floor(Math.log10(x)) - 4), `${what}: ${v} vs ${x}`);
  five(pnl1, 19.403, 'hand calc 1 Pnl'); five(pnd1, 19.557, 'hand calc 1 Pnd');
  five(pne2, 32.803, 'hand calc 2 Pne'); five(pnl2, 15.183, 'hand calc 2 Pnl');
  five(pnl3, 20.048, 'hand calc 3 Pnl'); five(pnd3, 18.861, 'hand calc 3 Pnd');
  assert.equal(braced, 48.42, 'Le = 0: Pne = Py');
  assert.equal(stocky, 48.42, 'λd at most 0.561: Pnd = Py');
});

test('End conditions: S-S, C-C, S-C, C-F and C-G at three lengths, with enough terms', async () => {
  const lines = await run('end_conditions.py');
  assert.match(lines[0], /Py = 328\.8 kN/);
  assert.match(lines[2], /local minimum is at 117 mm/);
  const blocks = {};
  let at = null;
  for (const l of lines) {
    const h = /^L = (\d+) mm, terms 1\.\.(\d+)$/.exec(l);
    if (h) { at = +h[1]; blocks[at] = { terms: +h[2] }; continue; }
    const m = /^ {2}(S-S|C-C|S-C|C-F|C-G) +([\d.]+) +([\d.]+) +([GDLO]) +(\d+) +(\d+)$/.exec(l);
    if (m && at) blocks[at][m[1]] = { P: +m[2], lf: +m[3], mode: m[4], pct: +m[5], m: +m[6] };
  }
  assert.deepEqual(Object.keys(blocks).map(Number), [1000, 2000, 3000]);
  assert.deepEqual([1000, 2000, 3000].map((L) => blocks[L].terms), [13, 22, 30]);
  for (const L of [1000, 2000, 3000]) assert.equal(Object.keys(blocks[L]).length, 6, `five end conditions at ${L}`);
  const b = blocks[3000];
  near(b['S-S'].P, 76.0, 0.05, 'S-S at 3000'); assert.equal(b['S-S'].mode, 'G');
  near(b['C-C'].P, 192.2, 0.05, 'C-C at 3000'); assert.equal(b['C-C'].mode, 'L');
  near(b['C-F'].P, 22.3, 0.05, 'C-F at 3000'); assert.equal(b['C-F'].mode, 'G');
  assert.equal(blocks[1000]['S-S'].mode, 'L');
  near(blocks[1000]['S-S'].lf, 0.585, 0.0005, 'S-S at 1000 is the local minimum');
  // fixed-guided buckles globally like pinned-pinned of the same length (both effective length L)
  near(blocks[3000]['C-G'].P, b['S-S'].P, 0.5, 'C-G and S-S at 3000');
  for (const L of [1000, 2000, 3000]) {
    const ps = ['S-S', 'C-C', 'S-C', 'C-F', 'C-G'].map((k) => blocks[L][k].P);
    assert.equal(Math.min(...ps), blocks[L]['C-F'].P, `C-F is weakest at ${L}`);
    assert.equal(Math.max(...ps), blocks[L]['C-C'].P, `C-C is strongest at ${L}`);
  }
});

test('Distortional mode and sheathing springs: the mode shape and the spring sweep', async () => {
  const lines = await run('distortional_mode.py');
  assert.match(row(lines, /^Distortional minimum/, 'minimum'), /half-wavelength 554 mm/);
  assert.match(row(lines, /^ {2}Pcrd = /, 'Pcrd'), /^ {2}Pcrd = 0\.412 Py = 84\.1 kN \(cFSM D 87 %\)$/);
  assert.match(row(lines, /^Nodes? that move/, 'moves most'), /^Nodes that move most: 1 and 21,$/);
  const tip = nums(row(lines, /bottom lip tip +1\.000/, 'tip'));
  const web = nums(row(lines, /bottom flange-web corner/, 'corner'));
  near(tip[2], 0.998, 0.002, 'lip tip rotation');
  assert.ok(web[1] < 0.1, `the flange-web corner hardly moves (${web[1]})`);
  const sweep = lines.filter((l) => /^ +\d+ +(\d+ +[\d.]+ +[\d.]+ +\d+|none: )/.test(l)).map((l) => [nums(l)[0], /none/.test(l) ? null : nums(l)[2]]);
  assert.deepEqual(sweep.map((s) => s[0]), [0, 100, 200, 400, 700, 1000, 3000]);
  near(sweep[0][1], 0.412, 0.0005, 'no spring: the minimum of part 1');
  for (let i = 1; i < 5; i++) assert.ok(sweep[i][1] > sweep[i - 1][1], `a stiffer spring lifts Pcrd/Py (${sweep[i][0]})`);
  assert.equal(sweep[5][1], null, 'at 1000 N/rad the distortional minimum is gone');
});

test('Open: .py and .txt files up to 1 MB of UTF-8 text; anything else is refused with a reason', async () => {
  const file = (body, name, type = '') => new File([body], name, { type });
  assert.equal(await readScriptFile(file('print(1)\r\n', 'a.py')), 'print(1)\n');
  assert.equal(await readScriptFile(file('﻿x = 1\n', 'notes.TXT')), 'x = 1\n');
  assert.equal(await readScriptFile(file('x = 1\n', 'script', 'text/x-python')), 'x = 1\n');
  await assert.rejects(readScriptFile(file('x', 'shape.png', 'image/png')), /“shape\.png” was not opened: the console opens Python \(\.py\) and text \(\.txt\) files/);
  await assert.rejects(readScriptFile(file('#'.repeat(OPEN_MAX + 1), 'big.py')), /“big\.py” was not opened: it is 1\.0 MB, and the console opens files up to 1 MB/);
  assert.equal((await readScriptFile(file('#'.repeat(OPEN_MAX), 'edge.py'))).length, OPEN_MAX);
  await assert.rejects(readScriptFile(file(new Uint8Array([0x70, 0x00, 0x71]), 'nul.py')), /not a text file/);
  await assert.rejects(readScriptFile(file(new Uint8Array([0xff, 0xfe, 0x41]), 'latin.txt')), /not a text file/);
  assert.equal(scriptName('study.txt'), 'study.py');
  assert.equal(scriptName('study.PY'), 'study.py');
  assert.equal(scriptName('README'), 'README.py');
});

test('the examples\' figures: what each draws, where, with the numbers it printed', async () => {
  const dsm = await figures('dsm_lip_study.py');
  assert.deepEqual(dsm.map((f) => f.kind), ['signature']);
  assert.equal(dsm[0].after, 'The best lip\'s signature curve, its minima classified:');
  assert.deepEqual(dsm[0].labels.map((l) => l.slice(0, 1)), ['L', 'D'], 'classified: local, then distortional');
  const dist = await figures('distortional_mode.py');
  assert.deepEqual(dist.map((f) => f.kind), ['section', 'signature', 'mode', 'signature']);
  assert.equal(dist[0].legend, 'reference stress (max 450)');
  assert.match(dist[2].title, /^mode 1: load factor 0\.412\d at length 554\.\d$/);    // the minimum printed above it
  assert.match(dist[1].labels[1], /^D 87%: 0\.412\d at 554/);
  assert.equal(dist[3].after, 'The curve at kphi = 1000 N/rad: no minimum is mostly distortional.');
  assert.ok(dist[3].labels.every((l) => !/^D/.test(l)), `no minimum mostly distortional: ${dist[3].labels}`);
  const ends = await figures('end_conditions.py');
  assert.deepEqual(ends.map((f) => f.kind), ['mode', 'mode']);
  assert.equal(ends[0].after, 'Mode shapes at 3000 mm: the weakest ends (C-F) and the strongest (C-C).');
  assert.match(ends[0].title, /load factor 0\.067\d+ at length 3000$/);              // C-F's, 22.3 kN / 328.8 kN
  assert.match(ends[1].title, /load factor 0\.584\d+ at length 3000$/);              // C-C's, 192.2 kN
});
