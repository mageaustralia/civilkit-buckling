/* The parity suite's scripts: every example script in the console's Examples menu
   and the cufsm-rs-py README quickstart (verbatim, with numpy), each run whole, as a user runs it,
   under CPython with pip's cufsm-rs-py (tools/pyparity/examples.mjs writes the fixture), Pyodide in
   Node and, where it needs no numpy, MicroPython in Node (tests/parity/parity.test.mjs).

   After a script ends, its captures (Python expressions over its globals) are read with
   tests/parity/capture.py, numbers packed bit for bit, and compared within compare.mjs's
   tolerances: numbers, never printed text (float formatting differs between runtimes).

   tol: a capture's bound, by name (compare.mjs TOL or a LIBM_TOL key) when it is not TOL. */
import { readFileSync } from 'node:fs';

const ex = (f) => new URL(`../../py/examples/${f}`, import.meta.url);
const README_CAPTURES = JSON.parse(readFileSync(new URL('../fixtures/pyparity/cases.json', import.meta.url), 'utf8'))
  .scripts.find((s) => s.id === 'readme/quickstart').captures;

/* The DSM examples' numbers come from minima of curves running to 2000 or 3000 mm, past 50 times
   their widest strip (8 to 16 mm), where the documented libm divergence (compare.mjs) can show;
   measured (5 Oct 2026), everything they capture stays inside 1e-9 (4.2e-11 at most), so they are
   held to TOL. A capture with a named tolerance is the README's classify, as in py-lite. */
const DSM = undefined;

export const SCRIPTS = [
  { id: 'lightest_section', file: 'lightest_section.py', runtimes: ['cpython', 'pyodide', 'micropython'],
    captures: {
      'rows': ['[[r["Py"], r["Pn"], r["Pnl"], r["Pnd"], r["kg"], r["governs"], r["dist_src"]] + list(r["local"][:2]) + list(r["dist"][:2]) for r in rows]', DSM],
      'counts': ['[runs, tried, donly, len(unchecked)]'],
      'fine': ['[f["Pn"], f["governs"]] + list(f["local"][:2]) + list(f["dist"][:2])', DSM],
    } },
  { id: 'catalogue_check', file: 'catalogue_check.py', runtimes: ['cpython', 'pyodide', 'micropython'],
    captures: {
      'rows': ['[[r["name"], r["A"], r["Py"], r["Pn"], r["status"], r["governs"], r["dist_src"]] + list(r["local"][:2]) + list(r["dist"][:2]) for r in rows]', DSM],
      'classes': ['[list(r["local"][2]) + list(r["dist"][2]) for r in rows]'],
    } },
  { id: 'dsm_lip_study', file: 'dsm_lip_study.py', runtimes: ['cpython', 'pyodide', 'micropython'],
    captures: {
      'rows': ['[[r["d"], r["A"], r["Py"], r["Pnl"], r["Pnd"], r["Pn"], r["eff"], r["governs"]] + list(r["local"][:2]) + list(r["dist"][:2]) for r in rows]', DSM],
      'classes': ['[list(r["local"][2]) + list(r["dist"][2]) for r in rows]'],
    } },
  { id: 'end_conditions', file: 'end_conditions.py', runtimes: ['cpython', 'pyodide', 'micropython'],
    captures: {
      'table': ['[[bc, L, table[(bc, L)][0], table[(bc, L)][1]] for bc, w in BCS for L in LENGTHS]', DSM],
      'scalars': ['[Py, Lcrl]'],
    } },
  { id: 'distortional_mode', file: 'distortional_mode.py', runtimes: ['cpython', 'pyodide', 'micropython'],
    captures: {
      'minimum': ['[Ld, lfd]', DSM],
      'classes': ['list(cd)'],
      'mode': ['[mag, list(d.theta)]', DSM],
      'springs': ['[dm, gone[0] if gone else None]', DSM],
    } },
  { id: 'readme_quickstart', file: 'full/readme_quickstart.py', runtimes: ['cpython', 'pyodide'],
    captures: Object.fromEntries(README_CAPTURES.map((e) => [e, [e, e.includes('classify') ? 'classify' : undefined]])) },
  { id: 'lip_study_plots', file: 'full/lip_study_plots.py', runtimes: ['cpython', 'pyodide'],
    captures: {
      'curves': ['[lip, A, Pn, eff, best]', DSM],
      'minima': ['[list(r["local"][:2]) + list(r["dist"][:2]) + [r["governs"]] for r in rows]', DSM],
    } },
  { id: 'lightest_numpy', file: 'full/lightest_numpy.py', runtimes: ['cpython', 'pyodide'],
    captures: {
      'space': ['[int(ok.sum()), int(t.size)]'],
      'done': ['[[x[0], x[1], bool(x[2])] + [float(v) for v in x[3]] for x in done]', DSM],
      'winner': ['[w_kg, wD, wB, wd, wt, t_exact]', DSM],
    } },
];

export const source = (s) => readFileSync(ex(s.file), 'utf8');

/* the script with the capture helper and one marked line of captured JSON appended */
const HELPER = readFileSync(new URL('./capture.py', import.meta.url), 'utf8');
export const MARK = '@@PARITY@@';
export function withCaptures(s) {
  const exprs = Object.values(s.captures).map(([e]) => e);
  return `${source(s)}\n\n# --- parity capture (tests/parity) ---\n${HELPER}\n`
    + `print(${JSON.stringify(MARK)} + _parity_capture(${JSON.stringify(exprs)}, globals()))\n`;
}
/* the captured values from a run's output, { expr: value } (numbers unpacked by the caller) */
export function captured(stdout) {
  const line = String(stdout).split('\n').find((l) => l.startsWith(MARK));
  if (!line) throw new Error('the script printed no captures');
  return JSON.parse(line.slice(MARK.length));
}
