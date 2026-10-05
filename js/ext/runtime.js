import { createCapabilityBridge } from '../../vendor/civilkit/host.js';
import { makeCapabilities } from './capabilities.js';

/* onCapability(name, declared), optional: told of every capability call a module makes, before
   it runs - the CLI counts what a module used and what it reached for without declaring. */
export async function createRuntime({ micropython, engine, stdout = () => {}, onCapability = null }) {
  const mp = await micropython.loadMicroPython({ heapsize: 16 * 1024 * 1024, stdout, stderr: stdout });
  let declared = null;
  const snapshot = { model: null, results: null };
  const proposals = [], logs = [];
  const sink = { log: (m) => logs.push(m), propose: (p) => proposals.push(p) };
  // Built once: the capability functions read `snapshot` at call time, so the host mutating
  // snapshot.model / snapshot.results before a check is enough (the Proxy form loses its
  // dynamic lookup the moment the bridge copies `granted`).
  const bridge = createCapabilityBridge(
    makeCapabilities(engine, snapshot, sink),
    () => (declared ? [...declared, 'log'] : null));
  const allowed = (k) => k === 'log' || (declared ?? []).includes(k);
  mp.registerJsModule('civilkit', onCapability ? new Proxy({}, {
    get(_, k) {
      const f = bridge[k];
      if (typeof k !== 'string' || typeof f !== 'function') return f;
      return (...a) => { onCapability(k, allowed(k)); return f(...a); };
    },
  }) : bridge);
  mp.runPython('import json');
  return {
    load({ manifest, main }) {
      declared = manifest.capabilities ?? [];
      mp.runPython('for _k in [k for k in globals() if not k.startswith("__") and k != "json"]:\n    del globals()[_k]');
      mp.runPython(main);
    },
    buildUi(inputs = {}, result = [], calcLines = []) {
      mp.globals.set('_A', JSON.stringify([inputs, result, calcLines]));
      mp.runPython('_OUT = json.dumps(build_ui(*json.loads(_A)))');
      return JSON.parse(String(mp.globals.get('_OUT')));
    },
    check(inputs, snap) {
      snapshot.model = snap.model; snapshot.results = snap.results;
      proposals.length = 0; logs.length = 0;
      mp.globals.set('_I', JSON.stringify(inputs ?? {}));
      mp.runPython('_OUT = json.dumps(check(json.loads(_I)))');
      return { ...JSON.parse(String(mp.globals.get('_OUT'))), proposals: [...proposals], logs: [...logs] };
    },
  };
}
