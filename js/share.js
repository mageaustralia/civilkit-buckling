import { parseLengths } from './lengths.js';
/* base64url of the compressed bytes. The chunks are 32,766 bytes (3 × 10,922): a multiple of 3,
   so every chunk's base64 is padding-free except the last, and each chunk stays far below the
   argument limit - btoa(String.fromCharCode(...wholeArray)) runs out of call stack above about
   110 KB in Node and 124 KB in Chromium, which a real section model reaches. */
const CHUNK = 32766;
const b64u = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export async function encodeState(state) {
  const raw = new TextEncoder().encode(JSON.stringify(state));
  return '#v2.' + b64u(await pipe(raw, new CompressionStream('deflate-raw')));
}
export async function decodeState(hash) {
  const m = /^#v(\d+)\.(.+)$/.exec(hash || '');
  if (!m) throw new Error('This is not a CivilKit Buckling link.');
  if (m[1] !== '2') throw new Error('This link is from an older version of CivilKit Buckling and cannot be opened.');
  try {
    const json = new TextDecoder().decode(await pipe(unb64u(m[2]), new DecompressionStream('deflate-raw')));
    return JSON.parse(json);
  } catch {
    throw new Error('This link is damaged and could not be opened.');
  }
}

/* The decoded model, checked before it is committed: geometry() reads every node's fixity array
   and both nodes of every element, so a link missing those would throw inside the first solve.
   Returns null when the state can be applied, or the message the footer shows. Numeric strings in
   the fixity flags and the spring and constraint rows are coerced; coordinates, thicknesses and
   material ids must already be numbers, otherwise the row is rejected. */
/* The largest model a link may open. A few hundred bytes of link can describe thousands of
   nodes: 2,000 tie the engine up for most of a minute (and re-run on every reload), 20,000
   exhaust the worker. 500 nodes and elements is well past any real cross-section; 1,000 lengths
   is what the Fill control makes at most. */
export const LIMITS = { nodes: 500, elems: 500, springs: 500, constraints: 500, lengths: 1000 };

export function validateState(s, noun = 'link') {
  const its = `This ${noun}\u2019s`;
  const m = s && typeof s === 'object' ? s.model : null;
  if (!m || !Array.isArray(m.mats) || !Array.isArray(m.nodes) || !Array.isArray(m.elems)
      || !Array.isArray(m.springs) || !Array.isArray(m.constraints))
    return `${its} model cannot be read.`;
  if (!m.nodes.length || !m.elems.length)
    return `This ${noun} contains no section to analyse.`;
  if (!m.mats.length)
    return `${its} model cannot be read: it has no material.`;
  const big = (n, what, cap) => `${its} model is too large to open: ${n} ${what}; the limit is ${cap}.`;
  if (m.nodes.length > LIMITS.nodes) return big(m.nodes.length, 'nodes', LIMITS.nodes);
  if (m.elems.length > LIMITS.elems) return big(m.elems.length, 'elements', LIMITS.elems);
  if (m.springs.length > LIMITS.springs) return big(m.springs.length, 'springs', LIMITS.springs);
  if (m.constraints.length > LIMITS.constraints) return big(m.constraints.length, 'constraints', LIMITS.constraints);
  const lens = s.analysis && Array.isArray(s.analysis.lengths) ? s.analysis.lengths.length : 0;
  if (lens > LIMITS.lengths) return `${its} analysis is too large to open: ${lens} lengths; the limit is ${LIMITS.lengths}.`;
  const ids = new Set();
  for (const q of m.mats) {
    if (!q || !Number.isFinite(q.id))
      return `${its} model cannot be read: a material row has no usable id.`;
    if (![q.ex, q.ey, q.vx, q.vy, q.g].every(Number.isFinite))
      return `${its} model cannot be read: material ${q.id} has no usable properties.`;
    ids.add(q.id);
  }
  for (let k = 0; k < m.nodes.length; k += 1) {
    const n = m.nodes[k];
    if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.z))
      return `${its} model cannot be read: node ${k + 1} has no usable coordinates.`;
    if (!Array.isArray(n.free) || n.free.length !== 4)
      return `${its} model cannot be read: node ${k + 1} has no fixity data (four flags).`;
    if (n.free.some((v) => !Number.isFinite(Number(v))))
      return `${its} model cannot be read: node ${k + 1} has a fixity flag that is not a number.`;
    n.free = n.free.map(Number);
    if (!Number.isFinite(n.stress)) n.stress = 1;      // the app's own starting stress column
  }
  for (let k = 0; k < m.elems.length; k += 1) {
    const e = m.elems[k];
    if (!e || !Number.isInteger(e.i) || !Number.isInteger(e.j))
      return `${its} model cannot be read: element ${k + 1} does not point at two nodes.`;
    if (e.i < 0 || e.j < 0 || e.i >= m.nodes.length || e.j >= m.nodes.length)
      return `${its} model cannot be read: element ${k + 1} points at node ${Math.max(e.i, e.j) + 1},`
        + ' which is not in the model.';
    if (!Number.isFinite(e.t) || e.t <= 0)
      return `${its} model cannot be read: element ${k + 1} has no usable thickness.`;
    if (!ids.has(e.mat))
      return `${its} model cannot be read: element ${k + 1} uses material ${e.mat}, which the ${noun} does not define.`;
  }
  for (let k = 0; k < m.springs.length; k += 1) {
    const r = m.springs[k];
    if (!Array.isArray(r) || r.length !== 9 || r.some((v) => !Number.isFinite(Number(v))))
      return `${its} model cannot be read: spring row ${k + 1} is not nine numbers.`;
    m.springs[k] = r.map(Number);
  }
  for (let k = 0; k < m.constraints.length; k += 1) {
    const r = m.constraints[k];
    if (!Array.isArray(r) || r.length !== 5 || r.some((v) => !Number.isFinite(Number(v))))
      return `${its} model cannot be read: constraint row ${k + 1} is not five numbers.`;
    m.constraints[k] = r.map(Number);
  }
  return null;
}

/* A link's analysis settings, taken as the page's own controls take them: the solution type, a
   boundary condition the BC menu offers (bcs), 1 to 100 longitudinal terms, 1 to 50 eigenvalues,
   at least two usable lengths, and the tube's inputs. A value that is absent is left out quietly;
   one that is present but clamped or dropped is left out (or clamped) AND named in notes, so the
   page can say the link was changed on the way in rather than silently analysing something else. */
export const TERMS_MAX = 100, NEIGS_MAX = 50;
export function readAnalysis(a, bcs) {
  const out = { notes: [] };
  if (!a || typeof a !== 'object') return out;
  const note = (s) => out.notes.push(s);
  const has = (k) => a[k] !== undefined && a[k] !== null;
  if (a.solution === 'general' || a.solution === 'signature') out.solution = a.solution;
  else if (has('solution')) note(`solution type "${a.solution}" is not one this page offers; kept the default`);
  if (typeof a.bc === 'string' && bcs.includes(a.bc)) out.bc = a.bc;
  else if (has('bc')) note(`boundary condition ${a.bc} is not one this page offers; kept the default`);
  const int = (k, label, lo, hi) => {
    if (!has(k)) return;
    const v = Number(a[k]);
    if (!Number.isFinite(v)) { note(`${label} ${a[k]} is not a number; kept the default`); return; }
    const c = Math.max(lo, Math.min(hi, Math.round(v)));
    if (c !== v) note(`${label} ${a[k]} became ${c} (whole numbers from ${lo} to ${hi})`);
    out[k] = c;
  };
  int('terms', 'longitudinal terms', 1, TERMS_MAX);
  int('neigs', 'eigenvalues', 1, NEIGS_MAX);
  if (has('lengths')) {
    const pr = parseLengths(Array.isArray(a.lengths) ? a.lengths.join('\n') : '');
    if (pr.lengths.length >= 2) {
      out.lengths = pr.lengths;
      if (pr.dropped.length) note(`${pr.dropped.length} unusable length${pr.dropped.length > 1 ? 's' : ''} dropped (${pr.dropped.slice(0, 4).join(', ')})`);
    } else note('the length list had fewer than two usable lengths; kept the default list');
  }
  const tb = a.tube;
  if (tb && typeof tb === 'object') {
    out.tube = {};
    const tk = (k) => tb[k] !== undefined && tb[k] !== null;
    const names = { D: 'tube diameter', t: 'tube wall', L: 'tube length', N: 'tube N', M: 'tube M', T: 'tube T',
                    V: 'tube V', p: 'harmonics around', q: 'terms along', nmodes: 'tube modes',
                    base: 'base end', top: 'top end' };
    const drop = (k) => note(`${names[k]} ${tb[k]} is not usable; kept the default`);
    for (const k of ['D', 't', 'L']) if (tk(k)) { if (Number.isFinite(tb[k]) && tb[k] > 0) out.tube[k] = tb[k]; else drop(k); }
    for (const k of ['N', 'M', 'T', 'V']) if (tk(k)) { if (Number.isFinite(tb[k])) out.tube[k] = tb[k]; else drop(k); }
    for (const k of ['p', 'q']) if (tk(k)) { if (Number.isInteger(tb[k]) && tb[k] >= 1) out.tube[k] = tb[k]; else drop(k); }
    // the page always asks for 4 tube modes; a link may ask for up to 20 (each is a full field)
    if (tk('nmodes')) { if (Number.isInteger(tb.nmodes) && tb.nmodes >= 1 && tb.nmodes <= 20) out.tube.nmodes = tb.nmodes; else drop('nmodes'); }
    for (const k of ['base', 'top']) if (tk(k)) { if (Number.isInteger(tb[k]) && tb[k] >= 0 && tb[k] <= 3) out.tube[k] = tb[k]; else drop(k); }
  }
  return out;
}
