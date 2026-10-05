import { toBuffers, validateModel } from '../model.js';
import { findMinima } from '../results.js';

export function makeCapabilities(engine, snapshot, sink) {
  const parse = (j) => (j == null || j === '' ? {} : JSON.parse(j));
  const modelOf = (a) => { const m = a.model ?? snapshot.model; validateModel(m); return m; };
  const buf = (m) => toBuffers(m);
  const out = (v) => JSON.stringify(v);
  return {
    getModel: () => out({ units: 'N-mm', ...snapshot.model }),
    hasResults: () => !!snapshot.results,
    getResults: () => out(snapshot.results ?? { curve: [], minima: [], maxStress: null }),
    sectionProps: (j) => out(engine.props(buf(modelOf(parse(j))))),
    stress: (j) => { const a = parse(j); return out({ stress: [...engine.stresgen(buf(modelOf(a)), a)] }); },
    firstYield: (j) => { const a = parse(j); return out(engine.firstYield(buf(modelOf(a)), a)); },
    signature: (j) => {
      const a = parse(j), m = modelOf(a);
      const spaces = (a.cfsm ?? []).reduce((s, k) => s | { G: 1, D: 2, L: 4, O: 8 }[k], 0);
      const raw = engine.signature(buf(m), { bc: a.bc ?? 'S-S', terms: a.terms ?? 1, spaces, lengths: a.lengths });
      const stride = 2 + (a.cfsm ?? []).length;
      const curve = [], constrained = Object.fromEntries((a.cfsm ?? []).map((k) => [k, []]));
      for (let r = 0; r < raw.length / stride; r++) {
        curve.push([raw[r * stride], raw[r * stride + 1]]);
        ['G', 'D', 'L', 'O'].filter((k) => k in constrained).forEach((k, c) => constrained[k].push(raw[r * stride + 2 + c]));
      }
      return out({ curve, constrained, minima: findMinima(curve) });
    },
    modes: (j) => {
      const a = parse(j);
      const [r] = engine.modes(buf(modelOf(a)), { bc: a.bc ?? 'S-S', terms: a.terms ?? 1, neigs: a.n ?? 5, lengths: [a.length] });
      const KIND = ['G', 'D', 'L', 'O'];
      return out({ modes: r.modes.map((md) => ({ lf: md.lf, cls: md.cls, kind: KIND[md.cls.indexOf(Math.max(...md.cls))],
                                                 ...(a.dofs ? { dofs: [...md.dofs] } : {}) })) });
    },
    proposeModel: (j) => {
      let m, error = null;
      try { m = { springs: [], constraints: [], ...JSON.parse(j) }; validateModel(m); } catch (e) { error = e.message; }
      sink.propose(error ? { error } : { model: m });
      return out({ accepted: false, pending: !error, error });
    },
    log: (msg) => { sink.log(String(msg)); },
  };
}

/* The host contract's capability table (guide/capabilities.html documents each one),
   one line each: the module builder's manifest checklist is generated from it. `log` is free and
   never declared, so it is not listed. tests/builder.test.mjs keeps it in step with
   makeCapabilities. */
export const CAPABILITY_DOCS = [
  ['getModel', 'the model on screen (or the worked example\'s fixture): mats, nodes, elems, loads, fy, analysis'],
  ['hasResults', 'whether the GUI has a solved curve for the current model'],
  ['getResults', 'the GUI\'s solved curve and its classified minima'],
  ['sectionProps', 'A, centroid, Ixx, Izz, Ixz, principal axes, J, shear centre, Cw'],
  ['stress', 'the node stresses for given actions P, Mxx, Mzz, M11, M22, B'],
  ['firstYield', 'the first-yield actions Py, My and B for a given fy'],
  ['signature', 'a signature curve, optionally with cFSM curves, and its minima'],
  ['modes', 'the buckling modes at one length, with their cFSM classification'],
  ['proposeModel', 'offer a section to the analysis; the user decides'],
];
