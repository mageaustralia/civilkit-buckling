/* The drawings of a section, a mode shape and a signature chart, as SVG: the GUI's (app.js) and
   the Python console's figures (js/py/figures.js) are drawn by this one code, so a console figure
   looks exactly like the page's own drawing and follows both themes (the classes are styled by
   styles.css: .sect for a section, svg.chart for a chart).

   Pure of the app's state: everything a drawing depends on comes in as arguments. It needs a
   DOM (document.createElementNS) and nothing else.

   geometry(model)                   the drawing's view of a model { nodes: [{x, z, free, stress}], elems: [{i, j, t}] }
   engineModel(g)                    the engine-node view of a geometry, for a mode's displacements
   modeXZ(md, amp)                   a mode's section-plane displacement per engine node
   fit(g, w, h, pad)                 section units -> drawing units
   drawSection(svg, g, opt)          a section, optionally its stress or a deformed mode over it
   ampAt / deformedPaths             the deformed shape's polylines
   drawChartCore(svg, cfg)           a chart's static drawing (log x, minima and their labels) */
import { deformScale } from './results.js';
import { placeLabels } from './labels.js';

export const SVG = 'http://www.w3.org/2000/svg';
/* Min and max by a loop: Math.min(...arr) passes every element as an argument and overflows the
   call stack on a large array (about 120 k entries in Chromium). */
export const minOf = (a, init = Infinity) => { let v = init; for (const x of a) if (x < v) v = x; return v; };
export const maxOf = (a, init = -Infinity) => { let v = init; for (const x of a) if (x > v) v = x; return v; };

/* the drawing's view of a model: the one on screen, or one an extension proposes or draws */
export function geometry(model) {
  const nodes = model.nodes.map((n) => [n.x, n.z]);
  const elems = model.elems.map((e) => [e.i, e.j]);
  const free = model.nodes.map((n) => (n.free || [1, 1, 1, 1]).map(Number));
  const stress = model.nodes.map((n) => (Number.isFinite(n.stress) ? n.stress : 0));
  const t = model.elems.map((e) => e.t);
  const dirs = elems.map(([a, b]) => {
    const dx = nodes[b][0] - nodes[a][0], dy = nodes[b][1] - nodes[a][1];
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L, L];
  });
  const normals = dirs.map(([dx, dy]) => [-dy, dx]);
  // node normal = sum of adjacent element normals (keeps the mode shape continuous at corners)
  const nn = nodes.map(() => [0, 0]);
  const degree = nodes.map(() => 0);
  elems.forEach(([a, b], i) => {
    nn[a][0] += normals[i][0]; nn[a][1] += normals[i][1];
    nn[b][0] += normals[i][0]; nn[b][1] += normals[i][1];
    degree[a]++; degree[b]++;
  });
  const nnorm = nn.map((v) => { const L = Math.hypot(v[0], v[1]); return L < 1e-9 ? [0, 1] : [v[0] / L, v[1] / L]; });
  // centroid (area weighted by strip length, each strip at its own thickness)
  let A = 0, cx = 0, cz = 0;
  elems.forEach(([a, b], i) => {
    const w = dirs[i][2] * t[i]; const mx = (nodes[a][0] + nodes[b][0]) / 2, mz = (nodes[a][1] + nodes[b][1]) / 2;
    A += w; cx += w * mx; cz += w * mz;
  });
  const xs = nodes.map((n) => n[0]), zs = nodes.map((n) => n[1]);
  const bb = nodes.length ? { xmin: minOf(xs), xmax: maxOf(xs),
                              zmin: minOf(zs), zmax: maxOf(zs) } : { xmin: 0, xmax: 1, zmin: 0, zmax: 1 };
  bb.w = bb.xmax - bb.xmin; bb.h = bb.zmax - bb.zmin;
  return { nodes, elems, free, stress, t, dirs, normals, nn: nnorm, degree, A,
           cx: A ? cx / A : 0, cz: A ? cz / A : 0, bb };
}

/* The model for the drawing and the mode shapes: one chain per element, corner[i] = the
   engine's node index of node i (the identity — nothing subdivides the model any more). */
export function engineModel(g) {
  const flat = [], elems = [], chains = [];
  const corner = g.nodes.map((_, i) => i);
  g.nodes.forEach((n, i) =>
    flat.push(n[0], n[1], g.stress[i] ?? 1, g.free[i][0] ? 1 : 0, g.free[i][1] ? 1 : 0));
  g.elems.forEach(([a, b]) => { elems.push(a, b); chains.push([a, b]); });
  return { flat, elems, chains, corner, nodes: g.nodes.length };
}

/* Section-plane displacement per engine node. One term's block of 4·nn is
   [x₀ y₀ x₁ y₁ … | z₀ θ₀ z₁ θ₁ …] (CUFSM's order: x and longitudinal interleaved,
   then z and rotation); `amp` holds one scalar per term. */
export function modeXZ(md, amp) {
  const nn = md.nn, dx = new Float64Array(nn), dz = new Float64Array(nn);
  for (let mI = 0; mI < md.nt; mI++) {
    const w = amp[mI];
    if (!w) continue;
    const base = 4 * nn * mI;
    for (let v = 0; v < nn; v++) {
      dx[v] += md.data[base + 2 * v] * w;
      dz[v] += md.data[base + 2 * nn + 2 * v] * w;
    }
  }
  return { dx, dz };
}

/* ------------------------------------------------------------- drawing */
export function fit(g, w, h, pad) {
  const xs = g.nodes.map((n) => n[0]), zs = g.nodes.map((n) => n[1]);
  const x0 = minOf(xs), x1 = maxOf(xs), z0 = minOf(zs), z1 = maxOf(zs);
  const sx = (w - 2 * pad) / Math.max(x1 - x0, 1), sz = (h - 2 * pad) / Math.max(z1 - z0, 1);
  const s = Math.min(sx, sz);
  const ox = pad + ((w - 2 * pad) - (x1 - x0) * s) / 2, oz = pad + ((h - 2 * pad) - (z1 - z0) * s) / 2;
  const map = (x, z) => [ox + (x - x0) * s, h - (oz + (z - z0) * s)];
  return { s, map, x0, x1, z0, z1 };
}

function stripQuad(g, i, fitr, tDefault) {
  const [a, b] = g.elems[i], [dx, dy] = g.dirs[i], n = g.normals[i];
  const ht = (g.t[i] ?? tDefault) / 2;
  const p = (node, sgn) => fitr.map(g.nodes[node][0] + n[0] * ht * sgn, g.nodes[node][1] + n[1] * ht * sgn);
  return [p(a, 1), p(b, 1), p(b, -1), p(a, -1)].map((q) => q.join(',')).join(' ');
}

/* opt, besides the GUI's own (keep, pad, fitTo, view, cls, grid, selElem, selNode, stress,
   deformed, dims):
     tDefault        the thickness of a strip that carries none
     lip: {b, h, d}  the lipped channel's lip, dimensioned on its own (null: none)
     labels          node labels: undefined numbers them 1, 2, ...; false draws none; an array, its texts
     hits            false: no tap/drag targets (a drawing that is not the editable section) */
export function drawSection(svg, g, opt = {}) {
  const vb = svg.viewBox.baseVal;
  const W = vb.width, H = vb.height;
  if (!opt.keep) svg.innerHTML = '';       // keep: draw over what is there (a proposal's ghost)
  const fitr = fit(opt.fitTo ?? g, W, H, opt.pad ?? 34);
  let root = svg;
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    (parent || root).appendChild(e);
    return e;
  };
  /* the main drawing's zoom and pan: everything sits in one group the gestures transform; --k
     undoes the scale for dots, hit circles and text, so they keep their size on screen */
  if (opt.view) {
    root = el('g', { class: 'view', transform: `translate(${opt.view.tx} ${opt.view.ty}) scale(${opt.view.s})` });
    root.style.setProperty('--k', String(1 / opt.view.s));
  }
  if (opt.cls) root = el('g', { class: opt.cls });
  if (opt.grid) {
    const gg = el('g', { class: 'grid' });
    for (let i = 1; i < 4; i++) {
      el('line', { x1: W * i / 4, y1: 0, x2: W * i / 4, y2: H }, gg);
      el('line', { x1: 0, y1: H * i / 4, x2: W, y2: H * i / 4 }, gg);
    }
  }
  const smax = maxOf((g.stress || [1]).map(Math.abs), 1e-9);
  for (let i = 0; i < g.elems.length; i++) {
    const poly = el('polygon', { class: 'strip' + (opt.selElem === i ? ' sel' : ''), points: stripQuad(g, i, fitr, opt.tDefault), 'data-elem': i });
    if (opt.stress) {
      const [a, b] = g.elems[i];
      const s = (g.stress[a] + g.stress[b]) / 2;
      poly.style.fill = s >= 0 ? 'var(--comp)' : 'var(--tens)';
      if (s < 0) poly.classList.add('tens');          // dashed: tension is not told by hue alone
      poly.style.fillOpacity = (0.12 + 0.88 * Math.abs(s) / smax).toFixed(2);
    }
  }
  if (opt.deformed) {
    const d = deformedPaths(g, fitr, opt.deformed.fam, opt.deformed.phase,
                            opt.deformed.mode, opt.deformed.em);
    for (const [a, b] of g.elems) {
      const [pa, pb] = [fitr.map(...g.nodes[a]), fitr.map(...g.nodes[b])];
      el('polyline', { class: 'undeformed', points: [pa, pb].map((q) => q.join(',')).join(' ') });
    }
    for (const poly of d) el('polyline', { class: 'deformed', points: poly });
  }
  g.nodes.forEach((n, i) => {
    const [x, y] = fitr.map(n[0], n[1]);
    const pinned = !g.free[i][0] && !g.free[i][1];
    el('circle', { class: 'node' + (pinned ? ' pin' : '') + (opt.selNode === i ? ' sel' : ''), cx: x, cy: y, r: 3.4 });
    if (opt.labels !== false) {
      const tx = el('text', { class: 'nlabel', x: x + 6, y: y - 5 });
      tx.textContent = opt.labels ? opt.labels[i] : i + 1;
    }
    if (opt.hits === false) return;
    // transparent hit target: tap to pin, drag to move (bigger than the visible dot)
    const hit = el('circle', { class: 'hit', cx: x, cy: y, r: 12, 'data-node': i });
    const ttl = document.createElementNS(SVG, 'title');
    ttl.textContent = pinned ? `node ${i + 1} pinned — tap to release, drag to move`
                             : `node ${i + 1} — tap to pin x/z, drag to move`;
    hit.appendChild(ttl);
  });
  // dimensions (rc-section style): height at the left, width at the top,
  // and the lip on its own for the lipped channel
  if (opt.dims !== false) {
    const [lx] = fitr.map(fitr.x0, fitr.z0);
    const [rx] = fitr.map(fitr.x1, fitr.z0);
    const topY = fitr.map(fitr.x0, fitr.z1)[1];
    const botY = fitr.map(fitr.x0, fitr.z0)[1];
    const Wd = fitr.x1 - fitr.x0, Hd = fitr.z1 - fitr.z0;
    const fmtD = (v) => Math.round(v * 10) / 10;
    if (Hd > 1e-9) {
      const x = lx - 20;
      el('path', { class: 'dim', d: `M${x - 5},${botY}H${x + 5}M${x - 5},${topY}H${x + 5}M${x},${botY}V${topY}` });
      const ty = (botY + topY) / 2;
      const t = el('text', { class: 'dimtext', x: x - 7, y: ty, 'text-anchor': 'middle',
                             transform: `rotate(-90 ${x - 7} ${ty})` });
      t.textContent = fmtD(Hd);
    }
    if (Wd > 1e-9) {
      const y = topY - 20;
      el('path', { class: 'dim', d: `M${lx},${y - 5}V${y + 5}M${rx},${y - 5}V${y + 5}M${lx},${y}H${rx}` });
      const t = el('text', { class: 'dimtext', x: (lx + rx) / 2, y: y - 7, 'text-anchor': 'middle' });
      t.textContent = fmtD(Wd);
    }
    const lipD = opt.lip;
    if (lipD) {                                  // the two lips, beside their own edges
      const x = rx + 20;
      const lip = (z0, z1) => {
        const y0 = fitr.map(lipD.b, z0)[1], y1 = fitr.map(lipD.b, z1)[1];
        el('path', { class: 'dim', d: `M${x - 5},${y0}H${x + 5}M${x - 5},${y1}H${x + 5}M${x},${y0}V${y1}` });
        const ty = (y0 + y1) / 2;
        const t = el('text', { class: 'dimtext', x: x + 7, y: ty, 'text-anchor': 'middle',
                               transform: `rotate(-90 ${x + 7} ${ty})` });
        t.textContent = fmtD(lipD.d);
      };
      lip(lipD.h, lipD.h - lipD.d);
      lip(0, lipD.d);
    }
  }
  const [cx, cy] = fitr.map(g.cx, g.cz);
  el('path', { class: 'cg', d: `M${cx - 7},${cy}h14M${cx},${cy - 7}v14` });
  return fitr;
}

/* per-sample amplitude of the mode shape on element i at parameter u */
export function ampAt(g, i, u, fam) {
  if (fam === 'local') return Math.sin(Math.PI * u);
  if (fam === 'glob') return 1;
  // distortional: 0 on the web, growing through flange to lip (distance from the longest strip)
  let web = 0;
  g.dirs.forEach(([dx, dy, L], k) => { void dx; void dy; if (L > g.dirs[web][2]) web = k; });
  const [a, b] = g.elems[i];
  const wn = g.normals[web], wa = g.nodes[g.elems[web][0]];
  const dist = (p) => Math.abs((p[0] - wa[0]) * wn[1] - (p[1] - wa[1]) * wn[0]);
  const ds = g.nodes.map(dist);
  const dmax = maxOf(ds, 1e-9);
  const f = (idx) => dmax < 1e-6 ? 1 : ds[idx] / dmax;
  return f(a) + (f(b) - f(a)) * u;
}

/* Displaced polylines: sampled per element so the plates can bow.
   With an engine mode, the endpoints move by the mode's own section-plane
   displacements (per term, at wave phase); with no mode supplied, a fixed
   illustrative deflection is drawn (only ever reached before a solve).
   mode.scale, when given, is the factor on the displacements (section units per unit of mode);
   without it the largest in-plane displacement is drawn at 10 % of the section's size. */
export function deformedPaths(g, fitr, fam, phase, mode, em) {
  /* in section units: fitr.map turns them into pixels, so the scale must not carry fitr.s too
     (it did, which blew an inch-scale section's mode far outside the drawing) */
  const size = Math.max(fitr.x1 - fitr.x0, fitr.z1 - fitr.z0);
  let scale = 0.1 * size;
  if (mode && em) {
    const { dx, dz } = modeXZ(mode, mode.ms.map((m) => Math.cos(m * phase)));
    if (mode.scale != null) scale = mode.scale;
    else {
      const at0 = modeXZ(mode, mode.ms.map(() => 1));     // the peak at phase 0 sets the scale
      scale = deformScale(at0.dx, at0.dz, size);
    }
    // every engine node along the strip — the bow lives in the interior nodes
    return em.chains.map((ch) => ch.map((ei) =>
      fitr.map(em.flat[ei * 5] + dx[ei] * scale,
               em.flat[ei * 5 + 1] + dz[ei] * scale).join(',')).join(' '));
  }
  const ph = Math.cos(phase);
  return g.elems.map(([a, b], i) => {
    const [ax, az] = g.nodes[a], [bx, bz] = g.nodes[b];
    const [nax, naz] = g.nn[a], [nbx, nbz] = g.nn[b];
    const out = [];
    const N = 14;
    for (let k = 0; k <= N; k++) {
      const u = k / N;
      let dx, dz;
      if (fam === 'glob') {
        // rigid-ish: rotate the section a few degrees about its centroid
        const x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        const th = 0.09 * ph, ca = Math.cos(th), sa = Math.sin(th);
        const rx = (x - g.cx) * ca - (z - g.cz) * sa + g.cx;
        const rz = (x - g.cx) * sa + (z - g.cz) * ca + g.cz;
        out.push(fitr.map(rx, rz));
        continue;
      }
      const nx = nax + (nbx - nax) * u, nz = naz + (nbz - naz) * u;
      const L = Math.hypot(nx, nz) || 1;
      const w = ampAt(g, i, u, fam) * scale * ph;
      dx = (nx / L) * w; dz = (nz / L) * w;
      const x = ax + (bx - ax) * u, z = az + (bz - az) * u;
      out.push(fitr.map(x + dx, z + dz));
    }
    return out.map((q) => q.join(',')).join(' ');
  });
}

/* ------------------------------------------------------------------ chart
   The chart's drawing: a log x axis (decades with 2 and 5 minors), log y when every value is
   positive (quarters on a linear axis otherwise), the series and the minima with their labels,
   placed so none prints over another (js/labels.js). The GUI's chart (app.js drawChart) adds the
   hover, scrub and keyboard readout on top of what this returns.

   cfg: points [{L, y}] (the x range), series [{points, cls}], markers [{i} (an index into points)
   or {L, y}, sel, label], xlabel, ylabel, fmt(v) and unit for a value's text, and markLabel(p, k),
   a marker's label when it carries none. */
export function drawChartCore(svg, cfg) {
  const W = 600, H = 340, m = { l: 54, r: 18, t: 16, b: 40 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(SVG, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    svg.appendChild(e);
    return e;
  };
  const xs = cfg.points[0].L, xe = cfg.points[cfg.points.length - 1].L;
  const lx0 = Math.log10(xs), lx1 = Math.log10(xe);
  // engine series can be NaN where a space does not exist — the axis must ignore it
  const ys = cfg.series.flatMap((s) => s.points.map((p) => p.y)).filter(Number.isFinite);
  // Buckling curves span decades (σ_cr at a 10 mm half-wave vs at 5 m), and a linear
  // axis would flatten every minimum against the floor — log y when everything is > 0.
  const yMin = minOf(ys), yMax = maxOf(ys);
  const logY = ys.length > 0 && yMin > 0;
  let ylo = 0, yhi = Math.max(yMax, 1) * 1.06;
  if (logY) {
    ylo = Math.pow(10, Math.floor(Math.log10(yMin)));
    yhi = Math.pow(10, Math.ceil(Math.log10(yMax)));
    if (yhi <= ylo) yhi = ylo * 10;
  }
  const X = (L) => m.l + (Math.log10(L) - lx0) / (lx1 - lx0) * (W - m.l - m.r);
  const Y = (v) => logY
    ? (v > 0 ? H - m.b - (Math.log10(v) - Math.log10(ylo)) / (Math.log10(yhi) - Math.log10(ylo)) * (H - m.t - m.b) : H - m.b)
    : H - m.b - v / yhi * (H - m.t - m.b);
  const tickFmt = (v) => v >= 1000 ? (v / 1000) + 'k' : String(v);
  const U = cfg.unit;
  const fmt = cfg.fmt ?? String;
  const val = (v) => (U ? `${fmt(v)} ${U}` : fmt(v));

  const g = el('g', { class: 'grid' });
  // x: decades + 2/5 minors
  const e0 = Math.ceil(lx0), e1 = Math.floor(lx1);
  const minors = [2, 5];
  for (let e = e0; e <= e1; e++) {
    for (const mm of minors) {
      const L = mm * Math.pow(10, e);
      if (L < xs * 0.999 || L > xe * 1.001) continue;
      const major = mm === 1;
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', X(L)); line.setAttribute('x2', X(L));
      line.setAttribute('y1', m.t); line.setAttribute('y2', H - m.b);
      if (major) line.classList.add('axis0');
      g.appendChild(line);
      if (major || (e1 - e0) >= 2) {
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('class', 'tick'); t.setAttribute('x', X(L)); t.setAttribute('y', H - m.b + 16);
        t.setAttribute('text-anchor', 'middle');
        t.textContent = L >= 1000 ? (L / 1000) + 'k' : L;
        g.appendChild(t);
      }
    }
  }
  // y ticks: decades (+ 2/5 minors while the span is short) on log, quarters on linear
  if (logY) {
    const ye0 = Math.floor(Math.log10(yMin)), ye1 = Math.ceil(Math.log10(yMax));
    const ym = [1, 2, 5];
    for (let e = ye0; e <= ye1; e++) {
      for (const mm of ym) {
        const v = mm * Math.pow(10, e);
        if (v < ylo * 0.999 || v > yhi * 1.001) continue;
        if ((ye1 - ye0) > 4 && mm !== 1) continue;
        const line = document.createElementNS(SVG, 'line');
        line.setAttribute('x1', m.l); line.setAttribute('x2', W - m.r);
        line.setAttribute('y1', Y(v)); line.setAttribute('y2', Y(v));
        if (mm === 1) line.classList.add('axis0');
        g.appendChild(line);
        const t = document.createElementNS(SVG, 'text');
        t.setAttribute('class', 'tick'); t.setAttribute('x', m.l - 8); t.setAttribute('y', Y(v) + 4);
        t.setAttribute('text-anchor', 'end'); t.textContent = tickFmt(v);
        g.appendChild(t);
      }
    }
  } else {
  const raw = yhi / 4, p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = (raw / p10 < 1.5 ? 1 : raw / p10 < 3 ? 2 : raw / p10 < 7 ? 5 : 10) * p10;
  for (let v = 0; v <= yhi; v += step) {
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', m.l); line.setAttribute('x2', W - m.r);
    line.setAttribute('y1', Y(v)); line.setAttribute('y2', Y(v));
    if (v === 0) line.classList.add('axis0');
    g.appendChild(line);
    const t = document.createElementNS(SVG, 'text');
    t.setAttribute('class', 'tick'); t.setAttribute('x', m.l - 8); t.setAttribute('y', Y(v) + 4);
    t.setAttribute('text-anchor', 'end'); t.textContent = v;
    g.appendChild(t);
  }
  }
  el('rect', { class: 'frame', x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b });
  el('text', { class: 'axlabel', x: (W + m.l) / 2, y: H - 6, 'text-anchor': 'middle' }, cfg.xlabel);
  el('text', { class: 'axlabel', x: 14, y: (H - m.b + m.t) / 2, 'text-anchor': 'middle',
               transform: `rotate(-90 14 ${(H - m.b + m.t) / 2})` }, cfg.ylabel || 'σ_cr (MPa)');

  for (const s of cfg.series) {
    const pts = s.points.filter((p) => Number.isFinite(p.y) && Number.isFinite(p.L));
    if (!pts.length) continue;
    el('polyline', { class: 'series ' + (s.cls || 'main'),
      points: pts.map((p) => `${X(p.L).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ') });
  }
  /* Minimum labels: placed so none prints over another or leaves the plot (js/labels.js), the
     lowest minimum first; one with no free place is left to the readout under the chart. */
  const markers = cfg.markers || [];
  const marks = markers.map((mi) => (mi.i != null ? cfg.points[mi.i] : mi));
  marks.forEach((p, k) => el('circle', { class: markers[k].sel ? 'marker sel' : 'marker', cx: X(p.L), cy: Y(p.y), r: markers[k].sel ? 6 : 5 }));
  const order = marks.map((p, k) => k).sort((a, b) => marks[a].y - marks[b].y);
  const texts = order.map((k) => {
    const p = marks[k];
    const t = el('text', { class: 'mlabel', x: 0, y: 0 },
                 markers[k].label ?? (cfg.markLabel ? cfg.markLabel(p, k) : `${val(p.y)} @ ${Math.round(p.L)}`));
    let w = 0;
    try { w = t.getComputedTextLength(); } catch { /* not rendered */ }
    return { t, p, w: w > 0 ? w : t.textContent.length * 6.4 };
  });
  const spots = placeLabels(texts.map(({ p, w }) => ({ px: X(p.L), py: Y(p.y), w })),
                            { x0: m.l + 4, y0: m.t + 2, x1: W - m.r - 6, y1: H - m.b - 2 },
                            { obstacles: marks.map((p) => [X(p.L) - 6, Y(p.y) - 6, X(p.L) + 6, Y(p.y) + 6]) });
  texts.forEach(({ t }, k) => {
    const s = spots[k];
    if (!s) { t.remove(); return; }
    t.setAttribute('x', s.x.toFixed(1)); t.setAttribute('y', s.y.toFixed(1));
  });
  return { W, H, m, X, Y, el, val, marks };
}
