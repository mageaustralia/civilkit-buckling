/* The Python console's one way into the engine: call(op, json) -> json, the 8 operations of
   cufsm-rs-py's native module (python/cufsm_rs/_native.pyi in that package), in its argument
   shapes, over the same cufsm.wasm the page runs. Both Python layers use it: the MicroPython lite
   module (py/cufsm_rs_lite) and, later, the package's own Python layer under Pyodide.

   Request: an op name and a JSON object of the .pyi's named arguments, for example
     call('strip', '{"arrays": [prop, node, elem, constraints, springs], "lengths": [...],
                     "m_all": [[1], ...], "bc": "S-S", "neigs": 20, "spaces": null}')
   The tables are CUFSM's own, 1-based (prop [mat#, Ex, Ey, vx, vy, G], node [node#, x, z, xdof,
   zdof, ydof, qdof, stress], elem [elem#, nodei, nodej, t, mat#], constraints [node#e, dofe,
   coeff, node#k, dofk], springs [#, nodei, nodej (0 = ground), ku, kv, kw, kq, local, discrete,
   ys]). This file, not the Python, turns them into the engine's buffers (the package's own
   src/lib.rs build(), with its messages).

   Reply: {"ok": value} in the .pyi's return shapes, or {"error": {"type", "message"}} with type
   ValueError, MechanismError (the stiffness is not positive definite, as the package raises),
   MemoryError (an output larger than the engine's memory can hold: the package has no fixed
   limits either, so a problem too large for the browser stops there) or RuntimeError (the engine
   trapped: a panic inside it, where the package raises PanicException, or memory it could not
   grow).

   Numbers cross packed, bit for bit (pack/unpack below), so NaN and infinities cross too.

   Every number comes from an engine export (ABI 2, minor 1): section_properties from
   cufsm_props_wn, strip from cufsm_strip (per-length terms, cFSM spaces), signature's default
   lengths and minima from cufsm_signature_lengths and cufsm_signature_minima, classify from
   cufsm_classify (every orth, norm and ospace, on any mode vectors), template from cufsm_template.
   Nothing here does mechanics: it checks arguments in the package's order and with its messages,
   and moves numbers. */
class PyError extends Error {
  constructor(type, message) { super(message); this.type = type; }
}
const bad = (msg) => new PyError('ValueError', msg);

/* Numbers cross the boundary bit for bit: a list of numbers is {"$f64": [u32, ...]}, the
   little-endian 32-bit halves of each double, and a lone number {"$f": [lo, hi]}. MicroPython's
   float formatting and parsing are not correctly rounded (a value can come back a few ulps off),
   and a mode vector handed back to classify() must be the one the engine wrote. Plain JSON
   numbers are accepted too. */
const toU32 = (nums) => Array.from(new Uint32Array(Float64Array.from(nums).buffer));
const fromU32 = (u) => Array.from(new Float64Array(Uint32Array.from(u).buffer));
export function unpack(v) {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') {
    if (Array.isArray(v.$f64)) return fromU32(v.$f64);
    if (Array.isArray(v.$f)) return fromU32(v.$f)[0];
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x)]));
  }
  return v;
}
export function pack(v) {
  if (typeof v === 'number') return { $f: toU32([v]) };
  if (ArrayBuffer.isView(v)) return { $f64: toU32(v) };
  if (Array.isArray(v)) return v.length && v.every((x) => typeof x === 'number') ? { $f64: toU32(v) } : v.map(pack);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  return v;
}

/* Rust's {} for an f64, as the package's messages print it: 3 not 3.0, inf not Infinity */
const rs = (v) => (Number.isNaN(v) ? 'NaN' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : String(v));
const trunc = (v) => Math.trunc(v);            // Rust's `as i64` for the numbers used as keys
const finite = (v, what) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${what} is not a finite number (${rs(Number(v))})`);
  return v;
};
const table = (t, name) => {
  if (t == null) return [];
  if (!Array.isArray(t) || t.some((r) => !Array.isArray(r))) throw bad(`${name} must be a list of rows`);
  return t;
};

/* The package's build() (src/lib.rs): CUFSM tables to the engine's buffers, with its checks and
   messages, in its order. The engine checks the rest (model.validate, as the package does). */
export function buffersOf(arrays) {
  if (!Array.isArray(arrays) || arrays.length !== 5) throw bad('arrays must be [prop, node, elem, constraints, springs]');
  const [prop, node, elem, constraints, springs] = arrays.map((t, k) =>
    table(t, ['prop', 'node', 'elem', 'constraints', 'springs'][k]));
  if (!prop.length) throw bad('prop is empty: at least one material row [mat#, Ex, Ey, vx, vy, G] is needed');
  const matIndex = new Map(), mats = [];
  prop.forEach((p, i) => {
    if (p.length !== 6) throw bad(`prop row ${i} has ${p.length} columns; CUFSM's prop is [mat#, Ex, Ey, vx, vy, G]`);
    p.forEach((v, k) => finite(v, `prop row ${i} column ${k}`));
    if (matIndex.has(trunc(p[0]))) throw bad(`prop: material number ${rs(p[0])} appears twice`);
    matIndex.set(trunc(p[0]), i);
    mats.push(p[1], p[2], p[3], p[4], p[5]);
  });
  const nodeIndex = new Map(), nodes = [];
  node.forEach((n, i) => {
    if (n.length !== 8) throw bad(`node row ${i} has ${n.length} columns; CUFSM's node is [node#, x, z, xdof, zdof, ydof, qdof, stress]`);
    n.forEach((v, k) => finite(v, `node row ${i} column ${k}`));
    if (nodeIndex.has(trunc(n[0]))) throw bad(`node: node number ${rs(n[0])} appears twice`);
    nodeIndex.set(trunc(n[0]), i);
    nodes.push(n[1], n[2], n[3] !== 0 ? 1 : 0, n[4] !== 0 ? 1 : 0, n[5] !== 0 ? 1 : 0, n[6] !== 0 ? 1 : 0, n[7]);
  });
  const nodeOf = (num, what) => {
    const k = nodeIndex.get(trunc(num));
    if (k === undefined) throw bad(`${what} refers to node ${rs(num)}, which is not in node`);
    return k;
  };
  const elems = [];
  elem.forEach((e, i) => {
    if (e.length !== 4 && e.length !== 5) throw bad(`elem row ${i} has ${e.length} columns; CUFSM's elem is [elem#, nodei, nodej, t, mat#]`);
    const what = `elem row ${i}`;
    let mat = 0;
    if (e.length === 5) {
      mat = matIndex.get(trunc(e[4]));
      if (mat === undefined) throw bad(`${what} refers to material ${rs(e[4])}, which is not in prop`);
    }
    const ni = nodeOf(e[1], what), nj = nodeOf(e[2], what);
    elems.push(ni, nj, finite(e[3], `${what} thickness`), mat);
  });
  const dof = (code, what) => {
    const c = trunc(code);
    if (c >= 1 && c <= 4) return c;
    throw bad(`${what}: DOF code ${c} is not 1 (x), 2 (z), 3 (y) or 4 (theta)`);
  };
  const cons = [];
  constraints.forEach((c, i) => {
    const what = `constraints row ${i}`;
    if (c.length !== 5) throw bad(`${what} has ${c.length} columns; CUFSM's constraints are [node#e, dofe, coeff, node#k, dofk]`);
    const ne = nodeOf(c[0], what), de = dof(c[1], what), co = finite(c[2], what);
    cons.push(ne, de, co, nodeOf(c[3], what), dof(c[4], what));
  });
  const sprs = [];
  springs.forEach((s, i) => {
    const what = `springs row ${i}`;
    if (s.length !== 10) throw bad(`${what} has ${s.length} columns; CUFSM's (v4.3) springs are [#, nodei, nodej, ku, kv, kw, kq, local, discrete, ys]`);
    s.forEach((v, k) => finite(v, `${what} column ${k}`));
    const ni = nodeOf(s[1], what);
    const nj = s[2] === 0 ? -1 : nodeOf(s[2], what);
    sprs.push(ni, nj, s[3], s[4], s[5], s[6], s[7] !== 0 ? 1 : 0, s[8] !== 0 ? 1 : 0, s[9]);
  });
  return {
    mats: Float64Array.from(mats), nodes: Float64Array.from(nodes), elems: Float64Array.from(elems),
    springs: Float64Array.from(sprs), constraints: Float64Array.from(cons),
  };
}

const parseBc = (bc) => {
  const s = String(bc).toUpperCase();
  if (!['S-S', 'C-C', 'S-C', 'C-S', 'C-F', 'F-C', 'C-G', 'G-C'].includes(s))
    throw bad(`boundary condition ${JSON.stringify(String(bc))} is not one of S-S, C-C, S-C, C-F, C-G`);
  return s;
};
const checkNeigs = (neigs) => {
  if (!Number.isInteger(neigs) || neigs < 0) throw bad(`neigs must be a whole number, got ${neigs}`);
  if (neigs === 0) throw bad('neigs must be at least 1');
  return neigs;
};
const checkLengths = (lengths) => {
  (lengths ?? []).forEach((a, i) => {
    if (!(typeof a === 'number' && Number.isFinite(a) && a > 0)) throw bad(`lengths[${i}] = ${rs(Number(a))} is not a positive length`);
  });
  return lengths;
};

/* CUFSM msort: the terms sorted, zeros and repeats dropped (stripmain does this first) */
const msort = (m) => [...new Set(m.filter((v) => v !== 0))].sort((a, b) => a - b);

const ORTH = { natural: 1, axial: 2, load: 3 };
const NORM = { none: 0, vector: 1, strain_energy: 2, work: 3 };
const OSPACE = { st: 1, k: 2, kg: 3, vector: 4 };

/* the package's spaces string as the engine's bits (1 G, 2 D, 4 L, 8 O), its parse_spaces messages */
function spaceBits(spaces) {
  let bits = 0;
  for (const ch of String(spaces)) {
    const c = ch.toUpperCase();
    const k = 'GDLO'.indexOf(c);
    if (k < 0 || c.length !== 1) throw bad(`spaces: '${c}' is not one of G, D, L, O`);
    bits |= 1 << k;
  }
  if (!bits) throw bad('spaces is empty: give some of G, D, L, O');
  return bits;
}

/* a whole number from 0 up, as the package's usize arguments */
const count = (v, name) => {
  if (!Number.isInteger(v) || v < 0) throw bad(`${name} must be a whole number, got ${v}`);
  return v;
};

export function createTransport(engine) {
  /* The engine's rows as the package's [L, m_terms, lfs, modes]. neigs is capped at the problem's
     size, 4 x nodes x terms: no length has more load factors than that, and the package's solver
     takes the same (complete) path for any neigs from there up, so the answer is the package's
     while the engine's output, sized by neigs, stays what it can hold. */
  function strip(b, lengths, mAll, bc, neigs, spaces) {
    if (!lengths.length) return [];
    const most = 4 * (b.nodes.length / 7) * Math.max(...mAll.map((m) => m.length));
    const out = engine.strip(b, { bc, mAll, spaces, neigs: Math.min(neigs, Math.max(most, 1)), lengths, classify: false });
    return out.map((r) => [r.L, r.m, r.modes.map((md) => md.lf), r.modes.map((md) => [...md.dofs])]);
  }

  const ops = {
    section_properties({ arrays }) {
      return engine.propsWn(buffersOf(arrays));
    },
    stress({ arrays, p = 0, mxx = 0, mzz = 0, m11 = 0, m22 = 0, b = 0, unsymmetric = true }) {
      const buf = buffersOf(arrays);
      return [...engine.stresgen(buf, { P: p, Mxx: mxx, Mzz: mzz, M11: m11, M22: m22, B: b, restrained: !unsymmetric })];
    },
    first_yield({ arrays, fy, unsymmetric = true, extreme_fibre = true }) {
      const b = buffersOf(arrays);
      const y = engine.firstYield(b, { fy, restrained: !unsymmetric, extremeFibre: !!extreme_fibre });
      return { fy, Py: y.Py, Mxx: y.Mxx, Mzz: y.Mzz, M11: y.M11, M22: y.M22, B: y.B };
    },
    stress_to_action({ arrays }) {
      return engine.stressToAction(buffersOf(arrays));
    },
    strip({ arrays, lengths, m_all, bc, neigs, spaces = null }) {
      const b = buffersOf(arrays);
      const bcs = parseBc(bc);
      checkNeigs(neigs);
      checkLengths(lengths);
      const bits = spaces == null ? 0 : spaceBits(spaces);
      if (!Array.isArray(m_all) || m_all.length !== lengths.length)
        throw bad(`invalid model: ${lengths.length} lengths but ${Array.isArray(m_all) ? m_all.length : 0} sets of longitudinal terms`);
      const mAll = m_all.map((m) => (Array.isArray(m) ? m : [m]).map(Number));
      // stripmain's own check, its message: a length whose terms are all zero (or none)
      const empty = mAll.findIndex((m) => !msort(m).length);
      if (empty >= 0) throw bad(`invalid model: no longitudinal terms at length ${rs(lengths[empty])}`);
      return strip(b, lengths, mAll, bcs, neigs, bits);
    },
    signature({ arrays, lengths = null, neigs = 1 }) {
      const b = buffersOf(arrays);
      checkNeigs(neigs);
      checkLengths(lengths);
      const ls = lengths ?? engine.signatureLengths(b);
      const rows = strip(b, ls, ls.map(() => [1]), 'S-S', neigs, 0);
      const minima = engine.signatureMinima(rows.map((r) => [r[0], r[2].length ? r[2][0] : NaN]));
      return [rows, minima];
    },
    classify({ arrays, results, bc, orth = 'axial', norm = 'vector', ospace = 'st' }) {
      const b = buffersOf(arrays);
      const bcs = parseBc(bc);
      const o = String(orth).toLowerCase(), nm = String(norm).toLowerCase(), os = String(ospace).toLowerCase();
      if (!Object.hasOwn(ORTH, o)) throw bad(`orth ${JSON.stringify(o)} is not natural, axial or load`);
      if (!Object.hasOwn(NORM, nm)) throw bad(`norm ${JSON.stringify(nm)} is not none, vector, strain_energy or work`);
      if (!Object.hasOwn(OSPACE, os)) throw bad(`ospace ${JSON.stringify(os)} is not st, k, kg or vector`);
      const ndof = 4 * arrays[1].length;
      const rows = (results ?? []).map(([L, mTerms, , vecs]) => {
        const want = ndof * mTerms.length;
        const wrong = vecs.find((md) => md.length !== want);
        if (wrong) throw bad(`a mode has ${wrong.length} entries; this model with ${mTerms.length} terms needs ${want}`);
        return { L, m: mTerms, modes: vecs };
      });
      if (!rows.length) return [];
      const cls = engine.classify(b, { bc: bcs, orth: ORTH[o], norm: NORM[nm], ospace: OSPACE[os], results: rows });
      let at = 0;
      return rows.map((r) => cls.slice(at, (at += r.modes.length)));
    },
    template({ shape, h, b1, b2, d1, d2, r1, r2, r3, r4, q1, q2, t, nh, nb1, nb2, nd1, nd2, nr1, nr2, nr3, nr4, centerline }) {
      const sh = String(shape).toUpperCase();
      if (sh !== 'C' && sh !== 'Z') throw bad(`shape ${JSON.stringify(sh)} is not C or Z`);
      for (const [name, v] of [['h', h], ['b1', b1], ['b2', b2], ['t', t]])
        if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) throw bad(`${name} = ${rs(Number(v))} must be positive`);
      for (const [name, v] of [['d1', d1], ['d2', d2], ['r1', r1], ['r2', r2], ['r3', r3], ['r4', r4]])
        if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw bad(`${name} = ${rs(Number(v))} must be zero or positive`);
      const n = { nh, nb1, nb2, nd1, nd2, nr1, nr2, nr3, nr4 };
      for (const [name, v] of Object.entries(n)) count(v, name);
      if (nh === 0 || nb1 === 0 || nb2 === 0) throw bad('nh, nb1 and nb2 must be at least 1');
      const m = engine.template([sh === 'C' ? 1 : 2, h, b1, b2, d1, d2, r1, r2, r3, r4, q1, q2, t,
        nh, nb1, nb2, nd1, nd2, nr1, nr2, nr3, nr4, centerline ? 1 : 0]);
      const node = [], elem = [];
      for (let i = 0; i < m.nodes.length / 7; i++) node.push([i + 1, ...m.nodes.subarray(7 * i, 7 * i + 7)]);
      for (let i = 0; i < m.elems.length / 4; i++) {
        const e = m.elems.subarray(4 * i, 4 * i + 4);
        elem.push([i + 1, e[0] + 1, e[1] + 1, e[2]]);
      }
      return [node, elem];
    },
  };

  function call(op, json) {
    try {
      const f = Object.hasOwn(ops, op) ? ops[op] : null;
      if (!f) throw bad(`unknown operation ${JSON.stringify(op)}`);
      const args = unpack(json == null || json === '' ? {} : JSON.parse(json));
      return JSON.stringify({ ok: pack(f(args)) });
    } catch (e) {
      const msg = String(e?.message ?? e);
      // A trap: the engine panicked (the package raises a PanicException there) or could not grow
      // its memory; wasm cannot tell the two apart. The call's buffers are freed, so the engine
      // usually carries on; Stop starts a fresh one.
      const trap = e instanceof WebAssembly.RuntimeError;
      const type = e instanceof PyError ? e.type : trap ? 'RuntimeError'
        : /out of memory|than the engine's memory can hold/.test(msg) ? 'MemoryError'
          : /^the elastic stiffness is not positive definite/.test(msg) ? 'MechanismError' : 'ValueError';
      const text = trap
        ? `the engine stopped (WebAssembly ${msg}): an internal error in the engine, or the problem is too large for the browser's memory; press Stop if the console misbehaves after this`
        : msg;
      return JSON.stringify({ error: { type, message: text } });
    }
  }
  return { call, ops: Object.keys(ops) };
}
