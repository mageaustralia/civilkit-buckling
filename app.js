import { startEngine } from './js/engine-client.js';
import { startExtensions } from './js/ext/client.js';
import { createExtensionsUI } from './js/ext/ui.js';
import { isotropic, fromPolylines, toBuffers, divideElem, doubleElems, deleteElems,
         deleteNode, translateNodes, toCufsmText, fromCufsmText, validateModel,
         appendNode, setNode, setElem } from './js/model.js';
import { createHistory } from './js/history.js';
import { parseNum, numFieldHtml, bindNumField } from './js/numfield.js';
import { virtualList } from './js/vlist.js';
import { attachCanvasGestures, nearestNode, nearestSegment, snapTo, fromView } from './js/gestures.js';
import { findMinima, collapseMinima } from './js/results.js';
import { pythonScript } from './js/python.js';
import { SHAPES, SECTION_DEFAULTS } from './js/shapes.js';
import { Ym } from './js/shapefn.js';
import { logLengths, parseLengths } from './js/lengths.js';
import { encodeState, decodeState, validateState, readAnalysis, TERMS_MAX, NEIGS_MAX } from './js/share.js';
import { shell } from './js/shell.js';
import * as PR from './js/projects.js';
import { startPwa } from './js/pwa.js';
/* the drawings of a section, a mode and a chart: shared with the Python console's figures */
import { SVG, minOf, maxOf, geometry as geometryOf, engineModel, modeXZ, fit, ampAt,
         drawSection as drawSectionCore, drawChartCore } from './js/draw.js';

const $ = (s) => document.querySelector(s);
function mkEl(tag, attrs, parent) {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

/* The page's own CSS as text, for the printable report's window. */
function pageCss() {
  try {
    return [...document.styleSheets].flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n');
  } catch { return ''; }
}

/* ------------------------------------------------------------------ shapes */
const ICONS = {
  c:      '<path d="M7 4v18M7 4h14M7 22h14M21 22v-6"/>',
  channel:'<path d="M7 4v18M7 4h14M7 22h14"/>',
  z:      '<path d="M5 22h10M15 22V6M15 6h10"/>',
  hat:    '<path d="M4 22h6M10 22V8M10 8h10M20 8v14M20 22h6"/>',
  plate:  '<path d="M4 15h22"/>',
  tube:   '<circle class="ring" cx="15" cy="13" r="8.5"/>',
  custom: '<path d="M4 21l7-9 5 5 9-12"/><circle cx="4" cy="21" r="1.6"/><circle cx="11" cy="12" r="1.6"/><circle cx="25" cy="5" r="1.6"/>',
  model:  '<path d="M4 21l7-9 5 5 9-12"/><path d="M4 27h22"/><circle cx="4" cy="21" r="1.6"/><circle cx="11" cy="12" r="1.6"/><circle cx="25" cy="5" r="1.6"/>',
};

const P = { shape: 'c', template: 'c', ...SECTION_DEFAULTS, bc: 'S-S', terms: 1, Lmin: 10, Lmax: 5000,
            solution: 'signature',   // 'signature' (S-S, m = 1, half-wavelengths) or 'general'
            neigs: 10,               // eigenvalues per length in the mode browser (1-50)
            lengths: logLengths(10, 5000, 90),
            custom: null };

/* ------------------------------------------------------------- geometry */
/* The editable model — a model.js model: materials, nodes (x, z, the four free flags and the
   nodal stress column), elements (i, j, per-element t, material id), springs and constraints.
   Editing a row in the tables rewrites it; changing a section parameter rebuilds it from the
   template. The global MODEL is always a model.js model. */
let MODEL = null;
/* the touch section editor's state (js/gestures.js): the drawing's zoom and pan, the fit it was
   last drawn with, a long-press drag in progress, the node or strip a sheet is editing, and
   ＋ Node mode (from = the node the next one joins, -1 = the last node) */
let canvasView = { s: 1, tx: 0, ty: 0 }, mainFit = null, tdrag = null, PICK = null;
const ADD = { on: false, from: -1 };
/* The material rows the Materials table edits — the same array as MODEL.mats, so there is one
   source of truth. The first row is the section's material. */
let MATS = [Object.assign(isotropic(100, P.E, P.nu), { grade: 'G450', fy: P.fy })];

/* Results reporting state: the reference stress (max |nodal stress|) and the units toggle. */
const acts = { ref: 1, norm: 'stress' };
/* CUFSM's Reference applied loads (loading_cb.m): the six actions add together. fy lives in P
   (the Material group owns its input); these accessors keep LOADS.fy an alias of it. */
const LOADS = { P: 0, Mxx: 0, Mzz: 0, M11: 0, M22: 0, B: 0, restrained: false, extremeFibre: true,
                get fy() { return P.fy; }, set fy(v) { P.fy = v; } };
let S2A = null;          // a pending Generate-from-Stress fit, awaiting Use these / Cancel
/* Set when the actions in LOADS were fitted by the engine to stresses that came with the model
   (a CUFSM paste) rather than being what generated them: { err } is the fit's residual. The
   Loads panel and the report say so; regenerating the stresses from the loads clears it. */
let LOADFIT = null;
let loadTimer = null;    // the 150 ms debounce on the action inputs
const currentMat = () => MATS[0];

let SPRINGS = [];        // CUFSM spring rows: [node_i, node_j (-1 = ground), ku, kv, kw, kq, local, discrete, ys]
let CONSTRAINTS = [];    // equation rows: [node_e, dof_e (1-4), coeff, node_k, dof_k], u_e = coeff * u_k

/* Every model replacement goes through here, so the editors and the engine buffers always
   point at the same rows. */
function setModel(m) {
  if (!m.mats.length) m.mats.push(isotropic(100, P.E, P.nu));
  MODEL = m; MATS = m.mats; SPRINGS = m.springs; CONSTRAINTS = m.constraints;
  S2A = null;            // a stress fit belongs to the model it was fitted on
  LOADFIT = null;
  syncRef();
  P.E = MATS[0].ex; P.nu = MATS[0].vx;
}

/* The reference stress the curve is reported against: the largest stress on the nodes. */
function syncRef() {
  let mx = 0;
  if (MODEL) for (const n of MODEL.nodes) mx = Math.max(mx, Math.abs(n.stress));
  acts.ref = mx > 0 ? mx : 1;
}

async function buildModel() {
  if (P.shape === 'model') return;              // the model owns itself now — nothing rebuilds it
  if (P.shape !== 'tube') P.template = P.shape; // the template Reset model goes back to
  if (!MATS.length) MATS.push(isotropic(100, P.E, P.nu));
  const mats = MATS.map((q) => ({ ...q }));     // the materials survive a rebuild
  const m = fromPolylines(SHAPES[P.shape].path(P), { t: P.t, mat: mats[0], mesh: P.mesh });
  m.mats = mats;
  setModel(m);
  const built = MODEL;
  // a fresh section starts at the unit-stress reference (P = A), until the Loads panel says else
  if (engineReady && !ACTKEYS.some((k) => LOADS[k])) {
    try {
      const pr = await engine.call('props', toBuffers(built));
      if (MODEL === built) LOADS.P = pr.A;     // a newer rebuild supersedes this one
    } catch { /* props declined: P stays 0 */ }
  }
  await regenStress();
}

const ACTKEYS = ['P', 'Mxx', 'Mzz', 'M11', 'M22', 'B'];

/* Applied-stress generator: the Loads panel's actions (and every template rebuild) write the
   nodal stress column through the engine's stresgen - never by hand. All six actions add.
   The worker answers asynchronously: a result for a model that is no longer on screen
   (a newer edit superseded this one) is dropped, never written back. */
async function regenStress() {
  const m = MODEL;
  if (!engineReady || !m || !m.nodes.length) return;
  try {
    const s = await engine.call('stresgen', toBuffers(m), LOADS);
    if (MODEL !== m) return;                    // the model changed under it
    m.nodes.forEach((n, i) => { n.stress = s[i]; });
    LOADFIT = null;                             // the stresses are the loads' own again
    syncRef();
  } catch { /* the engine declined the model - the solve reports it */ }
}

/* A model that brings its own nodal stresses (a CUFSM paste): the reference loads become the
   actions the engine's stress-to-action fits to them - P, M11, M22 and B, principal axes, so Mxx
   and Mzz are zero - and the stresses stay exactly as pasted. Actions under 0.1 % of their own
   first-yield value are the fit's noise and are written as 0, the rule Use these applies. With
   no answer from the engine the loads go to zero and the note says the fit failed, so the panel
   never shows the previous section's loads beside these stresses. */
async function fitLoadsToStress() {
  const m = MODEL;
  for (const k of ACTKEYS) LOADS[k] = 0;
  LOADS.restrained = false;
  if (!engineReady) { LOADFIT = { error: 'the engine is not loaded' }; return; }
  try {
    const r = await engine.call('stressToAction', toBuffers(m));
    if (MODEL !== m) return;
    const yy = await yieldVals();
    const keep = (v, yv) => (yy && yv && Math.abs(v) < 0.001 * Math.abs(yv)) ? 0 : v;
    LOADS.P = keep(r.P, yy && yy.Py);
    LOADS.M11 = keep(r.M11, yy && yy.M11);
    LOADS.M22 = keep(r.M22, yy && yy.M22);
    LOADS.B = keep(r.B, yy && yy.B);
    LOADFIT = { err: r.err };
  } catch (e) {
    if (MODEL === m) LOADFIT = { error: String((e && e.message) || e) };
  }
}
/* The sentence the Loads panel and the report print about a fit (empty when there is none). */
const loadFitText = () => !LOADFIT ? ''
  : LOADFIT.error ? `The model came with its own nodal stresses (pasted), but the engine could not fit actions to them: ${LOADFIT.error}. The stresses on the nodes are the pasted ones.`
  : `From the pasted stresses: these actions are the engine's stress-to-action fit of the nodal stresses that came with the model (fit err ||Gf - s|| = ${fmtY(LOADFIT.err)} MPa). The stresses on the nodes are the pasted ones; editing an action regenerates them from the actions.`;

/* First yield at fy, with the current restrained / extreme-fibre choices (the engine's
   grosprop). Null when the engine cannot answer. */
async function yieldVals() {
  if (!engineReady || !MODEL || !MODEL.nodes.length || !(LOADS.fy > 0)) return null;
  try {
    return await engine.call('firstYield', toBuffers(MODEL),
      { fy: LOADS.fy, restrained: LOADS.restrained, extremeFibre: LOADS.extremeFibre });
  } catch { return null; }
}

/* The section properties card's numbers: grosprop through the engine, never a hand calc. */
async function sectionProps() {
  if (!engineReady || !MODEL || !MODEL.nodes.length) return null;
  try { return await engine.call('props', toBuffers(MODEL)); } catch { return null; }
}

/* A row in the Materials, Nodes or Elements table was edited: the template no longer owns the
   model. The same rule dragging uses. */
function toModelShape() {
  if (P.shape === 'model') return;
  if (P.shape === 'custom' && P.custom) P.custom = MODEL.nodes.map((n) => [n.x, n.z]);
  P.shape = 'model';
  buildShapes(); buildParams();
}

/* the drawing's view of a model: the one on screen, or one an extension proposes or draws */
const geometry = (model = MODEL) => geometryOf(model);

/* "t = 1.5 mm" — or the range when the elements do not share one thickness */
const tRange = (g) => {
  if (!g.t.length) return 'no strips';
  const lo = minOf(g.t), hi = maxOf(g.t);
  const f = (v) => Number(v).toPrecision(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return lo === hi ? `t = ${f(lo)} mm` : `t = ${f(lo)} … ${f(hi)} mm`;
};


/* ----------------------------------------------------------------- engine
   The cufsm-rs engine (Rust -> WebAssembly, ABI 2), wrapped by js/engine.js and run in a
   Web Worker (js/worker.js). js/engine-client.js owns the main-thread half: ready, call,
   signatureChunked, cancel and restart. Every engine.* call below awaits — the UI thread
   never runs the solve, so it never blocks. */
let engine = startEngine(new URL('cufsm.wasm', import.meta.url));
let engineReady = false, engineErr = null;

class Aborted extends Error {}
/* A solve that was superseded (Aborted), cancelled by an edit, or killed by a worker restart:
   none of these is an engine failure, so none is reported as one. */
const dropped = (e) => e instanceof Aborted || e?.message === 'cancelled' || e?.message === 'restarted';
function setBusy(on, text, pct) {
  const el = document.getElementById('busy');
  if (!el) return;
  el.classList.toggle('on', !!on);
  if (text != null) document.getElementById('busyText').textContent = text;
  if (pct != null) document.getElementById('busyBar').style.width =
    Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%';
}

try {
  await engine.ready;
  engineReady = true;
} catch (err) {
  engineErr = 'engine failed to load: ' + (err?.message ?? String(err));
}
if (engineReady) {
  const note = document.getElementById('footerNote');
  if (note) note.textContent = 'The engine has loaded: signature curves, minima, classifications and '
    + 'mode shapes are computed in this page, with no server.';
}

/* The lengths solved at: the editable list in the Analysis group (parseLengths keeps it
   sorted and distinct). */
const lensFor = () => Float64Array.from(P.lengths);
/* Signature-curve mode forces S-S with m = 1 at each half-wavelength; general boundary
   conditions take the BC select and the editable term count. */
const engBc = () => (P.solution === 'general' ? P.bc : 'S-S');
const engTerms = () => (P.solution === 'general' ? Math.max(1, Math.min(TERMS_MAX, P.terms | 0)) : 1);
/* What the solved lengths are called: signature curves solve half-wavelengths, general
   boundary conditions solve physical lengths. */
const lengthWord = (plural) => P.solution === 'general'
  ? (plural ? 'physical lengths' : 'physical length')
  : (plural ? 'half-wavelengths' : 'half-wavelength');
const FAMKEYS = ['glob', 'dist', 'local', 'other'];

async function engineSignature(g) {
  const t0 = performance.now();
  const lens = lensFor(), n = lens.length;
  const me = engineModel(g), b = toBuffers(MODEL);
  const raw = await engine.signatureChunked(b,
    { bc: engBc(), terms: engTerms(), spaces: 0, lengths: Array.from(lens) },
    { chunk: 15, onProgress: (p) => setBusy(true, 'Solving…', p) });
  if (g !== geo) throw new Aborted();          // the model changed while this ran: result dropped
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ L: lens[i], lf: raw[i * 2 + 1], y: raw[i * 2 + 1] * acts.ref, fam: 'other' });
  if (pts.some((p) => !Number.isFinite(p.y)))
    throw new Error('a load factor came back non-finite');
  // minima of the envelope + a still-falling tail (global governs at long lengths) - the finder
  // is shared with the extension capabilities (js/results.js), so a module's minima are the
  // drawn curve's minima
  const minima = findMinima(pts.map((p) => [p.L, p.y])).map((m) => m.index);
  let gov = 0;
  for (let i = 1; i < n; i++) if (pts[i].y < pts[gov].y) gov = i;
  // classify at the minima and the governing point: G/D/L/O %, and the mode to draw
  const targets = [...new Set([gov, ...minima])];
  let done = 0;
  for (const i of targets) {
    if (g !== geo) throw new Aborted();
    const md = await engineModes(g, lens[i]);
    pts[i].cls = md.cls;
    pts[i].mode = md;
    if (md.cls.every(Number.isFinite))
      pts[i].fam = FAMKEYS[md.cls.indexOf(Math.max(...md.cls))];
    done++;
    setBusy(true, 'Classifying minima…', done / targets.length);
  }
  // one mode recurring at multiples of its half-wavelength (General BC, many terms) is one minimum
  const kept = collapseMinima(minima.map((i) => ({ index: i, length: pts[i].L, lf: pts[i].lf, fam: pts[i].fam })));
  for (const k of kept) pts[k.index].also = k.also;
  return { pts, minima: kept.map((k) => k.index), em: me, ms: performance.now() - t0 };
}

async function engineModes(g, L) {
  const b = toBuffers(MODEL), nt = engTerms();
  const nn = b.nodes.length / 7;
  const rows = await engine.call('modes', b, { bc: engBc(), terms: nt, neigs: 1, lengths: [L] });
  const r = rows[0];
  const md = r && r.modes[0];
  if (!md || md.dofs.length < 4 * nn * nt) throw new Error('the engine returned a bad mode row');
  const cls = md.cls, ms = r.m, data = md.dofs;
  // The mode is normalised over mixed units (mm and rad); rescale just the section-plane
  // entries so they fill the drawing — and leave a mode that is really longitudinal alone.
  let nm = 0;
  for (let mI = 0; mI < nt; mI++)
    for (let v = 0; v < nn; v++)
      nm = Math.max(nm, Math.abs(data[4 * nn * mI + 2 * v]),
                    Math.abs(data[4 * nn * mI + 2 * nn + 2 * v]));
  if (nm > 0.05)
    for (let mI = 0; mI < nt; mI++)
      for (let v = 0; v < nn; v++) {
        data[4 * nn * mI + 2 * v] /= nm;
        data[4 * nn * mI + 2 * nn + 2 * v] /= nm;
      }
  return { cls, nt, ms, data, nn };
}

/* The mode browser's rows: all neigs modes at one analysed length, normalised for drawing
   and cached on the signature (model, bc, terms and lengths are all fixed there; changing
   neigs clears the cache). The worker answers asynchronously: the first call for a length
   posts to the worker and every caller of that length shares the one in-flight promise;
   a result that belongs to a superseded signature is discarded. */
function modesAt(L) {
  if (!engineReady || !sig) return null;
  if (!sig.modeCache) sig.modeCache = new Map();
  if (!sig.modeCache.has(L)) {
    const s0 = sig;
    const b = toBuffers(MODEL), nt = engTerms(), nn = b.nodes.length / 7;
    const load = engine.call('modes', b, { bc: engBc(), terms: nt, neigs: P.neigs, lengths: [L] })
      .then((rows) => {
        const r = rows[0];
        const modes = r.modes.map((md) => {
          const data = md.dofs;
          let nm = 0;
          for (let mI = 0; mI < nt; mI++)
            for (let v = 0; v < nn; v++)
              nm = Math.max(nm, Math.abs(data[4 * nn * mI + 2 * v]), Math.abs(data[4 * nn * mI + 2 * nn + 2 * v]));
          if (nm > 0.05)
            for (let mI = 0; mI < nt; mI++)
              for (let v = 0; v < nn; v++) {
                data[4 * nn * mI + 2 * v] /= nm;
                data[4 * nn * mI + 2 * nn + 2 * v] /= nm;
              }
          return { lf: md.lf, cls: md.cls, ms: r.m, nt, data, nn };
        });
        const entry = { found: r.found, modes };
        if (s0.modeCache) s0.modeCache.set(L, entry);
        return entry;
      });
    sig.modeCache.set(L, load);
    load.catch(() => { if (s0.modeCache && s0.modeCache.get(L) === load) s0.modeCache.delete(L); });
  }
  return sig.modeCache.get(L);
}

/* The index of the entry of a length list nearest L on a log scale (0 for no L). */
function nearestIdx(list, L) {
  if (!(L > 0)) return 0;
  let k = 0;
  for (let i = 1; i < list.length; i++)
    if (Math.abs(Math.log(list[i] / L)) < Math.abs(Math.log(list[k] / L))) k = i;
  return k;
}

/* What the mode browser is looking at: a length (any analysed one, not only a minimum)
   and a mode number at it. Never rejects: an engine failure while a signature is on
   screen becomes engineErr, which the pane reports with Retry. */
async function selModeData() {
  if (!sig || !engineReady || !P.lengths.length) return null;
  if (!P.lengths.includes(selL)) selL = P.lengths[nearestIdx(P.lengths, selL)];
  const L = selL;
  const r = await Promise.resolve(modesAt(L)).catch((e) => {
    if (!dropped(e)) engineErr = 'engine: ' + (e && e.message ? e.message : String(e));
    return null;
  });
  if (!r || !r.found) return null;
  if (selModeIdx >= r.found) selModeIdx = r.found - 1;
  const md = r.modes[selModeIdx];
  const fam = md.cls.every(Number.isFinite) ? FAMKEYS[md.cls.indexOf(Math.max(...md.cls))] : 'other';
  return { L, r, md, fam };
}

/* The constrained curves — computed once when the cFSM pane first opens
   (G, D, L = spaces 7; CUFSM's chart has no O curve, O is a classification share),
   cached on this signature until the model changes */
async function cfsmCurves() {
  if (sig && sig.curves) return sig.curves;
  if (!engineReady || !geo) return null;
  const g0 = geo, s0 = sig;
  try {
    const lens = lensFor(), n = lens.length;
    const b = toBuffers(MODEL);
    const out = {};
    let step = 0;
    for (const [key, bit] of [['glob', 1], ['dist', 2], ['local', 4]]) {
      if (g0 !== geo || s0 !== sig) throw new Aborted();
      const raw = await engine.signatureChunked(b, { bc: engBc(), terms: engTerms(), spaces: bit,
        lengths: Array.from(lens) },
        { chunk: 15, onProgress: (p) => setBusy(true, `Solving ${key} space…`, (step + p) / 3) });
      if (g0 !== geo || s0 !== sig) throw new Aborted();
      const vals = new Array(n);
      for (let k = 0; k < n; k++) vals[k] = raw[k * 3 + 2] * acts.ref;  // row: L, free λ, space λ
      out[key] = vals;
      step++;
    }
    if (g0 !== geo || s0 !== sig) throw new Aborted();
    sig.curves = out;
    return out;
  } catch (e) {
    if (dropped(e)) throw e instanceof Aborted ? e : new Aborted();
    if (s0) s0.cfsmFailed = true;
    engineErr = 'engine: ' + (e && e.message ? e.message : String(e));
    return null;
  }
}

/* The signature curve. No engine, no curve: it returns null and the page shows
   "Loading the engine…" (or the engine's own error) instead of numbers. */
async function signature(g) {
  if (!engineReady) return null;
  try {
    const s = await engineSignature(g);
    engineErr = null;
    return s;
  } catch (e) {
    if (dropped(e))
      throw e instanceof Aborted ? e : new Aborted();   // cancel on edit or restart: silent
    engineErr = 'engine: ' + (e && e.message ? e.message : String(e));
    return null;
  }
}

const FAM = { local: { k: 'L', label: 'local' }, dist: { k: 'D', label: 'distortional' },
              glob: { k: 'G', label: 'global' }, other: { k: 'O', label: 'other' } };

/* --------------------------------------------- reporting: stress vs load factor
   With a reference stress on the nodes, results are a load factor lambda = P/Pref;
   with sigma_ref = 1 they ARE the buckling stress (the video's 1 ksi trick). */
const dscale = () => acts.norm === 'force' ? 1 / Math.max(acts.ref, 1e-9) : 1;
const unitOf = () => acts.norm === 'force' ? 'λ' : 'MPa';
const trimZ = (s) => s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
const fmt = (v) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (acts.norm === 'force') return v.toFixed(2);
  return a >= 1 ? v.toFixed(1) : a >= 0.001 ? trimZ(v.toFixed(3)) : v.toPrecision(1);
};
const fmtU = (v) => `${fmt(v)} ${unitOf()}`;

/* ------------------------------------------------------------- drawing */
/* the section drawing (js/draw.js), with what it reads of the shape on screen: the thickness of
   a strip that carries none and the lipped channel's lip, dimensioned on its own */
function drawSection(svg, g, opt = {}) {
  return drawSectionCore(svg, g, { tDefault: P.t, lip: P.shape === 'c' && P.d > 0 ? { b: P.b, h: P.h, d: P.d } : null, ...opt });
}

/* --------------------------------------------------- 3D mode shape (iso projection)
   The section repeated along a half-wave: stations at y = j/N · L, each displaced by
   sin(pi y / L) times the mode pattern — the video's "make a 3D version of that". */
function draw3D(svg, g, fam, phase, Lcr, mode, em) {
  const W = 420, H = 420;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  const N = 10, pad = 34;
  const bb = g.bb;
  const Lfull = Math.max(Lcr, 1);
  const Ldraw = Math.min(Lfull, Math.max(bb.w, bb.h) * 6);
  const waveF = Lfull <= Ldraw ? 1 : Ldraw / Lfull;
  // orbit projection: yaw about the section's vertical, pitch = elevation.
  // The √2 on the ground term keeps the default view pixel-identical to the old fixed one.
  const disp = 0.16 * Math.max(bb.w, bb.h);
  const cyw = Math.cos(yaw), syw = Math.sin(yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const sx = (x, y) => x * cyw - y * syw;
  const sy = (x, y, z) => (x * syw + y * cyw) * sp * Math.SQRT2 - z * cp;
  const corners = [];
  for (const x of [bb.xmin - disp, bb.xmax + disp])
    for (const y of [0, Ldraw])
      for (const z of [bb.zmin - disp, bb.zmax + disp]) corners.push([x, y, z]);
  const PX = corners.map(([x, y]) => sx(x, y)), PY = corners.map(([x, y, z]) => sy(x, y, z));
  const x0 = Math.min(...PX), x1 = Math.max(...PX), y0 = Math.min(...PY), y1 = Math.max(...PY);
  const S = Math.min((W - 2 * pad) / Math.max(x1 - x0, 1e-9), (H - 2 * pad) / Math.max(y1 - y0, 1e-9));
  const ox = pad + ((W - 2 * pad) - (x1 - x0) * S) / 2 - x0 * S;
  const oy = pad + ((H - 2 * pad) - (y1 - y0) * S) / 2 - y0 * S;
  const proj = (x, z, y) => [ox + sx(x, y) * S, oy + sy(x, y, z) * S];
  const scale = 0.14 * Math.max(bb.w, bb.h);

  const pt = (x0v, z0v, y, ph) => {   // displaced point at parameter position
    if (fam === 'glob') {
      const th = 0.09 * ph, ca = Math.cos(th), sa = Math.sin(th);
      return [(x0v - g.cx) * ca - (z0v - g.cz) * sa + g.cx, (x0v - g.cx) * sa + (z0v - g.cz) * ca + g.cz];
    }
    return [x0v, z0v];
  };

  // stations: the whole section sampled at each longitudinal position.
  // With an engine mode: term m contributes sin(mπ y/L)·cos(m·phase) at station y.
  const xzs = [];
  for (let j = 0; j <= N; j++)
    xzs.push(mode && em ? modeXZ(mode, mode.ms.map((m) =>
      Math.sin(m * Math.PI * (j / N) * waveF) * Math.cos(m * phase))) : null);
  const stations = [];
  for (let j = 0; j <= N; j++) {
    const y = j / N * Ldraw;
    const ph = Math.cos(phase) * Math.sin(Math.PI * (j / N) * waveF);
    const XZ = xzs[j];
    if (XZ) {
      stations.push(em.chains.map((ch) => ch.map((ei) => {
        const x = em.flat[ei * 5] + XZ.dx[ei] * scale;
        const z = em.flat[ei * 5 + 1] + XZ.dz[ei] * scale;
        return proj(x, z, y);
      }).join(' ')));
      continue;
    }
    stations.push(g.elems.map(([a, b], i) => {
      const [ax, az] = g.nodes[a], [bx, bz] = g.nodes[b];
      const [nax, naz] = g.nn[a], [nbx, nbz] = g.nn[b];
      const out = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        let x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        if (fam === 'glob') {
          [x, z] = pt(x, z, y, ph);
        } else {
          const nx = nax + (nbx - nax) * u, nz = naz + (nbz - naz) * u;
          const Ln = Math.hypot(nx, nz) || 1;
          const w = ampAt(g, i, u, fam) * scale * ph;
          x += (nx / Ln) * w; z += (nz / Ln) * w;
        }
        out.push(proj(x, z, y));
      }
      return out.map((q) => q.join(',')).join(' ');
    }));
  }
  // rails: every node's longitudinal line (engine: one per engine node, so the
  // interior points ride the real mode rather than a straight corner line)
  const railCount = em && xzs[0] ? em.nodes : g.nodes.length;
  for (let i = 0; i < railCount; i++) {
    const rail = [];
    for (let j = 0; j <= N; j++) {
      const y = j / N * Ldraw;
      const ph = Math.cos(phase) * Math.sin(Math.PI * (j / N) * waveF);
      let x, z;
      if (em && xzs[j]) {
        x = em.flat[i * 5] + xzs[j].dx[i] * scale;
        z = em.flat[i * 5 + 1] + xzs[j].dz[i] * scale;
      } else {
        const n = g.nodes[i];
        x = n[0]; z = n[1];
        if (fam === 'glob') [x, z] = pt(x, z, y, ph);
        else {
          const ei = g.elems.findIndex(([a, b]) => a === i || b === i);
          if (ei >= 0) {
            const u = g.elems[ei][0] === i ? 0 : 1;
            const w = ampAt(g, ei, u, fam) * scale * ph;
            x += g.nn[i][0] * w; z += g.nn[i][1] * w;
          }
        }
      }
      rail.push(proj(x, z, y));
    }
    mkEl('polyline', { class: 'rail', points: rail.map((q) => q.join(',')).join(' ') }, svg);
  }
  for (let j = N; j >= 0; j--) {
    const op = (0.35 + 0.65 * (1 - j / N)).toFixed(2);
    for (const poly of stations[j]) mkEl('polyline', { class: 'station', points: poly, opacity: op }, svg);
  }
  const note = mkEl('text', { class: 'nlabel', x: pad, y: H - 10 }, svg);
  note.textContent = `half-wave L = ${Math.round(Lfull)} mm` + (Ldraw < Lfull ? ' (length drawn to fit)' : '');
}

/* ------------------------------------------------------------------ chart */
function drawChart(svg, cfg) {
  const U = cfg.unit ?? unitOf();                // an extension's chart carries its own unit
  const val = (v) => (U ? `${fmt(v)} ${U}` : fmt(v));
  const { W, H, m, X, Y, el } = drawChartCore(svg, { ...cfg, unit: U, fmt,
    xlabel: cfg.xlabel || `${lengthWord()} L (mm)`,
    markLabel: (p) => `${p.fam ? `${FAM[p.fam].k} · ` : ''}${val(p.y)} @ ${Math.round(p.L)} mm` });
  /* The readout. A mouse hovers (nearest point within 50 px); a finger scrubs: a drag that goes
     sideways (8 px of x before y) takes over from the page scroll and reads the point under it
     on a crosshair, and a release within 6 % of the plot's width of a minimum selects that
     minimum (cfg.onSnap). A drag that goes up or down first is left to the page. Every number
     the readout prints is one of the engine's points. */
  const cross = el('line', { class: 'crosshair', x1: -99, x2: -99, y1: m.t, y2: H - m.b, style: 'display:none' });
  const dot = el('circle', { class: 'hoverdot', r: 4, cx: -99, cy: -99, style: 'display:none' });
  const tip = el('text', { class: 'hovertip', x: -99, y: -99, style: 'display:none' });
  const out = cfg.readout || null, rest = out ? out.innerHTML : '';
  const say = (p) => {
    if (!out) return;
    out.innerHTML = p ? `<b>L ${Math.round(p.L)} mm</b> · <b>${val(p.y)}</b>${p.fam ? ` · ${FAM[p.fam].label}` : ''}` : rest;
  };
  const hide = () => { dot.style.display = 'none'; tip.style.display = 'none'; cross.style.display = 'none'; };
  const toPlot = (ev) => {
    const r = svg.getBoundingClientRect();
    return [(ev.clientX - r.left) / r.width * W, (ev.clientY - r.top) / r.height * H];
  };
  const mark = (best, withTip) => {
    dot.style.display = '';
    dot.setAttribute('cx', X(best.L)); dot.setAttribute('cy', Y(best.y));
    if (withTip) {
      tip.style.display = '';
      const anchor = X(best.L) > W - 120 ? 'end' : 'start';
      tip.setAttribute('x', X(best.L) + (anchor === 'end' ? -10 : 10));
      tip.setAttribute('y', Y(best.y) + 16);
      tip.setAttribute('text-anchor', anchor);
      tip.textContent = `${val(best.y)} @ ${Math.round(best.L)} mm`;
    } else tip.style.display = 'none';
  };
  const showAt = (ev) => {
    const [px, py] = toPlot(ev);
    let best = null, bd = 1e9;
    for (const p of cfg.points) {
      if (!Number.isFinite(p.y)) continue;
      const d = (X(p.L) - px) ** 2 + (Y(p.y) - py) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > 2500) { hide(); say(null); return; }
    cross.style.display = 'none';
    mark(best, true);
    say(best);
  };
  /* the scrub: the engine point nearest the finger along L, the crosshair through it */
  const scrubAt = (ev) => {
    const [px] = toPlot(ev);
    let best = null, bd = Infinity;
    for (const p of cfg.points) {
      if (!Number.isFinite(p.y)) continue;
      const d = Math.abs(X(p.L) - px);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return;
    cross.style.display = '';
    cross.setAttribute('x1', X(best.L)); cross.setAttribute('x2', X(best.L));
    mark(best, false);
    say(best);
  };
  const st = svg.__scrub = { mode: null, x0: 0, y0: 0, id: null };
  svg.style.touchAction = 'pan-y';
  svg.onpointerdown = (ev) => {
    if (ev.pointerType === 'mouse') { showAt(ev); return; }
    Object.assign(st, { mode: 'pending', x0: ev.clientX, y0: ev.clientY, id: ev.pointerId });
  };
  svg.onpointermove = (ev) => {
    if (ev.pointerType === 'mouse') { showAt(ev); return; }
    if (ev.pointerId !== st.id) return;
    if (st.mode === 'pending') {
      const dx = Math.abs(ev.clientX - st.x0), dy = Math.abs(ev.clientY - st.y0);
      if (dx > 8 && dx > dy) {
        st.mode = 'scrub';
        try { svg.setPointerCapture(ev.pointerId); } catch { /* */ }
      } else if (dy > 8) st.mode = null;              // vertical first: the page scrolls
    }
    if (st.mode === 'scrub') scrubAt(ev);
  };
  svg.onpointerup = (ev) => {
    if (ev.pointerType === 'mouse' || ev.pointerId !== st.id) return;
    const was = st.mode;
    st.mode = null; st.id = null;
    if (was === 'pending') { showAt(ev); return; }   // a tap reads the point under it
    if (was !== 'scrub') return;
    const [px] = toPlot(ev);
    const tol = 0.06 * (W - m.l - m.r);
    let k = -1, bd = Infinity;
    (cfg.markers || []).forEach((mi, j) => {
      const d = Math.abs(X(cfg.points[mi.i].L) - px);
      if (d < bd) { bd = d; k = j; }
    });
    if (k >= 0 && bd <= tol && cfg.onSnap) { haptic('light'); cfg.onSnap(k); }
  };
  svg.onpointercancel = () => { st.mode = null; st.id = null; };
  svg.onpointerleave = (ev) => { if (ev.pointerType === 'mouse') { hide(); say(null); } };
  /* the keyboard's scrub: with the chart focused, ← → step along the engine's points (Home, End),
     the readout says each one, and Enter on a minimum selects it as a release there would */
  if (out) {
    const pts = cfg.points.filter((p) => Number.isFinite(p.y) && Number.isFinite(p.L));
    svg.tabIndex = 0;
    svg.onkeydown = (e) => {
      const n = pts.length;
      if (!n) return;
      let i = st.key ?? -1;
      if (e.key === 'ArrowRight') i = Math.min(n - 1, i + 1);
      else if (e.key === 'ArrowLeft') i = i < 0 ? 0 : Math.max(0, i - 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Enter' && i >= 0 && cfg.onSnap) {
        const k = (cfg.markers || []).findIndex((mi) => cfg.points[mi.i] === pts[i]);
        if (k >= 0) { e.preventDefault(); cfg.onSnap(k); }
        return;
      } else if (e.key === 'Escape') { st.key = null; hide(); say(null); return; }
      else return;
      e.preventDefault();
      st.key = i;
      const p = pts[i];
      cross.style.display = '';
      cross.setAttribute('x1', X(p.L)); cross.setAttribute('x2', X(p.L));
      mark(p, false);
      say(p);
    };
    svg.onblur = () => { st.key = null; hide(); say(null); };
  }
  /* iOS starts its own pan unless the move is cancelled: only while scrubbing (wired once) */
  if (!svg.__scrubWired) {
    svg.__scrubWired = true;
    svg.addEventListener('touchmove', (e) => { if (svg.__scrub?.mode === 'scrub' && e.cancelable) e.preventDefault(); }, { passive: false });
  }
}

/* A light tap of the Taptic Engine in a native store app, once one wires it; nothing on the web. */
function haptic(kind) {
  try { window.CivilKitNative?.haptic?.(kind); } catch { /* */ }
}

/* ------------------------------------------------------------------- state */
let geo = null, sig = null, disp = null, tab = 'sig', selMin = 0, selL = null, selModeIdx = 0, phase = 0,
    yaw = Math.PI / 4, pitch = Math.PI / 6,
    playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const pane = $('#pane');
let solveTimer = null, solving = false, solveAgain = false, cfsmSolving = false;

/* Every control ends here. The section and legend redraw instantly; the heavy
   engine solve is debounced (60 ms) and chunked in runSolve/engineSignature, so
   dragging a node never freezes the page — a stale solve aborts itself. */
/* The KPI row with no numbers in it: the engine has not produced any yet. */
const dashKpis = () => ['Governing', 'σ<sub>cr</sub>', 'L<sub>cr</sub>', 'Minima']
  .map((l) => `<div class="kpi"><div class="l">${l}</div><div class="v">—</div></div>`).join('');

/* draw = false skips the section rebuild for a change that cannot affect the drawing
   (the analysis term count): the drawing still shows the same strips, so rebuilding its
   1600-odd SVG elements only costs style recalculation and layout on the UI thread. */
function update(fast, draw = true) {
  if (P.shape === 'tube') { tubeUpdate(); return; }
  geo = geometry();
  if (!geo.elems.length) {
    clearTimeout(solveTimer); solveTimer = null;
    engine.cancel();                   // nothing to solve: drop what is running
    $('#sectionSvg').innerHTML = '';
    $('#legend').innerHTML = 'no elements left — reset the model in <b>Nodes &amp; elements</b>';
    $('#kpis').innerHTML = dashKpis();
    sig = null; disp = null;
    setBusy(false);
    renderPane();
    recordEdit();                      // deleting the last strip is an edit like any other
    return;
  }
  if (!engineReady) $('#kpis').innerHTML = dashKpis();   // still loading (or failed): no numbers yet
  if (draw) {
    refreshChips();
    drawMainSection();
  }
  if (fast && sig) {                 // display-only change (units): no re-solve
    refreshDisp();
    renderPane();
    autosave();
    return;
  }
  engine.cancel();                   // the model changed: drop the solve that is running now
  autosave();                        // the edit itself is kept now; a long solve must not hold it back
  setBusy(true, 'Solving…', 0);
  clearTimeout(solveTimer);
  solveTimer = setTimeout(() => { solveTimer = null; runSolve(); }, 60);
}

/* the section card's drawing and legend; it also ends an extension's proposal preview */
function drawMainSection() {
  const svg = $('#sectionSvg');
  svg.classList.remove('previewing');
  mainFit = drawSection(svg, geo, { pad: 56, view: canvasView, fitTo: tdrag?.fitTo,
                                    selNode: PICK?.node, selElem: PICK?.elem });
  $('#legend').innerHTML = `${geo.elems.length} strips · ${geo.nodes.length} nodes · ${tRange(geo)} to scale` +
    (geo.free.some((f) => !f[0] || !f[1]) ? ' · <span style="color:var(--accent)">pinned</span>' : '');
}

/* the KPIs and the chart data, from whatever signature we have (cheap, sync) */
function refreshDisp() {
  const ds = dscale();
  disp = { pts: sig.pts.map((p) => ({ ...p, sy: p.y * ds, raw: p.y })), minima: sig.minima,
           em: sig.em, ms: sig.ms };
  if (selMin >= disp.minima.length) selMin = Math.max(0, disp.minima.length - 1);
  /* The mode browser holds a length, not a list index: when the list changes (Fill, Recommend,
     a paste) and that length is gone, it moves to the minimum nearest the old length, so the
     highlighted chip, the length shown and the report's length are the same one. */
  if (!P.lengths.includes(selL)) {
    const mins = disp.minima.map((i) => disp.pts[i].L);
    if (mins.length) {
      selMin = selL == null ? Math.min(selMin, mins.length - 1) : nearestIdx(mins, selL);
      selL = mins[selMin];
    } else selL = P.lengths[0];
    selModeIdx = 0;
  }
  const gov = disp.pts.reduce((a, b) => (b.sy < a.sy ? b : a));
  $('#kpis').innerHTML = [
    ['Governing', `<span class="state ${gov.fam === 'glob' ? '' : 'yield'}">${FAM[gov.fam].k} · ${FAM[gov.fam].label}</span>`],
    [acts.norm === 'force' ? 'λ = P/P<sub>ref</sub>' : 'σ<sub>cr</sub>', fmtU(gov.sy)],
    ['L<sub>cr</sub>', `${Math.round(gov.L)} <small>mm</small>`],
    ['Minima', `${disp.minima.length}`],
  ].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
}

async function runSolve() {
  if (solving) { solveAgain = true; return; }
  solving = true;
  const g = geo;
  try {
    const s = await signature(g);
    if (g === geo) {
      sig = s;
      if (s) refreshDisp();
      else { disp = null; $('#kpis').innerHTML = dashKpis(); }   // no engine, or it declined
      renderPane();
    }
  } catch (e) { /* Aborted: the model changed mid-flight — restarted below */ }
  finally {
    solving = false;
    const stale = solveAgain || g !== geo;
    solveAgain = false;
    if (stale && geo.elems.length) update();
    else { setBusy(false); recordEdit(); autosave(); }   // the edit has settled: undo history, then the device
  }
}

/* resolves when no solve is pending (debounced or running) — for tests */
function idle() {
  return new Promise((res) => {
    (function pump() {
      if (solving || solveTimer != null || cfsmSolving) setTimeout(pump, 40);
      else res(true);
    })();
  });
}

/* ------------------------------------------------------------ tube (FTM) */
/* The finite tube method (Ádány & Schafer, Thin-Walled Structures 206, 2025): linear buckling
   of one circular tube under N, M, T and V, from cufsm-rs's cufsm_ftm. It has its own inputs and
   does not use the section above. params [R, t, L, E, ν, N, M, T, V, base, top, p, modes, nθ, ny]
   → [found, unknowns, σN, σM, τT, τV] then per mode [λ, waves, (u, v, w) on the nθ × ny grid]. */
const FT = { D: 508, t: 6, L: 6000, N: 1000, M: 0, T: 0, V: 0,
             base: 2, top: 3, p: 16, q: 6, nmodes: 4, res: null, sel: 0, err: null };
const FT_NTH = 72, FT_NY = 41;
const FT_ENDS = [['3', 'Free, stiff ring'], ['0', 'Free edge'], ['1', 'Pinned'], ['2', 'Clamped']];

/* 1..q, plus five wave numbers around the classical half-wavelength 1.728 √(Rt) */
function ftTerms() {
  const R = (FT.D - FT.t) / 2, q = Math.max(1, FT.q | 0);
  const js = [];
  for (let j = 1; j <= q; j++) js.push(j);
  const jstar = Math.round(FT.L / (1.728 * Math.sqrt(R * FT.t)));
  if (jstar > q) for (let j = Math.max(q + 1, jstar - 2); j <= jstar + 2; j++) js.push(j);
  return js.slice(0, 60);
}

/* One tube solve in the worker. A newer call supersedes an older one: only the newest
   writes FT.res. Runs off the UI thread, so the tube's inputs never freeze the page. */
let tubeGen = 0;
async function ftRun() {
  const gen = ++tubeGen;
  FT.res = null; FT.err = null;
  if (!engineReady) {
    FT.err = 'the engine is not ready';
    return;
  }
  const R = (FT.D - FT.t) / 2;
  const params = new Float64Array([R, FT.t, FT.L, P.E, P.nu, FT.N * 1e3, FT.M * 1e6, FT.T * 1e6,
    FT.V * 1e3, FT.base, FT.top, FT.p | 0, FT.nmodes | 0, FT_NTH, FT_NY]);
  const js = new Float64Array(ftTerms());
  const per = 2 + 3 * FT_NTH * FT_NY, cap = 6 + FT.nmodes * per;
  const t0 = performance.now();
  try {
    const o = await engine.call('ftm', params, js, cap);
    if (gen !== tubeGen) return;                // a newer tube solve is on screen
    const modes = [];
    for (let k = 0; k < o[0]; k++) {
      const b = 6 + k * per;
      modes.push({ lf: o[b], waves: o[b + 1], f: o.slice(b + 2, b + per) });
    }
    FT.res = { dofs: o[1], s: [o[2], o[3], o[4], o[5]], modes, R, js: [...js], ms: performance.now() - t0 };
    if (FT.sel >= modes.length) FT.sel = 0;
  } catch (e) {
    if (gen !== tubeGen || dropped(e)) return;
    FT.err = String(e && e.message || e);
  }
}

/* The tube's inputs, in the left card where the other sections' dimensions go. Young's E is the
   Material group's, shared with the strip sections. */
function tubeParams() {
  /* every tube input is a number field: the four actions may be negative (a ± key, since a phone's
     decimal pad has no minus); D, t and L are positive, p and q whole numbers from 1 */
  const num = (k, label, u) => numFieldHtml({ id: `ft_${k}`, label, unit: u, value: FT[k], allowNegative: 'NMTV'.includes(k) });
  const end = (k, label) => `<div class="field"><label for="ft_${k}">${label}</label><div class="inp"><select id="ft_${k}" data-k="${k}">
    ${FT_ENDS.map(([v, t]) => `<option value="${v}" ${+v === FT[k] ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>`;
  $('#params').innerHTML = `
    ${num('D', 'Outside diameter', 'mm', 1)}${num('t', 'Wall t', 'mm', 0.1)}${num('L', 'Length L', 'mm', 100)}
    <div class="group"><h2>Ends</h2>${end('base', 'Base')}${end('top', 'Top')}
      <div class="note">A stiff ring (a flange) keeps a free end round; a bare free edge buckles at about half the
        classical stress.</div></div>
    <div class="group"><h2>Actions</h2>
      ${num('N', 'Compression N', 'kN', 10)}${num('M', 'Moment M', 'kNm', 10)}
      ${num('T', 'Torque T', 'kNm', 10)}${num('V', 'Shear V', 'kN', 10)}
      <div class="note">Uniform along the tube; the load factor λ multiplies all four.</div></div>
    <div class="group"><h2>Fourier terms</h2>
      ${num('p', 'Harmonics around', '', 1)}${num('q', 'Terms along', '', 1)}
      <div class="note">Along: 1…q, plus five wave numbers at the classical half-wavelength 1.73 √(Rt).</div></div>`;
  /* p and q count harmonics and terms: whole numbers from 1 only. A fraction or a zero is not
     taken (the field says why) rather than reaching the engine. */
  for (const k of ['D', 't', 'L', 'N', 'M', 'T', 'V', 'p', 'q']) {
    const whole = k === 'p' || k === 'q', signed = 'NMTV'.includes(k);
    if (whole) $(`#ft_${k}`).inputMode = 'numeric';
    bindNumField($(`#ft_${k}`).closest('.numfield'), {
      allowNegative: signed, live: true,
      ...(whole ? { integer: true, min: 1 } : signed ? {} : { above: 0 }),
      onCommit: (v) => { FT[k] = v; tubeUpdate(); } });
  }
  $('#params').querySelectorAll('select[id^="ft_"]').forEach((el) => el.onchange = () => {
    FT[el.id.slice(3)] = +el.value; tubeUpdate();
  });
}

/* The tube's counterpart of update(): the section drawing and KPIs now, the solve debounced.
   tubeTimer stays non-null until the worker answers, so nothing reports idle mid-solve. */
let tubeTimer = null, tubeTick = 0;
function tubeUpdate() {
  drawTubeSection();
  tubeKpis();
  renderPane();
  setBusy(true, 'Solving the tube…', 0.5);
  const tick = ++tubeTick;
  clearTimeout(tubeTimer);
  tubeTimer = setTimeout(async () => {
    await ftRun();
    if (tick !== tubeTick) return;                // superseded: the newer pass cleans up
    tubeTimer = null;
    setBusy(false);
    tubeKpis();
    autosave();
    if (P.shape === 'tube') renderPane();
  }, 120);
}

function drawTubeSection(svg = $('#sectionSvg'), legend = true) {
  const R = FT.D / 2, c = 210, r = 150;
  const ri = Math.min(r - 2, r * (R - FT.t) / R);            // the wall stays visible when thin
  svg.innerHTML = `
    <path class="strip" fill-rule="evenodd" d="M${c - r} ${c}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z
      M${c - ri} ${c}a${ri} ${ri} 0 1 0 ${2 * ri} 0a${ri} ${ri} 0 1 0 ${-2 * ri} 0Z"/>
    <line x1="${c - r}" y1="${c + r + 26}" x2="${c + r}" y2="${c + r + 26}" stroke="var(--ink3)"/>
    <line x1="${c - r}" y1="${c + r + 20}" x2="${c - r}" y2="${c + r + 32}" stroke="var(--ink3)"/>
    <line x1="${c + r}" y1="${c + r + 20}" x2="${c + r}" y2="${c + r + 32}" stroke="var(--ink3)"/>
    <text x="${c}" y="${c + r + 46}" font-size="14" fill="var(--ink2)" text-anchor="middle">D = ${FT.D}</text>
    <text x="${c + r + 8}" y="${c - 6}" font-size="13" fill="var(--ink2)">t = ${FT.t}</text>
    <line class="cg" x1="${c - 8}" y1="${c}" x2="${c + 8}" y2="${c}"/><line class="cg" x1="${c}" y1="${c - 8}" x2="${c}" y2="${c + 8}"/>`;
  if (!legend) return;
  const Rm = (FT.D - FT.t) / 2;
  $('#legend').innerHTML = `Circular tube · R = ${Rm.toFixed(1)} mm to the mid-wall · R/t = ${(Rm / FT.t).toFixed(0)} ·
    L = ${FT.L} mm${ri > r * (R - FT.t) / R ? ' · wall drawn thicker than true' : ''}`;
}

const ftf = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

function tubeKpis() {
  const kpi = (l, v) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  const r = FT.res, m = r && r.modes[Math.min(FT.sel, r.modes.length - 1)];
  if (!m) {
    $('#kpis').innerHTML = [kpi('Load factor λ', '—'), kpi('Critical', '—'), kpi('Half-waves', '—')].join('');
    return;
  }
  const acts = [['N', FT.N, 'kN'], ['M', FT.M, 'kNm'], ['T', FT.T, 'kNm'], ['V', FT.V, 'kN']].filter((a) => a[1] !== 0);
  const hw = ftHalfWaves(m.f);
  $('#kpis').innerHTML = [
    kpi(`Load factor λ${FT.sel ? ` <small>mode ${FT.sel + 1}</small>` : ''}`, ftf(m.lf)),
    ...acts.slice(0, 2).map((a) => kpi(`${a[0]}<sub>cr</sub>`, `${ftf(m.lf * a[1])} <small>${a[2]}</small>`)),
    kpi('Half-waves', `${hw.around} <small>around</small> · ${hw.along} <small>along</small>`),
  ].join('');
}

/* The tube's results: the whole analysis pane. */
function paneFtm() {
  if (FT.err) { pane.innerHTML = `<div class="note" role="alert" style="color:var(--ink)">⚠ ${FT.err}</div>`; return; }
  const r = FT.res;
  if (!r || !r.modes.length) { pane.innerHTML = '<div class="note">⌁ solving the tube…</div>'; return; }
  const m = r.modes[Math.min(FT.sel, r.modes.length - 1)];
  const R = r.R, nu = P.nu;
  const scl = P.E * FT.t / R / Math.sqrt(3 * (1 - nu * nu));
  const omega = FT.L / R * Math.sqrt(FT.t / R);
  const acts = [['σ<sub>N</sub>', r.s[0]], ['σ<sub>M</sub>', r.s[1]], ['τ<sub>T</sub>', r.s[2]], ['τ<sub>V</sub>', r.s[3]]]
    .filter((a) => a[1] !== 0);
  pane.innerHTML = `
    <div class="chips" style="margin:0 0 10px">${r.modes.map((md, i) =>
      `<button class="chip ${i === FT.sel ? 'sel' : ''}" data-mode="${i}">Mode ${i + 1} · λ ${ftf(md.lf)}</button>`).join('')}</div>
    <div class="readout">
      <div>Load factor λ<b>${ftf(m.lf)}</b></div>
      ${acts.map((a) => `<div>${a[0]} at buckling<b>${ftf(m.lf * a[1])} MPa</b></div>`).join('')}
      <div>Classical σ<sub>cl</sub><b>${ftf(scl)} MPa</b></div>
      <div>Ω = L/R √(t/R)<b>${omega.toFixed(2)}</b></div>
      <div>Peak w at<b>θ ${ftPeak(m.f).deg}° · y ${ftPeak(m.f).y.toFixed(2)} L</b></div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.2fr);gap:14px;align-items:start;margin-top:10px">
      <svg id="ftTube" viewBox="0 0 300 520" style="width:100%;display:block" role="img" aria-label="The buckled tube"></svg>
      <div>
        <svg id="ftMap" viewBox="0 0 360 250" style="width:100%;display:block" role="img" aria-label="Radial displacement, unrolled"></svg>
        <div class="note">Radial displacement w, unrolled: around the tube (θ, 0 to 360°) across, base to top up.
          Red outward, blue inward. θ = 0 is the compression side of M.</div>
        <div class="note">${r.dofs} unknowns · ${FT.p} harmonics around, wave numbers ${r.js.join(', ')} along ·
          ${r.ms.toFixed(0)} ms</div>
        <div class="note">Finite tube method (Ádány &amp; Schafer, Thin-Walled Structures 206, 2025). A linear
          (bifurcation) analysis of the perfect tube: real tubes buckle well below it, so a design check applies the
          imperfection reduction of EN 1993-1-6 (or the governing code) to these values.</div>
      </div>
    </div>`;
  pane.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { FT.sel = +b.dataset.mode; tubeKpis(); paneFtm(); });
  ftDraw(m, R);
}

/* Half-waves of w through its largest value: sign changes around that ring and along that line,
   ignoring the part under 5 % of the peak (a local buckle is flat elsewhere). */
function ftHalfWaves(f) {
  const w = (i, j) => f[(i * FT_NY + j) * 3 + 2];
  let bi = 0, bj = 0, big = 0;
  for (let i = 0; i < FT_NTH; i++) for (let j = 0; j < FT_NY; j++) if (Math.abs(w(i, j)) > big) { big = Math.abs(w(i, j)); bi = i; bj = j; }
  const count = (vals, closed) => {
    const sig = vals.filter((v) => Math.abs(v) > 0.05 * big).map(Math.sign);
    let c = 0;
    for (let k = 1; k < sig.length; k++) if (sig[k] !== sig[k - 1]) c++;
    if (closed && sig.length > 1 && sig[0] !== sig[sig.length - 1]) c++;
    return closed ? Math.max(c, 1) : c + 1;
  };
  return { around: count(Array.from({ length: FT_NTH }, (_, i) => w(i, bj)), true),
           along: count(Array.from({ length: FT_NY }, (_, j) => w(bi, j)), false) };
}

/* Where the radial displacement peaks: θ in degrees and height as a fraction of L. */
function ftPeak(f) {
  let bi = 0, bj = 0, big = 0;
  for (let i = 0; i < FT_NTH; i++)
    for (let j = 0; j < FT_NY; j++) {
      const w = Math.abs(f[(i * FT_NY + j) * 3 + 2]);
      if (w > big) { big = w; bi = i; bj = j; }
    }
  return { deg: Math.round(360 * bi / FT_NTH), y: bj / (FT_NY - 1) };
}

function ftColour(v) {   // −1..1 → blue … neutral … red
  const a = Math.max(-1, Math.min(1, v));
  return a >= 0 ? `hsl(8 ${Math.round(75 * a)}% ${Math.round(62 - 14 * a)}%)`
                : `hsl(212 ${Math.round(-75 * a)}% ${Math.round(62 + 14 * a)}%)`;
}

function ftDraw(m, R, svgTube = $('#ftTube'), svgMap = $('#ftMap')) {
  const f = m.f, at = (i, j) => (i * FT_NY + j) * 3;
  let big = 0;
  for (let k = 0; k < f.length; k += 3) big = Math.max(big, Math.abs(f[k]), Math.abs(f[k + 2]));
  if (!big) big = 1;
  const wmax = (() => { let b = 0; for (let k = 2; k < f.length; k += 3) b = Math.max(b, Math.abs(f[k])); return b || 1; })();

  // Unrolled map of w.
  const map = svgMap;
  if (map) {
    const W = 330, H = 220, x0 = 24, y0 = 8, cw = W / FT_NTH, ch = H / (FT_NY - 1);
    let s = '';
    for (let i = 0; i < FT_NTH; i++)
      for (let j = 0; j < FT_NY - 1; j++) {
        const v = (f[at(i, j) + 2] + f[at(i, j + 1) + 2]) / 2 / wmax;
        s += `<rect x="${(x0 + i * cw).toFixed(1)}" y="${(y0 + H - (j + 1) * ch).toFixed(1)}" width="${(cw + 0.3).toFixed(1)}" height="${(ch + 0.3).toFixed(1)}" fill="${ftColour(v)}"/>`;
      }
    s += `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="none" stroke="var(--line2)"/>`;
    s += `<text x="${x0}" y="${y0 + H + 14}" font-size="10" fill="var(--ink3)">0°</text>
          <text x="${x0 + W / 2}" y="${y0 + H + 14}" font-size="10" fill="var(--ink3)" text-anchor="middle">180°</text>
          <text x="${x0 + W}" y="${y0 + H + 14}" font-size="10" fill="var(--ink3)" text-anchor="end">360°</text>
          <text x="${x0 - 4}" y="${y0 + H}" font-size="10" fill="var(--ink3)" text-anchor="end">0</text>
          <text x="${x0 - 4}" y="${y0 + 9}" font-size="10" fill="var(--ink3)" text-anchor="end">L</text>`;
    map.innerHTML = s;
  }

  // The tube, standing up, drawn with the mode exaggerated.
  const svg = svgTube;
  if (!svg) return;
  const Hs = 420, top = 34, cx = 150;
  const axial = Hs / FT.L;                                   // mm → px along the tube
  const radial = Math.max(axial, 0.24 * Hs / (2 * R));      // widened for slender tubes
  const amp = 0.4 * R / big;                                // mode exaggeration, in mm
  const az = -0.9, el = 0.35;                                // θ = 0 (bending compression) faces you
  const proj = (i, j) => {
    const th = 2 * Math.PI * i / FT_NTH, y = FT.L * j / (FT_NY - 1), k = at(i % FT_NTH, j);
    const rr = R + amp * f[k + 2], ut = amp * f[k];
    const X = (rr * Math.cos(th) - ut * Math.sin(th)) * radial, Z = (rr * Math.sin(th) + ut * Math.cos(th)) * radial;
    const Y = (y + amp * f[k + 1]) * axial;
    const x1 = X * Math.cos(az) + Z * Math.sin(az), z1 = -X * Math.sin(az) + Z * Math.cos(az);
    return [cx + x1, top + Hs - Y * Math.cos(el) + z1 * Math.sin(el), z1];
  };
  let s = '';
  const seg = (a, b, v) => `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${ftColour(v)}" stroke-width="${a[2] > 0 ? 1.6 : 0.7}" opacity="${a[2] > 0 ? 1 : 0.45}"/>`;
  for (let j = 0; j < FT_NY; j += 2)
    for (let i = 0; i < FT_NTH; i++) s += seg(proj(i, j), proj(i + 1, j), f[at(i, j) + 2] / wmax);
  for (let i = 0; i < FT_NTH; i += 3)
    for (let j = 0; j < FT_NY - 1; j++) s += seg(proj(i, j), proj(i, j + 1), f[at(i, j) + 2] / wmax);
  const endLbl = (v) => FT_ENDS.find((e) => +e[0] === v)[1].toLowerCase();
  s += `<text x="${cx}" y="${top + Hs + 40}" font-size="11" fill="var(--ink3)" text-anchor="middle">base: ${endLbl(FT.base)}</text>
        <text x="${cx}" y="${14}" font-size="11" fill="var(--ink3)" text-anchor="middle">top: ${endLbl(FT.top)}</text>`;
  if (radial > axial * 1.01)
    s += `<text x="4" y="${top + Hs + 56}" font-size="9" fill="var(--ink3)">drawn ${(radial / axial).toFixed(1)}× wider than true; mode exaggerated</text>`;
  svg.innerHTML = s;
}

/* Renders the side pane. A pane that awaits the engine (Loads, Mode browser) takes the
   generation it started with: if a newer render supersedes it while it waits, it does not
   write, so an older result can never land on top of a newer one. */
let renderGen = 0;
/* A re-render replaces the pane's controls, which would drop a keyboard user's focus on the page
   body: the focus goes back to the same control in the new pane (by id or its data key), else to
   the pane itself, so Tab carries on from where it was. */
const FOCUS_KEYS = ['data-min', 'data-step', 'data-norm', 'data-tbl', 'data-tsub'];
function paneFocusKey() {
  const a = document.activeElement;
  if (!a || a === pane || !pane.contains(a)) return a === pane ? '' : null;
  if (a.id) return `#${CSS.escape(a.id)}`;
  for (const k of FOCUS_KEYS) if (a.hasAttribute(k)) return `[${k}="${CSS.escape(a.getAttribute(k))}"]`;
  return '';
}
async function renderPane() {
  const key = paneFocusKey();
  const gen = renderGen + 1;
  await renderPaneNow();
  if (key === null || gen !== renderGen || pane.contains(document.activeElement) && document.activeElement !== pane) return;
  const el = key && pane.querySelector(key);
  (el || pane).focus({ preventScroll: true });
}
async function renderPaneNow() {
  const gen = ++renderGen;
  syncShell();
  matSummary();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('[data-more]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.more === tab)));
  // Docs opens the guide's page for what is on screen: the console's page from the Python tab
  const docsBtn = document.getElementById('docsBtn');
  if (docsBtn) docsBtn.setAttribute('href', tab === 'python' ? 'guide/console.html' : 'guide/');
  // the Extensions view is one persistent element: re-rendering the pane after a solve must not
  // reset an open module's form
  if (tab === 'extensions') { extUI.show(pane); return; }
  if (tab === 'python') { await showConsole(); return; }   // the console: persistent too, a run survives a solve
  if (tab === 'projects') { paneProjects(); return; }
  if (tab === 'ftm') { paneFtm(); return; }
  if (!sig || !disp) {
    if (tab === 'tables') { paneTables(); noteEngine(); return; }
    // Loads works without a signature: its numbers come from props/stresgen/firstYield
    if (tab === 'loads' && engineReady && geo && geo.elems.length) {
      await paneLoads(gen);
      if (gen !== renderGen) return;
      noteEngine();
      return;
    }
    if (!geo || !geo.elems.length)
      pane.innerHTML = `<div class="note">no elements left — open <b>Nodes &amp; elements</b>
        and press <b>Reset model</b> to restore the section.</div>`;
    else if (engineErr)                                  // the engine's own error (or load failure)
      pane.innerHTML = `<div class="note engineerr" role="alert">⚠ ${engineErr}
        <button class="btn engineRetry">Retry</button></div>`;
    else if (!engineReady)                     // the wasm is still fetching
      pane.innerHTML = '<div class="note">Loading the engine…</div>';
    else
      pane.innerHTML = '<div class="note">⌁ solving…</div>';
    noteEngine();
    return;
  }
  if (tab === 'sig') paneSig();
  else if (tab === 'mode') await paneMode(gen);
  else if (tab === 'mode3d') await paneMode3d(gen);
  else if (tab === 'loads') await paneLoads(gen);
  else if (tab === 'cfsm') paneCfsm();
  else paneTables();
  if (gen !== renderGen) return;
  noteEngine();
}

/* when the engine declined a model, say so above whatever is on screen — the Loads and
   tables panes keep their content and carry the note; a pane that is already showing the
   error (the full-pane error above, or the cFSM pane's own) is left alone */
function noteEngine() {
  if (!engineErr) return;
  if (pane.querySelector('.engineerr')) return;
  const d = document.createElement('div');
  d.className = 'note engineerr';
  d.textContent = `⚠ ${engineErr}`;
  const retry = document.createElement('button');
  retry.className = 'btn engineRetry';
  retry.textContent = 'Retry';
  d.append(' ', retry);
  pane.prepend(d);
}

/* Retry: restart the worker (a crashed one is replaced), wait for it, then solve again.
   One listener on the pane covers both places the button appears. */
pane.addEventListener('click', (e) => {
  if (!(e.target instanceof Element) || !e.target.matches('.engineRetry')) return;
  engineErr = null;
  engine.restart();
  setBusy(true, 'Restarting the engine…', 0);
  engine.ready.then(() => { engineReady = true; setBusy(false); update(); })
    .catch((err) => { engineReady = false; engineErr = 'engine failed to load: ' + (err?.message ?? String(err)); setBusy(false); renderPane(); });
});

/* shared controls ------------------------------------------------------- */
function normToggle() {
  return `<span class="toggle" id="normToggle" title="Stress: results are the buckling stress. Force: results are a load factor against the reference stress on the nodes.">
    <button data-norm="stress" class="${acts.norm === 'stress' ? 'on' : ''}">σ (MPa)</button>
    <button data-norm="force" class="${acts.norm === 'force' ? 'on' : ''}">λ force</button></span>`;
}
function wireNorm(root) {
  root.querySelectorAll('[data-norm]').forEach((b) => b.onclick = () => { acts.norm = b.dataset.norm; update(true); });
}
function minimaChips(extra = '') {
  if (!disp || !disp.minima.length) return '<span class="note" style="margin:0">no minima — the model has no strips</span>';
  return disp.minima.map((i, k) => {
    const p = disp.pts[i];
    return `<button class="chip ${k === selMin && p.L === selL ? 'sel' : ''}" data-min="${k}">${FAM[p.fam].k} @ ${Math.round(p.L)} mm</button>`;
  }).join('') +
    `<button class="chip" data-step="-1" title="previous minimum">‹</button>
     <button class="chip" data-step="1" title="next minimum">›</button>` + extra;
}
function wireChips(root) {
  root.querySelectorAll('[data-min]').forEach((b) => b.onclick = () => pickMin(+b.dataset.min));
  root.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => {
    const n = disp ? disp.minima.length : 0;
    if (n) {
      selMin = (selMin + +b.dataset.step + n) % n;
      selL = disp.pts[disp.minima[selMin]].L; selModeIdx = 0;
      renderPane();
    }
  });
}

/* The mode browser's steppers: any analysed length, any of the found modes. */
function wireModeBrowser(root) {
  const step = (d) => {
    const i = P.lengths.indexOf(selL);
    selL = P.lengths[Math.max(0, Math.min(P.lengths.length - 1, (i < 0 ? 0 : i) + d))];
    selModeIdx = 0; renderPane();
  };
  $('#lenPrev').onclick = () => step(-1);
  $('#lenNext').onclick = () => step(1);
  $('#modePrev').onclick = () => stepMode(-1);
  $('#modeNext').onclick = () => stepMode(1);
}
async function stepMode(d) {
  if (d < 0) selModeIdx = Math.max(0, selModeIdx - 1);
  else {
    const s = await selModeData();
    if (s) selModeIdx = Math.min(s.r.found - 1, selModeIdx + 1);
  }
  renderPane();
}
/* a sideways swipe on the 2D mode drawing steps the mode (left: the next one); the ◂ ▸ buttons
   stay, so nothing is gesture-only. The drawing keeps vertical page scroll (pan-y). */
function swipeModes(svg) {
  svg.style.touchAction = 'pan-y';
  let sw = null;
  svg.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') sw = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  svg.addEventListener('pointercancel', () => { sw = null; });
  svg.addEventListener('pointerup', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    sw = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 2 * Math.abs(dy)) stepMode(dx < 0 ? 1 : -1);
  });
}
/* The mode browser's toolbar: length ◂ ▸, mode ◂ ▸ and play. On a phone it stands in the thumb
   zone, above the tab bar (styles/shell.css); elsewhere it is a row above the drawing. */
const modeBar = (s) => `
    <div class="controls modebar" role="toolbar" aria-label="Mode browser">${s ? `
      <span class="stepper"><button class="btn" id="lenPrev" title="previous analysed length" aria-label="Previous length">‹</button>
        <span class="sv">L = ${Math.round(s.L)} mm</span><button class="btn" id="lenNext" title="next analysed length" aria-label="Next length">›</button></span>
      <span class="stepper"><button class="btn" id="modePrev" title="previous mode" aria-label="Previous mode">‹</button>
        <span class="sv">mode ${selModeIdx + 1} / ${s.r.found}</span><button class="btn" id="modeNext" title="next mode" aria-label="Next mode">›</button></span>` : ''}
      <button class="btn" id="playBtn"><span aria-hidden="true">${playing ? '⏸' : '▶'}</span> <span>${playing ? 'Pause' : 'Play'}</span></button>
    </div>`;
const modeReadout = (s) => `
    <div>Mode class<b>${FAM[s.fam].k} · ${FAM[s.fam].label}</b></div>
    <div>${acts.norm === 'force' ? 'λ' : 'σ_cr'}<b data-lf="${s.md.lf}">${fmtU(s.md.lf * acts.ref * dscale())}</b></div>
    <div>${lengthWord()}<b>${Math.round(s.L)} mm</b></div>
    <div>Mode<b>${selModeIdx + 1} of ${s.r.found}</b></div>
    ${s.md.cls.every(Number.isFinite) ? `<div>Modal content<b>G ${s.md.cls[0].toFixed(0)}% · D ${s.md.cls[1].toFixed(0)}% · L ${s.md.cls[2].toFixed(0)}% · O ${s.md.cls[3].toFixed(0)}%</b></div>` : ''}`;

/* ", recurs at 232 … 936 mm (7 more)": the lengths a collapsed minimum stands for */
const recurs = (p) => !p.also || !p.also.length ? ''
  : p.also.length === 1 ? `, recurs at ${Math.round(p.also[0])} mm`
  : `, recurs at ${Math.round(p.also[0])} … ${Math.round(p.also[p.also.length - 1])} mm (${p.also.length} more)`;

function paneSig() {
  pane.innerHTML = `
    <div class="controls">
      <label>${engBc()} <span style="color:var(--ink3)">· ${engTerms()} term${engTerms() > 1 ? 's' : ''} · ${P.lengths.length} ${P.solution === 'general' ? 'lengths' : 'half-wavelengths'}</span></label>
      ${normToggle()}
      <span class="note" style="margin:0">${matchMedia('(pointer: coarse)').matches ? 'drag along the curve to read it' : 'hover the curve for values'}</span>
    </div>
    <div class="resview" id="sigView">
      <button type="button" class="btn icon fullx" aria-label="Leave full screen" title="Leave full screen">✕</button>
      <div class="chartbox"><svg class="chart" id="sigChart" viewBox="0 0 600 340" role="img" aria-label="${escHtml(sigSummary())} Arrow keys read it point by point; Enter on a minimum selects it." aria-describedby="sigTable"></svg></div>
      <div class="chartread" id="chartReadout" aria-live="polite">${selMinText()}</div>
      ${sigTable()}
    </div>
    <div class="controls minrow">${minimaChips(`<button class="btn" id="showMode" title="The mode shape at the selected minimum">Show mode ▸</button>`)}</div>
    <div class="readout">
      ${disp.minima.map((i) => { const p = disp.pts[i]; return `<div>${FAM[p.fam].label} minimum<b>${fmtU(p.sy)} @ ${Math.round(p.L)} mm${recurs(p)}</b></div>`; }).join('')}
    </div>`;
  wireNorm(pane);
  wireChips(pane);
  wireFull();
  $('#showMode').onclick = () => {
    const back = lastView.modes;
    tab = back === 'mode3d' ? 'mode3d' : 'mode';
    renderPane();
  };
  drawChart($('#sigChart'), { points: disp.pts, series: [{ points: disp.pts }],
                               markers: disp.minima.map((i, k) => ({ i, sel: k === selMin && disp.pts[i].L === selL })),
                               ylabel: acts.norm === 'force' ? 'λ = P_cr / P_ref' : 'σ_cr (MPa)',
                               readout: $('#chartReadout'),
                               onSnap: (k) => pickMin(k) });
}

/* The signature chart's text alternative: a one-line summary naming the governing point (the
   lowest on the curve, as the KPI shows it) and a visually hidden table of the minima, for a
   screen reader. Every number is the engine's, formatted as on screen. */
function sigSummary() {
  if (!disp || !disp.pts.length) return 'Signature curve';
  const gov = disp.pts.reduce((a, b) => (b.sy < a.sy ? b : a));
  const what = acts.norm === 'force' ? 'load factor λ' : 'buckling stress';
  return `Signature curve of ${what} against half-wavelength, ${disp.pts.length} lengths, ${disp.minima.length} minima. `
    + `Governing: ${FAM[gov.fam].label}, ${plain(fmtU(gov.sy))} at ${Math.round(gov.L)} mm.`;
}
const plain = (h) => String(h).replace(/<[^>]*>/g, '');
function sigTable() {
  if (!disp || !disp.minima.length) return '';
  return `<div class="sr-only"><table id="sigTable"><caption>Minima of the signature curve</caption>
    <thead><tr><th scope="col">Minimum</th><th scope="col">Mode class</th><th scope="col">${acts.norm === 'force' ? 'λ' : 'σcr'}</th><th scope="col">Half-wavelength</th></tr></thead>
    <tbody>${disp.minima.map((i, k) => { const p = disp.pts[i];
      return `<tr><td>${k + 1}${k === selMin && p.L === selL ? ' (selected)' : ''}</td><td>${FAM[p.fam].label}</td><td>${plain(fmtU(p.sy))}</td><td>${Math.round(p.L)} mm</td></tr>`; }).join('')}</tbody></table></div>`;
}

/* the selected minimum, as the readout under the chart shows it when no finger is on it */
function selMinText() {
  const i = disp.minima[selMin];
  if (i === undefined || disp.pts[i].L !== selL) return 'Drag along the curve to read it; let go near a minimum to select it.';
  const p = disp.pts[i];
  return `Selected: <b>${FAM[p.fam].label} minimum</b> · <b>${fmtU(p.sy)}</b> @ <b>${Math.round(p.L)} mm</b>`;
}
function pickMin(k) {
  selMin = k;
  selL = disp.pts[disp.minima[k]].L; selModeIdx = 0;   // a minimum picks its length, mode 1
  renderPane();
}

/* Landscape on a phone: the Curve or Modes view fills the screen (.full on its .resview), until ✕;
   turning the phone again re-arms it. Only from the Curve and Modes tabs (in the medium layout a
   phone turned sideways is in, the rail moves the shell tab with the view). */
const LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
let fullDismissed = false;
LANDSCAPE.addEventListener('change', () => { fullDismissed = false; applyFull(); });
function applyFull() {
  const on = LANDSCAPE.matches && !fullDismissed && ['curve', 'modes'].includes(shell.tab)
    && ['sig', 'cfsm', 'mode', 'mode3d'].includes(tab);
  let any = false;
  for (const v of pane.querySelectorAll('.resview')) { v.classList.toggle('full', on); any = true; }
  document.body.classList.toggle('res-full', on && any);
}
function wireFull() {
  for (const b of pane.querySelectorAll('.resview .fullx')) b.onclick = () => { fullDismissed = true; applyFull(); };
  applyFull();
}

async function paneMode(gen) {
  const s = await selModeData();
  if (gen !== undefined && gen !== renderGen) return;   // a newer render owns the pane
  pane.innerHTML = `
    <div class="controls">${minimaChips()}</div>
    <div class="resview" id="modeView">
      <button type="button" class="btn icon fullx" aria-label="Leave full screen" title="Leave full screen">✕</button>
      <svg id="modeSvg" class="sect modesvg" viewBox="0 0 420 420" role="img" aria-label="${s ? `2D mode shape: ${FAM[s.fam].label}, mode ${selModeIdx + 1} of ${s.r.found} at ${Math.round(s.L)} mm` : '2D mode shape'}" aria-describedby="modeRead"></svg>
      ${modeBar(s)}
    </div>
    <div class="scrub"><span style="color:var(--ink3);font-size:12px">half-wave phase</span><input id="scrub" type="range" aria-label="Half-wave phase, percent" min="0" max="100" value="${((phase % (2 * Math.PI)) / (2 * Math.PI) * 100).toFixed(0)}"></div>
    <div class="readout" id="modeRead"></div>
    <div class="legend"><span><span class="sw" style="background:var(--ink3)"></span>undeformed</span><span><span class="sw" style="background:var(--comp)"></span>mode shape (exaggerated)</span></div>`;
  wireChips(pane);
  wireFull();
  $('#playBtn').onclick = () => { playing = !playing; paneMode(); };
  swipeModes($('#modeSvg'));
  $('#scrub').oninput = (e) => { phase = +e.target.value / 100 * 2 * Math.PI; playing = false; $('#playBtn').innerHTML = '<span aria-hidden="true">▶</span> <span>Play</span>'; drawMode(s); };
  if (s) wireModeBrowser(pane);
  drawMode(s);
}

/* The signature's engine model belongs to the model it was solved for. While a solve for a
   changed model is in flight the old em no longer matches the section on screen, and mixing
   them displaces nodes that the old chain alone knows: skip the overlay until the solve lands. */
const emMatchesModel = (em) => !!(em && geo && em.nodes === geo.nodes.length &&
                                  em.chains.length === geo.elems.length);

async function drawMode(s) {
  const d = s ?? await selModeData();
  const svg = $('#modeSvg');
  if (!svg || tab !== 'mode' || !sig || !d) return;
  const em = emMatchesModel(disp && disp.em) ? disp.em : null;
  drawSection(svg, geo, em
    ? { pad: 56, deformed: { fam: d.fam, phase, mode: d.md, em } }
    : { pad: 56 });
  const rd = $('#modeRead');
  if (rd) rd.innerHTML = modeReadout(d);
}

async function paneMode3d(gen) {
  const s = await selModeData();
  if (gen !== undefined && gen !== renderGen) return;   // a newer render owns the pane
  pane.innerHTML = `
    <div class="controls">${minimaChips()}</div>
    <div class="resview" id="mode3dView">
      <button type="button" class="btn icon fullx" aria-label="Leave full screen" title="Leave full screen">✕</button>
      <svg id="mode3dSvg" class="sect modesvg" viewBox="0 0 420 420" role="img" tabindex="0" aria-label="${s ? `3D mode shape: ${FAM[s.fam].label}, mode ${selModeIdx + 1} of ${s.r.found} at ${Math.round(s.L)} mm. Arrow keys turn it.` : '3D mode shape'}" aria-describedby="mode3dRead"></svg>
      ${modeBar(s)}
    </div>
    <div class="scrub"><span style="color:var(--ink3);font-size:12px">half-wave phase</span><input id="scrub" type="range" aria-label="Half-wave phase, percent" min="0" max="100" value="${((phase % (2 * Math.PI)) / (2 * Math.PI) * 100).toFixed(0)}"></div>
    <div class="scrub"><span style="color:var(--ink3);font-size:12px">view</span>
      <button class="btn" id="viewReset" title="Back to the default isometric view">⟳ reset view</button>
      <span class="note" style="margin:0">drag the 3D view to rotate it</span></div>
    <div class="readout" id="mode3dRead"></div>
    <div class="legend"><span><span class="sw" style="background:var(--comp)"></span>section stations along the half-wave</span><span><span class="sw" style="background:var(--ink3)"></span>longitudinal rails</span></div>`;
  wireChips(pane);
  wireFull();
  $('#playBtn').onclick = () => { playing = !playing; paneMode3d(); };
  $('#scrub').oninput = (e) => { phase = +e.target.value / 100 * 2 * Math.PI; playing = false; $('#playBtn').innerHTML = '<span aria-hidden="true">▶</span> <span>Play</span>'; draw3d(); };
  $('#viewReset').onclick = () => { yaw = Math.PI / 4; pitch = Math.PI / 6; draw3d(); };
  // the keyboard's orbit (drag is not the only way): arrows turn the view 10° a press
  $('#mode3dSvg').addEventListener('keydown', (e) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (!d) return;
    e.preventDefault();
    yaw += d[0] * Math.PI / 18;
    pitch = Math.max(0.15, Math.min(1.45, pitch + d[1] * Math.PI / 18));   // the drag's limits
    draw3d();
  });
  // drag to orbit: yaw with horizontal movement, elevation with vertical
  const svg3 = $('#mode3dSvg');
  svg3.style.touchAction = 'none';
  let rot = null, rotQueued = false;
  svg3.addEventListener('pointerdown', (e) => {
    rot = { x: e.clientX, y: e.clientY };
    svg3.classList.add('dragging');
    try { svg3.setPointerCapture(e.pointerId); } catch { /* */ }
  });
  svg3.addEventListener('pointermove', (e) => {
    if (!rot) return;
    yaw += (e.clientX - rot.x) * 0.011;
    pitch = Math.max(0.15, Math.min(1.45, pitch + (e.clientY - rot.y) * 0.011));
    rot = { x: e.clientX, y: e.clientY };
    if (!rotQueued) {
      rotQueued = true;
      requestAnimationFrame(() => { rotQueued = false; draw3d(); });
    }
  });
  const rotEnd = (e) => {
    if (!rot) return;
    rot = null;
    svg3.classList.remove('dragging');
    try { svg3.releasePointerCapture(e.pointerId); } catch { /* */ }
  };
  svg3.addEventListener('pointerup', rotEnd);
  svg3.addEventListener('pointercancel', rotEnd);
  if (s) wireModeBrowser(pane);
  draw3d(s);
}

async function draw3d(s) {
  const d = s ?? await selModeData();
  const svg = $('#mode3dSvg');
  if (!svg || tab !== 'mode3d' || !sig || !d) return;
  if (emMatchesModel(disp && disp.em)) draw3D(svg, geo, d.fam, phase, d.L, d.md, disp.em);
  else svg.innerHTML = '';
  const rd = $('#mode3dRead');
  if (rd) rd.innerHTML = modeReadout(d) + `
    <div>Stations drawn<b>11</b></div>`;
}

/* The yield readouts: enough digits that a parse of the DOM text is the number (the smoke
   suite reads them). Pretty-printing shorter forms belongs to the report. */
const fmtY = (v) => (Number.isFinite(v) ? String(+v.toPrecision(5)) : '-');
const YIELDS = [['useP', 'Py', 'Py', 'P', 'N'], ['useMxx', 'Mxxy', 'Mxx', 'Mxx', 'N·mm'],
                ['useMzz', 'Mzzy', 'Mzz', 'Mzz', 'N·mm'], ['useM11', 'M11y', 'M11', 'M11', 'N·mm'],
                ['useM22', 'M22y', 'M22', 'M22', 'N·mm'], ['useB', 'By', 'B', 'B', 'N·mm²']];

async function paneLoads(gen) {
  const [y, pr] = await Promise.all([yieldVals(), sectionProps()]);
  if (gen !== undefined && gen !== renderGen) return;   // a newer render owns the pane
  const actField = (k, u) => numFieldHtml({ id: k, label: k, unit: u, value: dnum(LOADS[k]), cls: 'act' });
  const yBtn = (use, rid, yk, u) => `<button class="btn ybtn" id="${use}" ${y ? '' : 'disabled'}
    title="Use ${rid.replace(/y$/, '')} at first yield as the demand (the other actions go to zero)">
    <span>${rid.slice(0, -1)}</span> <b id="${rid}">${y ? fmtY(y[yk]) : '-'}</b> <span class="u">${u}</span></button>`;
  pane.innerHTML = `
    <div class="loadsgrid">
      <div class="group" style="border-top:0;margin-top:0;padding-top:0">
        <h2>Reference applied loads</h2>
        ${LOADFIT ? `<div class="note s2a" id="loadFit">${loadFitText()}</div>` : ''}
        ${actField('P', 'N')}${actField('B', 'N·mm²')}
        ${actField('Mxx', 'N·mm')}${actField('M11', 'N·mm')}
        ${actField('Mzz', 'N·mm')}${actField('M22', 'N·mm')}
        <label class="chk"><input type="checkbox" id="restrained" ${LOADS.restrained ? 'checked' : ''}>
          restrained bending about x-z</label>
        <div class="tbar">
          <button class="btn" id="fromStress" title="Fit P, M11, M22 and B to the nodal stresses in the model">Generate from stress</button>
          <button class="link" id="unitP" title="P = A: the reference stress is 1 MPa at every node, so the curve reads as stress">unit stress (σ = 1)</button>
        </div>
        ${S2A ? `<div class="note s2a" id="s2aConfirm">${S2A.error ? `⚠ ${S2A.error}` : `Actions fitted to the stresses in the model:
          P ${fmtY(S2A.P)} N, M11 ${fmtY(S2A.M11)} N·mm, M22 ${fmtY(S2A.M22)} N·mm, B ${fmtY(S2A.B)} N·mm².
          Fit err ||Gf - s|| = ${fmtY(S2A.err)} MPa.`}
          <span class="tbar"><button class="btn primary" id="s2aUse" ${S2A.error ? 'disabled' : ''}>Use these</button>
          <button class="btn" id="s2aCancel">Cancel</button></span></div>` : ''}
        <div class="note">All six actions add together, as in CUFSM. Mxx and Mzz act about the geometric
          axes (with restrained bending, about x-z as drawn); M11 and M22 about the principal axes.</div>
      </div>
      <div class="group" style="border-top:0;margin-top:0;padding-top:0">
        <h2>First yield</h2>
        ${numFieldHtml({ id: 'fyL', label: 'fy', unit: 'MPa', value: dnum(LOADS.fy), allowNegative: false }).replace('>fy</label>', '>f<sub>y</sub></label>')}
        <label class="chk"><input type="checkbox" id="extremeFibre" ${LOADS.extremeFibre ? 'checked' : ''}>
          extreme fibre (through the thickness, not just the centreline)</label>
        <div class="ygrid">
          ${YIELDS.map(([use, rid, yk, , u]) => yBtn(use, rid, yk, u)).join('')}
        </div>
        <div class="note">Tap a value to use it as the demand.</div>
      </div>
    </div>
    <div class="group">
      <h2>Reference stress</h2>
      <svg id="loadSvg" class="sect" viewBox="0 0 420 315" style="width:100%;max-width:460px;aspect-ratio:4/3;display:block" role="img" aria-label="The reference stress on the section: compression solid, tension dashed, darker for more"></svg>
      <div class="legend">
        <span><span class="sw dash" style="--c:var(--tens)"></span>tension (dashed)</span>
        <span class="ramp"></span>
        <span><span class="sw" style="background:var(--comp)"></span>compression</span>
        <span id="loadMax"></span>
      </div>
      <div class="controls" style="margin-top:2px">
        ${normToggle()}
        <span class="note" style="margin:0">reference σ<sub>ref</sub> = ${fmtY(acts.ref)} MPa (max |nodal stress|,
          range ${fmtY(minStress())} … ${fmtY(maxStress())} MPa)</span>
      </div>
    </div>
    <div class="group">
      <h2>Section properties</h2>
      ${pr ? `<div class="readout">
        <div>A<b>${fmtY(pr.A)} mm²</b></div>
        <div>x<sub>cg</sub>, z<sub>cg</sub><b>${fmtY(pr.xcg)}, ${fmtY(pr.zcg)} mm</b></div>
        <div>Ixx<b>${fmtY(pr.Ixx)} mm⁴</b></div>
        <div>Izz<b>${fmtY(pr.Izz)} mm⁴</b></div>
        <div>Ixz<b>${fmtY(pr.Ixz)} mm⁴</b></div>
        <div>θ<sub>p</sub><b>${fmtY(pr.thetap)}°</b></div>
        <div>I11<b>${fmtY(pr.I11)} mm⁴</b></div>
        <div>I22<b>${fmtY(pr.I22)} mm⁴</b></div>
        <div>J<b>${fmtY(pr.J)} mm⁴</b></div>
        <div>x<sub>s</sub>, z<sub>s</sub><b>${fmtY(pr.xs)}, ${fmtY(pr.zs)} mm</b></div>
        <div>Cw<b>${fmtY(pr.Cw)} mm⁶</b></div>
      </div>` : '<div class="note">Loading the engine…</div>'}
    </div>`;
  drawSection($('#loadSvg'), geo, { pad: 46, stress: true });
  $('#loadMax').textContent = `max |σ| = ${fmtY(maxOf(geo.stress.map(Math.abs)))} MPa`;
  wireNorm(pane);

  /* Any action change regenerates the reference stress (debounced) and re-solves. */
  for (const k of ACTKEYS) {
    const inp = document.getElementById(k);
    if (inp) bindNumField(inp.closest('.numfield'), { live: true, onCommit: (v) => {
      LOADS[k] = v;
      clearTimeout(loadTimer);
      loadTimer = setTimeout(async () => { loadTimer = null; await regenStress(); update(); }, 150);
    } });
  }
  $('#restrained').onchange = async (e) => {
    LOADS.restrained = e.target.checked;
    await regenStress();
    refreshYield();
    update();
  };
  $('#extremeFibre').onchange = (e) => { LOADS.extremeFibre = e.target.checked; refreshYield(); };
  bindNumField($('#fyL').closest('.numfield'), { above: 0, allowNegative: false, live: true,
    onCommit: (v) => { LOADS.fy = v; $('#fy').value = v; matSummary(); refreshYield(); } });
  YIELDS.forEach(([use, , yk, key]) => {
    const b = $('#' + use);
    if (b) b.onclick = async () => {
      const yy = await yieldVals();
      if (!yy) return;
      for (const k of ACTKEYS) LOADS[k] = 0;
      LOADS[key] = yy[yk];
      S2A = null;
      await regenStress();
      renderPane();
      update();
    };
  });
  $('#unitP').onclick = async () => {
    const props = await sectionProps();
    if (!props) return;
    for (const k of ACTKEYS) LOADS[k] = 0;
    LOADS.P = props.A;
    S2A = null;
    await regenStress();
    renderPane();
    update();
  };
  $('#fromStress').onclick = async () => {
    try { S2A = await engine.call('stressToAction', toBuffers(MODEL)); }
    catch (e) { S2A = { error: String((e && e.message) || e) }; }
    renderPane();
  };
  if (S2A) {
    $('#s2aCancel').onclick = () => { S2A = null; renderPane(); };
    $('#s2aUse').onclick = async () => {
      const r = S2A;
      S2A = null;
      /* CUFSM's guess: fy = max |σ| on the nodes; actions under 0.1 % of their own yield
         value are noise from the fit and drop out. The fit is principal-axis, so Mxx/Mzz go. */
      let mx = 0;
      for (const n of MODEL.nodes) mx = Math.max(mx, Math.abs(n.stress));
      if (mx > 0) { LOADS.fy = mx; $('#fy').value = mx; }
      const yy = await yieldVals();
      const keep = (v, yv) => (yy && yv && Math.abs(v) < 0.001 * Math.abs(yv)) ? 0 : v;
      LOADS.P = keep(r.P, yy && yy.Py);
      LOADS.M11 = keep(r.M11, yy && yy.M11);
      LOADS.M22 = keep(r.M22, yy && yy.M22);
      LOADS.B = keep(r.B, yy && yy.B);
      LOADS.Mxx = 0; LOADS.Mzz = 0;
      await regenStress();
      renderPane();
      update();
    };
  }
}

/* Update only the six yield readouts (fy / restrained / extreme-fibre changes) without
   rebuilding the pane, so the control being touched keeps its focus. Rapid changes: only
   the newest call writes. */
let yieldGen = 0;
async function refreshYield() {
  const g = ++yieldGen;
  const y = await yieldVals();
  if (g !== yieldGen) return;
  for (const [, rid, yk] of YIELDS) {
    const el = document.getElementById(rid);
    if (el) el.textContent = y ? fmtY(y[yk]) : '-';
  }
}
const minStress = () => minOf(MODEL?.nodes.map((n) => n.stress) || [0]);
const maxStress = () => maxOf(MODEL?.nodes.map((n) => n.stress) || [0]);

function startCfsmSolve() {
  cfsmSolving = true;
  const g0 = geo;
  setBusy(true, 'Solving constrained curves…', 0);
  cfsmCurves().then((res) => {
    cfsmSolving = false;
    if (tab === 'cfsm' && geo === g0) renderPane();
    if (res && !solving && solveTimer == null) setBusy(false);
    else if (!res) setBusy(false);
  }).catch(() => {
    cfsmSolving = false;
    setBusy(false);
    if (tab === 'cfsm') renderPane();          // error note via noteEngine
  });
}

function paneCfsm() {
  // engine: the three constrained curves (CUFSM charts G, D, L — O is a classification
  // share, shown in the mode readouts), computed once and cached on this signature.
  // First open: placeholder + background chunked solve; re-render when it lands.
  if (engineReady && !(sig && sig.curves) && !(sig && sig.cfsmFailed)) {
    if (!cfsmSolving) startCfsmSolve();
    pane.innerHTML = `
      <div class="controls"><label>Modal spaces</label>
        <span class="note" style="margin:0">G global · D distortional · L local · O other</span>${normToggle()}</div>
      <div class="chartbox"><svg class="chart" id="cfsmChart" viewBox="0 0 600 340"></svg></div>
      <div class="readout"><div class="note">⌁ solving the constrained curves…</div></div>`;
    wireNorm(pane);
    return;
  }
  const curves = sig && sig.curves;
  if (!curves) {                 // the constrained solve failed — say so rather than draw a guess
    pane.innerHTML = `
      <div class="controls"><label>Modal spaces</label>
        <span class="note" style="margin:0">G global · D distortional · L local · O other</span>${normToggle()}</div>
      <div class="note engineerr" role="alert">⚠ ${engineErr || 'the constrained curves are not available'}
        <button class="btn engineRetry">Retry</button></div>`;
    wireNorm(pane);
    return;
  }
  const col = (key) => disp.pts.map((p, i) => ({ L: p.L, y: curves[key][i] * dscale() }));
  const series = [{ points: disp.pts, cls: 'main' },
                  { points: col('glob'), cls: 'glob' },
                  { points: col('dist'), cls: 'dist' },
                  { points: col('local'), cls: 'nominal' }];
  pane.innerHTML = `
    <div class="controls"><label>Modal spaces</label>
      <span class="note" style="margin:0">G global · D distortional · L local · O other</span>${normToggle()}</div>
    <div class="chartbox"><svg class="chart" id="cfsmChart" viewBox="0 0 600 340"></svg></div>
    <div class="legend">
      <span><span class="sw" style="background:var(--accent)"></span>unconstrained envelope</span>
      <span><span class="sw" style="background:var(--warn)"></span>G space</span>
      <span><span class="sw" style="background:var(--tens)"></span>D space</span>
      <span><span class="sw" style="background:var(--ink3)"></span>L space</span>
    </div>
    <div class="readout">
      ${disp.minima.map((i) => { const p = disp.pts[i]; const sp = FAM[p.fam].k;
        return `<div>${sp} space · mode 1<b>${fmtU(p.sy)} @ ${Math.round(p.L)} mm</b></div>`; }).join('')}
    </div>`;
  wireNorm(pane);
  drawChart($('#cfsmChart'), {
    points: disp.pts,
    series,
    markers: disp.minima.map((i) => ({ i })),
    ylabel: acts.norm === 'force' ? 'λ = P_cr / P_ref' : 'σ_cr (MPa)',
  });
}

/* Selection for Divide / Translate: one element index, a set of node indices. */
let SEL = { elem: -1, nodes: new Set() };
/* The paste panel's text — held here so a re-render (a solve landing) cannot wipe it. */
let PASTE = { open: false, err: '', prop: '', node: '', elem: '' };
/* which table the Nodes & elements tab shows: one at a time, full width */
let TBL = 'nodes';

const dnum = (v) => (Number.isFinite(+v) ? String(+Number(v).toPrecision(9)) : '0');
/* which preset grade a material row still matches — '' once it has been edited by hand.
   The chosen key wins while its values still fit: grades can share E and ν (G250 and C450L0
   are both 200000 / 0.3), and matching by value alone would snap the menu back to the first
   row that looks the same. */
const gradeOf = (q) => {
  const match = (p) => {
    const r = isotropic(q.id, p.E, p.nu);
    return r.ex === q.ex && r.ey === q.ey && r.vx === q.vx && r.vy === q.vy && r.g === q.g;
  };
  if (q.grade && PRESETS[q.grade] && match(PRESETS[q.grade])) return q.grade;
  const m = PRESET_ROWS.find(match);
  return m ? m.key : '';
};
const presetOptions = (q) => {
  const k = gradeOf(q);
  return `<option value="">grade…</option>` + MATERIALS.map(([grp, ms]) =>
    `<optgroup label="${grp}">${ms.map((m) =>
      `<option value="${m[0]}" ${k === m[0] ? 'selected' : ''}>${m[1]}</option>`).join('')}</optgroup>`).join('');
};
/* What the first material row is called: the preset it still matches, or your own values. */
const matLabel = () => {
  const q = currentMat(), k = gradeOf(q);
  const m = PRESET_ROWS.find((p) => p.key === k);
  return m ? `${m.name}, mat ${q.id}` : `mat ${q.id}, your values`;
};

/* a table cell's number through the app's one parser: null (and the cell marked, with the reason
   as its tooltip) when it cannot be used; the value is then not sent to the engine */
function cellNum(inp, opts = {}) {
  const r = parseNum(inp.value, opts);
  inp.classList.toggle('bad', !r.ok);
  inp.setAttribute('aria-invalid', String(!r.ok));
  inp.title = r.ok ? '' : r.message;
  return r.ok ? r.value : null;
}

function paneTables() {
  const subs = [['materials', 'Materials', MATS.length], ['nodes', 'Nodes', MODEL.nodes.length],
    ['elements', 'Elements', MODEL.elems.length], ['springs', 'Springs', SPRINGS.length],
    ['constraints', 'Constraints', CONSTRAINTS.length]];
  const sub = (k) => `class="tsub" data-tsub="${k}" role="tabpanel" ${TBL === k ? '' : 'hidden'}`;
  pane.innerHTML = `
    <div class="subwrap"><div class="subtabs" role="tablist">${subs.map(([k, label, n]) =>
      `<button class="subtab ${TBL === k ? 'on' : ''}" role="tab" aria-selected="${TBL === k}" data-tbl="${k}">${label}<span class="count ${n ? '' : 'zero'}">${n}</span></button>`).join('')}</div></div>
    <section ${sub('materials')}>
      <div>
        <div class="tscroll"><table class="props mats"><thead><tr>
          <th>mat#</th><th>Ex</th><th>Ey</th><th>vx</th><th>vy</th><th>Gxy</th><th>preset</th><th></th>
        </tr></thead>
        <tbody>${MATS.map((q, i) => `<tr>
          <td>${q.id}</td>
          ${['ex', 'ey', 'vx', 'vy', 'g'].map((k) =>
            `<td><input class="nrow" data-mat="${i},${k}" aria-label="Material ${q.id} ${MATCOL[k]}" type="text" inputmode="decimal" autocomplete="off" value="${dnum(q[k])}"></td>`).join('')}
          <td><select class="npreset" data-preset="${i}" aria-label="Material ${q.id} preset">${presetOptions(q)}</select></td>
          <td><button class="rowdel" data-delmat="${i}" ${MATS.length > 1 ? '' : 'disabled'}
            title="${MATS.length > 1 ? 'delete this material; its elements take the first row' : 'the section needs a material'}">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
        <div class="tbar"><button class="btn" id="addMat" title="Add a material row (elements pick theirs in the Elements tab)">+ material</button></div>
        <div class="note">The first row is the section's material. Presets fill Ex, Ey, vx, vy and Gxy;
          edit any cell and the row is yours. Gxy comes from E and ν, so it stays consistent.</div>
      </div>
    </section>
    <section ${sub('nodes')}>
      <div>
        <div class="tscroll"><table class="props nodes"><thead><tr>
          <th>#</th><th>x</th><th>z</th><th>xdof</th><th>zdof</th><th>ydof</th><th>qdof</th><th>stress</th><th></th>
        </tr></thead>
        <tbody>${MODEL.nodes.map((n, i) => `<tr class="${SEL.nodes.has(i) ? 'sel' : ''}" data-noderow="${i}">
          <td>${i + 1}</td>
          <td><input class="nrow" data-nc="${i},x" aria-label="Node ${i + 1} x" type="text" inputmode="decimal" autocomplete="off" value="${dnum(n.x)}"></td>
          <td><input class="nrow" data-nc="${i},z" aria-label="Node ${i + 1} z" type="text" inputmode="decimal" autocomplete="off" value="${dnum(n.z)}"></td>
          ${[0, 1, 2, 3].map((k) => `<td><button class="cell ${n.free[k] ? 'on' : ''}" data-dof="${i},${k}" aria-label="Node ${i + 1} ${['x', 'z', 'y', 'θ'][k]} ${n.free[k] ? 'free' : 'held'}"
            title="dof ${k + 1} — 1 free, 0 held (x, z, y along the member, θ)">${n.free[k] ? 1 : 0}</button></td>`).join('')}
          <td><input class="nrow" data-nc="${i},stress" aria-label="Node ${i + 1} stress" type="text" inputmode="decimal" autocomplete="off" value="${dnum(n.stress)}"></td>
          <td><button class="rowdel" data-delnode="${i}" title="delete node and its elements">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
        <div class="note">Click a row to select the node for <b>Translate</b>. Click a dof cell to hold it
        (or tap a node on the drawing) — CUFSM's four 0/1 columns, and they reach the engine.</div>
        <div class="tbar">
          <button class="btn" id="trBtn" ${SEL.nodes.size ? '' : 'disabled'}>Translate</button>
          <label class="mini">dx <input id="trDx" type="text" inputmode="decimal" autocomplete="off" value="0"></label>
          <label class="mini">dz <input id="trDz" type="text" inputmode="decimal" autocomplete="off" value="0"></label>
          <button class="btn" id="clearSel" ${SEL.nodes.size ? '' : 'disabled'}>Clear</button>
          <span class="note" style="margin:0">${SEL.nodes.size} selected</span>
        </div>
      </div>
    </section>
    <section ${sub('elements')}>
      <div>
        <div class="tscroll"><table class="props elems"><thead><tr>
          <th>#</th><th>nodei</th><th>nodej</th><th>t</th><th>mat</th><th></th>
        </tr></thead>
        <tbody>${MODEL.elems.map((e, i) => `<tr class="${SEL.elem === i ? 'sel' : ''}" data-elemrow="${i}">
          <td>${i + 1}</td><td>${e.i + 1}</td><td>${e.j + 1}</td>
          <td><input data-t="${i}" aria-label="Element ${i + 1} thickness" type="text" inputmode="decimal" autocomplete="off" value="${dnum(e.t)}"></td>
          <td><select data-emat="${i}" aria-label="Element ${i + 1} material">${MATS.map((q) =>
            `<option value="${q.id}" ${q.id === e.mat ? 'selected' : ''}>${q.id}</option>`).join('')}</select></td>
          <td><button class="rowdel" data-delelem="${i}" title="delete this element">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
        <div class="tbar">
          <button class="btn" id="divElem" ${SEL.elem >= 0 ? '' : 'disabled'}
            title="Split the selected element into equal parts">Divide</button>
          <button class="btn" id="dblElems" title="Two elements where there was one — halve every strip">Double all</button>
          <span class="note" style="margin:0">${SEL.elem >= 0 ? `element ${SEL.elem + 1} selected` : 'click a row to select an element'}</span>
        </div>
        <div class="note">Each row is one strip with its own thickness and material. Delete the flanges
        and re-run — the video's plate experiment: the curve moves.</div>
      </div>
    </section>
    <section ${sub('springs')}>
      <div>
        <div class="tscroll"><table class="props"><thead><tr><th>#</th><th>node i</th><th>node j</th><th>ku</th><th>kv</th><th>kw</th><th>kq</th><th>local</th><th>discrete</th><th>ys</th><th></th></tr></thead>
        <tbody>${SPRINGS.map((row, i) => `<tr><td>${i + 1}</td>${row.map((v, k) => `<td><input class="srow" data-sp="${i},${k}" aria-label="Spring ${i + 1} ${SPCOL[k]}" type="text" inputmode="decimal" autocomplete="off" value="${v}"></td>`).join('')}<td><button class="rowdel" data-delsp="${i}" title="delete this spring">✕</button></td></tr>`).join('')}</tbody></table>
        ${SPRINGS.length ? '' : '<div class="empty">No springs. The section is only held by its node dofs and end conditions.</div>'}
        <button class="btn" id="addSpring" title="Add a CUFSM spring row">+ add spring</button></div>
        <div class="note">CUFSM's spring row: node j = -1 for ground. Stiffnesses ku, kv, kw, kq; local
        0/1; discrete 0/1 with ys in 0..1 (fraction of the length).</div>
      </div>
    </section>
    <section ${sub('constraints')}>
      <div>
        <div class="tscroll"><table class="props"><thead><tr><th>#</th><th>node e</th><th>dof e</th><th>coeff</th><th>node k</th><th>dof k</th><th></th></tr></thead>
        <tbody>${CONSTRAINTS.map((row, i) => `<tr><td>${i + 1}</td>${row.map((v, k) => `<td><input class="srow" data-cs="${i},${k}" aria-label="Constraint ${i + 1} ${CSCOL[k]}" type="text" inputmode="decimal" autocomplete="off" value="${v}"></td>`).join('')}<td><button class="rowdel" data-delcs="${i}" title="delete this constraint">✕</button></td></tr>`).join('')}</tbody></table>
        ${CONSTRAINTS.length ? '' : '<div class="empty">No constraints. Every free dof moves independently.</div>'}
        <button class="btn" id="addConstr" title="Add an equation constraint row">+ add constraint</button></div>
        <div class="note">u<sub>e</sub> = coeff &middot; u<sub>k</sub>, between dofs of two nodes: dof 1 = x,
        2 = z, 3 = y along the member, 4 = &theta;.</div>
      </div>
    </section>
    <div class="tbar">
      <button class="btn" id="pasteCufsm">${PASTE.open ? 'Close' : 'Paste / copy CUFSM'}</button>
      <button class="btn" id="copyCufsm" title="Copy the model as three CUFSM blocks">Copy all</button>
      <button class="btn" id="resetModel">Reset model</button>
      <span class="note" style="margin:0">${tRange(geo)} · changing a section parameter rebuilds the model</span>
    </div>
    ${PASTE.open ? `
    <div class="paste" id="pastePanel">
      ${PASTE.err ? `<div class="note" role="alert" style="color:var(--bad)">⚠ ${PASTE.err}</div>` : ''}
      <label>prop <span class="hint">id Ex Ey vx vy Gxy</span><textarea id="pasteProp" rows="4" spellcheck="false"></textarea></label>
      <label>node <span class="hint">i x z xdof zdof ydof qdof stress</span><textarea id="pasteNode" rows="8" spellcheck="false"></textarea></label>
      <label>elem <span class="hint">i nodei nodej t mat</span><textarea id="pasteElem" rows="8" spellcheck="false"></textarea></label>
      <div class="tbar"><button class="btn primary" id="pasteApply">Apply</button>
        <span class="note" style="margin:0">CUFSM's three blocks — errors appear here, nothing is lost.</span></div>
    </div>` : ''}`;

  if (PASTE.open) {
    $('#pasteProp').value = PASTE.prop;
    $('#pasteNode').value = PASTE.node;
    $('#pasteElem').value = PASTE.elem;
    $('#pasteProp').oninput = $('#pasteNode').oninput = $('#pasteElem').oninput = (e) => {
      PASTE[e.target.id.replace('paste', '').toLowerCase()] = e.target.value;
    };
    $('#pasteApply').onclick = async () => {
      PASTE.prop = $('#pasteProp').value; PASTE.node = $('#pasteNode').value; PASTE.elem = $('#pasteElem').value;
      let m;
      try {
        m = fromCufsmText({ prop: PASTE.prop, node: PASTE.node, elem: PASTE.elem });
      } catch (e) {
        PASTE.err = e && e.message ? e.message : String(e);
        paneTables();
        return;
      }
      setModel(m);
      PASTE = { open: false, err: '', prop: '', node: '', elem: '' };
      SEL = { elem: -1, nodes: new Set() };
      toModelShape();
      paneTables();
      engine.cancel();                 // the old section's solve: the fit must not queue behind it
      await fitLoadsToStress();        // the loads describe the pasted stresses, not the old section
      if (MODEL !== m) return;         // another edit landed while the engine answered
      geo = geometry();
      recommendLengths('pasted');      // the old range can hide the new model's minima
    };
  }
  pane.querySelectorAll('.subtab').forEach((b) => {
    b.onclick = () => {
      TBL = b.dataset.tbl;
      pane.querySelectorAll('.subtab').forEach((x) => {
        x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b));
      });
      pane.querySelectorAll('.tsub').forEach((x) => { x.hidden = x.dataset.tsub !== TBL; });
    };
  });
  $('#pasteCufsm').onclick = () => {
    if (PASTE.open) PASTE = { open: false, err: '', prop: '', node: '', elem: '' };
    else {
      const t = toCufsmText(MODEL);
      PASTE = { open: true, err: '', prop: t.prop, node: t.node, elem: t.elem };
    }
    paneTables();
  };
  $('#copyCufsm').onclick = async () => {
    const t = toCufsmText(MODEL);
    const text = `prop\n${t.prop}\n\nnode\n${t.node}\n\nelem\n${t.elem}\n`;
    try {
      await navigator.clipboard.writeText(text);
      const b = $('#copyCufsm'); const old = b.textContent;
      b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = old; }, 1200);
    } catch { /* clipboard refused — the three blocks are on screen anyway */ }
  };

  pane.querySelectorAll('[data-mat]').forEach((inp) => inp.onchange = () => {
    const [i, k] = inp.dataset.mat.split(',');
    const q = MATS[+i], v = cellNum(inp, k === 'vx' || k === 'vy' ? {} : { above: 0 });
    if (!q || v === null) return;
    q[k] = v;
    // an isotropic row keeps Gxy = E / 2(1 + ν); only an orthotropic row sets it by hand
    if (q.ex === q.ey && q.vx === q.vy && k !== 'g') q.g = +(q.ex / (2 * (1 + q.vx))).toPrecision(12);
    P.E = MATS[0].ex; P.nu = MATS[0].vx;
    toModelShape(); paneTables(); update();
  });
  pane.querySelectorAll('[data-preset]').forEach((s) => s.onchange = () => {
    const p = PRESETS[s.value];
    if (!p) return;
    const i = +s.dataset.preset;
    const q = MATS[i];
    const r = isotropic(q.id, p.E, p.nu);
    q.ex = r.ex; q.ey = r.ey; q.vx = r.vx; q.vy = r.vy; q.g = r.g;
    q.grade = p.key;                     // sticks even when another grade shares the same E and ν
    q.fy = p.fy;
    if (i === 0) { P.fy = p.fy; $('#fy').value = P.fy; }   // only the first row is the section's material
    P.E = MATS[0].ex; P.nu = MATS[0].vx;
    toModelShape(); paneTables(); update();
  });
  $('#addMat').onclick = () => {
    const id = Math.max(0, ...MATS.map((q) => +q.id || 0)) + 1;
    MATS.push(isotropic(id, P.E, P.nu));       // MATS is MODEL.mats — one array, one truth
    toModelShape(); paneTables(); update();
  };

  pane.querySelectorAll('[data-noderow]').forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest('input,button,select')) return;
    const i = +tr.dataset.noderow;
    if (SEL.nodes.has(i)) SEL.nodes.delete(i); else SEL.nodes.add(i);
    paneTables();
  });
  pane.querySelectorAll('[data-elemrow]').forEach((tr) => tr.onclick = (e) => {
    if (e.target.closest('input,button,select')) return;
    const i = +tr.dataset.elemrow;
    SEL.elem = SEL.elem === i ? -1 : i;
    paneTables();
  });
  pane.querySelectorAll('[data-nc]').forEach((inp) => inp.onchange = () => {
    const [i, k] = inp.dataset.nc.split(',');
    const n = MODEL.nodes[+i], v = cellNum(inp);
    if (!n || v === null) return;
    if (k === 'stress') { n.stress = v; syncRef(); } else n[k] = v;
    toModelShape(); update();
  });
  pane.querySelectorAll('[data-dof]').forEach((b) => b.onclick = () => {
    const [i, k] = b.dataset.dof.split(',').map(Number);
    const free = MODEL.nodes[i].free;
    free[k] = free[k] ? 0 : 1;
    toModelShape(); paneTables(); update();
  });
  pane.querySelectorAll('[data-delnode]').forEach((b) => b.onclick = () => {
    setModel(deleteNode(MODEL, +b.dataset.delnode));
    SEL = { elem: -1, nodes: new Set() };
    toModelShape(); paneTables(); update();
  });
  pane.querySelectorAll('[data-delmat]').forEach((b) => b.onclick = () => {
    const i = +b.dataset.delmat;
    if (MATS.length <= 1 || !MATS[i]) return;
    const [gone] = MATS.splice(i, 1);            // MATS is MODEL.mats — one array, one truth
    for (const e of MODEL.elems) if (e.mat === gone.id) e.mat = MATS[0].id;
    if (i === 0 && MATS[0].fy != null) { P.fy = MATS[0].fy; $('#fy').value = P.fy; }
    P.E = MATS[0].ex; P.nu = MATS[0].vx;
    toModelShape(); paneTables(); update();
  });
  pane.querySelectorAll('input[data-t]').forEach((inp) => inp.onchange = () => {
    const v = cellNum(inp, { above: 0 });
    if (v === null) return;
    MODEL.elems[+inp.dataset.t].t = v;
    toModelShape(); update();
  });
  pane.querySelectorAll('[data-emat]').forEach((s) => s.onchange = () => {
    const id = +s.value;
    MODEL.elems[+s.dataset.emat].mat = Number.isFinite(id) ? id : s.value;
    toModelShape(); update();
  });
  pane.querySelectorAll('[data-delelem]').forEach((b) => b.onclick = () => {
    setModel(deleteElems(MODEL, [+b.dataset.delelem]));
    SEL = { elem: -1, nodes: new Set() };
    toModelShape(); paneTables(); update();
  });
  $('#divElem').onclick = () => {
    if (SEL.elem < 0 || SEL.elem >= MODEL.elems.length) return;
    const parts = parseInt(prompt('Divide the selected element into how many parts?', '2'), 10);
    if (!Number.isFinite(parts) || parts < 2) return;
    setModel(divideElem(MODEL, SEL.elem, parts));
    SEL = { elem: -1, nodes: new Set() };
    toModelShape(); paneTables(); update();
  };
  $('#dblElems').onclick = () => {
    setModel(doubleElems(MODEL));
    SEL = { elem: -1, nodes: new Set() };
    toModelShape(); paneTables(); update();
  };
  $('#trBtn').onclick = () => {
    if (!SEL.nodes.size) return;
    const dx = cellNum($('#trDx')) ?? 0, dz = cellNum($('#trDz')) ?? 0;
    if (!dx && !dz) return;
    setModel(translateNodes(MODEL, [...SEL.nodes], dx, dz));
    toModelShape(); paneTables(); update();
  };
  $('#clearSel').onclick = () => { SEL = { elem: -1, nodes: new Set() }; paneTables(); };

  pane.querySelectorAll('[data-sp]').forEach((inp) => inp.oninput = () => {
    const [i, k] = inp.dataset.sp.split(',').map(Number);
    const v = cellNum(inp);
    if (v !== null) { SPRINGS[i][k] = v; refreshChips(); update(); }
  });
  pane.querySelectorAll('[data-cs]').forEach((inp) => inp.oninput = () => {
    const [i, k] = inp.dataset.cs.split(',').map(Number);
    const v = cellNum(inp);
    if (v !== null) { CONSTRAINTS[i][k] = v; refreshChips(); update(); }
  });
  pane.querySelectorAll('[data-delsp]').forEach((b) => b.onclick = () => {
    SPRINGS.splice(+b.dataset.delsp, 1); paneTables(); refreshChips(); update();
  });
  pane.querySelectorAll('[data-delcs]').forEach((b) => b.onclick = () => {
    CONSTRAINTS.splice(+b.dataset.delcs, 1); paneTables(); refreshChips(); update();
  });
  $('#addSpring').onclick = () => { SPRINGS.push([0, -1, 0, 0, 0, 0, 0, 1, 0]); paneTables(); refreshChips(); update(); };
  $('#addConstr').onclick = () => { CONSTRAINTS.push([0, 1, 1, 1, 1]); paneTables(); refreshChips(); update(); };
  $('#resetModel').onclick = () => {
    P.shape = P.template;
    SEL = { elem: -1, nodes: new Set() };
    PASTE = { open: false, err: '', prop: '', node: '', elem: '' };
    buildShapes(); buildParams(); buildModel(); refreshChips(); update();
  };
}

/* ----------------------------------------------------------------- inputs */
function buildShapes() {
  $('#shapes').innerHTML = Object.entries(SHAPES).map(([k, s]) =>
    `<button class="shape ${k === P.shape ? 'on' : ''}" data-shape="${k}"><svg viewBox="0 0 30 26">${ICONS[k]}</svg>${
      k === 'model' ? 'Model' : s.name.split(' ')[0]}</button>`).join('');
  $('#shapes').querySelectorAll('.shape').forEach((b) => b.onclick = () => {
    const k = b.dataset.shape;
    // entering Custom: start from the section on screen so you edit rather than begin blank
    if (k === 'custom' && !P.custom) seedCustom();
    P.shape = k; tubeMode(); buildShapes(); buildParams(); buildModel(); update();
  });
}

/* Tube mode: the FSM-only inputs and tabs hide, the tube's own take their place. */
function tubeMode() {
  const on = P.shape === 'tube';
  $('#inputs').classList.toggle('tube', on);
  $('#tabs').classList.toggle('tube', on);
  document.body.dataset.shape = on ? 'tube' : 'fsm';   // the compact tab bar drops Loads, Modes, More
  if (on && tab !== 'projects') tab = 'ftm';          // a tube keeps More's Projects, and nothing else
  else if (tab === 'ftm') tab = 'sig';
  if (on && ['loads', 'modes'].includes(shell.tab)) shell.go('curve');
  if (on && shell.tab === 'more') tab = 'projects';
}

/* Material presets: E, ν and the yield (or 0.2 % proof) strength by grade. Editing any of the three
   by hand makes the material 'custom'. */
const MATERIALS = [
  ['AS 1397 cold-formed sheet and strip', [
    ['G250', 'G250', 200000, 0.3, 250], ['G300', 'G300', 200000, 0.3, 300],
    ['G450', 'G450', 200000, 0.3, 450], ['G500', 'G500', 200000, 0.3, 500],
    ['G550', 'G550', 200000, 0.3, 550,
     'AS/NZS 4600 Cl 1.5.1.5: for G550 under 0.9 mm thick, design with 0.75 f_y (and 0.75 f_u).']]],
  ['AS/NZS 1163 hollow sections', [
    ['C350L0', 'C350L0', 200000, 0.3, 350], ['C450L0', 'C450L0', 200000, 0.3, 450]]],
  ['EN 10025 structural steel (EN 1993-1-1)', [
    ['S235', 'S235', 210000, 0.3, 235], ['S275', 'S275', 210000, 0.3, 275],
    ['S355', 'S355', 210000, 0.3, 355, 'f_y for t ≤ 16 mm; it falls with thickness (EN 10025-2).']]],
  ['ASTM A653 SS sheet (AISI S100)', [
    ['A653-33', 'Grade 33', 203000, 0.3, 230, 'E = 29 500 ksi, F_y = 33 ksi.'],
    ['A653-50', 'Grade 50', 203000, 0.3, 345, 'E = 29 500 ksi, F_y = 50 ksi (Class 1).']]],
  ['Stainless (EN 1993-1-4)', [
    ['1.4301', '1.4301 (304)', 200000, 0.3, 230,
     'f_y is the 0.2 % proof strength of cold-rolled strip; stainless is non-linear well before it.']]],
  ['Aluminium (EN 1999-1-1)', [
    ['6061-T6', '6061-T6', 70000, 0.3, 240,
     'f_o, the 0.2 % proof strength of extruded profiles. EN 1999 takes ν = 0.3.']]],
];
/* The presets as (key, name, E, ν, f_y) rows — the Materials table's preset menu fills
   Ex, Ey, vx, vy and Gxy from them; the row keeps its own mat#. */
const PRESET_ROWS = MATERIALS.flatMap(([, ms]) => ms.map((m) =>
  ({ key: m[0], name: m[1], E: m[2], nu: m[3], fy: m[4], note: m[5] || '' })));
const PRESETS = Object.fromEntries(PRESET_ROWS.map((m) => [m.key, m]));

const FIELDS = {
  h: ['Depth h', 'mm'], b: ['Flange b', 'mm'], d: ['Lip d', 'mm'],
  t: ['Thickness t', 'mm'], mesh: ['Strips / elem', ''],
};
/* the table cells' names for a screen reader (the column heads are abbreviations) */
const MATCOL = { ex: 'Ex', ey: 'Ey', vx: 'vx', vy: 'vy', g: 'Gxy' };
const SPCOL = ['node i', 'node j', 'ku', 'kv', 'kw', 'kq', 'local', 'discrete', 'ys'];
const CSCOL = ['node e', 'dof e', 'coefficient', 'node k', 'dof k'];
function pointsEditor() {
  return `
    <div class="group">
      <h2>Points <span style="color:var(--ink3);font-weight:400;letter-spacing:0;text-transform:none">(x, z), mm — polyline order</span></h2>
      <div class="tscroll"><table class="props"><thead><tr><th>#</th><th>x</th><th>z</th><th></th></tr></thead>
      <tbody>${(P.custom || []).map((q, i) => `<tr>
        <td>${i + 1}</td>
        <td><input class="pt" data-i="${i}" data-c="0" aria-label="Point ${i + 1} x" type="text" inputmode="decimal" value="${q[0]}"></td>
        <td><input class="pt" data-i="${i}" data-c="1" aria-label="Point ${i + 1} z" type="text" inputmode="decimal" value="${q[1]}"></td>
        <td><button class="rowdel" data-ptdel="${i}" title="remove this point">✕</button></td>
      </tr>`).join('')}</tbody></table></div>
      <div class="tbar"><button class="btn" id="ptAdd">+ Add point</button>
        <button class="btn" id="ptUndo" ${hist.canUndo ? '' : 'disabled'} title="Undo the last edit">↶ Undo</button>
        <span class="note" style="margin:0">tap the drawing to append · drag a node to move it</span></div>
    </div>`;
}

function wirePoints() {
  $('#params').querySelectorAll('.pt').forEach((inp) => {
    inp.oninput = () => {
      const r = parseNum(inp.value);
      if (!r.ok) return;
      const v = r.value;
      P.custom[+inp.dataset.i][+inp.dataset.c] = v;
      buildModel(); update();
    };
  });
  $('#params').querySelectorAll('[data-ptdel]').forEach((b) => b.onclick = () => {
    if (P.custom.length <= 2) return;   // a section needs at least one strip
    P.custom.splice(+b.dataset.ptdel, 1);
    buildParams(); buildModel(); update();
  });
  const add = $('#ptAdd');
  if (add) add.onclick = () => {
    const c = P.custom;
    const q = c.length >= 2 ? [c[c.length - 1][0] + 25, c[c.length - 1][1]]
            : c.length === 1 ? [c[0][0] + 25, c[0][1]] : [0, 0];
    c.push(q);
    buildParams(); buildModel(); update();
  };
  const un = $('#ptUndo');
  if (un) un.onclick = () => undoEdit();
}

function buildParams() {
  if (P.shape === 'tube') { tubeParams(); return; }
  if (P.shape === 'model') {
    $('#params').innerHTML = `<div class="note">You are editing the model itself: nodes, elements,
      thicknesses and materials live in <b>Nodes &amp; elements</b>. The parameters below belong to a
      template — reset the model to go back to <b>${SHAPES[P.template].name}</b>.</div>`;
    return;
  }
  const keys = [...SHAPES[P.shape].fields, 't', 'mesh'];
  $('#params').innerHTML = keys.map((k) => numFieldHtml({ id: `p_${k}`, label: FIELDS[k][0], unit: FIELDS[k][1],
    value: P[k], allowNegative: false })).join('')
    + (P.shape === 'custom' ? pointsEditor() : '');
  for (const k of keys)
    bindNumField($('#p_' + k).closest('.numfield'), { live: true, allowNegative: false, above: 0,
      integer: k === 'mesh', max: k === 'mesh' ? 50 : undefined,
      onCommit: (v) => { P[k] = v; buildModel(); update(); } });
  if (P.shape === 'custom') wirePoints();
}

/* The positive-only analysis inputs, through numfield's parser: a value that cannot be used is
   marked inline (when the field is left) and never reaches the engine. Live, as before: each
   keystroke that parses takes effect. */
const ANALYSIS_FIELDS = {
  fy: { above: 0, apply: () => fyChanged() },
  // the term count re-solves, but the strips it does not touch are not redrawn
  terms: { integer: true, min: 1, max: TERMS_MAX, apply: () => { renderShapeFn(); update(false, false); } },
  // The length range only feeds Fill and Recommend: the list beside them is what is solved,
  // so editing the range alone does not change the analysis.
  Lmin: { above: 0, apply: () => {} },
  Lmax: { above: 0, apply: () => {} },
};
for (const [key, o] of Object.entries(ANALYSIS_FIELDS)) {
  $('#' + key).value = P[key];
  bindNumField($('#' + key).closest('.numfield'), { ...o, allowNegative: false, live: true,
    onCommit: (v) => { P[key] = v; o.apply(); } });
}

/* f_y is in no engine solve buffer and in no drawing: an edit reaches the screen only in the
   material line and the Loads panel's first-yield readouts, so refresh those. Rebuilding the
   section SVG (about 1600 elements at 321 nodes) and re-running the signature for it cost far
   more than the 50 ms the UI thread budget allows. */
function fyChanged() {
  matSummary();
  if (tab !== 'loads') return;
  const fyL = document.getElementById('fyL');
  if (fyL) fyL.value = dnum(P.fy);
  refreshYield();
}

/* The Material group's one-line summary: what the Materials table's first row is. */
function matSummary() {
  const q = currentMat();
  $('#matSummary').innerHTML = `Material ${q.id}: E ${q.ex} MPa, ν ${q.vx}, f<sub>y</sub> ${P.fy} MPa.
    <button class="link" id="matEdit">edit</button>`;
  $('#matEdit').onclick = () => { TBL = 'materials'; tab = 'tables'; renderPane(); };
}
matSummary();

/* CUFSM's length recommendation (lengths_recommend): a log range from the
   smallest strip to 1000× the largest, clamped so the useful part stays in view */
function recommendLengths(reason) {
  if (!geo || !geo.elems.length) return;
  let minEl = Infinity, maxEl = 0;
  for (const [a, b] of geo.elems) {
    const L = Math.hypot(geo.nodes[b][0] - geo.nodes[a][0], geo.nodes[b][1] - geo.nodes[a][1]);
    minEl = Math.min(minEl, L);
    maxEl = Math.max(maxEl, L);
  }
  const tMin = MODEL.elems.reduce((m, e) => Math.min(m, e.t), Infinity);
  P.Lmin = Math.max(1, Math.round(Math.max(minEl, isFinite(tMin) ? tMin : 0)));
  P.Lmax = Math.min(20000, Math.max(P.Lmin * 10, Math.round(1000 * maxEl)));
  $('#Lmin').value = P.Lmin;
  $('#Lmax').value = P.Lmax;
  fillLogLengths();
  if (reason === 'pasted')
    $('#lensDrop').textContent = `Lengths recommended for the pasted model: ${P.Lmin} to ${P.Lmax}, log-spaced.`;
  update();
}

/* The textarea's text for a lengths array (short, parseable numbers). */
const lengthsText = (ls) => ls.map((v) => +v.toPrecision(6)).join('\n');
/* Fill log-spaced: logLengths(min, max, n) from the three fields beside the button. */
function fillLogLengths() {
  const n = Math.max(2, Math.min(1000, parseInt($('#lensN').value, 10) || 90));
  P.lengths = logLengths(P.Lmin, P.Lmax, n);
  $('#lengths').value = lengthsText(P.lengths);
  $('#lensDrop').textContent = '';
}

/* CUFSM's m recommendation (m_recommend): the terms that matter at the longest
   length, from the characteristic half-wavelengths of local and distortional
   buckling — the minima of the constrained L and D curves (the engine applies
   1..=terms at every length; S-S is always m = 1). */
async function recommendTerms() {
  if (!geo || !geo.elems.length) return;
  setBusy(true, 'Recommending m…', 0);
  cfsmSolving = true;                 // so idle() knows a solve is in flight
  try {
    const firstMin = (ys, lens) => {
      for (let i = 1; i < ys.length - 1; i++)
        if (Number.isFinite(ys[i]) && ys[i] < ys[i - 1] && ys[i] <= ys[i + 1]) return lens[i];
      let k = -1;
      ys.forEach((y, i) => { if (Number.isFinite(y) && (k < 0 || y < ys[k])) k = i; });
      return k >= 0 ? lens[k] : null;
    };
    const lens = lensFor();
    let crl = null, crd = null;
    if (engineReady) {
      const curves = await cfsmCurves();
      if (curves) {
        crl = firstMin(curves.local, lens);
        crd = firstMin(curves.dist, lens);
      }
    } else return;
    const cr = Math.min(crl ?? Infinity, crd ?? Infinity);
    if (!Number.isFinite(cr) || cr <= 0) return;
    P.terms = Math.max(1, Math.min(8, Math.ceil(P.Lmax / cr) + 3));
    $('#terms').value = P.terms;
    renderShapeFn();
    update();
  } catch (e) {
    if (!(e instanceof Aborted)) console.warn('recommend m:', e);   // the model changed under us
  } finally {
    cfsmSolving = false;
    if (!solving && solveTimer == null) setBusy(false);
  }
}
function refreshChips() {
  const a = $('#springChip'), b = $('#constrChip');
  if (a) a.textContent = `${SPRINGS.length} spring${SPRINGS.length === 1 ? '' : 's'}`;
  if (b) b.textContent = `${CONSTRAINTS.length} constraint${CONSTRAINTS.length === 1 ? '' : 's'}`;
}
$('#springChip').onclick = () => { TBL = 'springs'; tab = 'tables'; renderPane(); };
$('#constrChip').onclick = () => { TBL = 'constraints'; tab = 'tables'; renderPane(); };
$('.chip.add').onclick = () => {
  SPRINGS.push([0, -1, 0, 0, 0, 0, 0, 1, 0]);
  TBL = 'springs'; tab = 'tables';
  renderPane();
  refreshChips();
  update();
};
$('#recLens').onclick = () => recommendLengths();
$('#fillLog').onclick = () => { fillLogLengths(); update(); };
$('#recTerms').onclick = () => { recommendTerms(); };
$('#bc').value = P.bc;
$('#bc').onchange = (e) => { P.bc = e.target.value; renderShapeFn(); update(); };

/* Solution type: a signature curve is S-S with m = 1 over half-wavelengths; general boundary
   conditions take the BC select and the term count over physical lengths. */
$('#solSignature').onchange = $('#solGeneral').onchange = () => {
  P.solution = $('#solGeneral').checked ? 'general' : 'signature';
  $('#generalOnly').hidden = P.solution !== 'general';
  $('#lengthsLabel').textContent = P.solution === 'general'
    ? 'Physical lengths, one per line (mm)' : 'Half-wavelengths, one per line (mm)';
  renderShapeFn();
  update();
};

/* Eigenvalue count: the curve plots lambda1 regardless; neigs drives the mode browser. */
$('#neigs').value = P.neigs;
$('#lensN').value = 90;
bindNumField($('#neigs').closest('.numfield'), { integer: true, min: 1, max: NEIGS_MAX, allowNegative: false, live: true,
  onCommit: (v) => {
    P.neigs = v;
    if (sig) sig.modeCache = null;          // the cached per-length rows hold only neigs modes
    if (tab === 'mode' || tab === 'mode3d') renderPane();
  } });
// the count only feeds Fill log-spaced (which falls back to 90): marked when it cannot be used
bindNumField($('#lensN').closest('.numfield'), { integer: true, min: 2, max: 1000, allowNegative: false, onCommit: () => {} });

$('#lengths').value = lengthsText(P.lengths);
$('#lengths').oninput = () => {
  const r = parseLengths($('#lengths').value);
  $('#lensDrop').textContent = r.dropped.length ? `dropped: ${r.dropped.join(', ')}` : '';
  if (r.lengths.length >= 2) { P.lengths = r.lengths; update(); }
};

/* The shape function panel (general BC only): Ym(bc, m, y, 1) on y in 0..1, with an
   m stepper over the analysis terms. */
let selTerm = 1;
function renderShapeFn() {
  const box = $('#shapeFn');
  if (!box) return;
  if (P.solution !== 'general') { box.innerHTML = ''; return; }
  const nt = engTerms();
  selTerm = Math.max(1, Math.min(nt, selTerm));
  const N = 200, vals = [];
  for (let i = 0; i <= N; i++) vals.push(Ym(P.bc, selTerm, i / N, 1));
  /* the range the curve uses, always with zero in it: a one-signed shape (S-S m = 1) sits on
     the axis instead of leaving an empty half below it */
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  if (hi - lo < 1e-12) { lo = -1; hi = 1; }
  const W = 260, pad = 8, H = lo < 0 && hi > 0 ? 110 : 70;
  const X = (i) => pad + (W - 2 * pad) * i / N;
  const Y = (v) => pad + (hi - v) / (hi - lo) * (H - 2 * pad);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  box.innerHTML = `
    <div class="field wide"><label>Shape function</label>
      <span class="stepper"><button class="btn" id="termPrev" title="previous term" ${selTerm <= 1 ? 'disabled' : ''}>‹</button>
      <span class="num">m = ${selTerm} of ${nt}</span><button class="btn" id="termNext" title="next term" ${selTerm >= nt ? 'disabled' : ''}>›</button></span></div>
    <svg id="shapeFnSvg" viewBox="0 0 ${W} ${H}" style="width:100%;display:block" role="img"
      aria-label="Shape function Y${selTerm}(y) for ${P.bc}">
      <line x1="${pad}" y1="${Y(0).toFixed(1)}" x2="${W - pad}" y2="${Y(0).toFixed(1)}" class="axis0"/>
      <path d="${d}"/></svg>`;
  $('#termPrev').onclick = () => { selTerm = Math.max(1, selTerm - 1); renderShapeFn(); };
  $('#termNext').onclick = () => { selTerm = Math.min(nt, selTerm + 1); renderShapeFn(); };
}

$('#tabs').querySelectorAll('.tab').forEach((b) => b.onclick = () => {
  tab = b.dataset.tab; renderPane();
  b.scrollIntoView({ inline: 'center', block: 'nearest' });
});

/* The shell's five tabs (js/shell.js) and the app's seven are mapped both ways, so the compact
   tab bar, the medium rail and the in-card row always agree with the pane on screen. A shell tab
   picks one of its app tabs (keeping the one already showing when it belongs to that shell tab);
   an app-tab change walks the shell tab back, so a chip that jumps to Nodes & elements lands on
   the shell tab that shows it. Curve carries signature + cFSM (+ the tube pane, its UX home),
   Modes carries 2D/3D, Loads loads, More carries the tables until Task 4 gives them the Model
   sheet, and Section shows the cards only - the pane is hidden there, so it maps to nothing. */
const SHELL_APP = { section: null, loads: ['loads'], curve: ['sig', 'cfsm', 'ftm'],
                    modes: ['mode', 'mode3d'], more: ['projects', 'tables', 'extensions', 'python'] };
const APP_SHELL = { sig: 'curve', cfsm: 'curve', ftm: 'curve', mode: 'modes', mode3d: 'modes',
                    loads: 'loads', tables: 'more', extensions: 'more', projects: 'more', python: 'more' };
/* compact More: its own switch between the tables and Extensions (the in-card tab row is hidden) */
document.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => { tab = b.dataset.more; renderPane(); });
/* off during boot: a phone still opens on the Section tab with the default signature pane */
let shellSync = false;
/* the app tab the shell last followed: the engine-ready re-render below fires with the boot
   tab unchanged, and must not walk the shell off the Section tab it opened on */
let syncedAppTab = tab;
function syncShell() {
  if (!shellSync || tab === syncedAppTab) return;
  syncedAppTab = tab;
  const s = APP_SHELL[tab];
  if (s && s !== shell.tab) shell.go(s);
}
/* the view each shell tab last showed (Modes: 2D or 3D, Curve: signature or cFSM), so coming back
   to a tab reopens what you left there rather than its first view */
const lastView = {};
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => {
  const from = APP_SHELL[tab];
  if (from) lastView[from] = tab;
  shell.go(b.dataset.go);
  // the new view starts at its top, not wherever the last one was scrolled to
  scrollTo({ top: 0, behavior: REDUCED.matches ? 'instant' : 'smooth' });
  // a tube's results are its own pane, never the FSM curve or tables of the previous section
  const want = P.shape === 'tube' ? ({ curve: ['ftm'], more: ['projects'] }[b.dataset.go] ?? null) : SHELL_APP[b.dataset.go];
  if (want && !want.includes(tab)) {
    const back = lastView[b.dataset.go];
    tab = back && want.includes(back) ? back : want[0];
    renderPane();
  }
  applyFull();                   // a phone already sideways: Curve and Modes open full screen
};
shell.go(shell.tab);              // body[data-tab] and the tab bar's aria before boot

/* screen -> section coordinates for #sectionSvg (inverse of fit()) */
function svgToSection(svg, clientX, clientY, pad) {
  const vb = svg.viewBox.baseVal;
  const fitr = fit(geo, vb.width, vb.height, pad);
  const r = svg.getBoundingClientRect();
  // the drawing's zoom and pan: back from the screen to the coordinates it was drawn in
  const { x: px, y: py } = fromView(canvasView, { x: (clientX - r.left) / r.width * vb.width,
                                                  y: (clientY - r.top) / r.height * vb.height });
  const [mx0, my0] = fitr.map(fitr.x0, fitr.z0);
  return [fitr.x0 + (px - mx0) / fitr.s, fitr.z0 + (my0 - py) / fitr.s];
}
const roundPt = (v) => Math.round(v * 10) / 10;

/* ------------------------------------------------------------- undo and redo
   One history for every edit, from any editor: the tables, the drawing (mouse or touch), the
   template parameters, the Loads panel, a paste and an extension's proposal. An edit is recorded
   once it has settled - when its solve finishes, so the stresses the engine writes for a template
   or a load are part of it - and only if the state differs from the last one recorded. The state
   is the model with the shape and template parameters that produced it, the reference loads and
   the analysis settings; undo puts all of it back and solves again. 50 steps. */
let hist = createHistory(50);          // a new one per opened project
let histKey = '';
const SNAP_P = ['shape', 'template', 'custom', 'h', 'b', 'd', 't', 'mesh', 'fy',
                'solution', 'bc', 'terms', 'neigs', 'lengths'];
const SNAP_L = [...ACTKEYS, 'restrained', 'extremeFibre'];
function snapState() {
  return { p: Object.fromEntries(SNAP_P.map((k) => [k, P[k]])), model: MODEL,
           loads: Object.fromEntries(SNAP_L.map((k) => [k, LOADS[k]])), loadfit: LOADFIT };
}
/* returns true when the state on screen became a new history step */
function recordEdit() {
  if (!engineReady || !MODEL || P.shape === 'tube' || tdrag || drag?.moved) return false;
  const k = JSON.stringify(snapState());
  if (k === histKey) return false;
  hist.push(JSON.parse(k));
  histKey = k;
  refreshUndo();
  return true;
}
function restoreState(st) {
  Object.assign(P, st.p);
  setModel(st.model);
  for (const k of SNAP_L) LOADS[k] = st.loads[k];
  LOADFIT = st.loadfit;
  histKey = JSON.stringify(snapState());
  closeEditSheets();
  ADD.from = -1;                       // add mode carries on from the last node
  SEL = { elem: -1, nodes: new Set() };
  tubeMode(); buildShapes(); buildParams(); syncAnalysisInputs(); matSummary(); refreshChips();
  refreshUndo();
  update();
  refreshModelList();
}
function undoEdit() { const st = hist.undo(); if (st) restoreState(st); }
function redoEdit() { const st = hist.redo(); if (st) restoreState(st); }
function refreshUndo() {
  $('#cvUndo').disabled = !hist.canUndo;
  $('#cvRedo').disabled = !hist.canRedo;
  const pt = document.getElementById('ptUndo');
  if (pt) pt.disabled = !hist.canUndo;
  const add = $('#cvAdd');
  add.setAttribute('aria-pressed', String(ADD.on));
  add.classList.toggle('on', ADD.on);
}

/* The points the Custom template starts from: the model on screen, so a dragged node index
   still means the same point once the template owns it. */
function seedCustom() {
  P.custom = MODEL.nodes.map((n) => [roundPt(n.x), roundPt(n.z)]);
}

/* entering Custom by dragging: seed from the template on screen, then move the point */
function ensureCustom() {
  if (P.shape === 'custom' || P.shape === 'model') return;
  seedCustom();
  P.shape = 'custom';
  buildShapes(); buildParams();
}

/* tap a node to pin/unpin x/z; drag a node to move it (auto-switches templates to Custom) */
let drag = null, suppressClick = false, lastPointer = 'mouse';
$('#sectionSvg').addEventListener('pointerdown', (e) => {
  suppressClick = false;
  lastPointer = e.pointerType || 'mouse';
  if (lastPointer !== 'mouse') return;       // a finger or a pen: js/gestures.js
  const t = e.target;
  if (!t.getAttribute || t.getAttribute('data-node') == null) return;
  if (e.button != null && e.button !== 0) return;
  drag = { i: +t.getAttribute('data-node'), moved: false, sx: e.clientX, sy: e.clientY };
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    drag.moved = true;
    ensureCustom();   // moving a point = designing your own section (the Model shape already is one)
  }
  const [x, z] = svgToSection($('#sectionSvg'), e.clientX, e.clientY, 56);
  if (P.shape === 'model') { MODEL.nodes[drag.i].x = roundPt(x); MODEL.nodes[drag.i].z = roundPt(z); }
  else P.custom[drag.i] = [roundPt(x), roundPt(z)];
  buildModel(); update();
});
const endDrag = () => {
  if (!drag) return;
  const { i, moved } = drag;
  drag = null;
  suppressClick = true;                 // consume the click that follows, if any
  if (!moved) {                         // a tap: pin / release the node's x and z
    const free = MODEL.nodes[i].free;
    const pin = free[0] || free[1];
    free[0] = free[1] = pin ? 0 : 1;
    toModelShape();                     // a fixity the template does not own
    update();
  } else {
    if (P.shape === 'custom') buildParams();   // refresh the point table after a drag
    idle().then(recordEdit);            // the drag is one undo step, recorded once it has settled
  }
};
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

/* on a Custom section, tap anywhere else to append a point to the polyline */
$('#sectionSvg').addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  if (lastPointer !== 'mouse') return;       // a tap: the gestures' onTap has it
  if (ADD.on) {                               // ＋ Node with a mouse: the same model operation
    const [x, z] = svgToSection($('#sectionSvg'), e.clientX, e.clientY, 56);
    addNodeAt(x, z);
    return;
  }
  if (P.shape !== 'custom') return;
  const [x, z] = svgToSection($('#sectionSvg'), e.clientX, e.clientY, 56);
  P.custom.push([roundPt(x), roundPt(z)]);
  buildParams(); buildModel(); update();
});

/* ------------------------------------------------------- the touch section editor
   Pen and finger editing (js/gestures.js): pinch and pan, tap a node or a strip to edit it in a
   sheet, long-press a node to drag it (0.5 mm snap), ＋ Node mode to grow the section a tap at a
   time. Every edit is a js/model.js operation - the ones the tables use - committed through
   commit(), so it re-solves and joins the undo history like any other edit. */
const SNAP_MM = 0.5;
/* drawing coordinates (the viewBox, before the view transform) -> model mm, with the fit the
   drawing was made with */
function drawnToModel(q, fitr = mainFit) {
  const [mx0, my0] = fitr.map(fitr.x0, fitr.z0);
  return [fitr.x0 + (q.x - mx0) / fitr.s, fitr.z0 + (my0 - q.y) / fitr.s];
}
function commit(m) {
  setModel(m);
  toModelShape();                    // the template no longer owns the model, as after a table edit
  update();
  refreshModelList();
}
function addNodeAt(x, z) {
  const from = ADD.from >= 0 && ADD.from < MODEL.nodes.length ? ADD.from : MODEL.nodes.length - 1;
  commit(appendNode(MODEL, snapTo(x, SNAP_MM), snapTo(z, SNAP_MM), from, { t: P.t }));
  ADD.from = MODEL.nodes.length - 1;
}
const canvas = attachCanvasGestures($('#sectionSvg'), {
  pick(q, ppu) {
    if (!geo || !mainFit || P.shape === 'tube' || $('#sectionSvg').classList.contains('previewing')) return null;
    const pts = geo.nodes.map(([x, z]) => { const [px, py] = mainFit.map(x, z); return { x: px, y: py }; });
    /* a node right under the finger wins; then a strip within 16 px; then a node within 24 px -
       so the middle of a short strip between two close nodes is still the strip */
    const near = nearestNode(pts, q, 12, ppu);
    if (near >= 0) return { node: near };
    const k = nearestSegment(geo.elems.map(([a, b]) => [pts[a], pts[b]]), q, 16, ppu);
    if (k >= 0) return { elem: k };
    const n = nearestNode(pts, q, 24, ppu);
    return n >= 0 ? { node: n } : null;
  },
  onTap(q, target) {
    if (P.shape === 'tube' || !MODEL) return;
    if (target?.node != null) { openNodeSheet(target.node); return; }
    if (target?.elem != null) { openElemSheet(target.elem); return; }
    if (ADD.on) { addNodeAt(...drawnToModel(q)); return; }
    closeEditSheets();
  },
  onLongPressDrag(i, q) {
    if (!MODEL || !MODEL.nodes[i]) return;
    if (!tdrag) {
      tdrag = { i, q, raf: 0, fit: mainFit, fitTo: { nodes: geo.nodes.map((n) => [...n]) } };
      closeEditSheets();
      toModelShape();
    }
    tdrag.q = q;
    if (tdrag.raf) return;            // one model update per frame
    tdrag.raf = requestAnimationFrame(() => {
      if (!tdrag) return;
      tdrag.raf = 0;
      const [x, z] = drawnToModel(tdrag.q, tdrag.fit).map((v) => snapTo(v, SNAP_MM));
      const n = MODEL.nodes[tdrag.i];
      if (n.x === x && n.z === z) return;
      setModel(setNode(MODEL, tdrag.i, { x, z }));
      update();                        // the drawing follows the finger; the curve re-solves
    });
  },
  onDragEnd() {
    if (!tdrag) return;
    cancelAnimationFrame(tdrag.raf);
    tdrag = null;
    if (geo && geo.elems.length) drawMainSection();   // the fit was frozen for the drag: refit
    idle().then(recordEdit);
  },
  onViewChange(v) {
    canvasView = v;
    const g = $('#sectionSvg').querySelector('g.view');
    if (g) {
      g.setAttribute('transform', `translate(${v.tx} ${v.ty}) scale(${v.s})`);
      g.style.setProperty('--k', String(1 / v.s));
    }
  },
  addMode: () => ADD.on,
});
$('#cvFit').onclick = () => canvas.fit();
$('#cvIn').onclick = () => canvas.zoom(1.4);
$('#cvOut').onclick = () => canvas.zoom(1 / 1.4);
$('#cvUndo').onclick = () => undoEdit();
$('#cvRedo').onclick = () => redoEdit();
$('#cvAdd').onclick = () => {
  ADD.on = !ADD.on;
  ADD.from = PICK?.node ?? -1;        // grow from the node being edited, else from the last one
  if (ADD.on) closeEditSheets();
  refreshUndo();
};

/* the node and element sheets: every field commits through a model operation */
/* a sheet's number field (js/numfield.js): the decimal pad, ± where it may be negative, the unit,
   an inline message for a value that cannot be used; commits on change */
const fieldHtml = (id, label, unit, v, allowNegative = true) => numFieldHtml({ id, label, unit, value: dnum(v), allowNegative });
function numInput(id, opts, apply) {
  bindNumField(document.getElementById(id).closest('.numfield'), { ...opts, onCommit: apply });
}
const DOFS = [['x', 'x'], ['z', 'z'], ['y', 'y (along)'], ['θ', 'θ']];
function renderNodeSheet() {
  const i = PICK.node, n = MODEL.nodes[i];
  $('#nodeSheetTitle').textContent = `Node ${i + 1}`;
  $('#nodeSheetBody').innerHTML = fieldHtml('nsX', 'x', 'mm', n.x) + fieldHtml('nsZ', 'z', 'mm', n.z)
    + `<div class="field stack"><span class="flabel">Free (tap to hold)</span><div class="doftoggles">${DOFS.map(([k, l], d) =>
      `<button type="button" class="btn dof ${n.free[d] ? 'on' : ''}" data-nsdof="${d}" aria-pressed="${!!n.free[d]}"
        title="dof ${d + 1}: ${l}">${k}</button>`).join('')}</div></div>`
    + fieldHtml('nsS', 'Stress', 'MPa', n.stress);
  numInput('nsX', {}, (v) => commit(setNode(MODEL, i, { x: v })));
  numInput('nsZ', {}, (v) => commit(setNode(MODEL, i, { z: v })));
  numInput('nsS', {}, (v) => commit(setNode(MODEL, i, { stress: v })));
  $('#nodeSheetBody').querySelectorAll('[data-nsdof]').forEach((b) => b.onclick = () => {
    const free = [...MODEL.nodes[i].free];
    free[+b.dataset.nsdof] = free[+b.dataset.nsdof] ? 0 : 1;
    commit(setNode(MODEL, i, { free }));
    renderNodeSheet();
  });
}
function renderElemSheet() {
  const k = PICK.elem, e = MODEL.elems[k];
  $('#elemSheetTitle').textContent = `Element ${k + 1} · nodes ${e.i + 1}→${e.j + 1}`;
  $('#elemSheetBody').innerHTML = fieldHtml('esT', 'Thickness t', 'mm', e.t, false)
    + `<div class="field"><label for="esMat">Material</label><div class="inp"><select id="esMat">${MATS.map((q) =>
      `<option value="${q.id}" ${q.id === e.mat ? 'selected' : ''}>mat ${q.id}</option>`).join('')}</select></div></div>
    ${numFieldHtml({ id: 'esParts', label: 'Divide into', unit: 'parts', value: 2, allowNegative: false })}
    <div class="tbar"><button type="button" class="btn" id="esDivide">Divide</button></div>`;
  numInput('esT', { allowNegative: false, above: 0 }, (v) => commit(setElem(MODEL, k, { t: v })));
  numInput('esParts', { allowNegative: false, integer: true, min: 2, max: 50 }, () => {});
  $('#esMat').onchange = (ev) => { const id = +ev.target.value; commit(setElem(MODEL, k, { mat: Number.isFinite(id) ? id : ev.target.value })); };
  $('#esDivide').onclick = () => {
    const r = parseNum($('#esParts').value, { integer: true, min: 2, max: 50 });
    if (!r.ok) { $('#esParts').dispatchEvent(new Event('change')); return; }
    const parts = r.value;
    closeEditSheets();
    commit(divideElem(MODEL, k, parts));
  };
}
function openNodeSheet(i) {
  if (shell.isOpen($('#elemSheet'))) shell.closeSheet($('#elemSheet'));
  PICK = { node: i };
  renderNodeSheet();
  shell.openSheet($('#nodeSheet'), { detent: 'medium' });
  drawMainSection();
}
function openElemSheet(k) {
  if (shell.isOpen($('#nodeSheet'))) shell.closeSheet($('#nodeSheet'));
  PICK = { elem: k };
  renderElemSheet();
  shell.openSheet($('#elemSheet'), { detent: 'medium' });
  drawMainSection();
}
function closeEditSheets() {
  PICK = null;
  for (const id of ['#nodeSheet', '#elemSheet']) shell.closeSheet($(id));
}
/* a sheet closed any way at all (Done, ✕, back, an undo) drops the selection it showed */
for (const id of ['nodeSheet', 'elemSheet'])
  new MutationObserver(() => {
    if (!document.getElementById(id).hidden || !PICK) return;
    if ((id === 'nodeSheet' && PICK.node == null) || (id === 'elemSheet' && PICK.elem == null)) return;
    PICK = null;                       // closed by Done, ✕ or back
    if (geo && geo.elems.length && P.shape !== 'tube') drawMainSection();
  }).observe(document.getElementById(id), { attributes: true, attributeFilter: ['hidden'] });
$('#nodeDel').onclick = () => {
  const i = PICK?.node;
  if (i == null) return;
  closeEditSheets();
  commit(deleteNode(MODEL, i));
  toast(`Node ${i + 1} deleted.`, 'Undo', undoEdit);
};
$('#elemDel').onclick = () => {
  const k = PICK?.elem;
  if (k == null) return;
  closeEditSheets();
  commit(deleteElems(MODEL, [k]));
  toast(`Element ${k + 1} deleted.`, 'Undo', undoEdit);
};
/* ---------------------------------------------- the compact model editor
   On a phone the Model button opens a large sheet: Materials, Nodes, Elements, Springs and
   Constraints, each a virtual list of 56 px summary rows (a 2,000-node paste keeps about 20 rows
   in the DOM). A tap on a row opens its editor: the node and element sheets of the drawing, or
   the row sheet for a material, a spring or a constraint. Every edit is a commit() of a new model. */
let MLIST = 'nodes', mlist = null;
const ROWH = 56;
const f2 = (v) => (Number.isFinite(+v) ? (+v).toFixed(2) : '-');
const f1 = (v) => (Number.isFinite(+v) ? (+v).toFixed(1) : '-');
const MLISTS = {
  materials: { n: () => MATS.length, row: (i) => { const q = MATS[i];
    return [`${q.id}`, `E ${dnum(q.ex)}`, `ν ${dnum(q.vx)}`, `G ${dnum(q.g)}`]; }, open: (i) => openRowSheet('materials', i) },
  nodes: { n: () => MODEL.nodes.length, row: (i) => { const n = MODEL.nodes[i];
    return [`${i + 1}`, `(${f2(n.x)}, ${f2(n.z)})`,
      `<span class="dots" title="free: x z y θ">${n.free.map((f) => (f ? '●' : '○')).join('')}</span>`, `σ ${f1(n.stress)}`]; },
    open: (i) => openNodeSheet(i) },
  elements: { n: () => MODEL.elems.length, row: (i) => { const e = MODEL.elems[i];
    return [`${i + 1}`, `${e.i + 1}→${e.j + 1}`, `t ${dnum(e.t)}`, `mat ${e.mat}`]; }, open: (i) => openElemSheet(i) },
  springs: { n: () => SPRINGS.length, row: (i) => { const r = SPRINGS[i];
    return [`${i + 1}`, `node ${r[0] + 1} → ${r[1] === -1 ? 'ground' : `node ${r[1] + 1}`}`, `kw ${f1(r[4])}`, r[7] ? 'discrete' : 'foundation']; },
    open: (i) => openRowSheet('springs', i) },
  constraints: { n: () => CONSTRAINTS.length, row: (i) => { const c = CONSTRAINTS[i];
    return [`${i + 1}`, `node ${c[0] + 1} dof ${c[1]}`, `= ${dnum(c[2])} ×`, `node ${c[3] + 1} dof ${c[4]}`]; },
    open: (i) => openRowSheet('constraints', i) },
};
function renderModelSheet() {
  const L = MLISTS[MLIST];
  $('#mlistSeg').querySelectorAll('[data-mlist]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mlist === MLIST)));
  $('#mlistAdd').hidden = MLIST === 'elements';
  $('#mlistEmpty').hidden = L.n() > 0;
  $('#mlistEmpty').textContent = MLIST === 'springs' ? 'No springs. The section is held only by its node dofs and end conditions.'
    : MLIST === 'constraints' ? 'No constraints. Every free dof moves on its own.' : 'Nothing here yet.';
  mlist = virtualList($('#mlist'), { count: L.n(), rowHeight: ROWH, render: (i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mrow';
    b.innerHTML = MLISTS[MLIST].row(i).map((c) => `<span>${c}</span>`).join('');
    b.onclick = () => MLISTS[MLIST].open(i);
    return b;
  } });
}
function refreshModelList() {
  if (!mlist || !shell.isOpen($('#modelSheet'))) return;
  $('#mlistEmpty').hidden = MLISTS[MLIST].n() > 0;
  mlist.refresh(MLISTS[MLIST].n());
}
$('#modelBtn').onclick = () => {
  shell.openSheet($('#modelSheet'), { detent: 'large' });
  renderModelSheet();
};
$('#mlistSeg').querySelectorAll('[data-mlist]').forEach((b) => b.onclick = () => {
  MLIST = b.dataset.mlist;
  $('#mlist').scrollTop = 0;
  renderModelSheet();
});
$('#mlistAdd').onclick = () => {
  const m = structuredClone(MODEL);
  if (MLIST === 'nodes') {                  // a node is placed on the drawing: ＋ Node mode
    shell.closeSheet($('#modelSheet'));
    ADD.on = true; ADD.from = -1; refreshUndo();
    toast('Tap the drawing to place the node.', 'Done', () => { ADD.on = false; refreshUndo(); });
    return;
  }
  if (MLIST === 'materials') m.mats.push(isotropic(Math.max(0, ...m.mats.map((q) => +q.id || 0)) + 1, P.E, P.nu));
  if (MLIST === 'springs') m.springs.push([0, -1, 0, 0, 0, 0, 0, 1, 0]);
  if (MLIST === 'constraints') m.constraints.push([0, 1, 1, 1, 1]);
  commit(m);
  MLISTS[MLIST].open(MLISTS[MLIST].n() - 1);
};
$('#mlistPaste').onclick = () => {           // the CUFSM paste panel lives with the tables
  shell.closeSheet($('#modelSheet'));
  const t = toCufsmText(MODEL);
  PASTE = { open: true, err: '', prop: t.prop, node: t.node, elem: t.elem };
  TBL = 'nodes';
  tab = 'tables';
  renderPane();
  setTimeout(() => document.getElementById('pastePanel')?.scrollIntoView({ block: 'start' }), 50);
};

/* the row sheet: one material, spring or constraint row, field by field */
const ROWDEF = {
  materials: { title: (i) => `Material ${MATS[i].id}`, fields: [['ex', 'Ex', 'MPa', { above: 0 }], ['ey', 'Ey', 'MPa', { above: 0 }],
    ['vx', 'νx', '', {}], ['vy', 'νy', '', {}], ['g', 'Gxy', 'MPa', { above: 0 }]],
    get: (i, k) => MATS[i][k],
    set: (m, i, k, v) => {
      const q = m.mats[i];
      q[k] = v;
      if (q.ex === q.ey && q.vx === q.vy && k !== 'g') q.g = +(q.ex / (2 * (1 + q.vx))).toPrecision(12);
    },
    del: (m, i) => {
      if (m.mats.length <= 1) return false;
      const [gone] = m.mats.splice(i, 1);
      for (const e of m.elems) if (e.mat === gone.id) e.mat = m.mats[0].id;
      return true;
    } },
  springs: { title: (i) => `Spring ${i + 1}`, fields: [[0, 'node i', '', { integer: true, min: 1 }, 1], [1, 'node j (0 = ground)', '', { integer: true, min: 0 }, 1],
    [2, 'ku', '', {}], [3, 'kv', '', {}], [4, 'kw', '', {}], [5, 'kq', '', {}], [6, 'local (0/1)', '', { integer: true, min: 0, max: 1 }],
    [7, 'discrete (0/1)', '', { integer: true, min: 0, max: 1 }], [8, 'ys (0 to 1)', '', { min: 0, max: 1 }]],
    get: (i, k) => (k === 1 ? (SPRINGS[i][1] === -1 ? 0 : SPRINGS[i][1] + 1) : k === 0 ? SPRINGS[i][0] + 1 : SPRINGS[i][k]),
    set: (m, i, k, v) => { m.springs[i][k] = k === 0 ? v - 1 : k === 1 ? (v === 0 ? -1 : v - 1) : v; },
    del: (m, i) => { m.springs.splice(i, 1); return true; } },
  constraints: { title: (i) => `Constraint ${i + 1}`, fields: [[0, 'node e', '', { integer: true, min: 1 }, 1], [1, 'dof e (1 to 4)', '', { integer: true, min: 1, max: 4 }],
    [2, 'coeff', '', {}], [3, 'node k', '', { integer: true, min: 1 }, 1], [4, 'dof k (1 to 4)', '', { integer: true, min: 1, max: 4 }]],
    get: (i, k) => (k === 0 || k === 3 ? CONSTRAINTS[i][k] + 1 : CONSTRAINTS[i][k]),
    set: (m, i, k, v) => { m.constraints[i][k] = k === 0 || k === 3 ? v - 1 : v; },
    del: (m, i) => { m.constraints.splice(i, 1); return true; } },
};
let ROWSEL = null;
function openRowSheet(kind, i) {
  ROWSEL = { kind, i };
  const D = ROWDEF[kind];
  $('#rowSheetTitle').textContent = D.title(i);
  $('#rowSheetBody').innerHTML = D.fields.map(([k, label, unit, o]) =>
    fieldHtml(`rs_${k}`, label, unit, D.get(i, k), !(o.above !== undefined || o.min !== undefined))).join('');
  for (const [k, , , o] of D.fields)
    numInput(`rs_${k}`, o, (v) => { const m = structuredClone(MODEL); D.set(m, i, k, v); commit(m); });
  $('#rowDel').disabled = kind === 'materials' && MATS.length <= 1;
  shell.openSheet($('#rowSheet'), { detent: 'medium' });
}
$('#rowDel').onclick = () => {
  if (!ROWSEL) return;
  const { kind, i } = ROWSEL, m = structuredClone(MODEL);
  const name = ROWDEF[kind].title(i);
  if (!ROWDEF[kind].del(m, i)) return;
  shell.closeSheet($('#rowSheet'));
  commit(m);
  toast(`${name} deleted.`, 'Undo', undoEdit);
};

let toastTimer = 0;
function toast(msg, action, fn, ms = 6000) {
  const t = $('#appToast');
  t.querySelector('span').textContent = msg;
  const b = t.querySelector('button');
  b.textContent = action;
  b.onclick = () => { t.hidden = true; fn(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  b.hidden = !action;
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ------------------------------------------------------------------ header */
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('cufsmTheme', next); } catch { /* */ }
};
/* The state a copied link carries: the model as the tables edit it, the reference loads, the
   analysis settings (including the shape, and the tube's own inputs, so a Tube link reopens as
   the same tube analysis) and the open tab with the σ↔λ display toggle. The strip templates'
   parameters are deliberately absent — the shared model owns itself once it is opened. */
function currentState() {
  return {
    v: 2,
    model: { mats: MATS.map((q) => ({ ...q })),
             nodes: MODEL.nodes.map((n) => ({ ...n, free: [...n.free] })),
             elems: MODEL.elems.map((e) => ({ ...e })),
             springs: SPRINGS.map((r) => [...r]),
             constraints: CONSTRAINTS.map((r) => [...r]) },
    loads: { P: LOADS.P, Mxx: LOADS.Mxx, Mzz: LOADS.Mzz, M11: LOADS.M11, M22: LOADS.M22, B: LOADS.B,
             restrained: LOADS.restrained, extremeFibre: LOADS.extremeFibre, fy: LOADS.fy },
    analysis: { solution: P.solution, bc: P.bc, terms: P.terms, neigs: P.neigs, lengths: [...P.lengths],
                shape: P.shape,
                tube: { D: FT.D, t: FT.t, L: FT.L, N: FT.N, M: FT.M, T: FT.T, V: FT.V,
                        base: FT.base, top: FT.top, p: FT.p, q: FT.q, nmodes: FT.nmodes } },
    ui: { tab, norm: acts.norm },
  };
}

/* The analysis inputs, read back out of P — both the shared boot and the default-boot fallback
   end here, so the controls can never show values the state does not have. */
function syncAnalysisInputs() {
  $('#solSignature').checked = P.solution === 'signature';
  $('#solGeneral').checked = P.solution === 'general';
  $('#generalOnly').hidden = P.solution !== 'general';
  $('#lengthsLabel').textContent = P.solution === 'general'
    ? 'Physical lengths, one per line (mm)' : 'Half-wavelengths, one per line (mm)';
  $('#bc').value = P.bc; $('#terms').value = P.terms; $('#neigs').value = P.neigs;
  $('#lengths').value = lengthsText(P.lengths); $('#lensDrop').textContent = '';
  $('#fy').value = P.fy;
}

/* Apply a decoded shared state before the first solve: the model, the reference loads, the
   analysis settings, the shape (the tube and its inputs come across whole) and the open tab.
   It throws only on a state validateState cannot read; the boot path turns that into a footer
   note. */
function applyShared(s, noun = 'link') {
  const bad = validateState(s, noun);
  if (bad) throw new Error(bad);
  const m = s.model;
  setModel(m);
  const a = s.analysis || {};
  /* Every analysis setting is read as the page's own controls read it; whatever is clamped or
     dropped on the way in is returned, and the boot says so in the footer. */
  const r = readAnalysis(a, [...$('#bc').options].map((o) => o.value));
  /* Tube mode round trips: the tube's inputs travel in analysis.tube, so the link reopens as
     the same tube analysis. Any other shape opens as 'model' — a strip template's own fields
     (h, b, d …) are not in the link, so showing them would misdescribe the model on screen. */
  P.shape = a.shape === 'tube' ? 'tube' : 'model';
  if (P.shape === 'tube' && r.tube) Object.assign(FT, r.tube);
  buildShapes(); buildParams();
  const L = s.loads || {};
  for (const k of ACTKEYS) if (Number.isFinite(L[k])) LOADS[k] = L[k];
  if (typeof L.restrained === 'boolean') LOADS.restrained = L.restrained;
  if (typeof L.extremeFibre === 'boolean') LOADS.extremeFibre = L.extremeFibre;
  if (Number.isFinite(L.fy) && L.fy > 0) LOADS.fy = L.fy;
  for (const k of ['solution', 'bc', 'terms', 'neigs', 'lengths']) if (r[k] !== undefined) P[k] = r[k];
  syncAnalysisInputs();
  const tabs = ['sig', 'mode', 'mode3d', 'loads', 'cfsm', 'tables', 'ftm'];
  if (s.ui && tabs.includes(s.ui.tab)) tab = s.ui.tab;
  if (s.ui && (s.ui.norm === 'stress' || s.ui.norm === 'force')) acts.norm = s.ui.norm;
  /* The tube chrome (hidden tabs, hidden FSM inputs) and both tab clamps: a tube opens on its
     ftm pane; an ftm tab in a link whose model is not a tube falls back to the signature. */
  tubeMode();
  SEL = { elem: -1, nodes: new Set() };
  refreshChips();
  return r.notes;
}

/* ------------------------------------------------------- projects on the device
   js/projects.js keeps them in IndexedDB, in this browser only: nothing is sent anywhere. The open
   project is saved 400 ms after each edit settles (and at once when the page is hidden: iOS kills
   a background page without an unload), only when its state changed. A save that fails says so,
   in the Projects view and in a toast, never silently; with no IndexedDB (private browsing) the
   projects last the session and the page says so. A project is held to the share link's checks
   and caps (validateState) on the way in and the way out. */
const PROJ = { db: null, memory: false, id: null, name: 'Untitled', savedKey: '', status: 'new', msg: '', at: 0,
               timer: null, chain: Promise.resolve(), warned: '', dropHash: false, suspend: false };
const LAST_KEY = 'ckbLastProject';
const rememberLast = (id) => { try { localStorage.setItem(LAST_KEY, id); } catch { /* storage off */ } };
const recallLast = () => { try { return localStorage.getItem(LAST_KEY); } catch { return null; } };
const escHtml = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/* the strip template behind the model, so a reopened template project keeps its h, b, d … fields
   (a link leaves them out; a project is the user's own copy) */
const TEMPLATE_KEYS = ['shape', 'template', 'h', 'b', 'd', 't', 'mesh', 'custom'];
function projectState() {
  const st = currentState();
  if (P.shape !== 'tube') st.template = Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, P[k]]));
  return st;
}
function applyTemplate(t) {
  if (!t || typeof t !== 'object' || P.shape === 'tube') return;
  if (SHAPES[t.template] && t.template !== 'tube') P.template = t.template;
  for (const k of ['h', 'b', 'd', 't', 'mesh']) if (Number.isFinite(t[k]) && t[k] > 0) P[k] = t[k];
  if (Array.isArray(t.custom) && t.custom.every((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite)))
    P.custom = t.custom;
  // a template's fields describe the model only when the template still owns it
  if (t.shape !== 'model' && t.shape !== 'tube' && SHAPES[t.shape] && (t.shape !== 'custom' || P.custom)) P.shape = t.shape;
  buildShapes(); buildParams();
}

async function openProjectsDb() {
  try { PROJ.db = await PR.openDb(); }
  catch { PROJ.db = PR.memoryDb(); PROJ.memory = true; }
}

function autosave() {
  if (!PROJ.db) return;
  clearTimeout(PROJ.timer);
  PROJ.timer = setTimeout(() => { PROJ.timer = null; saveNow(); }, 400);
}
/* saves run one after another, so a project is created once however fast the edits come */
function saveNow() {
  clearTimeout(PROJ.timer); PROJ.timer = null;
  PROJ.chain = PROJ.chain.then(doSave, doSave);
  return PROJ.chain;
}
function saveSays(status, msg = '') {
  PROJ.status = status; PROJ.msg = msg;
  refreshProjectStatus();
}
async function doSave() {
  if (!PROJ.db || !MODEL || PROJ.suspend) return;
  let key;
  try { key = JSON.stringify(projectState()); } catch { return; }
  if (key === PROJ.savedKey) return;
  const st = JSON.parse(key);
  const bad = PR.checkState(structuredClone(st));
  if (bad) {
    // nothing to keep (the last strip deleted): the saved project stays as it was
    if (/contains no section/.test(bad)) { saveSays('error', 'Not saved: the section has no strips.'); return; }
    failed(`Not saved on this device: ${bad.replace('This project’s model is too large to open', 'this model is too large for a project')}`);
    return;
  }
  try {
    PROJ.id = await PR.saveProject(PROJ.db, { id: PROJ.id ?? undefined, name: PROJ.name, state: st });
  } catch (e) {
    failed(`Not saved on this device: ${(e && e.message) || e}. Save to file to keep this work.`);
    return;
  }
  PROJ.savedKey = key; PROJ.at = Date.now();
  if (!PROJ.memory) rememberLast(PROJ.id);
  saveSays(PROJ.memory ? 'memory' : 'saved');
  PROJ.warned = PROJ.memory ? PROJ.warned : '';
  if (PROJ.memory && PROJ.warned !== 'memory') {
    PROJ.warned = 'memory';
    toast('Projects last this session only here: this browser is not letting the page store them. Save to file to keep your work.',
          'Projects', openProjectsView, 9000);
  }
  /* a shared link is a project now: the address no longer needs it, and a reload must not make a
     second copy (kept where the project could not be stored, so a reload still opens the link) */
  if (PROJ.dropHash && !PROJ.memory) {
    PROJ.dropHash = false;
    if (location.hash.startsWith('#v')) history.replaceState(history.state, '', location.pathname + location.search);
  }
}
function failed(msg) {
  saveSays('error', msg);
  if (PROJ.warned !== msg) { PROJ.warned = msg; toast(`⚠ ${msg}`, 'Projects', openProjectsView, 9000); }
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
addEventListener('pagehide', () => { saveNow(); });

function statusText() {
  const time = PROJ.at ? new Date(PROJ.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  if (PROJ.status === 'saved') return `Saved on this device · ${time}`;
  if (PROJ.status === 'memory') return '⚠ This browser is not letting the page store projects (private browsing?): they last this session only. Save to file to keep your work.';
  if (PROJ.status === 'error') return `⚠ ${escHtml(PROJ.msg)}`;
  return 'Not saved yet';
}
function refreshProjectStatus() {
  const el = document.getElementById('projStatus');
  if (!el) return;
  el.innerHTML = statusText();
  el.className = `projstatus ${PROJ.status}`;
}
function openProjectsView() {
  tab = 'projects';
  renderPane();
  if (shell.layout === 'compact') scrollTo({ top: 0 });
}

/* Open a project (a stored one, a file or a link) in place of the one on screen, which is saved
   first. Everything goes back to the defaults before the state is applied, so nothing of the last
   project leaks into this one. Returns null, or why it cannot be opened (then nothing changed). */
async function openState({ id = null, name, state, updated = 0 }, noun = 'project') {
  const bad = PR.checkState(structuredClone(state), noun);
  if (bad) return bad;
  await saveNow();
  closeEditSheets();
  ADD.on = false; ADD.from = -1; PICK = null;
  Object.assign(P, structuredClone(BOOT.p));
  Object.assign(LOADS, BOOT.loads);
  Object.assign(FT, BOOT.ft, { res: null, sel: 0, err: null });
  acts.norm = BOOT.norm;
  tab = BOOT.tab;
  canvasView = { s: 1, tx: 0, ty: 0 };
  selMin = 0; selL = null; selModeIdx = 0; sig = null; disp = null;
  const notes = applyShared(state, noun) || [];
  applyTemplate(state.template);
  tubeMode();
  syncAnalysisInputs(); matSummary(); refreshChips();
  hist = createHistory(50); histKey = '';
  PROJ.id = id; PROJ.name = name || 'Untitled'; PROJ.savedKey = ''; PROJ.warned = '';
  Object.assign(PROJ, id ? { status: 'saved', at: updated } : { status: 'new', at: 0 });
  if (id && !PROJ.memory) rememberLast(id);
  /* the section it opened, on a phone; the pane keeps the view the project was saved with */
  syncedAppTab = tab;
  if (shell.layout === 'compact') { shell.go('section'); scrollTo({ top: 0 }); }
  update();
  refreshUndo();
  refreshModelList();
  if (notes.length) toast(`Opened with changes: ${notes.join('; ')}.`, '', null, 8000);
  return null;
}

async function newProject() {
  await saveNow();
  closeEditSheets();
  Object.assign(P, structuredClone(BOOT.p));
  Object.assign(LOADS, BOOT.loads);
  Object.assign(FT, BOOT.ft, { res: null, sel: 0, err: null });
  MATS = BOOT.mats.map((q) => ({ ...q }));
  acts.norm = BOOT.norm; tab = BOOT.tab;
  canvasView = { s: 1, tx: 0, ty: 0 };
  selMin = 0; selL = null; selModeIdx = 0; sig = null; disp = null;
  const names = new Set((await PR.listProjects(PROJ.db).catch(() => [])).map((p) => p.name));
  let n = 1, name = 'Untitled';
  while (names.has(name)) name = `Untitled ${++n}`;
  PROJ.id = null; PROJ.name = name; PROJ.savedKey = ''; PROJ.status = 'new';
  tubeMode(); buildShapes(); buildParams(); syncAnalysisInputs();
  await buildModel();
  hist = createHistory(50); histKey = '';
  syncedAppTab = tab;
  if (shell.layout === 'compact') { shell.go('section'); scrollTo({ top: 0 }); }
  update(); refreshUndo(); refreshModelList(); matSummary(); refreshChips();
}

const relTime = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
};
let projGen = 0;
function paneProjects() {
  pane.innerHTML = `
    <div class="projcur">
      <div class="l">Open project</div>
      <div class="n" id="projName">${escHtml(PROJ.name)}</div>
      <div class="projstatus ${PROJ.status}" id="projStatus" role="status">${statusText()}</div>
    </div>
    <div class="projacts">
      <button type="button" class="btn" id="projNew">＋ New</button>
      <button type="button" class="btn" id="projDup">Duplicate</button>
      <button type="button" class="btn" id="projOpenFile">Open file…</button>
      <button type="button" class="btn" id="projSaveFile">Save to file</button>
      <input type="file" id="projFile" accept=".json,application/json" hidden>
    </div>
    <div class="note engineerr" id="projMsg" role="alert" hidden></div>
    <h2 class="projh">On this device</h2>
    <ul class="projlist" id="projList"><li class="note loading">Loading…</li></ul>
    <div class="note">Projects stay in this browser and are never uploaded. A file (.ckb.json) or
      <b>Copy link</b> takes one elsewhere.</div>`;
  const say = (msg) => { const m = $('#projMsg'); m.textContent = msg ? `⚠ ${msg}` : ''; m.hidden = !msg; };
  $('#projNew').onclick = () => newProject();
  $('#projDup').onclick = async () => {
    await saveNow();
    PROJ.id = null; PROJ.name = `${PROJ.name} copy`; PROJ.savedKey = '';
    await saveNow();
    toast(`You are now editing “${PROJ.name}”.`, '', null, 4000);
    if (tab === 'projects') paneProjects();
  };
  $('#projOpenFile').onclick = () => $('#projFile').click();
  $('#projFile').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) openProjectFile(f, say);
  };
  $('#projSaveFile').onclick = () => {
    const st = projectState();
    const bad = PR.checkState(structuredClone(st));
    if (bad) { say(bad.replace('This project’s model is too large to open', 'This model is too large to save as a project')); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(PR.toFile({ name: PROJ.name, state: st }));
    a.download = PR.fileName(PROJ.name);
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  fillProjectList(say);
}

/* a .ckb.json file: from Open file…, or handed over by the system to the installed app (the
   manifest's file_handlers, read through launchQueue) */
async function openProjectFile(f, say) {
  let got;
  try { got = await PR.fromFile(f); } catch (err) { say((err && err.message) || String(err)); return; }
  const why = await openState({ id: null, name: got.name, state: got.state }, 'file');
  if (why) { say(why); return; }
  await saveNow();
  if (tab === 'projects') paneProjects();
}

async function fillProjectList(say) {
  const gen = ++projGen;
  let list;
  try { list = await PR.listProjects(PROJ.db); }
  catch (e) { if (gen === projGen) say(`The projects on this device could not be read: ${(e && e.message) || e}`); return; }
  const ul = document.getElementById('projList');
  if (gen !== projGen || !ul) return;
  if (!list.length) { ul.innerHTML = '<li class="note">No projects yet: your work is saved here as soon as it has solved.</li>'; return; }
  ul.innerHTML = list.map((p) => `
    <li class="projrow${p.id === PROJ.id ? ' cur' : ''}" data-id="${escHtml(p.id)}">
      <button type="button" class="projopen" ${p.id === PROJ.id ? 'aria-current="true"' : ''}>
        <span class="pn">${escHtml(p.name)}</span><span class="pd">${p.id === PROJ.id ? 'open now · ' : ''}${relTime(p.updated)}</span></button>
      <button type="button" class="btn projren">Rename</button>
      <button type="button" class="btn danger projdel" aria-label="Delete ${escHtml(p.name)}">Delete</button>
    </li>`).join('');
  for (const li of ul.querySelectorAll('.projrow')) {
    const id = li.dataset.id, name = list.find((p) => p.id === id).name;
    li.querySelector('.projopen').onclick = async () => {
      if (id === PROJ.id) return;
      let rec;
      try { rec = await PR.loadProject(PROJ.db, id); } catch (e) { say((e && e.message) || String(e)); return; }
      if (!rec) { say('That project is no longer on this device.'); fillProjectList(say); return; }
      const why = await openState(rec);
      if (why) say(why);
      else if (tab === 'projects') paneProjects();
    };
    li.querySelector('.projren').onclick = () => renameRow(li, id, name, say);
    li.querySelector('.projdel').onclick = () => deleteRow(id, name, say);
  }
}

function renameRow(li, id, name, say) {
  li.innerHTML = `<input type="text" class="projinput" value="${escHtml(name)}" aria-label="Project name" maxlength="120" enterkeyhint="done">
    <button type="button" class="btn primary projok">Save</button><button type="button" class="btn projcancel">Cancel</button>`;
  const inp = li.querySelector('input');
  inp.focus(); inp.select();
  const done = async () => {
    const v = inp.value.trim();
    if (!v) { inp.setAttribute('aria-invalid', 'true'); return; }
    try {
      if (id === PROJ.id) { PROJ.name = v; PROJ.savedKey = ''; await saveNow(); }
      else {
        const rec = await PR.loadProject(PROJ.db, id);
        if (rec) await PR.saveProject(PROJ.db, { id, name: v, state: rec.state });
      }
    } catch (e) { say(`The name could not be saved: ${(e && e.message) || e}`); }
    paneProjects();
  };
  li.querySelector('.projok').onclick = done;
  li.querySelector('.projcancel').onclick = () => paneProjects();
  inp.onkeydown = (e) => { if (e.key === 'Enter') done(); else if (e.key === 'Escape') paneProjects(); };
}

/* Delete, with Undo for 5 s. Deleting the open project opens the next most recent one (or a new
   one); Undo puts the record back and reopens it. */
async function deleteRow(id, name, say) {
  let rec;
  try { rec = await PR.loadProject(PROJ.db, id); await PR.deleteProject(PROJ.db, id); }
  catch (e) { say(`It could not be deleted: ${(e && e.message) || e}`); return; }
  const wasOpen = id === PROJ.id;
  if (wasOpen) {
    PROJ.suspend = true;                                  // the save before opening must not re-create it
    clearTimeout(PROJ.timer); PROJ.timer = null;
    try {
      const next = (await PR.listProjects(PROJ.db).catch(() => []))[0];
      const nrec = next && await PR.loadProject(PROJ.db, next.id).catch(() => null);
      if (!nrec || await openState(nrec)) await newProject();
    } finally { PROJ.suspend = false; }
  }
  if (tab === 'projects') paneProjects();
  toast(`Deleted “${name}”.`, 'Undo', async () => {
    try { await PR.restoreProject(PROJ.db, rec); } catch (e) { say(`It could not be put back: ${(e && e.message) || e}`); return; }
    if (wasOpen) await openState(rec);
    if (tab === 'projects') paneProjects();
  }, 5000);
}

/* a link opened while the page is open (the app's deep link, a pasted address): a new project */
addEventListener('hashchange', async () => {
  if (!location.hash.startsWith('#v')) return;
  let s;
  try { s = await decodeState(location.hash); }
  catch (e) { toast(`⚠ ${(e && e.message) || e}`, '', null, 8000); return; }
  const why = await openState({ id: null, name: 'Shared link', state: s }, 'link');
  if (why) { toast(`⚠ ${why}`, '', null, 8000); return; }
  PROJ.dropHash = true;
});

/* Copy link: encode the state, put it in the address bar, copy the URL. Every outcome is said
   on the button itself — a link that cannot be made, refused by the address bar, or blocked
   from the clipboard is never silent, and the label always comes back. */
const SHARE_TITLE = 'Copy a link to this analysis';
let shareTimer = null;
function shareSays(msg, ms = 2600) {
  const b = $('#shareBtn');
  b.textContent = msg;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(() => { b.textContent = 'Copy link'; b.title = SHARE_TITLE; }, ms);
}
$('#shareBtn').onclick = async () => {
  const b = $('#shareBtn');
  let encoded;
  try { encoded = await encodeState(currentState()); }
  catch (e) {
    shareSays('⚠ too large to link', 5000);
    b.title = `This model is too large to put in a link: ${(e && e.message) || e}`;
    return;
  }
  try { history.replaceState(null, '', encoded); }
  catch (e) {
    shareSays('⚠ address bar refused the link', 5000);
    b.title = `The address bar would not take a link this long: ${(e && e.message) || e}`;
    return;
  }
  try { await navigator.clipboard.writeText(location.href); }
  catch {
    shareSays('⚠ clipboard blocked — link is in the address bar', 4000);
    b.title = 'The link was put in the address bar, but the clipboard copy was refused — copy it from there.';
    return;
  }
  shareSays('Copied ✓');
  b.title = 'A link to this analysis is on the clipboard';
};
/* ------------------------------------------------------------ reporting
   A print-ready report of the analysis on screen, in a new window — inputs
   and drawing, results, signature, mode shape, constrained curves and the
   Python for it, in the style of the RC Sections report. Always light. */
async function buildReportHtml() {
  await idle();
  const esc = (t) => String(t).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch));
  const f = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : '—');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:680px';
  document.body.appendChild(holder);
  const mkSvg = (cls, w, h) => {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('class', cls);
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('width', w); s.setAttribute('height', h);
    s.style.cssText = 'max-width:100%;height:auto;display:block';
    holder.appendChild(s);
    return s;
  };
  const table = (head, cols, rows) =>
    `<table>${head ? `<tr><th colspan="${cols.length}">${head}</th></tr>` : ''}` +
    `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('') + `</table>`;
  const kv = (head, pairs) =>
    `<table>${head ? `<tr><th colspan="2">${head}</th></tr>` : ''}` +
    pairs.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') + `</table>`;
  try {
    // the section drawing, dimensioned
    const secSvg = mkSvg('sect', 300, 300);
    drawSection(secSvg, geo, { pad: 56 });
    // the signature curve, redrawn clean
    const sigSvg = mkSvg('chart', 640, 360);
    drawChart(sigSvg, { points: disp.pts, series: [{ points: disp.pts }],
                        markers: disp.minima.map((i) => ({ i })),
                        ylabel: acts.norm === 'force' ? 'λ = P_cr / P_ref' : 'σ_cr (MPa)' });
    // the mode the mode browser on screen is on — the report says what it reports
    let sel = null, selErr = '';
    try { sel = await selModeData(); } catch (e) { selErr = e && e.message ? e.message : String(e); }
    const modeSvg = mkSvg('sect', 300, 300);
    drawSection(modeSvg, geo, sel
      ? { pad: 56, deformed: { fam: sel.fam, phase, mode: sel.md, em: disp.em } }
      : { pad: 56 });
    // the constrained curves, if they are not on screen yet
    let curves = sig.curves || null;
    if (engineReady && !curves && !sig.cfsmFailed) { try { curves = await cfsmCurves(); } catch { /* Aborted */ } }
    let cfsmSvg = null, cfsmNote = '';
    if (!curves) {
      cfsmNote = engineErr ? `⚠ ${esc(engineErr)} — the constrained curves are not available.` : '';
    } else {
      cfsmSvg = mkSvg('chart', 640, 360);
      const col = (key) => disp.pts.map((p, i) => ({ L: p.L, y: curves[key][i] * dscale() }));
      const series = [{ points: disp.pts, cls: 'main' },
                      { points: col('glob'), cls: 'glob' },
                      { points: col('dist'), cls: 'dist' },
                      { points: col('local'), cls: 'nominal' }];
      drawChart(cfsmSvg, { points: disp.pts, series, markers: disp.minima.map((i) => ({ i })),
                           ylabel: acts.norm === 'force' ? 'λ = P_cr / P_ref' : 'σ_cr (MPa)' });
    }
    const gov = disp.pts.reduce((a, b) => (b.sy < a.sy ? b : a));
    const shapeName = P.shape === 'model' ? 'Edited model'
      : P.shape === 'custom' ? 'Custom section' : SHAPES[P.shape].name;
    const params = (P.shape === 'custom' || P.shape === 'model') ? []
      : SHAPES[P.shape].fields.map((k) => [FIELDS[k][0], `${P[k]} ${FIELDS[k][1]}`]);
    const source = engineReady
      ? 'Curve, minima, classifications and mode shapes from the cufsm-rs engine (Rust → WebAssembly) running in the page.'
      : 'The cufsm-rs engine is not available in this page.';
    const minRows = disp.minima.map((i) => {
      const p = disp.pts[i];
      const cls = p.cls
        ? `G ${p.cls[0].toFixed(0)}% · D ${p.cls[1].toFixed(0)}% · L ${p.cls[2].toFixed(0)}% · O ${p.cls[3].toFixed(0)}%`
        : '—';
      return [`${FAM[p.fam].k} · ${FAM[p.fam].label}`, fmtU(p.sy), `${Math.round(p.L)} mm${recurs(p)}`, cls];
    });
    /* The model as tables: every column the Nodes & elements sub-tabs show, with units. */
    const presetName = (q) => {
      const m = PRESET_ROWS.find((p) => p.key === gradeOf(q));
      return m ? m.name : 'custom';
    };
    const matRows = MATS.map((q) =>
      [q.id, fmtY(q.ex), fmtY(q.ey), fmtY(q.vx), fmtY(q.vy), fmtY(q.g), presetName(q)]);
    const nodeRows = MODEL.nodes.map((n, i) => [i + 1, fmtY(n.x), fmtY(n.z),
      n.free[0] ? 1 : 0, n.free[1] ? 1 : 0, n.free[2] ? 1 : 0, n.free[3] ? 1 : 0, fmtY(n.stress)]);
    const elemRows = MODEL.elems.map((e, i) => [i + 1, e.i + 1, e.j + 1, fmtY(e.t), e.mat]);
    const springRows = SPRINGS.map((r, i) => [i + 1, ...r.map(fmtY)]);
    const constrRows = CONSTRAINTS.map((r, i) => [i + 1, ...r.map(fmtY)]);
    /* Reference applied loads and the first-yield actions, all six of each. */
    const loadRows = [['P', fmtY(LOADS.P), 'N'], ['Mxx', fmtY(LOADS.Mxx), 'N·mm'],
      ['Mzz', fmtY(LOADS.Mzz), 'N·mm'], ['M11', fmtY(LOADS.M11), 'N·mm'],
      ['M22', fmtY(LOADS.M22), 'N·mm'], ['B', fmtY(LOADS.B), 'N·mm²']];
    const yv = await yieldVals();
    const yieldRows = yv ? YIELDS.map(([, rid, yk, , u]) => [rid, fmtY(yv[yk]), u]) : [];
    /* The engine's gross and warping section properties, each with its unit. */
    const pr = await sectionProps();
    const propRows = !pr ? [] : [
      ['A', fmtY(pr.A), 'mm²'], ['x<sub>cg</sub>', fmtY(pr.xcg), 'mm'], ['z<sub>cg</sub>', fmtY(pr.zcg), 'mm'],
      ['Ixx', fmtY(pr.Ixx), 'mm⁴'], ['Izz', fmtY(pr.Izz), 'mm⁴'], ['Ixz', fmtY(pr.Ixz), 'mm⁴'],
      ['θ<sub>p</sub>', fmtY(pr.thetap), '°'], ['I11', fmtY(pr.I11), 'mm⁴'], ['I22', fmtY(pr.I22), 'mm⁴'],
      ['J', fmtY(pr.J), 'mm⁴'], ['x<sub>s</sub>', fmtY(pr.xs), 'mm'], ['z<sub>s</sub>', fmtY(pr.zs), 'mm'],
      ['Cw', fmtY(pr.Cw), 'mm⁶'], ['B1', fmtY(pr.B1), 'mm'], ['B2', fmtY(pr.B2), 'mm'],
    ];
    /* The length list, spelled out value by value. */
    const lenList = P.lengths.map((v) => `${fmtY(v)} mm`).join(', ');
    /* The mode the report draws: what the mode browser on screen is stepped to. */
    const modeRows = sel ? [
      [`${lengthWord()} L`, `${Math.round(sel.L)} mm`],
      ['Mode', `${selModeIdx + 1} of ${sel.r.found}`],
      ['Mode class', `${FAM[sel.fam].k} · ${FAM[sel.fam].label}`],
      [acts.norm === 'force' ? 'λ = P/P_ref' : 'σ_cr', fmtU(sel.md.lf * acts.ref * dscale())],
      ['Modal content', sel.md.cls.every(Number.isFinite)
        ? `G ${sel.md.cls[0].toFixed(0)}% · D ${sel.md.cls[1].toFixed(0)}% · L ${sel.md.cls[2].toFixed(0)}% · O ${sel.md.cls[3].toFixed(0)}%`
        : '—'],
    ] : [];
    /* Every mode the engine found at that length — the mode browser's rows, the shown one marked. */
    const clsName = (md) => {
      const k = md.cls.every(Number.isFinite)
        ? FAMKEYS[md.cls.indexOf(Math.max(...md.cls))] : 'other';
      return `${FAM[k].k} · ${FAM[k].label}`;
    };
    const modalContent = (md) => md.cls.every(Number.isFinite)
      ? `G ${md.cls[0].toFixed(0)}% · D ${md.cls[1].toFixed(0)}% · L ${md.cls[2].toFixed(0)}% · O ${md.cls[3].toFixed(0)}%`
      : '—';
    const selRows = sel ? sel.r.modes.map((md, i) => [
      `${i + 1}${i === selModeIdx ? ' (shown)' : ''}`,
      fmtU(md.lf * acts.ref * dscale()), clsName(md), modalContent(md),
    ]) : [];
    const now = new Date();
    const html = `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<title>CivilKit Buckling (CUFSM) - ${esc(shapeName)} report</title>
<style>${pageCss()}
body{background:#fff;color:#1c2330;margin:0;padding:28px 34px;font-size:13px}
h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
.meta{color:#666;margin-bottom:10px} .two{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start}
table{border-collapse:collapse;width:100%;margin-bottom:10px} td,th{padding:3px 6px;border-bottom:1px solid #e3e3e3;text-align:left;overflow-wrap:anywhere}
td:last-child{text-align:right;font-variant-numeric:tabular-nums} td:nth-child(3),td:nth-child(4){text-align:left}
th{background:#f3f1ec;font-weight:600} th:not(:last-child){text-align:left}
pre{background:#f6f4ef;border:1px solid #e3dfd6;border-radius:8px;padding:10px 12px;font-size:11px;
  white-space:pre-wrap;max-height:340px;overflow:auto}
.foot{margin-top:26px;color:#666;font-size:11px}
svg.chart .series.main{stroke:#0e7c6b} svg.chart .series.glob{stroke:#b45309} svg.chart .series.dist{stroke:#1d5fd6}
svg.chart .series.nominal{stroke:#8a8f98} svg.chart .series.other{stroke:#c0262d}
svg.chart .series{fill:none;stroke-width:2.2;stroke-linejoin:round}
svg.chart .grid line{stroke:#e3e3e3} svg.chart .grid line.axis0{stroke:#cfcac0;stroke-width:1.3}
svg.chart .tick{fill:#8a8f98;font-size:11px} svg.chart .axlabel{fill:#4b5563;font-size:12px}
svg.chart .frame{fill:none;stroke:#d4cfc4} svg.chart .marker{fill:#fff;stroke:#1c2330;stroke-width:1.8}
svg.chart .mlabel{fill:#4b5563;font-size:11px}
@page{margin:14mm} @media print{body{padding:0} h2{break-after:avoid} .keep{break-inside:avoid}
  pre{max-height:none;overflow:visible}}
</style></head><body>
<h1>CivilKit Buckling (CUFSM) — section report</h1>
<div class="meta">${esc(shapeName)} · ${tRange(geo)} · E ${P.E} MPa · f<sub>y</sub> ${P.fy} MPa · ${esc(engBc())} · ${now.toLocaleDateString()} ${now.toLocaleTimeString()}</div>
<div class="meta">Units as the model is solved: lengths mm, stresses MPa, forces N, moments N·mm, bimoments N·mm², second moments mm⁴, Cw mm⁶, ratios dimensionless.</div>
<h2>1 Section</h2><div class="two keep"><div>${secSvg.outerHTML}</div><div>${kv('', [
      ['Section', esc(shapeName)],
      ...params.map(([k, v]) => [k, `${v}`]),
      ['Strips in the model', `${geo.elems.length} strips · ${geo.nodes.length} nodes`],
      ["Young's E", `${P.E} MPa`],
      ['Yield f<sub>y</sub>', `${P.fy} MPa`],
      ['Material', esc(matLabel())],
      ["Poisson's ratio", `${P.nu}`],
      ['End conditions', `${esc(engBc())}, ${engTerms()} term${engTerms() > 1 ? 's' : ''}`],
      [P.solution === 'general' ? 'Lengths' : 'Half-wavelengths',
       `${P.lengths.length} solved, ${fmtY(P.lengths[0])} to ${fmtY(P.lengths[P.lengths.length - 1])} mm`],
    ])}<div class="meta">${esc(source)}</div></div></div>
<h2>2 The model</h2>
<div class="keep">${table('Materials', ['mat#', 'Ex (MPa)', 'Ey (MPa)', 'vx', 'vy', 'Gxy (MPa)', 'preset'], matRows)}</div>
<div class="keep">${table('Nodes', ['#', 'x (mm)', 'z (mm)', 'xdof', 'zdof', 'ydof', 'qdof', 'stress (MPa)'], nodeRows)}</div>
<div class="keep">${table('Elements', ['#', 'node i', 'node j', 't (mm)', 'mat#'], elemRows)}</div>
<div class="keep">${SPRINGS.length
      ? table('Springs', ['#', 'node i', 'node j', 'ku (N/mm)', 'kv (N/mm)', 'kw (N/mm)', 'kq (N·mm/rad)',
                          'local 0/1', 'discrete 0/1', 'ys (0 to 1)'], springRows)
      : '<div class="meta">No springs: the section is only held by its node dofs and end conditions.</div>'}</div>
<div class="keep">${CONSTRAINTS.length
      ? table('Constraints', ['#', 'node e', 'dof e', 'coeff', 'node k', 'dof k'], constrRows)
      : '<div class="meta">No constraints: every free dof moves independently.</div>'}
<div class="meta">Node coordinates in mm and nodal reference stress in MPa; the dof columns are CUFSM's
four 0/1 flags (1 = free, 0 = held), and a spring's node j = -1 is ground. Every row here is what the
engine was given.</div></div>
<h2>3 Reference loads and first yield</h2>
<div class="keep">${table('Reference applied loads', ['Action', 'Value', 'Unit'], loadRows)}
${LOADFIT ? `<div class="meta"><b>${esc(loadFitText())}</b></div>` : ''}
<div class="meta">The six actions add together, as in CUFSM. Restrained bending about x-z:
${LOADS.restrained ? 'on' : 'off'}. The reference stress on the nodes is
${fmtY(acts.ref)} MPa (max |nodal stress|).</div></div>
<div class="keep">${yv
      ? table(`First yield (f<sub>y</sub> = ${fmtY(LOADS.fy)} MPa, ${LOADS.extremeFibre ? 'extreme fibre' : 'centreline'}${LOADS.restrained ? ', restrained bending' : ''})`,
              ['Action', 'Value', 'Unit'], yieldRows)
      : '<div class="meta">First yield is not available: the engine cannot answer for this model.</div>'}
<div class="meta">The value of one action alone that first reaches f<sub>y</sub> somewhere on the
section — the acceptance numbers CUFSM's loading panel shows.</div></div>
<h2>4 Section properties</h2>
<div class="keep">${pr
      ? table('', ['Property', 'Value', 'Unit'], propRows)
      : '<div class="meta">Section properties are not available: the engine is not loaded.</div>'}
<div class="meta">Gross properties from the engine's grosprop, J, x<sub>s</sub>, z<sub>s</sub>,
Cw, B1 and B2 from its cutwp_prop2 (the same numbers the Loads tab shows); B1 and B2 are the extra
warping lengths that helper returns.</div></div>
<h2>5 Buckling results</h2>
<div class="keep">${kv('Governing mode', [
      ['Family', `${FAM[gov.fam].k} · ${FAM[gov.fam].label}`],
      [acts.norm === 'force' ? 'λ = P/P_ref' : 'σ_cr', fmtU(gov.sy)],
      ['L_cr', `${Math.round(gov.L)} mm`],
      ['Minima on the curve', `${disp.minima.length}`],
      ['σ_cr / f_y (elastic check)', `${f(gov.raw / P.fy)}`],
    ])}
${minRows.length ? table('Minima', ['Minimum', acts.norm === 'force' ? 'λ' : 'σ_cr', 'L', 'Modal content'], minRows) : ''}
${disp.minima.some((i) => disp.pts[i].also?.length) ? '<div class="meta">Minima of one family whose load factors agree within 1 % are one mode recurring at multiples of its half-wavelength: each is listed once, at its shortest length, with the lengths it recurs at.</div>' : ''}
${gov.raw > P.fy ? '<div class="meta">σ_cr exceeds f_y: this is an elastic bifurcation above yield — inelastic behaviour is not modelled, and the real member will yield before this load.</div>' : ''}</div>
<h2>6 Signature curve</h2><div class="keep">${sigSvg.outerHTML}
<div class="meta">${P.lengths.length} ${lengthWord(true)}; markers at the minima. ${esc(source)}${engineErr ? ` ⚠ ${esc(engineErr)}` : ''}</div></div>
<h2>7 ${P.solution === 'general' ? 'Lengths' : 'Half-wavelengths'} solved</h2><div class="keep">${kv('', [
      ['Count', `${P.lengths.length} ${lengthWord(true)}`],
      ['First', `${fmtY(P.lengths[0])} mm`],
      ['Last', `${fmtY(P.lengths[P.lengths.length - 1])} mm`],
    ])}
<div class="meta"><b>Solved list:</b> ${lenList}. Every ${lengthWord()} the curve and the modes were
solved at, in ascending order.</div></div>
<h2>8 Mode shape${sel ? ` (L = ${Math.round(sel.L)} mm, mode ${selModeIdx + 1} of ${sel.r.found})` : ''}</h2>
<div class="two keep"><div>${modeSvg.outerHTML}</div><div>${sel
      ? kv('As selected on screen', modeRows)
      : `<div class="meta">No mode to report: ${selErr ? esc(selErr) : 'the model has not been solved yet.'}</div>`}
<div class="meta">Deformed at half-wave phase ${(phase * 180 / Math.PI).toFixed(0)}°; the undeformed section is dashed.</div></div></div>
${sel ? `<div class="keep">${table(`Modes at L = ${Math.round(sel.L)} mm`, ['Mode', acts.norm === 'force' ? 'λ = P/P_ref' : 'σ_cr (MPa)', 'Class', 'Modal content'], selRows)}
<div class="meta">All ${sel.r.found} modes the engine found at this ${lengthWord()}, stepped through by
the mode browser; the one drawn above is marked (shown). The governing minimum is ${fmtU(gov.sy)} at
L = ${Math.round(gov.L)} mm (§5).</div></div>` : ''}
<h2>9 Modal spaces (cFSM)</h2>${cfsmSvg ? `<div class="keep">${cfsmSvg.outerHTML}
<div class="meta">Unconstrained envelope with the G, D and L space curves (CUFSM's signature plot; O is a classification share).</div></div>` : `<div class="meta">${cfsmNote || 'Constrained curves not available.'}</div>`}
<h2>10 The analysis as Python</h2><div class="keep"><pre>${esc(pyCode())}</pre>
<div class="meta">The model on screen, table for table, and the same analysis, as a script for the published
cufsm-rs-py package (<code>pip install cufsm-rs-py</code>; the same Rust engine this page runs). It prints the
minima as this page finds them: the load factors of §5, at the same lengths.</div></div>
<div class="foot">Generated by CivilKit Buckling (https://mageengineering.com.au/apps/buckling/). ${esc(source)}
An analysis tool, not a design certificate: the engineer of record checks what they use.</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);<\/script></body></html>`;
    return html;
  } finally {
    holder.remove();
  }
}
/* The tube's printable report: the same page style as the strip sections'. */
async function buildTubeReportHtml() {
  while (tubeTimer != null) await new Promise((r) => setTimeout(r, 40));
  const esc = (t) => String(t).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] ?? ch));
  const r = FT.res;
  if (!r || !r.modes.length) throw new Error(FT.err || 'the tube has not been solved');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:680px';
  document.body.appendChild(holder);
  const mkSvg = (cls, w, h) => {
    const s = document.createElementNS(SVG, 'svg');
    s.setAttribute('class', cls);
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('width', w); s.setAttribute('height', h);
    s.style.cssText = 'max-width:100%;height:auto;display:block';
    holder.appendChild(s);
    return s;
  };
  const table = (head, cols, rows) =>
    `<table>${head ? `<tr><th colspan="${cols.length}">${head}</th></tr>` : ''}` +
    `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>` +
    rows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('') + `</table>`;
  const kv = (head, pairs) =>
    `<table>${head ? `<tr><th colspan="2">${head}</th></tr>` : ''}` +
    pairs.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('') + `</table>`;
  try {
    const R = r.R, t = FT.t, L = FT.L, E = P.E, nu = P.nu;
    const endName = (v) => FT_ENDS.find((e) => +e[0] === v)[1];
    const sel = Math.min(FT.sel, r.modes.length - 1), m = r.modes[sel];
    const secSvg = mkSvg('sect', 300, 300);
    secSvg.setAttribute('viewBox', '0 0 420 420');
    drawTubeSection(secSvg, false);
    const tubeSvg = mkSvg('', 300, 520), mapSvg = mkSvg('', 360, 250);
    ftDraw(m, R, tubeSvg, mapSvg);
    const acts = [
      ['Compression N', FT.N, 'kN', 'σ<sub>N</sub> = N / (2πRt)', r.s[0], 'MPa'],
      ['Moment M', FT.M, 'kNm', 'σ<sub>M</sub> = M / (πR²t), peak, at θ = 0', r.s[1], 'MPa'],
      ['Torque T', FT.T, 'kNm', 'τ<sub>T</sub> = T / (2πR²t)', r.s[2], 'MPa'],
      ['Shear V', FT.V, 'kN', 'τ<sub>V</sub> = V / (πRt), peak, at θ = 90°', r.s[3], 'MPa'],
    ].filter((a) => a[1] !== 0);
    const modeRows = r.modes.map((md, i) => {
      const hw = ftHalfWaves(md.f);
      const pk = ftPeak(md.f);
      return [`${i + 1}${i === sel ? ' (drawn)' : ''}`, ftf(md.lf),
        acts.map((a) => `${a[0].split(' ').pop()}<sub>cr</sub> ${ftf(md.lf * a[1])} ${a[2]}`).join(' · '),
        `θ ${pk.deg}°, y ${pk.y.toFixed(2)} L`, `${hw.around} around · ${hw.along} along`];
    });
    const scl = E * t / R / Math.sqrt(3 * (1 - nu * nu));
    const omega = L / R * Math.sqrt(t / R);
    const col = (v) => (v === 3 ? 0 : v);      // a ring end is free for the column
    const k = { '2-0': 2, '0-2': 2, '1-1': 1, '2-2': 0.5, '2-1': 0.7, '1-2': 0.7 }[`${col(FT.base)}-${col(FT.top)}`];
    const I = Math.PI * R ** 3 * t;
    const refs = [['Classical axial stress E t / (R √(3(1 − ν²)))', `${ftf(scl)} MPa`],
                  ['Ω = L/R √(t/R)', omega.toFixed(2)]];
    if (k) refs.push([`Euler load π²EI / (KL)², K = ${k}`, `${ftf(Math.PI ** 2 * E * I / (k * L) ** 2 / 1e3)} kN`]);
    const source = 'Load factors and modes from the cufsm-rs engine (Rust → WebAssembly) running in the page.';
    const now = new Date();
    return `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8">
<title>CivilKit Buckling (CUFSM) - tube report</title>
<style>${pageCss()}
body{background:#fff;color:#1c2330;margin:0;padding:28px 34px;font-size:13px}
h1{font-size:20px;margin:0 0 2px} h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
.meta{color:#666;margin-bottom:10px} .two{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start}
table{border-collapse:collapse;width:100%;margin-bottom:10px} td,th{padding:3px 6px;border-bottom:1px solid #e3e3e3;text-align:left}
td:last-child{text-align:right;font-variant-numeric:tabular-nums} th{background:#f3f1ec;font-weight:600}
.foot{margin-top:26px;color:#666;font-size:11px}
@page{margin:14mm} @media print{body{padding:0} h2{break-after:avoid} .keep{break-inside:avoid}}
</style></head><body>
<h1>CivilKit Buckling (CUFSM) — tube report</h1>
<div class="meta">Circular tube ${FT.D} × ${t} mm, L ${L} mm · ${endName(FT.base)} base, ${endName(FT.top)} top · E ${E} MPa ·
${now.toLocaleDateString()} ${now.toLocaleTimeString()}</div>
<h2>1 Tube</h2><div class="two keep"><div>${secSvg.outerHTML}</div><div>${kv('', [
      ['Outside diameter D', `${FT.D} mm`], ['Wall t', `${t} mm`],
      ['Radius to the mid-wall R', `${R.toFixed(1)} mm`], ['R / t', (R / t).toFixed(1)],
      ['Length L', `${L} mm`], ['L / R', (L / R).toFixed(2)],
      ['Material', matLabel()],
      ["Young's E", `${E} MPa`], ["Poisson's ratio", `${nu}`],
      ['Base', endName(FT.base)], ['Top', endName(FT.top)],
    ])}<div class="meta">Free, stiff ring: the end moves as a rigid section but stays round (a flange). Free edge: a bare
shell edge, which buckles locally at about half the classical stress under compression. Pinned: a hinge with a rigid end
plate (u = w = 0, the end section turns as a plane). Clamped: u = v = w = 0 and w' = 0. The first pinned end also holds
the tube axially.</div></div></div>
<h2>2 Actions and reference stresses</h2><div class="keep">${table('', ['Action', 'Value', 'Stress', 'MPa'],
      acts.map((a) => [a[0], `${a[1]} ${a[2]}`, a[3], ftf(a[4])]))}
<div class="meta">Uniform along the tube. The load factor λ multiplies all of them together; hoop stress is not carried.</div></div>
<h2>3 Buckling results</h2><div class="keep">${kv('Lowest mode', [
      ['Load factor λ', ftf(r.modes[0].lf)],
      ...acts.map((a) => [`${a[0]} at buckling`, `${ftf(r.modes[0].lf * a[1])} ${a[2]}`]),
      ...acts.map((a) => [`${a[3].split(' = ')[0]} at buckling`, `${ftf(r.modes[0].lf * a[4])} MPa`]),
    ])}
${table('Modes', ['Mode', 'λ', 'Critical actions', 'Peak w at', 'Half-waves at the peak'], modeRows)}</div>
<h2>4 Mode ${sel + 1}</h2><div class="two keep"><div>${tubeSvg.outerHTML}</div><div>${mapSvg.outerHTML}
<div class="meta">Left: the tube standing on its base, the mode exaggerated (and the tube drawn wider than true where it is
slender). Right: the radial displacement unrolled, θ from 0 to 360° across and base to top up; red outward, blue inward.
θ = 0 is the compression side of M.</div></div></div>
<h2>5 Reference values</h2><div class="keep">${kv('', refs)}
<div class="meta">Closed forms for comparison, not checks: the classical stress holds for a medium-length cylinder in uniform
compression, the Euler load for a long one.</div></div>
<h2>6 Method and limits</h2><div class="meta">The finite tube method (Ádány and Schafer, Thin-Walled Structures 206, 2025):
u, v and w as products of Fourier series around (${FT.p} harmonics) and along the tube (wave numbers ${r.js.join(', ')}),
Sanders-type strains, supports imposed exactly; ${r.dofs} unknowns. One uniform segment with stresses uniform along it: no
stepped or tapered towers, no pressure, no hoop stress. This is a linear (bifurcation) analysis of the perfect tube: real
tubes buckle well below it, so a design check applies the imperfection reduction of EN 1993-1-6 (or the governing code) to
these values.</div>
<div class="foot">Generated by CivilKit Buckling (https://mageengineering.com.au/apps/buckling/). ${esc(source)}
An analysis tool, not a design certificate: the engineer of record checks what they use.</div>
<script>window.onload = () => setTimeout(() => window.print(), 300);<\/script></body></html>`;
  } finally {
    holder.remove();
  }
}

$('#reportBtn').onclick = async () => {
  const btn = $('#reportBtn'), old = btn.textContent;
  btn.textContent = 'Building…';
  try {
    const html = await (P.shape === 'tube' ? buildTubeReportHtml() : buildReportHtml());
    const w = window.open('', '_blank');
    if (!w) { btn.textContent = 'Allow pop-ups'; setTimeout(() => { btn.textContent = old; }, 2500); return; }
    w.document.write(html);
    w.document.close();
  } catch (e) {
    console.error(e);
    btn.textContent = 'Failed';
    setTimeout(() => { btn.textContent = old; }, 2500);
    return;
  } finally {
    if (btn.textContent === 'Building…') btn.textContent = old;
  }
};

/* The Python drawer and its run facade are gone (#drawer is now the
   .ckext module builder); the report and the Python console use pyCode(). Undo stays global. */
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea')) return;  // native text undo
    e.preventDefault();
    if (e.shiftKey) redoEdit(); else undoEdit();
  }
});

/* The report's Python: a cufsm-rs-py script rebuilding the model on screen (js/python.js). */
const pyCode = () => pythonScript({ model: MODEL, solution: P.solution, bc: engBc(), terms: engTerms(),
                                    lengths: P.lengths });

/* The Python console (More > Python). Its code, its worker, MicroPython and the cufsm_rs lite
   package all load on the console's first open, so a visit that never opens it pays nothing. */
let pyUI = null;
async function showConsole() {
  if (!pyUI) pyUI = Promise.all([import('./js/py/console-ui.js'), import('./js/py/console-client.js')])
    .then(([ui, client]) => ui.createConsoleUI({
      client: client.createConsoleClient(),
      modelScript: pyCode,
      modelLabel: () => `${MODEL.nodes.length} nodes, ${MODEL.elems.length} elements, `
        + (P.solution === 'general' ? `${engBc()} with ${engTerms()} terms` : 'signature curve') + `, ${P.lengths.length} lengths`,
    }))
    .catch((e) => { pyUI = null; throw e; });
  let ui;
  try { ui = await pyUI; } catch (e) {
    pane.innerHTML = '';
    const n = document.createElement('div');
    n.className = 'note engineerr';
    n.setAttribute('role', 'alert');
    n.textContent = `The Python console did not load: ${String(e?.message ?? e)}`;
    pane.appendChild(n);
    return;
  }
  if (tab === 'python') ui.show(pane);
}

/* ---------------------------------------------------------------- animate */
function tick() {
  if (playing && (tab === 'mode' || tab === 'mode3d')) {
    phase = (phase + 0.045) % (2 * Math.PI);
    if (tab === 'mode') drawMode(); else draw3d();
    const s = $('#scrub');
    if (s) s.value = (phase / (2 * Math.PI) * 100).toFixed(0);
  }
  requestAnimationFrame(tick);
}

/* debug/testing hook. The getters are read-only and always present; the live engine object
   is handed out only under ?test=1 (a production page gets null, so nothing can reach
   crash()), and so are setEngine and the cufsm-test eval bridge (tests dispatch an event
   carrying source, the JSON result comes back in data-cufsm-result). */
const TEST_HOOK = new URLSearchParams(location.search).get('test') === '1';

/* The extension sandbox: started lazily (the worker costs a wasm compile), with a banner that
   carries the last failure - a stopped module, a Python error - where the user can see it.
   The Extensions UI (js/ext/ui.js) builds the real surface on top of this. */
let extClient = null;
const extBanner = document.createElement('div');
extBanner.id = 'extBanner';
extBanner.setAttribute('role', 'alert');
extBanner.style.cssText = 'display:none;margin:10px;padding:10px 12px;border:1px solid #a44;'
  + 'border-radius:6px;background:#2a1515;color:#e0a0a0;font:13px/1.4 system-ui,sans-serif';
document.body.appendChild(extBanner);
const extFail = (msg) => { extBanner.textContent = msg; extBanner.style.display = 'block'; };
const extSession = (s) => ({
  tree: s.tree,
  buildUi: (...a) => s.buildUi(...a).catch((e) => { extFail(String(e.message || e)); throw e; }),
  check: (...a) => s.check(...a).catch((e) => { extFail(String(e.message || e)); throw e; }),
});
const ext = {
  start() {
    if (!extClient) {
      const t = Number(new URLSearchParams(location.search).get('extTimeout'));
      extClient = startExtensions({ timeoutMs: Number.isFinite(t) && t > 0 ? t : 20000 });
    }
    return extClient;
  },
  async open(bundle) { return extSession(await this.start().open(bundle)); },
  banner() { return extBanner.textContent; },
  clearBanner() { extBanner.textContent = ''; extBanner.style.display = 'none'; },
};

/* What a module's capabilities see: the model with its loads, fy and analysis settings, and
   the solved curve when there is one. Copies, so nothing a module run does reaches the GUI. */
function extSnapshot() {
  const model = {
    mats: MATS.map((q) => ({ ...q })),
    nodes: MODEL.nodes.map((n) => ({ ...n, free: [...n.free] })),
    elems: MODEL.elems.map((e) => ({ ...e })),
    springs: SPRINGS.map((r) => [...r]),
    constraints: CONSTRAINTS.map((r) => [...r]),
    loads: { P: LOADS.P, Mxx: LOADS.Mxx, Mzz: LOADS.Mzz, M11: LOADS.M11, M22: LOADS.M22, B: LOADS.B,
             restrained: LOADS.restrained },
    fy: LOADS.fy,
    analysis: { solution: P.solution, bc: engBc(), terms: engTerms(), neigs: P.neigs, lengths: [...P.lengths] },
  };
  const results = sig && sig.pts.length ? {
    curve: sig.pts.map((p) => [p.L, p.lf]),
    minima: sig.minima.map((i) => {
      const p = sig.pts[i];
      return { length: p.L, lf: p.lf, kind: FAM[p.fam].k, cls: p.cls ?? null };
    }),
    maxStress: acts.ref,
  } : null;
  return { model, results };
}

/* A proposal's model, as the app keeps one: every node gets its four fixity flags and a stress,
   springs and constraints default to none, and model.js validates the result. */
function proposalModel(prop) {
  const { loads, analysis, fy, units, ...m } = structuredClone(prop);
  m.springs = Array.isArray(m.springs) ? m.springs : [];
  m.constraints = Array.isArray(m.constraints) ? m.constraints : [];
  m.nodes = (m.nodes || []).map((n) => ({
    x: Number(n.x), z: Number(n.z),
    free: Array.isArray(n.free) && n.free.length === 4 ? n.free.map((f) => (f ? 1 : 0)) : [1, 1, 1, 1],
    stress: Number.isFinite(n.stress) ? n.stress : 1 }));
  validateModel(m);
  return { m, loads, analysis, fy };
}

/* Preview: the proposal ghosted over the current section, both on one scale. */
function drawProposal(svg, prop) {
  const gp = geometry(proposalModel(prop).m);
  const gc = geo && geo.elems.length ? geo : null;
  const fitTo = { nodes: [...(gc ? gc.nodes : []), ...gp.nodes] };
  if (gc) drawSection(svg, gc, { pad: 40, dims: false, fitTo });
  else svg.innerHTML = '';
  drawSection(svg, gp, { pad: 40, dims: false, fitTo, keep: true, cls: 'ghost' });
  svg.classList.add('previewing');
}
function previewProposal(prop) {
  if (P.shape === 'tube' || !geo) return;
  if (!prop) {
    if ($('#sectionSvg').classList.contains('previewing')) drawMainSection();
    return;
  }
  drawProposal($('#sectionSvg'), prop);
  $('#legend').textContent = 'Preview: the proposed section (dashed) over the current one. Nothing has changed yet.';
}

/* Use it: the proposed section becomes the model on screen (the Model shape owns it, as after a
   paste), with the proposal's loads and analysis settings when it carries them. The stresses are
   regenerated from the reference loads through the engine. Returns the undo. */
async function commitProposal(prop) {
  const { m, loads, analysis, fy } = proposalModel(prop);
  recordEdit();                        // an edit still settling becomes its own step first
  setModel(m);
  P.shape = 'model';
  const L = loads && typeof loads === 'object' ? loads : {};
  for (const k of ACTKEYS) if (Number.isFinite(L[k])) LOADS[k] = L[k];
  if (typeof L.restrained === 'boolean') LOADS.restrained = L.restrained;
  const f = Number.isFinite(fy) ? fy : L.fy;
  if (Number.isFinite(f) && f > 0) LOADS.fy = f;
  const a = analysis && typeof analysis === 'object' ? analysis : {};
  if (a.solution === 'general' || a.solution === 'signature') P.solution = a.solution;
  if (typeof a.bc === 'string' && [...$('#bc').options].some((o) => o.value === a.bc)) P.bc = a.bc;
  if (Number.isFinite(a.terms)) P.terms = Math.max(1, Math.min(TERMS_MAX, a.terms | 0));
  if (Number.isFinite(a.neigs)) P.neigs = Math.max(1, Math.min(NEIGS_MAX, a.neigs | 0));
  const pr = parseLengths(Array.isArray(a.lengths) ? a.lengths.join('\n') : '');
  if (pr.lengths.length >= 2) P.lengths = pr.lengths;
  tubeMode(); buildShapes(); buildParams(); syncAnalysisInputs();
  SEL = { elem: -1, nodes: new Set() };
  if (ACTKEYS.some((k) => LOADS[k])) await regenStress();
  /* the proposal is one step in the undo history; the toast's Undo steps back over it, and only
     while it is still the latest step (after another edit, ↶ does the undoing) */
  const pushed = recordEdit();
  const mine = histKey;
  update();
  return () => { if (pushed && histKey === mine) undoEdit(); };
}

const extUI = createExtensionsUI({
  openSession: (bundle) => ext.start().open(bundle),
  runExamples: (bundle) => ext.start().examples(bundle),
  snapshot: extSnapshot,
  drawSection: (svg, model, opt = {}) =>
    drawSection(svg, geometry(model ?? MODEL), { pad: 48, ...opt, ...(model ? { dims: false } : {}) }),
  drawChart,
  drawProposal,
  preview: previewProposal,
  commit: commitProposal,
  fmt,
});

window.__cufsm = {
  get engine() { return TEST_HOOK && engineReady ? engine : null; },
  get layout() { return shell.layout; },
  get err() { return engineErr; },
  get sig() { return sig; },
  get disp() { return disp; },
  get geo() { return geo; },
  get model() { return MODEL; },
  get acts() { return acts; },
  get loads() { return LOADS; },
  get springCount() { return SPRINGS.length; },
  get view() { return { ...canvasView }; },
  get history() { return { canUndo: hist.canUndo, canRedo: hist.canRedo }; },
  get selMin() { return selMin; },
  get selL() { return selL; },
  get selModeIdx() { return selModeIdx; },
  get constrCount() { return CONSTRAINTS.length; },
  engineModel, engineSignature, engineModes, cfsmCurves, modeXZ, idle, buildReportHtml,
  ...(TEST_HOOK ? {
    setEngine(e) { engine = e; engineReady = !!e; engineErr = null; update(); },
    ext,
    /* kill the worker mid-flight: the next solve fails with the engine's message, the
       error state offers Retry, and Retry restarts the worker (browser evidence step) */
    breakEngine() { engine?.crash?.(); },
  } : null),
};
if (TEST_HOOK) document.addEventListener('cufsm-test', (ev) => {
  const done = (v) => {
    document.documentElement.dataset.cufsmResult =
      v === undefined ? JSON.stringify({ undefinedReturn: true }) : JSON.stringify(v);
  };
  try {
    const code = String(ev.detail && ev.detail.code);
    const v = new Function('return (' + code + ')')();
    if (v && typeof v.then === 'function')
      v.then(done, (e) => done({ error: String((e && e.message) || e) }));
    else done(v);
  } catch (e) {
    done({ error: String((e && e.message) || e) });
  }
});

/* Boot: a copied link (#v2.…) is decoded, validated and applied before the first solve. The
   whole sequence — including the first update() and render — sits in one try, so a link that is
   decodable but malformed cannot leave a dead page: everything falls back to the default section
   and the message lands in the footer note. Never throws. */
let shared = null, shareErr = null, fellBack = false, shareNotes = [];
/* Boot order: a #v2. link, saved as a new project called "Shared link"; else the
   last project opened on this device; else the default section. */
await openProjectsDb();
let bootProj = null;
if (location.hash.startsWith('#v')) {
  try { shared = await decodeState(location.hash); PROJ.name = 'Shared link'; PROJ.dropHash = true; }
  catch (e) { shareErr = (e && e.message) || String(e); shared = null; }
} else {
  try {
    const last = recallLast();
    bootProj = last ? await PR.loadProject(PROJ.db, last) : null;
    if (!bootProj) {
      const [newest] = await PR.listProjects(PROJ.db);
      if (newest) bootProj = await PR.loadProject(PROJ.db, newest.id);
    }
  } catch (e) { shareErr = `Your projects could not be read: ${(e && e.message) || e}.`; }
  if (bootProj) shared = bootProj.state;
}
/* the default state, snapshotted before anything touches it, so a failure part-way through a
   shared boot restores P, the loads, the tab, the materials (setModel replaces them) and the
   σ↔λ toggle exactly */
const BOOT = { p: structuredClone(P), loads: { ...LOADS }, tab, norm: acts.norm,
               mats: MATS.map((q) => ({ ...q })), ft: { ...FT } };
try {
  buildShapes();
  buildParams();
  if (shared) {
    shareNotes = applyShared(shared, bootProj ? 'project' : 'link') || [];
    if (bootProj) {
      applyTemplate(shared.template);
      Object.assign(PROJ, { id: bootProj.id, name: bootProj.name, status: 'saved', at: bootProj.updated });
    }
  } else { await buildModel(); fellBack = true; }
  update();
  renderShapeFn();                    // the shape-function pane is drawn on boot, not on first touch
} catch (e) {
  if (!shareErr) shareErr = (bootProj ? `Your last project, “${bootProj.name}”, could not be opened: ` : '') + ((e && e.message) || String(e));
  PROJ.id = null; PROJ.name = 'Untitled'; PROJ.dropHash = false;   // never written over the project that failed
  try {
    Object.assign(P, BOOT.p);
    Object.assign(LOADS, BOOT.loads);
    acts.norm = BOOT.norm; tab = BOOT.tab; MATS = BOOT.mats;
    buildShapes(); buildParams(); await buildModel(); update();
    renderShapeFn();
    fellBack = true;
  } catch (e2) {
    fellBack = false;
    shareErr += `; the default section could not be built: ${(e2 && e2.message) || e2}`;
  }
}
if (shareErr) {
  const note = $('#footerNote');
  if (note) note.textContent = `⚠ ${shareErr}` +
    (fellBack ? ' The page opened with its default section instead.' : '');
} else if (shareNotes.length) {
  const note = $('#footerNote');
  if (note) note.textContent = `⚠ This ${bootProj ? 'project' : 'link'} was opened with changes: ${shareNotes.join('; ')}.`;
}
shellSync = true;                  // from here an app-tab change moves the shell tab too
tick();
startPwa({ toast });

/* ?py=<example file> (e.g. ?py=dsm_lip_study.py): opens the Python console with that example in
   the editor, a link that demonstrates the console in one click */
const pyDemo = new URLSearchParams(location.search).get('py');
if (pyDemo) {
  tab = 'python'; renderPane();
  pyUI?.then((ui) => ui.useExample(pyDemo)).catch(() => {});
}
if ('launchQueue' in window) window.launchQueue.setConsumer(async (params) => {
  const h = params.files && params.files[0];
  if (h) openProjectFile(await h.getFile(), (msg) => toast(`⚠ ${msg}`, '', null, 8000));
});
window.addEventListener('resize', () => { if (tab === 'mode') drawMode(); else if (tab === 'mode3d') draw3d(); });
