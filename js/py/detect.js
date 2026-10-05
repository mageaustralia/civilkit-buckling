/* Which runtime a console script needs, cheapest test first. This module is the first two steps' pure part and the third's reading of an error; the
   order is js/py/dispatch.js's.

     1. scanImports(source): the modules a script imports, read from its text (strings and
        comments skipped), against MICROPYTHON_MODULES, what the MicroPython runtime runs.
     2. A compile-only pass in MicroPython (the runner's compiles()): a SyntaxError there means
        syntax MicroPython lacks (f"{x=}", match, walrus in places, ...): the full runtime.
     3. fallbackReason(result): a MicroPython run that failed partway on something MicroPython
        lacks (an import, a built-in, a module attribute, the lite layer's "needs numpy") is re-run
        on the full runtime; its output was buffered, so the re-run shows one clean output.

   packagesFor(modules) turns a script's imports into the Pyodide packages it downloads (closed over
   their dependencies, from the pinned release's lock: js/py/pyodide-files.js), and downloadFor()
   into the files and bytes still to fetch. No Buckling imports: liftable as it is. */
import { PYODIDE } from './pyodide-files.js';

/* the modules a script may import and still run on MicroPython: the lite cufsm_rs (and its plot),
   the examples' dsm, and MicroPython's own modules that behave as CPython's for a console script
   (a missing function in one of them is caught by step 3) */
export const MICROPYTHON_MODULES = new Set(['cufsm_rs', 'dsm', 'json', 'math', 'cmath', 'time', 'sys', 'array',
  'collections', 'random', 'struct', 're', 'io', 'itertools', 'functools', 'heapq', 'copy', 'operator', 'string']);

/* the source with every string's and comment's text blanked (newlines kept), so an "import numpy"
   inside a docstring or a comment is not read as an import */
export function codeOnly(src) {
  const s = String(src ?? '');
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '#') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '"' || c === "'") {
      const triple = s.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      out += q; i += q.length;
      while (i < s.length && !s.startsWith(q, i)) {
        if (s[i] === '\\') { out += '  '; i += 2; continue; }
        if (!triple && s[i] === '\n') break;            // an unterminated string ends at its line
        out += s[i] === '\n' ? '\n' : ' '; i++;
      }
      if (s.startsWith(q, i)) { out += q; i += q.length; }
      continue;
    }
    out += c; i++;
  }
  return out;
}

/* every module a script imports, dotted names whole ('cufsm_rs.plot'), in first-seen order;
   relative imports (from . import x) are left out */
export function scanImports(src) {
  const code = codeOnly(src).replace(/\\\n/g, ' ');
  const mods = [];
  const add = (m) => { if (m && !mods.includes(m)) mods.push(m); };
  for (const stmt of code.split(/[\n;]/)) {
    let m = /^\s*import\s+(.+)$/.exec(stmt);
    if (m) {
      for (const part of m[1].replace(/[()]/g, '').split(',')) add(/^\s*([\w.]+)/.exec(part)?.[1]);
      continue;
    }
    m = /^\s*from\s+([\w.]+)\s+import\s+(.+)$/.exec(stmt);
    if (m && !m[1].startsWith('.')) {
      add(m[1]);
      // from cufsm_rs import plot: a submodule
      if (m[1] === 'cufsm_rs' && /\bplot\b/.test(m[2])) add('cufsm_rs.plot');
    }
  }
  // cufsm_rs.plot reached as an attribute (cufsm_rs.plot.plot_signature, fsm.plot.plot_mode)
  if (mods.includes('cufsm_rs') && /\.plot\s*\.\s*plot_(section|signature|mode)\b/.test(code)) add('cufsm_rs.plot');
  return mods;
}

/* the modules (top-level names) MicroPython cannot run; [] when it can */
export const beyondMicroPython = (mods) => [...new Set(mods.map((m) => m.split('.')[0]))]
  .filter((m) => !MICROPYTHON_MODULES.has(m));

/* what the packages imported by the console's own modules need: cufsm_rs is numpy-backed, its
   plot module is matplotlib's, and dsm imports cufsm_rs */
const IMPLIED = { cufsm_rs: ['numpy'], 'cufsm_rs.plot': ['matplotlib'], dsm: ['numpy'] };

/* the Pyodide packages a script's imports need, closed over their dependencies (lock keys,
   sorted), and the imports the console does not host (another package of the release, named) */
export function packagesFor(mods, P = PYODIDE) {
  const byImport = new Map();
  for (const [key, p] of Object.entries(P.packages)) for (const i of p.imports) byImport.set(i, key);
  const need = new Set(), notHosted = [];
  const add = (key) => {
    if (need.has(key)) return;
    need.add(key);
    for (const d of P.packages[key].depends) add(d);
  };
  for (const m of mods) {
    for (const k of IMPLIED[m] ?? []) add(k);
    const top = m.split('.')[0];
    if (byImport.has(top)) add(byImport.get(top));
    else if (Object.hasOwn(P.others, top) && !notHosted.some((n) => n.module === top))
      notHosted.push({ module: top, package: P.others[top] });
  }
  return { packages: [...need].sort(), notHosted };
}

/* the files a set of packages needs on top of the core, and of those, the ones not in `have` (the
   names already on the device or loaded), with their bytes */
export function downloadFor(packages, have = new Set(), P = PYODIDE) {
  const files = [...P.core, ...packages.map((k) => P.packages[k].file)];
  const missing = files.filter((f) => !have.has(f));
  const bytes = missing.reduce((s, f) => s + P.files[f].size, 0);
  return { files, missing, bytes, coreMissing: P.core.some((f) => !have.has(f)) };
}

export const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;

/* why a failed MicroPython run should run again on the full runtime, or null: an import MicroPython
   lacks, a built-in it lacks (NameError on a CPython built-in), an attribute missing from one of
   its modules or built-in types, or the lite layer's own refusal (it names the full runtime) */
const CPY_BUILTINS = new Set(('abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod '
  + 'compile complex delattr dict dir divmod enumerate eval exec filter float format frozenset getattr globals hasattr '
  + 'hash help hex id input int isinstance issubclass iter len list locals map max memoryview min next object oct open '
  + 'ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum super tuple type '
  + 'vars zip __import__ exit quit copyright credits license NotImplemented Ellipsis BaseExceptionGroup ExceptionGroup '
  + 'ModuleNotFoundError RecursionError TimeoutError ConnectionError FileNotFoundError PermissionError UnicodeError '
  + 'UnicodeDecodeError UnicodeEncodeError ResourceWarning DeprecationWarning UserWarning Warning').split(' '));
const BUILTIN_TYPES = /^'?(module|str|list|dict|int|float|tuple|set|frozenset|bytes|bytearray|object|type|complex|range|function|generator|NoneType|bool)'? object has no attribute|^type object '(str|list|dict|int|float|tuple|set|bytes|object|type)' has no attribute/;
export function fallbackReason(result) {
  const e = result?.error;
  if (!e || result.ok) return null;
  if (e.type === 'ImportError' || e.type === 'ModuleNotFoundError')
    return { why: 'import', text: e.message };
  if (e.fullRuntime) return { why: 'lite', text: e.message };
  if (e.type === 'SyntaxError') return { why: 'syntax', text: e.message };
  if (e.type === 'NameError') {
    const m = /name '(\w+)' (?:is not defined|isn't defined)/.exec(e.message);
    if (m && CPY_BUILTINS.has(m[1])) return { why: 'builtin', text: e.message };
  }
  if (e.type === 'AttributeError' && BUILTIN_TYPES.test(e.message)) return { why: 'attribute', text: e.message };
  // a built-in that takes fewer keywords on MicroPython (json.dumps(indent=2), ...)
  if (e.type === 'TypeError' && /^(extra keyword arguments given|function doesn't take keyword arguments)/.test(e.message))
    return { why: 'builtin', text: e.message };
  if (e.type === 'NotImplementedError' && /full Python runtime|needs numpy/.test(e.message)) return { why: 'lite', text: e.message };
  return null;
}
