#!/usr/bin/env node
/* Copy cufsm-rs-py's own Python layer, unchanged, into py/cufsm-rs-py/ at a pinned tag: what
   the Python console's full runtime (Pyodide) imports as cufsm_rs, with py/pyodide/_native_js.py
   in place of the compiled _native module.

     node tools/vendor-cufsm-rs-py.mjs [path/to/cufsm-py] [tag]   (default ../cufsm-py, v0.1.0)

   The files come from the tag (git show), not the working tree, and VERSION records the tag, its
   commit and each file's SHA-256; tests/py-pyodide.test.mjs checks the files against it. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const repo = resolve(process.argv[2] || join(here, '..', 'cufsm-py'));
const tag = process.argv[3] || 'v0.1.0';
const out = join(here, 'py', 'cufsm-rs-py');
export const FILES = ['__init__.py', '_display.py', 'plot.py'];
mkdirSync(join(out, 'cufsm_rs'), { recursive: true });
const git = (...a) => execFileSync('git', a, { cwd: repo });
const commit = git('rev-list', '-n', '1', tag).toString().trim();
const lines = [`cufsm-rs-py ${tag} ${commit}`];
for (const f of FILES) {
  const b = git('show', `${tag}:python/cufsm_rs/${f}`);
  writeFileSync(join(out, 'cufsm_rs', f), b);
  lines.push(`${createHash('sha256').update(b).digest('hex')}  cufsm_rs/${f}`);
}
writeFileSync(join(out, 'LICENSE'), git('show', `${tag}:LICENSE`));
writeFileSync(join(out, 'VERSION'), lines.join('\n') + '\n');
console.log(`py/cufsm-rs-py from ${tag} (${commit.slice(0, 7)})`);
