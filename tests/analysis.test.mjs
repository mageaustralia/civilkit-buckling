import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ym } from '../js/shapefn.js';
import { parseLengths, logLengths } from '../js/lengths.js';

test('Ym matches Ym_at_ys.m', () => {
  const a = 1000, y = 250;
  assert.equal(Ym('S-S', 1, y, a), Math.sin(Math.PI * y / a));
  assert.equal(Ym('C-C', 2, y, a), Math.sin(2 * Math.PI * y / a) * Math.sin(Math.PI * y / a));
  assert.equal(Ym('S-C', 1, y, a), Math.sin(2 * Math.PI * y / a) + 2 * Math.sin(Math.PI * y / a));
  assert.equal(Ym('C-F', 1, y, a), 1 - Math.cos(0.5 * Math.PI * y / a));
  assert.equal(Ym('C-G', 1, y, a), Math.sin(0.5 * Math.PI * y / a) * Math.sin(Math.PI * y / a / 2));
  assert.equal(Ym('C-S', 1, y, a), Ym('S-C', 1, y, a));
});

test('parseLengths sanitises', () => {
  const r = parseLengths('10\n5\n5\n0\n-3\nabc\n20, 15');
  assert.deepEqual(r.lengths, [5, 10, 15, 20]);
  assert.deepEqual(r.dropped, ['duplicate 5', '0', '-3', 'abc']);
});

test('logLengths spans the range', () => {
  const l = logLengths(10, 1000, 3);
  assert.deepEqual(l.map((v) => Math.round(v)), [10, 100, 1000]);
});

/* Defect 3: the drawn deformation is a fraction of the section's size, in section units, and
   does not depend on how many pixels a unit is drawn at. */
import { deformScale } from '../js/results.js';
test('deformScale puts the peak in-plane displacement at 10 % of the section size', () => {
  const dx = Float64Array.from([0, 0.6, -1]), dz = Float64Array.from([0, 0.8, 0]);
  for (const size of [9, 150, 5000]) {
    const k = deformScale(dx, dz, size);
    const peak = Math.max(...[0, 1, 2].map((i) => Math.hypot(dx[i], dz[i]))) * k;
    assert.ok(Math.abs(peak - 0.1 * size) < 1e-12, `size ${size}: peak ${peak}`);
  }
  // a mode that is really longitudinal (tiny in-plane entries) is not blown up to fill the drawing
  const k = deformScale(Float64Array.from([0.01]), Float64Array.from([0]), 100);
  assert.ok(0.01 * k <= 0.1 * 100 * 0.05);
});

/* Defect 13: with General BC and many terms, local buckling recurs at multiples of its
   half-wavelength, giving a row of near-identical "local minimum" entries. Minima of one family
   whose load factors agree within 1 % collapse into the shortest, which lists the others. */
import { collapseMinima } from '../js/results.js';
test('collapseMinima merges a recurring local minimum and keeps the rest', () => {
  const m = [[115, 1.006, 'local'], [232, 1.006, 'local'], [352, 1.0059, 'local'], [465, 1.005, 'local'],
             [700, 3.2, 'dist'], [800, 1.005, 'local'], [5000, 0.515, 'glob']]
    .map(([length, lf, fam], index) => ({ index, length, lf, fam }));
  const c = collapseMinima(m);
  assert.deepEqual(c.map((x) => x.length), [115, 700, 800, 5000]);
  assert.deepEqual(c[0].also, [232, 352, 465]);
  assert.deepEqual(c[1].also, []);
  // a 2 % difference is two minima, not one
  const d = collapseMinima([{ index: 0, length: 100, lf: 1, fam: 'local' }, { index: 1, length: 200, lf: 1.02, fam: 'local' }]);
  assert.equal(d.length, 2);
});
