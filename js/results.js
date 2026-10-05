/* The minima finder for a signature curve, shared by the GUI (app.js) and by the extension
   capabilities (js/ext/capabilities.js): one implementation, so a module's minima and the
   drawn curve's minima can never disagree.

   curve: [[length, loadFactor], ...] in engine order.
   Returns [{ index, length, lf }]: interior local minima, plus a still-falling last point
   (the global governs at long lengths), and - for a monotone curve - the governing point
   itself, because there the lowest drawn point is the answer. */
export function findMinima(curve) {
  const n = curve.length;
  const out = [];
  if (!n) return out;
  const lf = (i) => Number(curve[i][1]);
  for (let i = 1; i < n - 1; i++)
    if (lf(i) <= lf(i - 1) && lf(i) < lf(i + 1)) out.push({ index: i, length: Number(curve[i][0]), lf: lf(i) });
  if (n > 1 && lf(n - 1) < lf(n - 2)) out.push({ index: n - 1, length: Number(curve[n - 1][0]), lf: lf(n - 1) });
  if (!out.length) {                             // monotone curve: the governing point is a "minimum"
    let k = 0;
    for (let i = 1; i < n; i++) if (lf(i) < lf(k)) k = i;
    out.push({ index: k, length: Number(curve[k][0]), lf: lf(k) });
  }
  return out;
}

/* The factor a mode shape's section-plane displacements (dx, dz per node, in the engine's own
   normalisation) are multiplied by before drawing, in section units: the largest in-plane
   displacement becomes frac of the section's size, whatever the units (an inch C and a mm C look
   alike). The engine's modes come normalised so their largest x or z entry is 1; one whose
   in-plane part is tiny (a really longitudinal mode, left un-normalised) is divided by 1, not by
   its own peak, so it is drawn as small as it is. */
export function deformScale(dx, dz, size, frac = 0.1) {
  let peak = 0;
  for (let i = 0; i < dx.length; i++) peak = Math.max(peak, Math.hypot(dx[i], dz[i]));
  return frac * size / Math.max(peak, 1);
}

/* Minima that are one buckling mode recurring: with General BC and several longitudinal terms a
   local (or distortional) mode reappears at multiples of its own half-wavelength with the same
   load factor. minima: [{ index, length, lf, fam }] in length order. A run of minima of the same
   family whose load factors are within tol of the run's first collapses into that first (the
   shortest length), which lists the others in also. A different family breaks the run. */
export function collapseMinima(minima, tol = 0.01) {
  const out = [];
  for (const m of minima) {
    const head = out[out.length - 1];
    if (head && head.fam === m.fam && Math.abs(m.lf - head.lf) <= tol * Math.abs(head.lf)) head.also.push(m.length);
    else out.push({ ...m, also: [] });
  }
  return out;
}
