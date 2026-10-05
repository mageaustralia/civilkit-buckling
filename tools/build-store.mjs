#!/usr/bin/env node
/* Build the extension store: pack every module under extensions/ with the ckext CLI, test it, and list
   it in store/index.json ONLY if its worked examples verify. A module that is not Verified is left out
   (and named), so the store never offers one whose cited numbers do not reproduce.

     node tools/build-store.mjs          writes store/<id>.ckext and store/index.json

   Re-run after changing a module; commit store/ with the change. */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'tools/ckext.mjs');
const store = join(root, 'store');
mkdirSync(store, { recursive: true });

const index = [], skipped = [];
for (const name of readdirSync(join(root, 'extensions')).sort()) {
  const dir = join(root, 'extensions', name);
  if (!existsSync(join(dir, 'manifest.json'))) continue;
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const file = `${m.id}.ckext`;
  execFileSync('node', [cli, 'pack', dir, '-o', join(store, file)], { stdio: 'pipe' });
  let verdict = '';
  try {
    verdict = execFileSync('node', [cli, 'test', join(store, file)], { encoding: 'utf8' });
  } catch (e) { verdict = String(e.stdout || e.message); }
  if (!/\bverified\b/.test(verdict) || /community/i.test(verdict)) { skipped.push(`${m.id}: ${verdict.trim().split('\n').pop()}`); continue; }
  index.push({ id: m.id, name: m.name, version: m.version, description: m.description || '', url: file });
}
writeFileSync(join(store, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`store: ${index.length} module(s): ${index.map((e) => `${e.id} ${e.version}`).join(', ') || 'none'}`);
if (skipped.length) { console.log('left out (not Verified):'); for (const s of skipped) console.log('  ' + s); process.exitCode = 1; }
