#!/usr/bin/env node
/* Maintainers only: copy CivilKit's shared extension runtime (@civilkit/moduleui's host and
   registry, the MicroPython build and fflate) into vendor/civilkit, pinned at the source commit.

     node tools/vendor-civilkit.mjs path/to/studio-source
     (or set CIVILKIT_STUDIO_DIR)

   The source is CivilKit Studio's tree, which is not public. Nobody else needs this: the
   vendored files are complete as committed (see vendor/civilkit/README.md). Without a checkout
   the tool says so and changes nothing. */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const arg = process.argv[2] || process.env.CIVILKIT_STUDIO_DIR;
const sg = arg && resolve(arg);
if (!sg || !existsSync(join(sg, 'packages/moduleui/host.js'))) {
  console.error('vendor-civilkit: needs a local checkout of the CivilKit Studio source (not public), '
    + 'passed as the first argument or CIVILKIT_STUDIO_DIR.\n'
    + 'Nothing was changed: vendor/civilkit is complete as committed.');
  process.exit(1);
}
const out = join(here, 'vendor', 'civilkit');
mkdirSync(out, { recursive: true });
const files = [
  ['packages/moduleui/host.js', 'host.js'],
  ['packages/moduleui/vendor/fflate.browser.js', 'fflate.js'],
  ['web_demo/vendor/micropython/micropython.mjs', 'micropython.mjs'],
  ['web_demo/vendor/micropython/micropython.wasm', 'micropython.wasm'],
];
for (const [from, to] of files) copyFileSync(join(sg, from), join(out, to));
const reg = readFileSync(join(sg, 'packages/moduleui/registry.js'), 'utf8')
  .replace("'@civilkit/moduleui/vendor/fflate.js'", "'./fflate.js'");
if (/from '@civilkit\//.test(reg)) throw new Error('registry.js still has a @civilkit import');
writeFileSync(join(out, 'registry.js'), reg);
if (/^\s*import\s/m.test(readFileSync(join(out, 'host.js'), 'utf8'))) throw new Error('host.js has imports: the source predates the import-free moduleui host');
const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: sg }).toString().trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'packages/moduleui', 'web_demo/vendor/micropython'], { cwd: sg }).toString().trim();
writeFileSync(join(out, 'VERSION'), `upstream ${sha}${dirty ? ' (uncommitted changes)' : ''}\n`);
console.log('vendor/civilkit from', sha, dirty ? '(uncommitted changes!)' : '');
