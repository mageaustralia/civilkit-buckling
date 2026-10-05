import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readBundle } from '../vendor/civilkit/registry.js';
import { zipSync, strToU8 } from '../vendor/civilkit/fflate.js';

test('vendored registry reads a Buckling bundle and refuses a Studio one', () => {
  const mk = (point) => zipSync({ 'manifest.json': strToU8(JSON.stringify({ id: 'a.b', name: 'A', version: '1.0.0',
    civilkitApi: '^1.0', contributes: [{ point, id: 'x' }] })), 'main.py': strToU8('') });
  assert.equal(readBundle(mk('buckling.tool'), { points: ['buckling.tool'] }).manifest.id, 'a.b');
  assert.throws(() => readBundle(mk('design-check'), { points: ['buckling.tool'] }), /CivilKit Studio/);
});

test('vendor is pinned', async () => {
  assert.match(await readFile(new URL('../vendor/civilkit/VERSION', import.meta.url), 'utf8'), /^upstream [0-9a-f]{7,}/);
});
