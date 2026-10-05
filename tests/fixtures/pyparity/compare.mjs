/* Parity comparison for the Python console's tests: our numbers against the fixtures CPython and
   cufsm-rs-py wrote (tools/pyparity/gen.py).

   The tolerance is 1e-9 relative. A scalar is compared relative to itself. A list of numbers (a
   mode vector, the nodal stresses, a row of load factors) is compared relative to its largest
   entry, the max-norm: a mode's zero entries carry round-off of order 1e-16 of its peak, and a
   relative test on them alone would compare noise. A mode shape's components (u, v, w, theta,
   and what ModeShape.at() sums from them) are compared relative to the mode's own largest
   entry, which the engine scales to 1 (opts.floor = 1): a component that is all round-off, such
   as v of a mode with no warping, is zero to that precision. NaN matches NaN only.

   Two documented exceptions, each reported by the tests with its measured size:
   - A mode vector may come back with the opposite sign when its two largest entries tie (+1 and
     -1 to within 1e-9): the engine scales a mode so its largest entry is +1, and which of two
     tied entries is "largest" is decided by the last bit. A sign flip is accepted only then.
   - Known platform divergence (LIBM_TOL): the package is native code on the system's libm and the
     page's engine is wasm on Rust's own libm; a last-bit difference in a
     transcendental function (sin, cos, atan2, hypot and the like) is amplified
     where the problem is ill-conditioned. Native cufsm-rs 0.4.1 built with Rust's libm
     reproduces the wasm's numbers, and with the system libm the package's. It shows above 1e-9 in the load factors and modes at long half-wavelengths, and in
     the cFSM classification percentages.

   The long-length cutoff is 50 times the widest strip: on the fixture models the divergence first
   passes 1e-9 between 63 and 322 times, so 50 sits below the earliest onset seen. The bounds are
   about 3 times the largest divergence measured (1.5e-4 at long lengths, 1.5e-7 in classify), so
   a real regression there still fails rather than hiding inside a loose bound.

   Two more of the same kind came with the engine's minor 1 exports (cufsm-rs 0.4.2), both on the
   unsymmetric two-material fixture only:
   - constrained: load factors and modes restricted to cFSM spaces (strip with spaces) that hold
     G or D, at 11 to 17 times the widest strip, well inside the long-length cutoff: up to 4.0e-7.
   - classifyEnergy: the classification with the strain-energy norm, up to 8.5e-6 (the other
     norms stay inside `classify`).
   Measured the same way as the first two (5 Oct 2026): cufsm-rs 0.4.2's C interface built natively
   reproduces the package's numbers exactly; built natively with Rust's libm (the libm crate's sin,
   cos, atan2, hypot and Apple's combined __sincos_stret, which LLVM emits for a sin and cos of
   one argument) it reproduces the wasm's to 1.5e-11. So the source is libm, not the version (0.4.2
   changes no analysis code from 0.4.1). The bounds are again about 3 times the largest measured. */
export const TOL = 1e-9;
export const LIBM_TOL = { longLength: 5e-4, classify: 5e-7, constrained: 1.2e-6, classifyEnergy: 2.5e-5 };

export function unmark(v) {
  if (Array.isArray(v)) return v.map(unmark);
  if (v === 'NaN') return NaN;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmark(x)]));
  return v;
}

const isNums = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'number');
const peakOf = (a) => a.reduce((m, x) => (Number.isFinite(x) ? Math.max(m, Math.abs(x)) : m), 0);

function diff(a, e, scale) {
  if (Number.isNaN(e)) return Number.isNaN(a) ? 0 : Infinity;
  if (!Number.isFinite(e)) return a === e ? 0 : Infinity;
  if (typeof a !== 'number' || !Number.isFinite(a)) return Infinity;
  return scale > 0 ? Math.abs(a - e) / scale : Math.abs(a - e) === 0 ? 0 : Infinity;
}

/* the largest relative difference anywhere in two matching structures (a tied mode vector is
   measured with its sign either way, as compare accepts it) */
export function worst(a, e, floor = 0) {
  if (typeof e === 'number') return diff(a, e, Math.max(Math.abs(e), floor));
  if (isNums(e)) {
    if (!Array.isArray(a) || a.length !== e.length) return Infinity;
    const p = Math.max(peakOf(e), floor);
    const w = e.reduce((m, x, i) => Math.max(m, diff(a[i], x, p)), 0);
    // a tied mode vector may be flipped (see above): measure it the way compare accepts it
    return tied(e) ? Math.min(w, e.reduce((m, x, i) => Math.max(m, diff(-a[i], x, p)), 0)) : w;
  }
  if (Array.isArray(e)) {
    if (!Array.isArray(a) || a.length !== e.length) return Infinity;
    return e.reduce((m, x, i) => Math.max(m, worst(a[i], x, floor)), 0);
  }
  if (e && typeof e === 'object') {
    if (!a || typeof a !== 'object') return Infinity;
    return Object.keys(e).reduce((m, k) => Math.max(m, worst(a[k], e[k], floor)), 0);
  }
  return a === e ? 0 : Infinity;
}

/* a normalisation tie: the expected vector's largest entry is +peak and another is -peak */
export const tied = (e) => { const p = peakOf(e); return p > 0 && e.some((x) => x <= -(1 - TOL) * p); };

/* throws, naming the first place that differs by more than tol; opts.flips collects the paths
   where a tied mode vector was accepted with the opposite sign */
export function compare(a, e, where = '', opts = {}) {
  const tol = opts.tol ?? TOL;
  if (typeof e === 'number' || isNums(e)) {
    const floor = opts.floor ?? 0;
    const p = isNums(e) ? Math.max(peakOf(e), floor) : 0;
    const w = isNums(e) && Array.isArray(a) && a.length === e.length
      ? e.reduce((m, x, i) => Math.max(m, diff(a[i], x, p)), 0) : worst(a, e, floor);
    if (!(w <= tol) && isNums(e) && tied(e) && Array.isArray(a) && worst(a, e, floor) <= tol) {
      opts.flips?.push(where);
      return;
    }
    if (!(w <= tol)) throw new Error(`${where}: relative difference ${w}\n  ours ${JSON.stringify(a)?.slice(0, 400)}\n  pip  ${JSON.stringify(e)?.slice(0, 400)}`);
    return;
  }
  if (Array.isArray(e)) {
    if (!Array.isArray(a) || a.length !== e.length)
      throw new Error(`${where}: length ${Array.isArray(a) ? a.length : typeof a}, pip ${e.length}`);
    e.forEach((x, i) => compare(a[i], x, `${where}[${i}]`, opts));
    return;
  }
  if (e && typeof e === 'object') {
    if (!a || typeof a !== 'object') throw new Error(`${where}: not an object`);
    const ka = Object.keys(a).sort().join(), ke = Object.keys(e).sort().join();
    if (ka !== ke) throw new Error(`${where}: keys ${ka}, pip ${ke}`);
    for (const k of Object.keys(e)) compare(a[k], e[k], `${where}.${k}`, opts);
    return;
  }
  if (a !== e) throw new Error(`${where}: ${JSON.stringify(a)} vs pip ${JSON.stringify(e)}`);
}
