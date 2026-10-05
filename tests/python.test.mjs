import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pythonScript } from '../js/python.js';

/* Defect 5: the report's Python is a script for the published cufsm-rs-py package that rebuilds
   the model on screen row for row (CUFSM's 1-based tables, full precision) and runs the same
   analysis; it was a made-up cufsm API with a template path and mesh = 4, which no edited or
   pasted model went through. */
const model = {
  mats: [{ id: 100, ex: 29500, ey: 29500, vx: 0.3, vy: 0.3, g: 11346.15 }],
  nodes: [{ x: 5, z: 1, free: [1, 1, 1, 1], stress: -38.889 }, { x: 5, z: 0, free: [1, 0, 1, 1], stress: -50 },
          { x: 2.5, z: 0, free: [1, 1, 1, 1], stress: 0.1 + 0.2 }],
  elems: [{ i: 0, j: 1, t: 0.1, mat: 100 }, { i: 1, j: 2, t: 0.1, mat: 100 }],
  springs: [[1, -1, 0, 0, 10, 0, 0, 1, 0]],
  constraints: [[0, 1, 1, 2, 1]],
};
test('the script rebuilds the model as CUFSM tables for cufsm_rs.Model', () => {
  const py = pythonScript({ model, solution: 'signature', bc: 'S-S', terms: 1, lengths: [1, 2.5, 10] });
  assert.match(py, /^import cufsm_rs$/m);
  assert.doesNotMatch(py, /import cufsm$|mesh=|cufsm\.model\(/m);
  assert.match(py, /\[100, 29500, 29500, 0\.3, 0\.3, 11346\.15\]/);
  assert.match(py, /\[2, 5, 0, 1, 0, 1, 1, -50\]/);                 // 1-based, the fixity flags as given
  assert.match(py, /\[3, 2\.5, 0, 1, 1, 1, 1, 0\.30000000000000004\]/);   // full precision
  assert.match(py, /\[2, 2, 3, 0\.1, 100\]/);
  assert.match(py, /\[1, 2, 0, 0, 0, 10, 0, 0, 1, 0\]/);              // ground spring: node j = 0
  assert.match(py, /\[1, 1, 1, 3, 1\]/);                              // constraint nodes 1-based
  assert.match(py, /cufsm_rs\.signature\(model, lengths\)/);
});
test('general boundary conditions run strip with the terms and end conditions', () => {
  const py = pythonScript({ model, solution: 'general', bc: 'C-C', terms: 3, lengths: [100, 1000] });
  assert.match(py, /cufsm_rs\.strip\(model, lengths, m_all=3, bc="C-C", neigs=1\)/);
});
