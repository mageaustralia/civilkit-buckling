/* The module builder: write a .ckext in the app. Three tabs (main.py, the manifest
   as a form, the worked examples as JSON), Run (the module's form in a preview pane, through the
   same sandbox worker installed modules run in), Test (the badge and each example's diffs, from
   js/ext/examples.js in that worker) and Export (a zipped bundle the CLI and the installer read).
   The same view, read-only, is an installed module's View code, with Fork into the builder.

   The draft is kept in localStorage (a per-viewer convenience): saved as it is typed, restored
   by New module…, and never replaced without an Undo. The pure helpers below run under Node too
   (tests/builder.test.mjs); createBuilder needs a DOM. */
import { zipSync } from '../../vendor/civilkit/fflate.js';
import { readBundle } from '../../vendor/civilkit/registry.js';
import { CAPABILITY_DOCS } from './capabilities.js';
import { highlight, tokenize, tracebackLine } from './pyhighlight.js';
import { fullView } from '../fullview.js';

export const POINT = 'buckling.tool';
export const TESTS_PATH = 'tests/worked-examples.json';
const DRAFT_KEY = 'civilkit-buckling.builder-draft';
const FULL_KEY = 'civilkit-buckling.builder-full';

/* Studio's builder template, adapted to Buckling: the numbers come from the engine through
   civilkit.firstYield and civilkit.sectionProps, and fy defaults to the app's own. */
export const STARTER_MAIN = `# A CivilKit Buckling module: build_ui draws the form,
# check computes. Every engineering number comes from a
# civilkit capability (the engine); this file orchestrates.
# Units: N, mm, MPa. Declare each capability you call
# in the manifest.
import json, civilkit


def call(name, arg=None):
    f = getattr(civilkit, name)
    return json.loads(f(json.dumps(arg)) if arg is not None else f())


def num(inputs, key, default):
    v = inputs.get(key)
    if v is None or v == "":
        return default
    return float(v)


def sig(v):
    # 5 significant figures, for display (finer than the
    # worked examples' 0.1 % tolerance)
    return float("%.5g" % v) if v else v


def build_ui(inputs, result, calcLines):
    kids = [
        {"type": "text", "value": "First yield of the section in the analysis, from the engine."},
        {"type": "field", "id": "fy", "label": "fy (MPa), blank: the analysis's",
         "inputType": "number", "default": inputs.get("fy", "")},
        {"type": "button", "id": "run", "label": "Run", "action": "run-check"},
    ]
    if result:
        kids.append({"type": "result", "items": result})
    if calcLines:
        kids.append({"type": "calc", "lines": calcLines})
    return {"type": "panel", "title": "My module", "children": kids}


def check(inputs):
    fy = num(inputs, "fy", call("getModel").get("fy"))
    if not fy or fy <= 0:
        raise ValueError("fy must be a positive stress (MPa)")
    props = call("sectionProps", {})
    y = call("firstYield", {"fy": fy})
    py = y["Py"] / 1000.0
    return {
        "result": [
            {"label": "fy", "value": fy, "unit": "MPa"},
            {"label": "A", "value": sig(props["A"]), "unit": "mm²"},
            {"label": "Py", "value": sig(py), "unit": "kN"},
            {"label": "My (x axis)", "value": sig(y["Mxx"] / 1e6), "unit": "kN·m"},
        ],
        "calcLines": [
            {"label": "Squash load",
             "eq": "Py = fy A = %g × %g / 1000 = %.4g kN" % (fy, props["A"], py)},
        ],
    }
`;

export function starterManifest() {
  return {
    id: 'my.module', name: 'My module', version: '0.1.0', civilkitApi: '^1.0',
    description: '', license: 'MIT',
    contributes: [{ point: POINT, id: 'main' }],
    capabilities: ['getModel', 'sectionProps', 'firstYield'],
  };
}
export const starterDraft = () => ({ main: STARTER_MAIN, manifest: starterManifest(), examples: '[]\n' });

/* JSON with short values kept on one line: a fixture model reads a node per line, not a number
   per line. */
export function pretty(v, ind = '') {
  const one = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || one.length <= 96) return one;
  const next = ind + '  ';
  if (Array.isArray(v)) return v.length ? `[\n${v.map((x) => next + pretty(x, next)).join(',\n')}\n${ind}]` : '[]';
  const ks = Object.entries(v).filter(([, x]) => x !== undefined);
  return `{\n${ks.map(([k, x]) => `${next}${JSON.stringify(k)}: ${pretty(x, next)}`).join(',\n')}\n${ind}}`;
}

export function parseExamples(text) {
  if (!String(text ?? '').trim()) return [];
  let list;
  try { list = JSON.parse(text); } catch (e) { throw new Error(`The worked examples are not valid JSON: ${e.message}`); }
  if (!Array.isArray(list)) throw new Error('The worked examples must be a JSON list, [ { id, input, model, expected, source }, … ]');
  return list;
}

/* Append an example whose fixture is `model` (getModel's shape) and whose inputs are the ones in
   the preview. Its expected rows are left empty for the author to fill with cited numbers: the
   builder never writes an engine result in as an expectation. */
export function addFixture(text, model, inputs = {}) {
  const list = parseExamples(text);
  const used = new Set(list.map((x) => x && x.id));
  let n = list.length + 1;
  while (used.has(`example-${n}`)) n++;
  list.push({ id: `example-${n}`, input: inputs, model, expected: { result: [] }, source: '' });
  return { text: pretty(list) + '\n', id: `example-${n}` };
}

/* manifest.json as exported: the form's fields over the draft's manifest, with the contract's
   fixed parts (civilkitApi, a buckling.tool contribution) filled in when missing. */
export function manifestOf(m) {
  const out = { ...m };
  out.civilkitApi = out.civilkitApi || '^1.0';
  if (!Array.isArray(out.contributes) || !out.contributes.length) out.contributes = [{ point: POINT, id: 'main' }];
  const known = CAPABILITY_DOCS.map(([k]) => k);
  const caps = Array.isArray(out.capabilities) ? out.capabilities : [];
  out.capabilities = [...known.filter((k) => caps.includes(k)), ...caps.filter((k) => !known.includes(k))];
  for (const k of ['description', 'license']) if (out[k] === '') delete out[k];
  return out;
}

const enc = (s) => new TextEncoder().encode(s);
export function draftFiles(d) {
  const manifest = manifestOf(d.manifest);
  return {
    'manifest.json': enc(JSON.stringify(manifest, null, 2) + '\n'),
    'main.py': enc(d.main),
    [manifest.tests || TESTS_PATH]: enc(d.examples && d.examples.trim() ? d.examples : '[]\n'),
  };
}

/* The bundle bytes, checked the way the installer and the CLI check them (readBundle with the
   Buckling point), with the worked examples parsed first so a JSON slip is named here. */
export function packDraft(d) {
  parseExamples(d.examples);
  if (!String(d.main || '').trim()) throw new Error('main.py is empty');
  const bytes = zipSync(draftFiles(d));
  readBundle(bytes, { points: [POINT] });
  return bytes;
}

export function fileName(manifest) {
  const base = String(manifest?.id || 'module').split('.').pop().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'module'}.ckext`;
}

/* An installed module (the registry's record: manifest + unzipped files) as a draft. A fork gets
   its own id and name, so installing it never replaces the module it came from. */
export function draftFromRecord(rec, { fork = false } = {}) {
  const dec = (b) => (b ? new TextDecoder().decode(b) : '');
  const m = structuredClone(rec.manifest);
  const examples = dec(rec.files[m.tests || TESTS_PATH]) || '[]\n';
  if (fork) {
    m.id = `${m.id}-fork`;
    m.name = `${m.name} (fork)`;
    delete m.tests;
  }
  return { main: dec(rec.files['main.py']), manifest: m, examples, from: rec.manifest.id };
}

export const sameDraft = (a, b) => !!a && !!b && a.main === b.main && a.examples === b.examples
  && JSON.stringify(manifestOf(a.manifest)) === JSON.stringify(manifestOf(b.manifest));

/* localStorage, guarded: a private window or blocked storage just means no draft. */
export function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    return d && typeof d.main === 'string' && d.manifest && typeof d.manifest === 'object' ? d : null;
  } catch { return null; }
}
export function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, savedAt: Date.now() })); return true; } catch { return false; }
}

/* Tab and Shift-Tab on a code textarea: four spaces in, or out of every selected line. Pure. */
export function indent(text, start, end, out = false) {
  if (!out && start === end) return { text: text.slice(0, start) + '    ' + text.slice(end), start: start + 4, end: start + 4, from: start, to: end, insert: '    ' };
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const to = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const block = text.slice(from, to);
  const lines = block.split('\n');
  const next = lines.map((l) => (out ? l.replace(/^ {1,4}/, '') : '    ' + l));
  const insert = next.join('\n');
  return { text: text.slice(0, from) + insert + text.slice(to), start: from, end: from + insert.length, from, to, insert };
}

/* ------------------------------------------------------------- the editor
   main.py is a textarea over a highlighted <pre>: the textarea keeps the caret, the selection,
   native undo and the keyboard, with its text transparent; the <pre> under it shows the same
   text in colour, moved with the textarea's scroll. Both share one font, size, line height and
   padding and never wrap, so every character sits on its twin. Colours come from the page's
   tokens, so the editor follows the light and dark themes. The page CSP allows inline styles,
   so the rules ship with the editor. */
const EDITOR_CSS = `
.ck-edwrap { min-width: 0; }
.ck-ed { --ck-fs: 12.5px; --ck-lh: 20px; --ck-pad: 10px; position: relative; display: flex; min-height: 300px; height: 52vh;
  resize: vertical; overflow: hidden; border: 1px solid var(--line2); border-radius: 8px; background: var(--panel); }
.ck-ed:focus-within { border-color: var(--accent); }
body[data-layout="compact"] .ck-ed { --ck-fs: 13px; min-height: 320px; height: 55vh; }
/* touch screens: 16 px, the size below which iOS Safari zooms the page when a field takes focus;
   the highlighted layer and the textarea share these variables, so they stay aligned */
@media (pointer: coarse) { .ck-ed { --ck-fs: 16px; --ck-lh: 24px; } }
.ck-ed .ck-gut, .ck-ed .ck-pre, :is(.ext-builder, .pycon) .ck-ed textarea.ext-codearea {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: var(--ck-fs); line-height: var(--ck-lh);
  font-variant-ligatures: none; letter-spacing: 0; tab-size: 4; font-weight: 400; }
.ck-gut { flex: none; overflow: hidden; background: var(--bg); border-right: 1px solid var(--line); color: var(--ink3);
  text-align: right; user-select: none; -webkit-user-select: none; }
.ck-gut-in { padding: var(--ck-pad) 8px var(--ck-pad) 10px; will-change: transform; }
.ck-gut-in > div { height: var(--ck-lh); min-width: 2ch; }
.ck-gut-in > div.ck-errline { color: color-mix(in srgb, var(--bad) 80%, var(--ink));
  box-shadow: inset 3px 0 var(--bad); background: color-mix(in srgb, var(--bad) 16%, transparent); }
.ck-main { position: relative; flex: 1; min-width: 0; overflow: hidden; }
.ck-layer { position: absolute; top: 0; left: 0; min-width: 100%; pointer-events: none; will-change: transform; }
.ck-pre { margin: 0; padding: var(--ck-pad) 12px; white-space: pre; color: var(--ink); background: none; border: 0;
  border-radius: 0; overflow: visible; position: relative; }
.ck-pre code { font: inherit; background: none; padding: 0; color: inherit; }
.ck-band { position: absolute; left: 0; right: 0; height: var(--ck-lh);
  top: calc(var(--ck-pad) + (var(--ck-line, 1) - 1) * var(--ck-lh)); background: color-mix(in srgb, var(--bad) 14%, transparent); }
.ck-band[hidden] { display: none; }
:is(.ext-builder, .pycon) .ck-ed textarea.ext-codearea { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; margin: 0;
  border: 0; border-radius: 0; padding: var(--ck-pad) 12px; background: transparent; color: transparent;
  -webkit-text-fill-color: transparent; caret-color: var(--ink); resize: none; white-space: pre; overflow: auto; opacity: 1; outline: none; }
.ck-ed textarea::selection { background: color-mix(in srgb, var(--accent) 30%, transparent); }
.ck-msg { margin: 6px 0 0; padding: 7px 10px; border-radius: 7px; font-size: 13px; white-space: pre-wrap; cursor: pointer;
  color: color-mix(in srgb, var(--bad) 80%, var(--ink)); border: 1px solid color-mix(in srgb, var(--bad) 40%, var(--panel));
  background: color-mix(in srgb, var(--bad) 8%, var(--panel)); }
.ck-msg[hidden] { display: none; }
.py-kw { color: var(--tens); }
.py-const, .py-num { color: color-mix(in srgb, var(--warn) 75%, var(--ink)); }
.py-str { color: var(--comp); }
.py-comment { color: color-mix(in srgb, var(--ink3) 75%, var(--ink2)); font-style: italic; }
.py-def, .py-deco { color: var(--accent); }
.py-call { color: color-mix(in srgb, var(--accent) 65%, var(--ink)); }
.py-builtin { color: color-mix(in srgb, var(--tens) 60%, var(--ink)); }
.py-op { color: var(--ink2); }
.ext-builder .ext-codearea.ext-examples { background: var(--panel); color: var(--ink); }
/* full view: the builder over the whole viewport, editor beside the preview */
.ext-builder.ck-full { position: fixed; inset: 0; z-index: 65; margin: 0; overflow: auto; background: var(--bg);
  padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  display: flex; flex-direction: column; }
.ext-builder.ck-full .ext-compact-note { display: none; }
.ext-builder.ck-full .ext-bgrid { flex: 1; min-height: 0; }
.ext-builder.ck-full .ck-ed { height: calc(100dvh - 220px); min-height: 320px; resize: none; }
.ext-builder.ck-full .ext-codearea.ext-examples { height: calc(100dvh - 290px); }
@media (min-width: 900px) {
  .ext-builder.ck-full .ext-bgrid { grid-template-columns: minmax(0, 1.35fr) minmax(320px, 1fr); align-items: start; }
  .ext-builder.ck-full.readonly .ext-bgrid { grid-template-columns: minmax(0, 1fr); }
  .ext-builder.ck-full .ext-bside { max-height: calc(100dvh - 140px); overflow: auto; }
}
@media (max-width: 899.98px) { .ext-builder.ck-full .ck-ed { height: 60dvh; } }
html.ck-lock, html.ck-lock body { overflow: hidden; }
.ck-expand { white-space: nowrap; }
.ext-builder .ext-manifest-json { background: var(--bg); color: var(--ink); border: 1px solid var(--line); }
`;
function injectEditorCss() {
  if (document.getElementById('ck-editor-css')) return;
  const st = document.createElement('style');
  st.id = 'ck-editor-css';
  st.textContent = EDITOR_CSS;
  document.head.appendChild(st);
}

/* Type text at the caret through the browser's own editing, so Undo still steps back over it;
   setRangeText (no undo entry) only where execCommand is gone. */
function insertText(ta, text, from = ta.selectionStart, to = ta.selectionEnd) {
  ta.setSelectionRange(from, to);
  if (!(document.execCommand && document.execCommand('insertText', false, text))) {
    ta.setRangeText(text, from, to, 'end');
    ta.dispatchEvent(new Event('input'));
  }
}

/* The indentation a new line after `line` gets: the line's own, one level more after a
   trailing ':' (a comment after it does not count). Pure. */
export function newlineIndent(line) {
  let ind = /^[ \t]*/.exec(line)[0];
  const toks = tokenize(line).filter((t) => t.type !== 'comment' && t.text.trim());
  const last = toks[toks.length - 1];
  if (last && last.type === 'op' && last.text === ':') ind += '    ';
  return ind;
}

/* A code textarea (the builder's, and the Python console's): no spellcheck or autocorrect, no
   wrapping, Tab and Shift-Tab indent, Escape then Tab leaves it. */
export function codeTextarea(cls, value, label, { readOnly = false } = {}) {
  const ta = document.createElement('textarea');
  ta.className = `ext-codearea ${cls}`;
  ta.value = value;
  ta.spellcheck = false;
  ta.autocapitalize = 'off';
  ta.setAttribute('autocorrect', 'off');
  ta.wrap = 'off';
  ta.readOnly = readOnly;
  ta.setAttribute('aria-label', label);
  let escaped = false;                // Escape, then Tab, leaves the editor (keyboard users)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { escaped = true; return; }
    if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || readOnly) { escaped = false; return; }
    if (escaped) { escaped = false; return; }
    e.preventDefault();
    const r = indent(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
    ta.setSelectionRange(r.from, r.to);
    // execCommand keeps the native undo stack; setRangeText is the fallback
    if (!(document.execCommand && document.execCommand('insertText', false, r.insert))) {
      ta.setRangeText(r.insert, r.from, r.to, 'end');
      ta.dispatchEvent(new Event('input'));
    }
    ta.setSelectionRange(r.start, r.end);
  });
  return ta;
}

/* ta: the textarea (made by codeArea, with Tab handling). Returns the wrapper to mount and
   mark(line, message) / clear() for errors, refresh() after setting ta.value in code. */
export function pyEditor(ta, { readOnly = false } = {}) {
  injectEditorCss();
  const h = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const wrap = h('div', 'ck-edwrap');
  const ed = h('div', 'ck-ed');
  const gut = h('div', 'ck-gut');
  gut.setAttribute('aria-hidden', 'true');
  const gutIn = h('div', 'ck-gut-in');
  gut.appendChild(gutIn);
  const main = h('div', 'ck-main');
  const layer = h('div', 'ck-layer');
  layer.setAttribute('aria-hidden', 'true');
  const band = h('div', 'ck-band');
  band.hidden = true;
  const pre = h('pre', 'ck-pre');
  const code = h('code');
  pre.appendChild(code);
  layer.append(band, pre);
  main.append(layer, ta);
  ed.append(gut, main);
  const msg = h('div', 'ck-msg');
  msg.setAttribute('role', 'alert');
  msg.hidden = true;
  wrap.append(ed, msg);

  let raf = 0, lines = 0, errLine = null;
  const render = () => {
    raf = 0;
    code.innerHTML = highlight(ta.value);            // highlight() escapes every character
    const n = ta.value.split('\n').length;
    if (n !== lines) {
      lines = n;
      const frag = document.createDocumentFragment();
      for (let k = 1; k <= n; k++) { const d = document.createElement('div'); d.textContent = k; frag.appendChild(d); }
      gutIn.replaceChildren(frag);
      if (errLine) paintErr();
    }
    sync();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };
  const sync = () => {
    layer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    gutIn.style.transform = `translateY(${-ta.scrollTop}px)`;
  };
  const paintErr = () => {
    for (const d of gutIn.querySelectorAll('.ck-errline')) d.classList.remove('ck-errline');
    if (!errLine) { band.hidden = true; return; }
    band.style.setProperty('--ck-line', errLine);
    band.hidden = false;
    gutIn.children[errLine - 1]?.classList.add('ck-errline');
  };
  function mark(line, message) {
    const n = ta.value.split('\n').length;
    errLine = line ? Math.min(Math.max(1, line), n) : null;
    paintErr();
    msg.textContent = errLine ? `Line ${errLine}: ${message}` : message;
    msg.title = errLine ? 'Go to the line' : '';
    msg.hidden = !message;
    if (errLine) {                                      // bring the line into view
      const lh = parseFloat(getComputedStyle(ed).getPropertyValue('--ck-lh')) || 20;
      const y = (errLine - 1) * lh;
      if (y < ta.scrollTop || y + 2 * lh > ta.scrollTop + ta.clientHeight) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
      sync();
    }
  }
  function clear() { if (errLine === null && msg.hidden) return; errLine = null; paintErr(); msg.hidden = true; msg.textContent = ''; }
  msg.addEventListener('click', () => {
    if (!errLine) return;
    const v = ta.value;
    let at = 0;
    for (let k = 1; k < errLine; k++) at = v.indexOf('\n', at) + 1;
    ta.focus();
    ta.setSelectionRange(at, at);
  });

  ta.addEventListener('input', () => { schedule(); clear(); });
  ta.addEventListener('scroll', sync, { passive: true });
  if (!readOnly) ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    const v = ta.value, s = ta.selectionStart;
    insertText(ta, '\n' + newlineIndent(v.slice(v.lastIndexOf('\n', s - 1) + 1, s)));
  });
  render();
  return { el: wrap, mark, clear, refresh: render };
}

/* A "?" link into the extensions guide (guide/*.html), opened in a new tab: the analysis on screen
   is not saved anywhere, so leaving the page for the docs would lose it. The visible circle is
   small; on touch screens its hit area is 48 px. */
const HELP_CSS = `
.ext-help { position: relative; display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--line2); background: var(--panel);
  color: var(--ink2); font: 600 13px/1 ui-sans-serif, system-ui, sans-serif; text-decoration: none; }
.ext-help:hover { color: var(--ink); border-color: var(--ink3); }
.ext-help:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (pointer: coarse) { .ext-help { width: 32px; height: 32px; } .ext-help::before { content: ""; position: absolute; inset: -8px; } }
.ext-headrow { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; }
.ext-headrow h3 { margin: 0; }
`;
export function helpLink(href, label) {
  if (!document.getElementById('ck-help-css')) {
    const st = document.createElement('style');
    st.id = 'ck-help-css';
    st.textContent = HELP_CSS;
    document.head.appendChild(st);
  }
  const a = document.createElement('a');
  a.className = 'ext-help';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = '?';
  a.setAttribute('aria-label', `Help: ${label} (opens the guide in a new tab)`);
  a.title = `${label} (opens in a new tab)`;
  return a;
}

/* Edit & run on an installed module's code: the builder the fork opens runs it straight away. */
let runOnOpen = false;

/* ---------------------------------------------------------------- the view
   ui = { h, button, badgeEl, toast,
          mountRunner(el, bundle, name) -> { destroy(), getInputs() }   the module view's runner
          runExamples(bundle) -> Promise<report>                        in the sandbox worker
          snapshot() -> { model, results }                              what getModel would see
          back(), fork() }                                               navigation, from ui.js */
export function createBuilder({ draft, readOnly = false, status = '', onRestart = null, ui }) {
  const { h, button } = ui;
  let state = { main: draft.main, manifest: structuredClone(draft.manifest), examples: draft.examples ?? '[]\n', from: draft.from };
  let runner = null, saveTimer = null, warned = false, alive = true;

  const el = h('div', `ext-module ext-view ext-builder${readOnly ? ' readonly' : ''}`);
  const bar = h('div', 'ext-bar');
  const title = h('b', 'ext-name', readOnly ? `Code: ${state.manifest.name}` : 'Module builder');
  bar.append(button('‹ Extensions', 'btn ext-back', ui.back), title,
    readOnly ? helpLink('guide/capabilities.html', 'what each capability call does')
             : helpLink('guide/tutorial.html', 'writing a module, step by step'));
  const compactNote = h('div', 'note ext-compact-note', 'Best on a tablet or desktop: the builder works here, but code is easier to write on a larger screen.');
  const statusEl = h('div', 'ext-bstatus');
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');
  const say = (msg, kind = '', action = null) => {
    statusEl.className = `ext-bstatus ${kind}`;
    statusEl.replaceChildren(h('span', null, msg));
    if (action) statusEl.append(' ', button(action[0], 'btn', action[1]));
  };

  /* tools */
  const tools = h('div', 'ext-btools');
  const runBtn = button('Run', 'btn primary', () => run());
  runBtn.title = 'Run the module in the preview (Ctrl or ⌘ + Enter)';
  const testBtn = button('Test', 'btn', () => test());
  testBtn.title = 'Run the worked examples: they decide the Verified badge';
  const exportBtn = button('Export .ckext', 'btn', () => exportIt());
  const expandBtn = button('⤢ Full view', 'btn', () => {});   // fullView() wires it
  if (readOnly) {
    const edit = button('Edit & run as a fork', 'btn primary ext-editrun', () => { runOnOpen = true; ui.fork(); runOnOpen = false; });
    edit.title = 'Open a copy of this module in the builder and run it';
    tools.append(edit, h('span', 'note', 'A fork is a copy with its own id: installing it keeps the original.'));
  }
  else tools.append(runBtn, testBtn, exportBtn);
  tools.append(expandBtn);

  /* tabs */
  const tabs = h('nav', 'ext-btabs');
  tabs.setAttribute('role', 'tablist');
  const panels = {};
  const tabBtns = {};
  for (const [k, label] of [['main', 'main.py'], ['manifest', 'manifest'], ['examples', 'worked examples']]) {
    const b = button(label, 'btn ext-btab', () => select(k));
    b.dataset.btab = k;
    b.setAttribute('role', 'tab');
    tabBtns[k] = b;
    tabs.appendChild(b);
    panels[k] = h('div', 'ext-bpanel');
    panels[k].setAttribute('role', 'tabpanel');
  }
  function select(k) {
    for (const [n, b] of Object.entries(tabBtns)) {
      b.setAttribute('aria-selected', String(n === k));
      b.classList.toggle('on', n === k);
      panels[n].hidden = n !== k;
    }
  }

  /* main.py */
  const code = codeArea('ext-code', state.main, 'main.py');
  code.oninput = () => { state.main = code.value; changed(); };
  const pyed = pyEditor(code, { readOnly });
  panels.main.appendChild(pyed.el);
  /* A Python error names a line of main.py: mark it in the editor (cleared by the next edit). */
  const markError = (text, prefix = '') => {
    const { line, message } = tracebackLine(text);
    if (!line) return false;
    select('main');
    pyed.mark(line, prefix + message);
    return true;
  };

  /* manifest */
  const form = h('div', 'ext-mform');
  const mjson = h('pre', 'ext-manifest-json');
  const field = (name, label, { area = false, hint = '' } = {}) => {
    const wrap = h('label', 'ext-mfield');
    wrap.appendChild(h('span', null, label));
    const inp = h(area ? 'textarea' : 'input');
    inp.name = name;
    if (!area) { inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false; }
    inp.value = state.manifest[name] ?? '';
    inp.disabled = readOnly;
    inp.oninput = () => { state.manifest[name] = inp.value; changed(); };
    wrap.appendChild(inp);
    if (hint) wrap.appendChild(h('small', 'note', hint));
    return wrap;
  };
  const fields = {
    id: field('id', 'id', { hint: 'Reverse-domain and unique, for example yourname.dsm-beams. A new id installs as a new module.' }),
    name: field('name', 'Name'),
    version: field('version', 'Version', { hint: 'Semantic: 1.0.0' }),
    description: field('description', 'Description', { area: true }),
    license: field('license', 'Licence'),
  };
  form.append(...Object.values(fields));
  const caps = h('fieldset', 'ext-caps');
  caps.appendChild(h('legend', null, 'Capabilities: what the module may call (anything else throws)'));
  for (const [k, doc] of CAPABILITY_DOCS) {
    const lab = h('label', 'ext-cap');
    const cb = h('input');
    cb.type = 'checkbox';
    cb.dataset.cap = k;
    cb.disabled = readOnly;
    cb.checked = (state.manifest.capabilities ?? []).includes(k);
    cb.onchange = () => {
      const set = new Set(state.manifest.capabilities ?? []);
      if (cb.checked) set.add(k); else set.delete(k);
      state.manifest.capabilities = [...set];
      changed();
    };
    const txt = h('span');
    txt.append(h('code', null, k), ' ', h('span', 'note', doc));
    lab.append(cb, txt);
    caps.appendChild(lab);
  }
  form.appendChild(caps);
  panels.manifest.append(form, h('div', 'ext-mlabel', 'manifest.json'), mjson);

  /* worked examples */
  const exArea = codeArea('ext-examples', state.examples, 'tests/worked-examples.json');
  exArea.oninput = () => { state.examples = exArea.value; changed(); };
  const exHint = h('p', 'note', 'A JSON list. Each example is { id, input, model, expected: { result: [{ label, value, unit }] }, source }: '
    + 'the module runs on its fixture model and must reproduce every expected row to 0.1 %. Cite where the numbers come from in source.');
  panels.examples.append(exHint);
  if (!readOnly) {
    const fix = button('Use the current model as a fixture', 'btn', () => {
      try {
        const inputs = runner ? runner.getInputs() : {};
        const { text, id } = addFixture(exArea.value, ui.snapshot().model, inputs);
        exArea.value = text;
        state.examples = text;
        changed();
        exArea.scrollTop = exArea.scrollHeight;
        say(`Added ${id} with the section on screen as its model. Fill in its expected numbers and their source.`);
      } catch (e) { say(e.message, 'error'); }
    });
    panels.examples.append(fix);
  }
  panels.examples.append(exArea);

  /* the side: test report and preview */
  const side = h('div', 'ext-bside');
  const report = h('div', 'ext-test');
  report.hidden = true;
  const preview = h('div', 'ext-preview');
  const previewBody = h('div', 'ext-pbody');
  previewBody.appendChild(h('div', 'ext-empty', 'Run (Ctrl or ⌘ + Enter) to see the module here, running in the sandbox on the section in the analysis.'));
  preview.append(h('h3', null, 'Preview'), previewBody);
  side.append(report, preview);

  const editor = h('div', 'ext-bedit');
  editor.append(tabs, ...Object.values(panels));
  const grid = h('div', 'ext-bgrid');
  grid.append(editor);
  if (!readOnly) grid.append(side);
  el.append(bar, ...(readOnly ? [] : [compactNote]), statusEl, tools, grid);
  select('main');
  refreshManifest();
  if (status) say(status, '', onRestart ? ['Start a new module', onRestart] : null);

  if (!readOnly && runOnOpen) setTimeout(() => run(), 0);

  /* Full view (js/fullview.js): the builder as a modal over the whole screen, remembered */
  const fv = fullView({
    el, button: expandBtn, storageKey: FULL_KEY, openTitle: 'Open the builder over the whole screen',
    label: () => (readOnly ? `Code: ${state.manifest.name}` : 'Module builder, full view'),
    focusTarget: () => (panels.main.hidden ? expandBtn : code),
    onChange: () => pyed.refresh(),
  });
  fv.restore(() => alive);

  /* Ctrl/⌘-Enter runs from anywhere in the builder */
  el.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !readOnly) { e.preventDefault(); run(); }
  });

  function codeArea(cls, value, label) { return codeTextarea(cls, value, label, { readOnly }); }

  function refreshManifest() { mjson.textContent = JSON.stringify(manifestOf(state.manifest), null, 2); }
  function changed() {
    refreshManifest();
    if (readOnly) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }
  function save() {
    clearTimeout(saveTimer);
    if (readOnly) return;
    if (!saveDraft(state) && !warned) {
      warned = true;
      say('This browser is not keeping drafts (storage is blocked): export the module to keep your work.', 'error');
    }
  }

  function bundle() { return { manifest: manifestOf(state.manifest), main: state.main }; }

  function run() {
    if (readOnly || !alive) return;
    save();
    runner?.destroy();
    previewBody.replaceChildren();
    const b = bundle();
    runner = ui.mountRunner(previewBody, b, b.manifest.name || 'The draft module');
    watchErrors();
    preview.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* The runner's error box (ui.js mountRunner) holds the whole traceback: watch it. */
  let errWatch = null, runMarked = false;
  function watchErrors() {
    errWatch?.disconnect();
    const look = () => {
      const box = previewBody.querySelector(':scope > .ext-error');
      const text = box && !box.hidden ? box.textContent : '';
      if (text) runMarked = markError(text) || runMarked;
      else if (runMarked) { runMarked = false; pyed.clear(); }
    };
    errWatch = new MutationObserver(look);
    errWatch.observe(previewBody, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  }

  async function test() {
    let examples;
    try { examples = parseExamples(state.examples); } catch (e) { showReport(null, e.message); return; }
    save();
    testBtn.disabled = true;
    report.hidden = false;
    report.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    report.replaceChildren(h('div', 'ext-running', examples.length ? `Running ${examples.length} worked example${examples.length === 1 ? '' : 's'}…` : 'Checking…'));
    try {
      const r = await ui.runExamples({ ...bundle(), examples });
      if (alive) showReport(r, null, examples);
    } catch (e) {
      if (alive) showReport(null, String((e && e.message) || e));
    } finally { testBtn.disabled = false; }
  }
  function showReport(r, err, examples = []) {
    report.hidden = false;
    report.replaceChildren();
    const head = h('div', 'ext-thead');
    head.appendChild(h('h3', null, 'Worked examples'));
    report.appendChild(head);
    if (err) { report.appendChild(h('div', 'ext-error', err)); markError(err); return; }
    const bad = r.examples.find((x) => x.diffs.some((d) => tracebackLine(d).line));
    if (bad) markError(bad.diffs.find((d) => tracebackLine(d).line), `worked example ${bad.id}: `);
    const pass = r.examples.filter((x) => x.pass).length;
    head.append(ui.badgeEl(r.badge), h('span', 'note', r.examples.length
      ? `${pass} of ${r.examples.length} reproduce their numbers.`
      : 'No worked examples yet: a module without one stays Community. Add one on the worked examples tab.'));
    r.examples.forEach((x, k) => {
      const row = h('div', `ext-ex ${x.pass ? 'pass' : 'fail'}`);
      row.appendChild(h('div', 'ext-exid', `${x.pass ? '✓' : '✗'} ${x.id}`));
      if (x.diffs.length) {
        const ul = h('ul', 'ext-diffs');
        for (const d of x.diffs) ul.appendChild(h('li', null, d));
        row.appendChild(ul);
      }
      const rows = examples[k]?.expected?.result;
      if (!Array.isArray(rows) || !rows.length) row.appendChild(h('div', 'ext-warn', 'This example states no expected numbers, so it checks nothing yet.'));
      if (x.source) row.appendChild(h('div', 'ext-src', x.source));
      report.appendChild(row);
    });
  }

  function exportIt() {
    let bytes;
    try { bytes = packDraft(state); } catch (e) { say(`Not exported: ${e.message}`, 'error'); return; }
    save();
    const name = fileName(state.manifest);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = h('a');
    a.href = url; a.download = name; a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    say(`Exported ${name} (${bytes.length} bytes). Install it from the Extensions list, or check it with: node tools/ckext.mjs test ${name}`, 'ok');
  }

  /* Replace the whole draft (Start a new module, an Undo): the fields follow, and it is saved. */
  function replace(d) {
    const prev = { ...state, manifest: structuredClone(state.manifest) };
    state = { main: d.main, manifest: structuredClone(d.manifest), examples: d.examples ?? '[]\n', from: d.from };
    code.value = state.main;
    pyed.refresh();
    pyed.clear();
    exArea.value = state.examples;
    for (const [k, w] of Object.entries(fields)) w.querySelector('input, textarea').value = state.manifest[k] ?? '';
    for (const cb of caps.querySelectorAll('input[data-cap]')) cb.checked = (state.manifest.capabilities ?? []).includes(cb.dataset.cap);
    refreshManifest();
    save();
    report.hidden = true;
    return prev;
  }

  return {
    el,
    replace,
    say,
    get draft() { return state; },
    destroy() {
      alive = false;
      errWatch?.disconnect();
      fv.destroy();
      if (saveTimer) save();
      runner?.destroy();
      runner = null;
    },
  };
}
