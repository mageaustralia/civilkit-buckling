import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels } from '../js/labels.js';

/* Defect 6: minimum labels on the signature chart must not print over each other or leave the
   plot; a label with no free place is dropped (the list under the chart names every minimum). */
const box = (l) => [l.x, l.y - l.h, l.x + l.w, l.y];
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const frame = { x0: 54, y0: 16, x1: 582, y1: 300 };

test('two minima 378 mm and 535 mm apart on a log axis get separate places', () => {
  const pts = [{ px: 400, py: 120, w: 150 }, { px: 425, py: 122, w: 150 }];
  const out = placeLabels(pts, frame);
  const shown = out.filter(Boolean);
  assert.equal(shown.length, 2);
  assert.ok(!overlap(box(shown[0]), box(shown[1])));
});
test('many minima in a row: no two shown labels overlap, all inside the frame', () => {
  const pts = Array.from({ length: 12 }, (_, i) => ({ px: 200 + i * 18, py: 150 + (i % 2), w: 140 }));
  const out = placeLabels(pts, frame);
  const shown = out.filter(Boolean);
  assert.ok(shown.length >= 2);
  for (let i = 0; i < shown.length; i++) {
    const b = box(shown[i]);
    assert.ok(b[0] >= frame.x0 && b[2] <= frame.x1 && b[1] >= frame.y0 && b[3] <= frame.y1, JSON.stringify(b));
    for (let j = i + 1; j < shown.length; j++) assert.ok(!overlap(b, box(shown[j])));
  }
});
test('a label near the right edge is anchored to stay inside', () => {
  const [l] = placeLabels([{ px: 575, py: 200, w: 150 }], frame);
  assert.ok(l.x + l.w <= frame.x1 && l.x >= frame.x0);
});
test('labels keep clear of the obstacles they are given (the markers)', () => {
  const marker = [395, 114, 407, 126];
  const out = placeLabels([{ px: 401, py: 120, w: 100 }, { px: 430, py: 120, w: 100 }], frame, { obstacles: [marker, [424, 114, 436, 126]] });
  for (const l of out.filter(Boolean)) assert.ok(!overlap(box(l), marker));
});
