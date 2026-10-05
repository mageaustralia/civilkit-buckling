export function startExtensions({ timeoutMs = 20000 } = {}) {
  let w, token = null, next = 1, ready;
  const pending = new Map();
  const spawn = async () => {
    const src = `import ${JSON.stringify(new URL('./worker.js', import.meta.url).href)};`;
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    const [wasm, mpWasm] = await Promise.all([
      fetch(new URL('../../cufsm.wasm', import.meta.url)).then((r) => r.arrayBuffer()),
      fetch(new URL('../../vendor/civilkit/micropython.wasm', import.meta.url)).then((r) => r.arrayBuffer())]);
    ready = new Promise((res, rej) => {
      w.onmessage = ({ data: m }) => {
        if (token === null && m?.type === 'boot-error' && typeof m.token === 'string') { token = m.token; rej(new Error(m.error)); return; }
        if (token === null && m?.type === 'ready' && typeof m.token === 'string') { token = m.token; res(); return; }
        if (!m || m.token !== token) return;                         // forged or stray: ignored
        const p = pending.get(m.id); if (!p) return;
        pending.delete(m.id); clearTimeout(p.t);
        m.error ? p.rej(new Error(m.error)) : p.res(m.value);
      };
      w.onerror = (e) => rej(new Error(e.message));
    });
    w.postMessage({ type: 'boot', wasm, mpWasm }, [wasm, mpWasm]);
    return ready;
  };
  const call = (msg) => new Promise((res, rej) => {
    const id = next++;
    const t = setTimeout(() => { pending.delete(id); restart(); rej(new Error('The module stopped responding and was stopped.')); }, timeoutMs);
    pending.set(id, { res, rej, t });
    w.postMessage({ ...msg, id });
  });
  const restart = () => { w?.terminate(); token = null; for (const p of pending.values()) { clearTimeout(p.t); p.rej(new Error('restarted')); } pending.clear(); ready = spawn(); };
  ready = spawn();
  return {
    async open(bundle) {
      await ready;
      const tree = await call({ type: 'load', bundle });
      return {
        tree,
        buildUi: (inputs, result, calcLines) => call({ type: 'ui', inputs, result, calcLines }),
        check: (inputs, snapshot) => call({ type: 'check', inputs, snapshot }),
      };
    },
    /* bundle = { manifest, main, examples } -> { badge, examples: [{ id, pass, diffs, source }] } */
    async examples(bundle) {
      await ready;
      return call({ type: 'examples', bundle });
    },
    close() { w?.terminate(); },
  };
}
