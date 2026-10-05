import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinchView, zoomAbout, nearestNode, nearestSegment, toView, fromView, snapTo } from '../js/gestures.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('a pinch keeps the point under the fingers fixed and scales by the spread', () => {
  const v0 = { s: 1, tx: 0, ty: 0 };
  // fingers 100 apart about (200, 200), then 200 apart about the same midpoint: twice the zoom
  const v = pinchView(v0, [{ x: 150, y: 200 }, { x: 250, y: 200 }], [{ x: 100, y: 200 }, { x: 300, y: 200 }]);
  close(v.s, 2);
  const q = fromView(v0, { x: 200, y: 200 });            // the drawing point under the midpoint
  const p = toView(v, q);                                 // is still under it after the pinch
  close(p.x, 200); close(p.y, 200);
});

test('a pinch that moves its midpoint pans with it', () => {
  const v0 = { s: 2, tx: -100, ty: -50 };
  const v = pinchView(v0, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 130, y: 140 }, { x: 230, y: 140 }]);
  close(v.s, 2);
  close(v.tx, -70); close(v.ty, -10);
});

test('the zoom is clamped to 0.25 to 20', () => {
  const v0 = { s: 1, tx: 0, ty: 0 };
  assert.equal(pinchView(v0, [{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }, { x: 1000, y: 0 }]).s, 20);
  assert.equal(pinchView(v0, [{ x: 0, y: 0 }, { x: 1000, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 0 }]).s, 0.25);
  assert.equal(zoomAbout(v0, 100, { x: 0, y: 0 }).s, 20);
});

test('zoomAbout keeps its centre fixed', () => {
  const v0 = { s: 1.5, tx: 10, ty: -20 };
  const c = { x: 210, y: 210 };
  const v = zoomAbout(v0, 1.25, c);
  close(v.s, 1.875);
  const p = toView(v, fromView(v0, c));
  close(p.x, c.x); close(p.y, c.y);
});

test('nearestNode picks the closest node within the radius, measured on screen', () => {
  const nodes = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 30, y: 0 }];
  assert.equal(nearestNode(nodes, { x: 8, y: 1 }, 24, 1), 1);
  assert.equal(nearestNode(nodes, { x: 60, y: 0 }, 24, 1), -1);
  // zoomed in 4x, 8 drawing units is 32 px on screen: outside a 24 px radius
  assert.equal(nearestNode([{ x: 0, y: 0 }], { x: 8, y: 0 }, 24, 4), -1);
  assert.equal(nearestNode([{ x: 0, y: 0 }], { x: 5, y: 0 }, 24, 4), 0);
});

test('nearestSegment measures to the segment, not its line', () => {
  const segs = [[{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 50 }, { x: 100, y: 50 }]];
  assert.equal(nearestSegment(segs, { x: 50, y: 10 }, 16, 1), 0);
  assert.equal(nearestSegment(segs, { x: 50, y: 42 }, 16, 1), 1);
  assert.equal(nearestSegment(segs, { x: 130, y: 0 }, 16, 1), -1);    // beyond the end
  assert.equal(nearestSegment(segs, { x: 50, y: 25 }, 16, 1), -1);
});

test('snapTo rounds to the grid without float noise', () => {
  assert.equal(snapTo(12.26, 0.5), 12.5);
  assert.equal(snapTo(-0.24, 0.5), 0);
  assert.equal(snapTo(0.1 + 0.2, 0.1), 0.3);
});
