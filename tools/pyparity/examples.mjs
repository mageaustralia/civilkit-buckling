#!/usr/bin/env node
/* The parity suite's CPython leg: runs every script in tests/parity/scripts.mjs on CPython with the
   pinned cufsm-rs-py (and numpy, scipy and matplotlib, Agg backend), and writes what each captured
   to tests/fixtures/pyparity/examples.json, which tests/parity/parity.test.mjs compares the
   Pyodide and MicroPython legs against. npm test needs no Python; rerun this after changing an
   example or a capture:

     tools/pyparity/.venv/bin/pip install cufsm-rs-py==0.1.0 matplotlib scipy     (see gen.py)
     node tools/pyparity/examples.mjs

   Each script runs as a user runs it beside dsm.py (the working directory is py/examples). */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPTS, withCaptures, captured } from '../../tests/parity/scripts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const py = process.env.PYTHON || join(root, 'tools/pyparity/.venv/bin/python');
const versions = JSON.parse(execFileSync(py, ['-c', `import json, sys, numpy, scipy, matplotlib
from importlib.metadata import version
print(json.dumps({"python": sys.version.split()[0], "cufsm_rs_py": version("cufsm-rs-py"), "numpy": numpy.__version__,
                  "scipy": scipy.__version__, "matplotlib": matplotlib.__version__}))`]).toString());
if (versions.cufsm_rs_py !== '0.1.0') throw new Error(`cufsm-rs-py ${versions.cufsm_rs_py} is installed; the fixtures pin 0.1.0`);
const dir = mkdtempSync(join(tmpdir(), 'ckb-parity-'));
const out = { generator: 'tools/pyparity/examples.mjs', ...versions, scripts: {} };
for (const s of SCRIPTS.filter((x) => x.runtimes.includes('cpython'))) {
  const file = join(dir, `${s.id}.py`);
  writeFileSync(file, withCaptures(s));
  const t0 = Date.now();
  const stdout = execFileSync(py, [file], { cwd: join(root, 'py/examples'), maxBuffer: 1 << 28,
    env: { ...process.env, MPLBACKEND: 'Agg', PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: join(root, 'py/examples'), PYTHONWARNINGS: 'ignore' } }).toString();
  out.scripts[s.id] = captured(stdout);
  console.log(`${s.id}: ${Object.keys(out.scripts[s.id]).length} captures in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
writeFileSync(join(root, 'tests/fixtures/pyparity/examples.json'), JSON.stringify(out) + '\n');
console.log(`CPython ${versions.python}, cufsm-rs-py ${versions.cufsm_rs_py}: tests/fixtures/pyparity/examples.json`);
