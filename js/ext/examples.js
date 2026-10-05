/* Worked examples: what makes a module Verified. Shared by the headless CLI (tools/ckext.mjs) and
   by the app, where the sandbox worker runs them at install so the registry can decide the badge.
   Pure: a runtime (js/ext/runtime.js) in, a report out. */
import { tracebackLine } from './pyhighlight.js';

/* Studio's rule, ported verbatim from CivilKit Studio's module system: every expected row
   must exist in the actual result by label, numbers within 0.1 % (floor 1e-9), strings exactly,
   and a stated unit exactly. Rows the module emits beyond the expected list are fine. */
export function matchExpected(expected, actual) {
  const diffs = [];
  const rows = (expected && expected.result) || [];
  const got = new Map(((actual && actual.result) || []).map((r) => [r.label, r]));
  for (const ex of rows) {
    const a = got.get(ex.label);
    if (!a) { diffs.push(`${ex.label}: missing from result`); continue; }
    if (typeof ex.value === 'number') {
      const tol = Math.max(1e-9, Math.abs(ex.value) * 1e-3);
      if (typeof a.value !== 'number' || Math.abs(a.value - ex.value) > tol) diffs.push(`${ex.label}: expected ${ex.value}, got ${a.value}`);
    } else if (String(a.value) !== String(ex.value)) diffs.push(`${ex.label}: expected ${JSON.stringify(ex.value)}, got ${JSON.stringify(a.value)}`);
    if (ex.unit != null && a.unit !== ex.unit) diffs.push(`${ex.label}: expected unit ${ex.unit}, got ${a.unit}`);
  }
  return diffs;
}

/* A thrown error as one line: a Python traceback is cut to its last line, the exception itself,
   with the main.py line it failed on (the builder marks that line in its editor). */
export function errorText(e) {
  const msg = String((e && e.message) || e).trim();
  if (!/Traceback/.test(msg)) return msg;
  const { line, message } = tracebackLine(msg);
  return line ? `${message} (main.py line ${line})` : message;
}

/* The worked examples inside an unzipped bundle ({ path: Uint8Array }), at manifest.tests or the
   default path. Throws when the file is there but is not a JSON list. */
export function examplesOf(manifest, files) {
  const bytes = files[(manifest && manifest.tests) || 'tests/worked-examples.json'];
  if (!bytes) return [];
  const list = JSON.parse(typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes));
  if (!Array.isArray(list)) throw new Error('tests/worked-examples.json is not a list');
  return list;
}

/* bundle = { manifest, main, examples }. Each example runs on a freshly loaded module, against its
   own fixture model and no solved results. Anything the module or the engine throws (a model the
   engine refuses, an undeclared capability, a Python error) becomes that example's diff, so one
   bad example never stops the others. Verified needs at least one example, all passing. */
export async function runWorkedExamples(runtime, bundle) {
  const examples = [];
  for (const ex of bundle.examples ?? []) {
    let diffs;
    try {
      runtime.load({ manifest: bundle.manifest, main: bundle.main });
      const out = runtime.check(ex.input ?? {}, { model: ex.model ?? null, results: null });
      diffs = matchExpected(ex.expected, out);
    } catch (e) {
      diffs = [errorText(e)];
    }
    examples.push({ id: ex.id ?? '?', pass: diffs.length === 0, diffs, source: ex.source ?? null });
  }
  const badge = examples.length > 0 && examples.every((x) => x.pass) ? 'verified' : 'community';
  return { badge, examples };
}
