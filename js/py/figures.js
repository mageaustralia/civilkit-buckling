/* The Python console's figures: what cufsm_rs.plot (py/cufsm_rs_lite/plot.py) drew, as inline SVG
   in the output, drawn by the page's own code (js/draw.js), so a figure looks like the page's
   drawing of the same thing and follows the theme.

   A figure spec (plot.py's, numbers unpacked by js/py/runner.js):
     section    numbers, x, z, free [[xdof, zdof]], elems [[i, j]] (node rows, 0-based), t, stress,
                show_stress, node_numbers, legend
     signature  lengths, curve, minima [[length, load factor]], labels (one per minimum, the
                package's text), classes, xlabel, ylabel
     mode       the section's tables as above, u and w (the mode at y, per node), scale, y, title
   Every number drawn is one of these: nothing here recomputes a result.

   drawFigure(spec, svg)    draws a spec into an <svg> that is in the document (for text widths)
   figureAlt(spec)          the figure's text alternative (its aria-label)
   figureName(spec)         "signature curve" ...; placeholder(spec) "[figure: signature curve]"
   svgFile(svg)             the drawn figure as a standalone .svg file's text, the theme's colours inlined */
import { SVG, geometry, engineModel, drawSection, drawChartCore, minOf, maxOf } from '../draw.js';

const NAMES = { section: 'cross-section', signature: 'signature curve', mode: 'mode shape' };
export const figureName = (spec) => NAMES[spec.kind] ?? 'figure';
export const placeholder = (spec) => `[figure: ${figureName(spec)}]`;
/* a number as the package's %.4g prints it */
export const g4 = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : String(v));

const SECT = 420, HEAD = 28;                 // the section drawing's square, and the band above it for a title

/* the spec's tables as the drawing's model */
function model(spec) {
  return {
    nodes: spec.x.map((x, i) => ({ x, z: spec.z[i], free: [spec.free[i][0], spec.free[i][1], 1, 1], stress: spec.stress[i] })),
    elems: spec.elems.map(([i, j], k) => ({ i, j, t: spec.t[k] })),
  };
}

export function figureAlt(spec) {
  if (spec.kind === 'signature') {
    const n = spec.lengths.length;
    const mins = spec.labels.length
      ? `${spec.labels.length} ${spec.labels.length === 1 ? 'minimum' : 'minima'}: ${spec.labels.join('; ')}`
      : 'no minima';
    return `Signature curve: ${spec.ylabel} against ${spec.xlabel} on a log scale, ${n} lengths`
      + (n ? ` from ${g4(minOf(spec.lengths))} to ${g4(maxOf(spec.lengths))}` : '') + `; ${mins}.`;
  }
  const w = maxOf(spec.x) - minOf(spec.x), h = maxOf(spec.z) - minOf(spec.z);
  const size = `${g4(w)} wide and ${g4(h)} deep`;
  if (spec.kind === 'mode')
    return `${spec.title}: the deformed cross-section over the undeformed one (dashed), cut at y = ${g4(spec.y)}; `
      + `the section is ${size}.`;
  const comp = spec.stress.some((s) => s > 0), tens = spec.stress.some((s) => s < 0);
  return `Cross-section: ${spec.x.length} nodes and ${spec.elems.length} elements, ${size}`
    + (spec.show_stress ? `, shaded by the reference stress (${[comp && 'compression', tens && 'tension'].filter(Boolean).join(' and ')}; `
      + `${spec.legend.replace(/^reference stress \(/, '').replace(/\)$/, '')})` : '')
    + (spec.node_numbers ? ', with the node numbers' : '') + '.';
}

const mk = (tag, attrs, parent) => {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

/* a section or a mode: the section drawing in its square, under a band for the title or legend */
function drawSectionFigure(spec, svg) {
  const g = geometry(model(spec));
  const head = spec.kind === 'mode' || spec.legend ? HEAD : 0;
  svg.setAttribute('viewBox', `0 0 ${SECT} ${SECT + head}`);
  svg.replaceChildren();
  if (head) {
    const t = mk('text', { class: 'figtitle', x: 12, y: 19 }, svg);
    if (spec.kind === 'mode') t.textContent = spec.title;
    else {
      const comp = spec.stress.some((s) => s > 0), tens = spec.stress.some((s) => s < 0);
      /* SVG collapses runs of spaces: the gaps are dx offsets */
      let first = true;
      const span = (cls, text, gap) => {
        const s = mk('tspan', { ...(cls ? { class: cls } : {}), ...(gap && !first ? { dx: gap } : {}) }, t);
        s.textContent = text;
        first = false;
      };
      if (comp) { span('swc', '■', 14); span(null, 'compression', 5); }
      if (tens) { span('swt', '■', 14); span(null, 'tension', 5); }
      span(null, spec.legend, 14);
    }
  }
  const sect = mk('svg', { class: 'sect', x: 0, y: head, width: SECT, height: SECT, viewBox: `0 0 ${SECT} ${SECT}` }, svg);
  const opt = { pad: 56, hits: false, labels: spec.node_numbers ? spec.numbers.map(String) : false };
  if (spec.kind === 'section') {
    drawSection(sect, g, { ...opt, stress: spec.show_stress });
    return;
  }
  /* the mode at y as one term: the page's deformed-shape drawing, at the package's scale */
  const nn = spec.x.length, data = new Float64Array(4 * nn);
  for (let v = 0; v < nn; v++) { data[2 * v] = spec.u[v]; data[2 * nn + 2 * v] = spec.w[v]; }
  const mode = { nn, nt: 1, ms: [1], data, scale: spec.scale };
  /* a scale that throws the shape past the drawing's margin: fit both, and leave out the dimensions */
  const size = Math.max(g.bb.w, g.bb.h) || 1;
  const moved = g.nodes.map(([x, z], i) => [x + spec.scale * spec.u[i], z + spec.scale * spec.w[i]]);
  const out = moved.some(([x, z]) => x < g.bb.xmin - 0.15 * size || x > g.bb.xmax + 0.15 * size
    || z < g.bb.zmin - 0.15 * size || z > g.bb.zmax + 0.15 * size);
  drawSection(sect, g, { ...opt, labels: false, deformed: { fam: 'other', phase: 0, mode, em: engineModel(g) },
                         ...(out ? { fitTo: { nodes: [...g.nodes, ...moved] }, dims: false } : {}) });
}

function drawSignatureFigure(spec, svg) {
  const points = spec.lengths.map((L, i) => ({ L, y: spec.curve[i] })).sort((a, b) => a.L - b.L);
  svg.classList.add('chart');
  drawChartCore(svg, {
    points,
    series: [{ points, cls: 'main' }],
    markers: spec.minima.map(([L, y], k) => ({ L, y, label: spec.labels[k] })),
    xlabel: spec.xlabel, ylabel: spec.ylabel, fmt: g4,
  });
}

export function drawFigure(spec, svg) {
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', figureAlt(spec));
  if (spec.kind === 'signature') drawSignatureFigure(spec, svg);
  else drawSectionFigure(spec, svg);
  return svg;
}

/* the computed look of every element, inlined, so the file shows what the page showed (in the
   theme it showed it in) without the page's style sheets */
const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linejoin',
  'stroke-linecap', 'opacity', 'font-family', 'font-size', 'font-weight', 'paint-order', 'display', 'visibility'];
export function svgFile(svg) {
  const copy = svg.cloneNode(true);
  const from = [...svg.querySelectorAll('*')], to = [...copy.querySelectorAll('*')];
  from.forEach((e, k) => {
    const cs = getComputedStyle(e);
    to[k].setAttribute('style', PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    to[k].removeAttribute('class');
  });
  const vb = svg.viewBox.baseVal;
  copy.removeAttribute('class');
  copy.removeAttribute('style');
  copy.setAttribute('xmlns', SVG);
  copy.setAttribute('width', vb.width);
  copy.setAttribute('height', vb.height);
  const title = mk('title', {});
  title.textContent = svg.getAttribute('aria-label') ?? '';
  const bg = mk('rect', { x: vb.x, y: vb.y, width: vb.width, height: vb.height,
                          fill: getComputedStyle(svg).backgroundColor || '#fff' });
  copy.prepend(title, bg);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(copy) + '\n';
}
