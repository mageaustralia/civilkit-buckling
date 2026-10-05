import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBundle } from '../vendor/civilkit/registry.js';
import { CAPABILITY_DOCS, makeCapabilities } from '../js/ext/capabilities.js';
import { addFixture, draftFromRecord, fileName, indent, manifestOf, packDraft, parseExamples, pretty,
         sameDraft, starterDraft } from '../js/ext/builder.js';

test('the manifest checklist is the host capability table', () => {
  const offered = Object.keys(makeCapabilities(null, { model: null, results: null }, {})).filter((k) => k !== 'log');
  assert.deepEqual(CAPABILITY_DOCS.map(([k]) => k).sort(), offered.sort());
});

test('the starter packs into a bundle the installer accepts, and the CLI runs its form', () => {
  const bytes = packDraft(starterDraft());
  const { manifest, files } = readBundle(bytes, { points: ['buckling.tool'] });
  assert.equal(manifest.contributes[0].point, 'buckling.tool');
  assert.ok(manifest.capabilities.includes('firstYield'));
  assert.match(new TextDecoder().decode(files['main.py']), /civilkit/);
  assert.equal(new TextDecoder().decode(files['tests/worked-examples.json']).trim(), '[]');
  const out = join(mkdtempSync(join(tmpdir(), 'ckext-')), fileName(manifest));
  writeFileSync(out, bytes);
  let r;
  try { r = JSON.parse(execFileSync('node', ['tools/ckext.mjs', 'test', out, '--json']).toString()); }
  catch (e) { r = JSON.parse(e.stdout.toString()); }          // no examples: Community, exit 1
  assert.equal(r.badge, 'community');
  assert.deepEqual(r.form.fields.map((f) => f.id), ['fy']);
});

test('packDraft names a JSON slip and a bad manifest', () => {
  assert.throws(() => packDraft({ ...starterDraft(), examples: '[{' }), /not valid JSON/);
  assert.throws(() => packDraft({ ...starterDraft(), examples: '{}' }), /must be a JSON list/);
  assert.throws(() => packDraft({ ...starterDraft(), manifest: { ...starterDraft().manifest, version: 'one' } }), /semver/);
  assert.throws(() => packDraft({ ...starterDraft(), manifest: { ...starterDraft().manifest, contributes: [{ point: 'design-check', id: 'x' }] } }),
    /This module is for CivilKit Studio/);
});

test('a fixture example carries the model and no expected numbers', () => {
  const model = { mats: [{ id: 1 }], nodes: [{ x: 0, z: 0 }, { x: 1, z: 0 }], elems: [{ i: 0, j: 1, t: 1, mat: 1 }] };
  const a = addFixture('[]', model, { fy: '350' });
  const b = addFixture(a.text, model);
  const list = parseExamples(b.text);
  assert.deepEqual(list.map((x) => x.id), ['example-1', 'example-2']);
  assert.deepEqual(list[0].model, model);
  assert.deepEqual(list[0].input, { fy: '350' });
  assert.deepEqual(list[0].expected, { result: [] });
  assert.throws(() => addFixture('nope', model), /not valid JSON/);
  assert.equal(pretty({ x: 1, free: [1, 1, 1, 1] }), '{"x":1,"free":[1,1,1,1]}');
});

test('a fork gets its own id and name; View code keeps them', () => {
  const enc = (s) => new TextEncoder().encode(s);
  const rec = { manifest: { id: 'a.b', name: 'AB', version: '1.0.0', civilkitApi: '^1.0', contributes: [{ point: 'buckling.tool', id: 'm' }], capabilities: [] },
                files: { 'main.py': enc('x = 1\n'), 'tests/worked-examples.json': enc('[]') } };
  const f = draftFromRecord(rec, { fork: true });
  assert.equal(f.manifest.id, 'a.b-fork');
  assert.equal(f.manifest.name, 'AB (fork)');
  assert.equal(rec.manifest.id, 'a.b');
  assert.equal(draftFromRecord(rec).manifest.id, 'a.b');
  assert.equal(f.main, 'x = 1\n');
  assert.ok(sameDraft(starterDraft(), starterDraft()));
  assert.ok(!sameDraft(f, starterDraft()));
  assert.equal(fileName(f.manifest), 'b-fork.ckext');
  assert.deepEqual(manifestOf({ ...f.manifest, capabilities: ['firstYield', 'getModel'] }).capabilities, ['getModel', 'firstYield']);
});

test('Tab indents by four spaces, and a selection line by line', () => {
  assert.equal(indent('ab', 1, 1).text, 'a    b');
  assert.equal(indent('x\ny\nz', 0, 3).text, '    x\n    y\nz');
  assert.equal(indent('    x\n  y', 0, 9, true).text, 'x\ny');
});
