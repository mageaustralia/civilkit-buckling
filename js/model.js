/* The CUFSM model as plain data. Node and element indices are 0-based; materials are referred to
   by their CUFSM id (mat#). Every operation returns a new model and never mutates its input. */
const clone = (m) => structuredClone(m);

export function isotropic(id, E, nu) {
  return { id, ex: E, ey: E, vx: nu, vy: nu, g: +(E / (2 * (1 + nu))).toPrecision(12) };
}

export function fromPolylines(lines, { t, mat, mesh = 4 }) {
  const nodes = [], elems = [], seen = new Map();
  const at = (x, z) => {
    const k = `${x.toFixed(6)},${z.toFixed(6)}`;
    if (!seen.has(k)) { seen.set(k, nodes.length); nodes.push({ x, z, free: [1, 1, 1, 1], stress: 1 }); }
    return seen.get(k);
  };
  for (const line of lines)
    for (let s = 1; s < line.length; s++) {
      const [[x0, z0], [x1, z1]] = [line[s - 1], line[s]];
      let prev = at(x0, z0);
      for (let k = 1; k <= mesh; k++) {
        const cur = at(x0 + (x1 - x0) * k / mesh, z0 + (z1 - z0) * k / mesh);
        elems.push({ i: prev, j: cur, t, mat: mat.id });
        prev = cur;
      }
    }
  return { mats: [mat], nodes, elems, springs: [], constraints: [] };
}

export function toBuffers(m) {
  const row = new Map(m.mats.map((q, k) => [q.id, k]));
  return {
    mats: Float64Array.from(m.mats.flatMap((q) => [q.ex, q.ey, q.vx, q.vy, q.g])),
    nodes: Float64Array.from(m.nodes.flatMap((n) => [n.x, n.z, ...n.free, n.stress])),
    elems: Float64Array.from(m.elems.flatMap((e) => {
      if (!row.has(e.mat)) throw new Error(`element ${e.i + 1}-${e.j + 1} uses material ${e.mat}, which is not defined`);
      return [e.i, e.j, e.t, row.get(e.mat)];
    })),
    springs: Float64Array.from(m.springs.flat()),
    constraints: Float64Array.from(m.constraints.flat()),
  };
}

export function divideElem(m0, k, parts = 2) {
  const m = clone(m0);
  const e = m.elems[k], a = m.nodes[e.i], b = m.nodes[e.j];
  const news = [];
  let prev = e.i;
  for (let p = 1; p < parts; p++) {
    const u = p / parts;
    m.nodes.push({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, free: [1, 1, 1, 1],
                   stress: a.stress + (b.stress - a.stress) * u });
    const cur = m.nodes.length - 1;
    news.push({ ...e, i: prev, j: cur });
    prev = cur;
  }
  news.push({ ...e, i: prev, j: e.j });
  m.elems.splice(k, 1, ...news);
  return m;
}

export function doubleElems(m) {
  let out = m;
  for (let k = m.elems.length - 1; k >= 0; k--) out = divideElem(out, k, 2);
  return out;
}

function renumber(m, keep) {             // keep: bool per node → drop the others, fix every reference
  const map = new Map();
  m.nodes = m.nodes.filter((_, i) => keep[i] && map.set(i, map.size));
  m.elems = m.elems.filter((e) => map.has(e.i) && map.has(e.j)).map((e) => ({ ...e, i: map.get(e.i), j: map.get(e.j) }));
  m.springs = m.springs.filter((s) => map.has(s[0]) && (s[1] === -1 || map.has(s[1])))
    .map((s) => [map.get(s[0]), s[1] === -1 ? -1 : map.get(s[1]), ...s.slice(2)]);
  m.constraints = m.constraints.filter((c) => map.has(c[0]) && map.has(c[3]))
    .map((c) => [map.get(c[0]), c[1], c[2], map.get(c[3]), c[4]]);
  return m;
}

export function deleteElems(m0, ks) {
  const m = clone(m0), drop = new Set(ks);
  m.elems = m.elems.filter((_, k) => !drop.has(k));
  const used = new Set(m.elems.flatMap((e) => [e.i, e.j]));
  return renumber(m, m.nodes.map((_, i) => used.has(i)));
}

export function deleteNode(m0, i) {
  return renumber(clone(m0), m0.nodes.map((_, k) => k !== i));
}

export function translateNodes(m0, idxs, dx, dz) {
  const m = clone(m0);
  for (const i of idxs) { m.nodes[i].x += dx; m.nodes[i].z += dz; }
  return m;
}

/* A node appended to the model, joined by a new element to node `from` (-1: a lone first node).
   It takes the stress of the node it grows from, and the new element the thickness and material
   of the last element touching that node (else the last element, else opts.t and the first
   material). */
export function appendNode(m0, x, z, from, opts = {}) {
  const m = clone(m0);
  const src = m.nodes[from];
  m.nodes.push({ x, z, free: [1, 1, 1, 1], stress: src ? src.stress : 1 });
  if (src) {
    const like = [...m.elems].reverse().find((e) => e.i === from || e.j === from) || m.elems.at(-1);
    m.elems.push({ i: from, j: m.nodes.length - 1, t: like ? like.t : opts.t ?? 1, mat: like ? like.mat : m.mats[0].id });
  }
  return m;
}

/* one node or element row changed (x, z, free, stress / t, mat); the rest is copied */
export function setNode(m0, i, patch) {
  const m = clone(m0);
  Object.assign(m.nodes[i], structuredClone(patch));
  return m;
}
export function setElem(m0, k, patch) {
  const m = clone(m0);
  Object.assign(m.elems[k], patch);
  return m;
}

export function toCufsmText(m) {
  return {
    prop: m.mats.map((q) => `${q.id} ${q.ex} ${q.ey} ${q.vx} ${q.vy} ${q.g}`).join('\n'),
    node: m.nodes.map((n, i) => `${i + 1} ${n.x} ${n.z} ${n.free.join(' ')} ${n.stress}`).join('\n'),
    elem: m.elems.map((e, k) => `${k + 1} ${e.i + 1} ${e.j + 1} ${e.t} ${e.mat}`).join('\n'),
  };
}

function rows(text, what, width) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l, k) => {
    const v = l.split(/[\s,]+/).map(Number);
    if (v.length !== width || v.some((x) => !Number.isFinite(x)))
      throw new Error(`${what} line ${k + 1}: expected ${width} numbers, got "${l}"`);
    return v;
  });
}

export function fromCufsmText({ prop, node, elem }) {
  const mats = rows(prop, 'prop', 6).map(([id, ex, ey, vx, vy, g]) => ({ id, ex, ey, vx, vy, g }));
  const nrows = rows(node, 'node', 8);
  const index = new Map(nrows.map((r, k) => [r[0], k]));
  const nodes = nrows.map(([, x, z, a, b, c, d, s]) => ({ x, z, free: [a, b, c, d], stress: s }));
  const ids = new Set(mats.map((q) => q.id));
  const elems = rows(elem, 'elem', 5).map(([, ni, nj, t, mat], k) => {
    for (const n of [ni, nj]) if (!index.has(n)) throw new Error(`elem line ${k + 1}: node ${n} is not in the node list`);
    if (!ids.has(mat)) throw new Error(`elem line ${k + 1}: material ${mat} is not in the prop list`);
    return { i: index.get(ni), j: index.get(nj), t, mat };
  });
  return { mats, nodes, elems, springs: [], constraints: [] };
}

export function validateModel(m, { maxNodes = 5000 } = {}) {
  if (!m || !Array.isArray(m.nodes) || !Array.isArray(m.elems) || !Array.isArray(m.mats)) throw new Error('a model needs mats, nodes and elems');
  if (!m.elems.length) throw new Error('the model has no elements');
  if (m.nodes.length > maxNodes) throw new Error(`the model has ${m.nodes.length} nodes; the limit is ${maxNodes}`);
  m.nodes.forEach((n, k) => {
    if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.z)) throw new Error(`node ${k + 1} has no finite x and z`);
  });
  m.mats.forEach((q) => {
    if (!q || !['ex', 'ey', 'vx', 'vy', 'g'].every((f) => Number.isFinite(q[f])) || !(q.ex > 0 && q.ey > 0 && q.g > 0))
      throw new Error(`material ${q && q.id} needs finite ex, ey, vx, vy and g, with ex, ey and g above zero`);
  });
  const ids = new Set(m.mats.map((q) => q.id));
  m.elems.forEach((e, k) => {
    for (const n of [e.i, e.j]) if (!Number.isInteger(n) || n < 0 || n >= m.nodes.length) throw new Error(`element ${k + 1} refers to node ${n + 1}, which does not exist`);
    if (!(e.t > 0)) throw new Error(`element ${k + 1} has thickness ${e.t}`);
    if (!ids.has(e.mat)) throw new Error(`element ${k + 1} uses material ${e.mat}, which is not defined`);
  });
}
