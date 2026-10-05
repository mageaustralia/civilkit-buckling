import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNum, numFieldHtml } from '../js/numfield.js';

test('parseNum', () => {
  assert.deepEqual(parseNum('1,5'), { ok: true, value: 1.5 });          // decimal comma (EU keypads)
  assert.deepEqual(parseNum('−3'), { ok: true, value: -3 });            // Unicode minus from some keypads
  assert.deepEqual(parseNum('2e5'), { ok: true, value: 200000 });
  assert.equal(parseNum('').ok, false);
  assert.match(parseNum('-1', { allowNegative: false }).message, /positive/);
  assert.match(parseNum('0.6', { max: 0.5 }).message, /at most 0.5/);
});

test('parseNum: a comma is a decimal comma only between digits, and words are refused', () => {
  assert.deepEqual(parseNum(' -0,25 '), { ok: true, value: -0.25 });
  assert.equal(parseNum('1,000,5').ok, false);
  assert.match(parseNum('abc').message, /not a number/);
  assert.match(parseNum('Infinity').message, /not a number/);
  assert.match(parseNum('3', { min: 5 }).message, /at least 5/);
  assert.match(parseNum('0', { above: 0 }).message, /above 0/);
  assert.match(parseNum('2.5', { integer: true }).message, /whole number/);
  assert.deepEqual(parseNum('4', { integer: true }), { ok: true, value: 4 });
});

test('numFieldHtml: a signed field gets the ± key, a positive one does not; values are escaped', () => {
  const s = numFieldHtml({ id: 'P', label: 'P', unit: 'N', value: -3 });
  assert.match(s, /inputmode="decimal"/);
  assert.match(s, /class="pm"/);
  assert.match(s, /value="-3"/);
  const t = numFieldHtml({ id: 'h', label: 'Depth h', unit: 'mm', value: 150, allowNegative: false });
  assert.doesNotMatch(t, /class="pm"/);
  assert.match(numFieldHtml({ id: 'x', label: 'a"b', value: 1 }), /a&quot;b/);
});
