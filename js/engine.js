/* The cufsm-rs engine (ABI 2, minor 1 or later) behind plain functions. Runs in the browser, a
   worker and Node. Minor 1 adds the Python console's exports (strip, classify, template, propsWn,
   signatureLengths, signatureMinima); the GUI's own calls use the minor 0 exports, unchanged. */
const ABI = 2, MINOR = 1;

export async function loadEngine(source) {
  let bytes = source;
  if (typeof source === 'string' || source instanceof URL) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`cufsm.wasm: HTTP ${res.status}`);
    bytes = await res.arrayBuffer();
  }
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const e = instance.exports;
  if (typeof e.cufsm_abi_version !== 'function' || e.cufsm_abi_version() !== ABI)
    throw new Error(`cufsm.wasm is not ABI ${ABI}: rebuild it with node build-wasm.mjs`);
  const minor = typeof e.cufsm_abi_minor === 'function' ? e.cufsm_abi_minor() : 0;   // none: minor 0
  if (!(minor >= MINOR))
    throw new Error(`cufsm.wasm is ABI ${ABI} minor ${minor}, not ${MINOR} or later: rebuild it with node build-wasm.mjs`);
  return new Engine(e);
}

export class Engine {
  constructor(e) { this.e = e; }

  #err() {
    const p = this.e.cufsm_last_error_ptr(), n = this.e.cufsm_last_error_len();
    return p && n ? new TextDecoder().decode(new Uint8Array(this.e.memory.buffer, p, n)) : 'unknown engine error';
  }

  /* alloc every input, run fn(ptrs..., out, cap), copy out, free everything on every path */
  #call(fn, inputs, cap) {
    const e = this.e, held = [];
    const put = (arr, bytesPer) => {
      const n = Math.max(arr.length * bytesPer, 1);
      const p = e.cufsm_alloc(n);
      if (!p) throw new Error('the engine is out of memory');
      held.push([p, n]);
      if (bytesPer === 8) new Float64Array(e.memory.buffer, p, arr.length).set(arr);
      else new Uint8Array(e.memory.buffer, p, arr.length).set(arr);
      return p;
    };
    try {
      const args = [];
      for (const x of inputs) {
        if (x instanceof Uint8Array) args.push(put(x, 1), x.length);
        else args.push(put(x, 8), x.length);
      }
      // an output this platform cannot address (wasm32: 4 GB) is refused before the size wraps
      if (!(cap * 8 < 2 ** 32)) throw new Error('the requested output is larger than the engine\'s memory can hold');
      const op = e.cufsm_alloc(cap * 8);
      if (!op) throw new Error('the engine is out of memory');
      held.push([op, cap * 8]);
      const n = fn(...args, op, cap);
      if (n < 0) throw new Error(this.#err());
      return new Float64Array(e.memory.buffer.slice(op, op + n * 8));
    } finally {
      for (const [p, n] of held) e.cufsm_dealloc(p, n);
    }
  }

  #model(b) { return [b.mats, b.nodes, b.elems]; }
  #bc(s) { return new TextEncoder().encode(s); }

  signature(b, { bc, terms, spaces, lengths }) {
    const lens = Float64Array.from(lengths);
    const stride = 2 + [1, 2, 4, 8].filter((k) => spaces & k).length;
    return this.#call(this.e.cufsm_signature,
      [Float64Array.from([terms, spaces, 1]), ...this.#model(b), this.#bc(bc), lens, b.springs, b.constraints],
      lens.length * stride);
  }

  modes(b, { bc, terms, neigs, lengths }) {
    const lens = Float64Array.from(lengths);
    const nn = b.nodes.length / 7;
    const blk = 5 + 4 * nn * terms, per = 2 + terms + neigs * blk;
    const raw = this.#call(this.e.cufsm_modes,
      [Float64Array.from([terms, 0, neigs]), ...this.#model(b), this.#bc(bc), lens, b.springs, b.constraints],
      lens.length * per);
    return [...lens].map((L, i) => {
      const r = raw.subarray(i * per, (i + 1) * per);
      const found = r[0], nt = r[1];
      const modes = [];
      for (let k = 0; k < found; k++) {
        const o = 2 + nt + k * blk;
        modes.push({ lf: r[o], cls: [...r.subarray(o + 1, o + 5)], dofs: r.slice(o + 5, o + blk) });
      }
      return { L, found, m: [...r.subarray(2, 2 + nt)], modes };
    });
  }

  props(b) {
    const r = this.#call(this.e.cufsm_props, this.#model(b), 15);
    const k = ['A', 'xcg', 'zcg', 'Ixx', 'Izz', 'Ixz', 'thetap', 'I11', 'I22', 'J', 'xs', 'zs', 'Cw', 'B1', 'B2'];
    return Object.fromEntries(k.map((name, i) => [name, r[i]]));
  }

  stresgen(b, { P = 0, Mxx = 0, Mzz = 0, M11 = 0, M22 = 0, B = 0, restrained = false }) {
    return this.#call(this.e.cufsm_stresgen,
      [...this.#model(b), Float64Array.from([P, Mxx, Mzz, M11, M22, B, restrained ? 1 : 0])],
      b.nodes.length / 7);
  }

  firstYield(b, { fy, restrained = false, extremeFibre = true }) {
    const r = this.#call(this.e.cufsm_yield,
      [...this.#model(b), Float64Array.from([fy, restrained ? 1 : 0, extremeFibre ? 1 : 0])], 6);
    return { Py: r[0], Mxx: r[1], Mzz: r[2], M11: r[3], M22: r[4], B: r[5] };
  }

  stressToAction(b) {
    const r = this.#call(this.e.cufsm_stress_to_action, this.#model(b), 5);
    return { P: r[0], M11: r[1], M22: r[2], B: r[3], err: r[4] };
  }

  /* cufsm_strip: modes at each length, rows as modes() returns them. Either terms (1..terms at
     every length) or mAll, one list of terms per length (any values: the engine sorts them and
     drops zeros and repeats, and each row reports the terms it used). spaces: 0 free, else the
     bits 1 G, 2 D, 4 L, 8 O together are the one cFSM space the analysis is restricted to.
     classify false writes NaN for the G, D, L, O percentages and skips the work. */
  strip(b, { bc, terms = 0, mAll = null, spaces = 0, neigs, lengths, classify = true }) {
    const lens = Float64Array.from(lengths);
    const nn = b.nodes.length / 7;
    const lists = mAll ?? Array.from(lens, () => Array.from({ length: terms }, (_, k) => k + 1));
    // the rows' sizes from the lists as given: msort only shortens them, so this bounds the output
    const cap = lists.reduce((s, m) => s + 2 + m.length + neigs * (5 + 4 * nn * m.length), 0);
    const flat = mAll ? Float64Array.from(mAll.flatMap((m) => [m.length, ...m])) : new Float64Array(0);
    const raw = this.#call(this.e.cufsm_strip,
      [Float64Array.from([mAll ? 0 : terms, spaces, neigs, classify ? 1 : 0]), ...this.#model(b), this.#bc(bc),
       lens, flat, b.springs, b.constraints], cap);
    const out = [];
    let at = 0;
    for (const L of lens) {
      const found = raw[at], nt = raw[at + 1];
      const blk = 5 + 4 * nn * nt;
      const modes = [];
      for (let k = 0; k < found; k++) {
        const o = at + 2 + nt + k * blk;
        modes.push({ lf: raw[o], cls: [...raw.subarray(o + 1, o + 5)], dofs: raw.slice(o + 5, o + blk) });
      }
      out.push({ L, found, m: [...raw.subarray(at + 2, at + 2 + nt)], modes });
      at += 2 + nt + neigs * blk;
    }
    return out;
  }

  /* cufsm_classify: G, D, L, O percent of given modes. results: [{ L, m: [terms], modes: [dofs] }];
     orth 1 natural, 2 axial, 3 load; norm 0 none, 1 vector, 2 strain energy, 3 work; ospace 1 ST,
     2 K, 3 Kg, 4 vector (CUFSM's codes; its defaults 2, 1, 1). One [G, D, L, O] per mode, in order. */
  classify(b, { bc, orth = 2, norm = 1, ospace = 1, results }) {
    const flat = [];
    let count = 0;
    for (const r of results) {
      flat.push(r.L, r.m.length, ...r.m, r.modes.length);
      for (const d of r.modes) for (const v of d) flat.push(v);
      count += r.modes.length;
    }
    const raw = this.#call(this.e.cufsm_classify,
      [Float64Array.from([orth, norm, ospace]), ...this.#model(b), this.#bc(bc), Float64Array.from(flat),
       b.springs, b.constraints], 4 * count);
    return Array.from({ length: count }, (_, k) => [...raw.subarray(4 * k, 4 * k + 4)]);
  }

  /* cufsm_template: CUFSM's templatecalc. params: the 23 values [shape (1 C, 2 Z), h, b1, b2, d1,
     d2, r1..r4, q1, q2, t, nh, nb1, nb2, nd1, nd2, nr1..nr4, centerline]. Returns the engine's own
     0-based buffers: { nodes (7 each), elems (4 each) }. */
  template(params) {
    const p = Float64Array.from(params);
    const s = p.slice(13, 22).reduce((a, n) => a + (Number.isFinite(n) && n > 0 ? n : 0), 0);
    const raw = this.#call(this.e.cufsm_template, [p], 2 + 7 * (s + 1) + 4 * s);
    const nn = raw[0], ne = raw[1];
    return { nodes: raw.slice(2, 2 + 7 * nn), elems: raw.slice(2 + 7 * nn, 2 + 7 * nn + 4 * ne) };
  }

  /* props() and the warping function wn at each node (cutwp_prop2) */
  propsWn(b) {
    const nn = b.nodes.length / 7;
    const r = this.#call(this.e.cufsm_props_wn, this.#model(b), 15 + nn);
    const k = ['A', 'xcg', 'zcg', 'Ixx', 'Izz', 'Ixz', 'thetap', 'I11', 'I22', 'J', 'xs', 'zs', 'Cw', 'B1', 'B2'];
    return { ...Object.fromEntries(k.map((name, i) => [name, r[i]])), wn: [...r.subarray(15)] };
  }

  /* CUFSM signature_ss's 100 half-wavelengths for the model */
  signatureLengths(b) {
    return [...this.#call(this.e.cufsm_signature_lengths, this.#model(b), 100)];
  }

  /* the interior local minima of a curve, [[L, lf], ...] in, [[L, lf], ...] out (lf NaN: none there) */
  signatureMinima(curve) {
    if (!curve.length) return [];
    const raw = this.#call(this.e.cufsm_signature_minima, [Float64Array.from(curve.flat())],
      Math.max(2 * curve.length - 4, 0));
    return Array.from({ length: raw.length / 2 }, (_, k) => [raw[2 * k], raw[2 * k + 1]]);
  }

  ftm(params, terms, cap) {
    return this.#call(this.e.cufsm_ftm, [Float64Array.from(params), Float64Array.from(terms)], cap);
  }
}
