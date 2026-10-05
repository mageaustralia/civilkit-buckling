import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { matchExpected } from '../js/ext/examples.js';

test('matchExpected follows Studio', () => {
  assert.deepEqual(matchExpected({ result: [{ label: 'Py', value: 105, unit: 'N' }] }, { result: [{ label: 'Py', value: 105.05, unit: 'N' }] }), []);
  assert.deepEqual(matchExpected({ result: [{ label: 'Py', value: 105 }] }, { result: [{ label: 'Py', value: 106 }] }), ['Py: expected 105, got 106']);
  assert.deepEqual(matchExpected({ result: [{ label: 'S', value: 'OK' }] }, { result: [] }), ['S: missing from result']);
  assert.deepEqual(matchExpected({ result: [{ label: 'Py', value: 105, unit: 'kN' }] }, { result: [{ label: 'Py', value: 105, unit: 'N' }] }), ['Py: expected unit kN, got N']);
});

const run = (...args) => spawnSync('node', ['tools/ckext.mjs', ...args], { encoding: 'utf8' });

test('cli: hello is verified, and an engine refusal becomes a diff', () => {
  const json = (dir) => JSON.parse(execFileSync('node', ['tools/ckext.mjs', 'test', dir, '--json']).toString());
  const ok = json('tests/fixtures/ckext/hello-module');
  assert.equal(ok.badge, 'verified');
  assert.deepEqual(ok.capabilities.used, ['firstYield']);
  assert.deepEqual(ok.form.fields.map((f) => f.id), ['fy']);
  assert.equal(ok.run.result[0].label, 'Py');
  const bad = spawnSync('node', ['tools/ckext.mjs', 'test', 'tests/fixtures/ckext/zero-thickness-module', '--json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  const r = JSON.parse(bad.stdout);
  assert.equal(r.badge, 'community');
  assert.match(r.examples[0].diffs[0], /thickness/);
});

test('cli: pack writes a bundle that test verifies; usage errors exit 2', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const out = join(mkdtempSync(join(tmpdir(), 'ckext-')), 'hello.ckext');
  const p = run('pack', 'tests/fixtures/ckext/hello-module', '-o', out);
  assert.equal(p.status, 0, p.stderr);
  const t = run('test', out);
  assert.equal(t.status, 0, t.stdout + t.stderr);
  assert.match(t.stdout, /verified/);
  assert.equal(run('frobnicate').status, 2);
  assert.equal(run('test').status, 2);
});

test('cli: an undeclared capability call is reported and fails the run', () => {
  const r = run('test', 'tests/fixtures/ckext/undeclared-module', '--json');
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.capabilities.undeclaredCalls, ['firstYield']);
  assert.match(j.examples[0].diffs[0], /not declared/);
});

test('the reference modules under extensions/ are verified', () => {
  for (const dir of ['extensions/dsm-compression', 'extensions/section-rounded-cz']) {
    const r = run('test', dir, '--json');
    const j = JSON.parse(r.stdout);
    assert.equal(j.badge, 'verified', `${dir}: ${JSON.stringify(j.examples)}`);
    assert.equal(r.status, 0);
    assert.deepEqual(j.capabilities.undeclaredCalls, []);
  }
});
