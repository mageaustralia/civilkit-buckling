/* One console run, on the runtime it needs:
   MicroPython first, the full runtime (Pyodide) only when the script needs it and the user agrees.

     1. the import scan (js/py/detect.js): an import MicroPython lacks goes to the full runtime;
     2. a compile-only pass in MicroPython: a SyntaxError goes to the full runtime;
     3. the MicroPython run: a failure partway on something MicroPython lacks (fallbackReason)
        re-runs on the full runtime. Its output was buffered and is dropped, so one clean output
        is shown, the full runtime's.
   Before the full runtime downloads anything, consent(need) is asked (the console's prompt, or a
   remembered "always"); with nothing to download (it is on the device, or loaded) it is not
   asked. Declined, the script's MicroPython run is shown, with its notice and marked line.

   Pure: the console (js/py/console-ui.js, through js/py/console-client.js) and the Node tests
   drive the same runScript().

   mp       { run(source), compile(source) }        js/py/runner.js's, or the client's
   full     { plan(source), run(source) }           plan: { packages, notHosted, missing, bytes }
   consent  (need) -> Promise<boolean>              need: plan + { reason }
   Resolves to the result shown: a runner result, with
     fallback  { why, text } the reason it ran on the full runtime (absent on MicroPython)
     declined  { why, text, bytes } when the user said Not now (the result is MicroPython's) */
import { scanImports, beyondMicroPython, fallbackReason } from './detect.js';

export async function runScript(source, { mp, full, consent, onStage = () => {} }) {
  let reason = null, first = null;
  const beyond = beyondMicroPython(scanImports(source));
  if (beyond.length) reason = { why: 'import', modules: beyond, text: `it imports ${beyond.join(', ')}` };
  else {
    onStage('check');
    const c = await mp.compile(source);
    if (!c.ok && c.error?.type === 'SyntaxError') {
      reason = { why: 'syntax', line: c.error.line,
        text: `MicroPython cannot read line ${c.error.line ?? '?'} (${c.error.type}: ${c.error.message})` };
    }
  }
  if (!reason) {
    onStage('micropython');
    first = await mp.run(source);
    const fb = fallbackReason(first);
    if (!fb) return first;
    reason = { ...fb, line: first.error?.line ?? null,
      text: `MicroPython stopped at line ${first.error?.line ?? '?'} (${first.error?.type}: ${first.error?.message})` };
  }
  const plan = await full.plan(source);
  const yes = plan.bytes === 0 || await consent({ ...plan, reason });
  if (!yes) {
    onStage('micropython');
    const r = first ?? await mp.run(source);
    return { ...r, declined: { ...reason, bytes: plan.bytes } };
  }
  onStage('full');
  const r = await full.run(source);
  return { ...r, fallback: reason };
}
