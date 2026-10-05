import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../js/history.js';

test('undo, redo, limit, and redo cleared by a new edit', () => {
  const h = createHistory(3);
  h.push({ n: 1 }); h.push({ n: 2 }); h.push({ n: 3 }); h.push({ n: 4 });
  assert.deepEqual(h.undo(), { n: 3 });
  assert.deepEqual(h.undo(), { n: 2 });
  assert.equal(h.undo(), null);            // limit 3 dropped { n: 1 }
  assert.deepEqual(h.redo(), { n: 3 });
  h.push({ n: 9 });
  assert.equal(h.canRedo, false);
});

test('the history holds copies, and current is the state on screen', () => {
  const h = createHistory();
  const a = { nodes: [{ x: 1 }] };
  h.push(a);
  a.nodes[0].x = 99;                       // the caller mutating its model must not reach the history
  assert.deepEqual(h.current, { nodes: [{ x: 1 }] });
  h.push({ nodes: [{ x: 2 }] });
  const back = h.undo();
  back.nodes[0].x = 7;                     // nor may mutating what undo handed out
  assert.deepEqual(h.current, { nodes: [{ x: 1 }] });
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
  assert.equal(h.redo().nodes[0].x, 2);
});

test('an empty history has nothing to undo or redo', () => {
  const h = createHistory();
  assert.equal(h.current, null);
  assert.equal(h.undo(), null);
  assert.equal(h.redo(), null);
  h.push({ n: 1 });
  assert.equal(h.undo(), null);            // the first state is the base: nothing before it
});
