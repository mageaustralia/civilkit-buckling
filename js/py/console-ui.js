/* The Python console view (More > Python): a cufsm-rs-py script, run in the page.

   An editor (the module builder's: js/ext/builder.js pyEditor, highlighted by js/ext/pyhighlight.js),
   Run (also Ctrl/⌘-Enter), Stop for a runaway script (the worker is terminated and a fresh one
   started), and "Use the model on screen", which puts the report's script for the analysis on
   screen (js/python.js pythonScript) in the editor. Examples loads one of the example scripts
   (py/examples/, listed in EXAMPLES); Open loads a .py or .txt file (or one dropped on the
   editor); Download saves the editor's text as a .py file, and Save output the last run's output
   as a .txt. Every load goes through the browser's editing, so Undo brings back the old text. The output appears when a run finishes, never
   partway (the plan's buffered output), with the runtime that ran it; an error is shown as its
   Python traceback and its line is marked in the editor. A script that needs more than MicroPython
   (numpy, scipy, matplotlib, syntax or built-ins MicroPython lacks: js/py/dispatch.js) runs on the
   full runtime, Pyodide, after the user agrees to its download in a prompt that says what it needs
   and its size ("always for this device" is remembered); Not now shows the MicroPython run, with
   the notice that names what it needs. matplotlib's figures appear in the output as images, each
   with a Download SVG button; "Remove full Python from this device" deletes its copy.
   cufsm_rs.plot's figures (js/py/figures.js) appear in the output where the script drew them,
   each an inline SVG with a Download SVG button; Save output stays text, with a placeholder line
   ("[figure: signature curve]") for each figure.

   app = {
     client: createConsoleClient()              js/py/console-client.js; started on the first show()
     modelScript() -> string                    the script for the model on screen
     modelLabel() -> string                     a few words on what that script runs, for the status line
   }
   The view is one persistent element: re-rendering the pane after a solve keeps the script, the
   output and a run in progress. */
import { codeTextarea, pyEditor } from '../ext/builder.js';
import { RUNTIMES } from './runner.js';
import { runScript } from './dispatch.js';
import { mb } from './detect.js';
import { cachedFiles, forgetPyodide } from './pyodide-cache.js';
import { PYODIDE } from './pyodide-files.js';
import { EXAMPLES, FULL_EXAMPLES, exampleUrl, readScriptFile, scriptName, DEFAULT_NAME } from './examples.js';
import { drawFigure, figureName, placeholder, svgFile } from './figures.js';
import { fullView } from '../fullview.js';

const DRAFT_KEY = 'civilkit-buckling.console-draft';
const NAME_KEY = 'civilkit-buckling.console-name';
const ALWAYS_KEY = 'civilkit-buckling.full-python-always';
/* the badge's words for a runtime */
const ranOn = (rt) => (rt === 'pyodide' ? `${RUNTIMES.pyodide} (Pyodide)` : RUNTIMES[rt] ?? rt);
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* the draft lives in the editor only */ } };

/* the editor's text as a download (a Blob and an <a download>, which iOS Safari honours too) */
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);    // Safari reads the Blob after click() returns
}

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (label, cls, onclick) => {
  const b = h('button', cls, label);
  b.type = 'button';
  b.onclick = onclick;
  return b;
};
const secs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);

export function createConsoleUI(app) {
  const root = h('div', 'pycon');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-labelledby', 'pyconTitle');

  const head = h('div', 'pycon-head');
  const title = h('h3', null, 'Python console');
  title.id = 'pyconTitle';
  const intro = h('p', 'note');
  intro.innerHTML = 'Runs <b>cufsm-rs-py</b> '
    + 'scripts in the page, on the same engine as the analysis: <code>import cufsm_rs</code>, with <code>math</code> and '
    + '<code>json</code>, and <code>cufsm_rs.plot</code> draws its figures here. A script that uses numpy, scipy or '
    + 'matplotlib runs on full Python (Pyodide), the same scripts as <code>pip install cufsm-rs-py</code>: it is '
    + 'downloaded the first time a script needs it, once you agree.';
  /* the guide's page on the console, beside the title (a new tab, as the app's own Docs) */
  const docs = h('a', 'btn pycon-docs', 'Docs');
  docs.href = new URL('../../guide/console.html', import.meta.url).href;
  docs.target = '_blank';
  docs.rel = 'noopener';
  docs.title = 'The guide to the Python console and the cufsm_rs API (opens in a new tab)';
  const titleRow = h('div', 'pycon-titlerow');
  titleRow.append(title, docs);
  head.append(titleRow, intro);

  const bar = h('div', 'pycon-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Console');
  const runBtn = button('Run', 'btn primary pycon-run', () => run());
  runBtn.title = 'Run the script (Ctrl+Enter or ⌘+Enter)';
  runBtn.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  const stopBtn = button('Stop', 'btn pycon-stop', () => stop());
  stopBtn.title = 'Stop a script that is still running';
  stopBtn.disabled = true;
  const modelBtn = button('Use the model on screen', 'btn pycon-model', () => useModel());
  modelBtn.title = 'Put the analysis on screen in the editor, as a cufsm-rs-py script (Undo brings back what was there)';
  const examples = h('select', 'pycon-examples');
  examples.setAttribute('aria-label', 'Load an example script');
  examples.title = 'Load an example script into the editor (Undo brings back what was there)';
  const fullGroup = document.createElement('optgroup');
  fullGroup.label = 'Full Python (downloads Pyodide when you agree)';
  fullGroup.append(...FULL_EXAMPLES.map((x) => new Option(x.label, x.file)));
  examples.append(new Option('Examples…', ''), ...EXAMPLES.map((x) => new Option(x.label, x.file)), fullGroup);
  examples.onchange = () => { const f = examples.value; examples.value = ''; if (f) useExample(f); };
  const fileIn = h('input', 'pycon-file');
  fileIn.type = 'file';
  fileIn.accept = '.py,.txt,text/x-python,text/plain';
  fileIn.hidden = true;
  fileIn.tabIndex = -1;
  fileIn.setAttribute('aria-hidden', 'true');
  fileIn.onchange = () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (f) openFile(f); };
  const openBtn = button('Open…', 'btn pycon-open', () => fileIn.click());
  openBtn.title = 'Open a .py or .txt file in the editor (or drop one on it)';
  const saveBtn = button('Download', 'btn pycon-download', () => download(ta.value, fileName, 'text/x-python'));
  saveBtn.title = 'Save the script as a .py file';
  const fullBtn = button('⤢ Full view', 'btn pycon-full', () => {});   // fullView() wires it
  bar.append(runBtn, stopBtn, examples, modelBtn, openBtn, saveBtn, fullBtn, fileIn);

  const ta = codeTextarea('pycon-code', '', 'Python script');
  const ed = pyEditor(ta);
  let fileName = DEFAULT_NAME;
  const setName = (n) => { fileName = n; save(NAME_KEY, n); };
  ta.addEventListener('input', () => save(DRAFT_KEY, ta.value));
  /* a file dropped on the editor opens like Open */
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  ed.el.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); ed.el.classList.add('pycon-drop'); } });
  ed.el.addEventListener('dragleave', () => ed.el.classList.remove('pycon-drop'));
  ed.el.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    ed.el.classList.remove('pycon-drop');
    const f = e.dataTransfer.files?.[0];
    if (f) openFile(f);
  });

  const out = h('section', 'pycon-out');
  out.setAttribute('aria-label', 'Output');
  const status = h('div', 'pycon-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const badge = h('span', 'pycon-badge');
  badge.hidden = true;
  const statusText = h('span', 'pycon-statustext', 'Press Run: the output appears here when the script finishes.');
  status.append(badge, statusText);
  const notice = h('div', 'pycon-notice');
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  /* what the script printed, and the figures it drew where it drew them */
  const stream = h('div', 'pycon-stream');
  stream.setAttribute('role', 'group');
  stream.setAttribute('aria-label', 'Printed output and figures');
  stream.hidden = true;
  const tb = h('pre', 'pycon-traceback');
  tb.tabIndex = 0;
  tb.setAttribute('aria-label', 'Traceback');
  tb.hidden = true;
  let lastOut = '';
  const saveOut = button('Save output', 'btn pycon-saveout',
    () => download(lastOut, fileName.replace(/\.py$/i, '') + '-output.txt', 'text/plain'));
  saveOut.title = 'Save the last run\'s output (and its traceback) as a .txt file';
  saveOut.hidden = true;
  /* why a run went to the full runtime, or why it did not */
  const why = h('p', 'pycon-why');
  why.hidden = true;
  /* the full runtime's download prompt: what this script needs, its size, Load / Not now, and "always" */
  const consentBox = h('div', 'pycon-consent');
  consentBox.setAttribute('role', 'group');
  consentBox.setAttribute('aria-labelledby', 'pyconConsentTitle');
  consentBox.hidden = true;
  const forget = button('Remove full Python from this device', 'btn pycon-forget', async () => {
    if (running) return;
    app.client.dropFull?.();
    await forgetPyodide();
    save(ALWAYS_KEY, '');
    forget.hidden = true;
    statusText.textContent = 'Full Python was removed from this device; a script that needs it asks again.';
  });
  forget.title = 'Delete this device\'s copy of the full Python runtime (Pyodide) and ask before the next download';
  forget.hidden = true;
  out.append(status, consentBox, why, notice, stream, tb, saveOut, forget);
  const showForget = () => cachedFiles().then((have) => { forget.hidden = !have.size; }, () => {});

  root.append(head, bar, ed.el, out);
  /* Full view (js/fullview.js): the console over the whole screen, the editor beside its output */
  fullView({
    el: root, button: fullBtn, label: 'Python console, full view',
    openTitle: 'Open the console over the whole screen', focusTarget: () => ta, onChange: () => ed.refresh(),
  });
  root.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  let running = false, started = false, ticker = 0, runId = 0, t0 = 0, statusLine = 'Running';
  const setRunning = (on) => {
    running = on;
    runBtn.disabled = on;
    stopBtn.disabled = !on;
    root.classList.toggle('running', on);
    clearInterval(ticker);
    if (on) {
      t0 = Date.now();
      statusLine = 'Running';
      const say = () => {
        if (!consentBox.hidden) return;                 // the prompt says what is happening
        statusText.textContent = `${statusLine}… ${Math.floor((Date.now() - t0) / 1000)} s`;
      };
      say();
      ticker = setInterval(say, 1000);
    }
  };
  const clearOut = () => {
    notice.hidden = stream.hidden = tb.hidden = saveOut.hidden = why.hidden = true;
    why.textContent = '';
    notice.textContent = tb.textContent = '';
    stream.replaceChildren();
    blobs.forEach((u) => URL.revokeObjectURL(u));
    blobs = [];
    lastOut = '';
  };

  async function run() {
    if (running) return;
    const mine = ++runId;
    ed.clear();
    setRunning(true);
    badge.hidden = true;
    clearOut();
    let r;
    const source = ta.value;
    const client = app.client;
    client.onProgress = (t) => {
      if (mine !== runId) return;
      statusLine = String(t).replace(/…$/, '');
      statusText.textContent = `${statusLine}… ${Math.floor((Date.now() - t0) / 1000)} s`;
    };
    try {
      r = await runScript(source, {
        mp: { run: (s) => client.run(s), compile: (s) => client.compile(s) },
        full: { plan: (s) => client.plan(s), run: (s) => client.runFull(s) },
        consent: (need) => (mine === runId ? askConsent(need) : Promise.resolve(false)),
        onStage: (stage) => {
          if (mine !== runId) return;
          if (stage === 'full') { t0 = Date.now(); statusLine = 'Running on full Python'; }
        },
      });
    } catch (e) {
      if (mine !== runId) return;                       // stopped: stop() has said so
      setRunning(false);
      statusText.textContent = `The console could not run the script: ${String(e?.message ?? e)}`;
      return;
    }
    if (mine !== runId) return;
    setRunning(false);
    show(r);
    if (r.runtime === 'pyodide') showForget();
  }

  /* the download prompt; resolves true to load, false for Not now (or Stop) */
  let answer = null;
  function askConsent(need) {
    let always = false;
    try { always = localStorage.getItem(ALWAYS_KEY) === '1'; } catch { /* asked every time */ }
    if (always) return Promise.resolve(true);
    consentBox.replaceChildren();
    const head = h('h4', null, 'This script needs full Python');
    head.id = 'pyconConsentTitle';
    const pkgs = ['numpy', 'matplotlib', 'scipy'].filter((k) => need.packages.includes(k));
    const reason = h('p', null, `${need.reason.text[0].toUpperCase()}${need.reason.text.slice(1)}, which the console's `
      + 'MicroPython does not run. Full Python (Pyodide) runs it, the same as pip install cufsm-rs-py on your own machine.');
    const sizeP = h('p');
    sizeP.innerHTML = `Download now: <b>${mb(need.bytes)}</b>, this once. It is kept on this device, so it also works offline.`;
    const list = h('ul');
    const part = (label, files) => {
      const bytes = files.filter((f) => need.missing.includes(f)).reduce((a, f) => a + PYODIDE.files[f].size, 0);
      if (bytes) list.appendChild(h('li', null, `${label}: ${mb(bytes)}`));
    };
    part(`Python ${need.python} (Pyodide ${need.version})`, PYODIDE.core);
    const shown = new Set();
    for (const k of pkgs) {
      const close = new Set();
      const add = (x) => { if (close.has(x) || shown.has(x)) return; close.add(x); PYODIDE.packages[x].depends.forEach(add); };
      add(k);
      close.forEach((x) => shown.add(x));
      part(k === 'matplotlib' ? `matplotlib, with ${close.size - 1} packages it uses` : k,
        [...close].map((x) => PYODIDE.packages[x].file));
    }
    const rest = need.packages.filter((k) => !shown.has(k));
    if (rest.length) part(rest.join(', '), rest.map((x) => PYODIDE.packages[x].file));
    const acts = h('div', 'pycon-consent-acts');
    const load = button('Load full Python and run', 'btn primary pycon-consent-load', () => done(true));
    const later = button('Not now', 'btn pycon-consent-later', () => done(false));
    later.title = 'Run on MicroPython instead: it stops where the script needs full Python';
    const lab = h('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'pycon-consent-always';
    lab.append(box, document.createTextNode('Always load it on this device without asking'));
    acts.append(load, later, lab);
    consentBox.append(head, reason, sizeP, list, acts);
    if (need.notHosted.length) consentBox.appendChild(h('p', 'pycon-why', `Not hosted here: ${need.notHosted.map((x) => x.module).join(', ')}; `
      + 'that import will fail on full Python too.'));
    consentBox.hidden = false;
    statusText.textContent = 'Waiting for your answer: nothing is downloaded until you choose Load.';
    load.focus({ preventScroll: true });
    consentBox.scrollIntoView?.({ block: 'nearest' });
    function done(yes) {
      if (yes && box.checked) save(ALWAYS_KEY, '1');
      consentBox.hidden = true;
      consentBox.replaceChildren();
      const a = answer;
      answer = null;
      if (yes) { t0 = Date.now(); statusLine = 'Loading full Python'; }
      a?.res(yes);
    }
    return new Promise((res, rej) => { answer = { res, rej }; });
  }

  /* one finished run, all at once */
  function show(r) {
    badge.hidden = false;
    badge.dataset.runtime = r.runtime;
    badge.textContent = `Ran on: ${ranOn(r.runtime)}`;
    if (r.fallback) {
      why.textContent = `Full Python ran this script: ${r.fallback.text}.`;
      why.hidden = false;
    } else if (r.declined) {
      why.textContent = `Not run on full Python (you chose Not now): ${r.declined.text}. This is MicroPython's run.`;
      why.hidden = false;
    }
    root.dataset.runtime = r.runtime;
    const what = r.ok ? 'Finished' : 'Ended with an error';
    const nfig = (r.output ?? []).filter((o) => o.figure || o.image).length;
    statusText.textContent = `${what} in ${secs(r.ms)}`
      + (nfig ? `, with ${nfig} figure${nfig > 1 ? 's' : ''}` : r.ok && !r.stdout ? ', printing nothing' : '');
    const parts = (r.output ?? [{ text: r.stdout }]).filter((o) => o.figure || o.image || o.text);
    if (r.truncated) parts.push({ text: '\n… the output was cut off here (1 MB)' });
    let saved = '';
    if (parts.length) {
      stream.hidden = false;                            // before drawing: a chart measures its labels
      let n = 0;
      for (const o of parts) {
        if (o.figure) {
          stream.appendChild(figureEl(o.figure, ++n));
          saved += (saved && !saved.endsWith('\n') ? '\n' : '') + placeholder(o.figure) + '\n';
        } else if (o.image) {
          stream.appendChild(imageEl(o.image, ++n));
          saved += (saved && !saved.endsWith('\n') ? '\n' : '') + '[figure: matplotlib figure]\n';
        } else {
          const pre = h('pre', 'pycon-stdout', o.text);
          pre.tabIndex = 0;                             // scrollable: keyboard users can reach it
          pre.setAttribute('aria-label', 'Printed output');
          stream.appendChild(pre);
          saved += o.text;
        }
      }
    }
    if (r.error) {
      const full = r.error.fullRuntime;
      if (full) { notice.textContent = full.text; notice.hidden = false; }
      /* a missing module: the notice and the marked line say it all; any other error is its traceback */
      if (!full?.module) { tb.textContent = r.error.text; tb.hidden = false; }
      if (r.error.line) ed.mark(r.error.line, `${r.error.type ?? 'Error'}: ${r.error.message}`);
    }
    lastOut = [saved.replace(/\n$/, ''), r.error?.text].filter(Boolean).join('\n\n');
    if (lastOut) { lastOut += '\n'; saveOut.hidden = false; }
  }

  /* one matplotlib figure: its SVG (matplotlib's own, from the full runtime) shown as an image, so
     nothing in it can script the page, and a Download SVG button for it */
  let blobs = [];
  function imageEl(image, n) {
    const fig = h('figure', 'pycon-fig pycon-fig-mpl');
    const url = URL.createObjectURL(new Blob([image.svg], { type: 'image/svg+xml' }));
    blobs.push(url);
    const img = document.createElement('img');
    img.className = 'pycon-figimg';
    img.src = url;
    img.alt = image.alt;
    img.decoding = 'async';
    fig.appendChild(img);
    const bar = h('div', 'pycon-figbar');
    const cap = h('span', 'pycon-figcap', `Figure ${n} · matplotlib`);
    const dl = button('Download SVG', 'btn pycon-figdl', () =>
      download(image.svg, `${fileName.replace(/\.py$/i, '')}-figure-${n}.svg`, 'image/svg+xml'));
    dl.title = `Save figure ${n} as an .svg file`;
    dl.setAttribute('aria-label', `Download SVG of figure ${n}, a matplotlib figure`);
    bar.append(cap, dl);
    fig.appendChild(bar);
    return fig;
  }

  /* one figure: its SVG, drawn in place, and a Download SVG button for it */
  function figureEl(spec, n) {
    const fig = h('figure', `pycon-fig pycon-fig-${spec.kind}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('pycon-figsvg');
    fig.appendChild(svg);
    const bar = h('div', 'pycon-figbar');
    const cap = h('span', 'pycon-figcap', `Figure ${n} · ${figureName(spec)}`);
    const dl = button('Download SVG', 'btn pycon-figdl', () =>
      download(svgFile(svg), `${fileName.replace(/\.py$/i, '')}-figure-${n}-${spec.kind}.svg`, 'image/svg+xml'));
    dl.title = `Save figure ${n} as an .svg file, in the colours on screen`;
    dl.setAttribute('aria-label', `Download SVG of figure ${n}, the ${figureName(spec)}`);
    bar.append(cap, dl);
    fig.appendChild(bar);
    stream.appendChild(fig);                            // in the document before it is drawn
    try { drawFigure(spec, svg); } catch (e) {
      svg.remove();
      cap.textContent = `Figure ${n} · ${figureName(spec)}: it could not be drawn (${String(e?.message ?? e)})`;
      dl.remove();
    }
    return fig;
  }

  function stop() {
    if (!running) return;
    runId++;
    if (answer) { const a = answer; answer = null; consentBox.hidden = true; consentBox.replaceChildren(); a.rej(new Error('stopped')); }
    app.client.stop();
    setRunning(false);
    badge.hidden = true;
    clearOut();
    statusText.textContent = 'Stopped. The script was ended and the console restarted; nothing it printed is kept.';
  }

  /* the editor's whole text replaced through the browser's editing, so Undo brings the old one
     back; on a touch screen (where focusing the editor raises the keyboard) set directly */
  function setScript(text) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    let done = false;
    if (!coarse && document.execCommand) {
      ta.focus({ preventScroll: true });
      ta.select();
      done = document.execCommand('insertText', false, text);
    }
    if (!done) { ta.value = text; ta.dispatchEvent(new Event('input')); }
    ta.setSelectionRange(0, 0);
    ta.scrollTop = ta.scrollLeft = 0;
    ed.refresh();
    save(DRAFT_KEY, ta.value);
  }
  /* new text in the editor: the old marks and output belong to the old text */
  function loaded(text, name, what) {
    setScript(text);
    setName(name);
    ed.clear();
    if (!running) {
      badge.hidden = true;
      clearOut();
      statusText.textContent = `${what} Press Run.`;
    }
  }
  function useModel() {
    loaded(app.modelScript(), DEFAULT_NAME, `The editor holds the analysis on screen (${app.modelLabel()}).`);
  }
  let loads = 0;                                        // a slow fetch never lands over a newer load
  async function useExample(file) {
    const x = [...EXAMPLES, ...FULL_EXAMPLES].find((e) => e.file === file);
    if (!x) { fail(`There is no example called “${file}”.`); return; }
    const mine = ++loads;
    let text;
    try {
      const r = await fetch(exampleUrl(file));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = await r.text();
    } catch (e) {
      if (mine === loads) fail(`The example “${x.label}” did not load: ${String(e?.message ?? e)}`);
      return;
    }
    if (mine === loads) loaded(text, file.split('/').pop(), `The editor holds the example “${x.label}” (${file})`
      + (x.full ? ': it runs on full Python.' : '.'));
  }
  async function openFile(f) {
    const mine = ++loads;
    let text;
    try { text = await readScriptFile(f); } catch (e) {
      if (mine === loads) fail(String(e?.message ?? e));
      return;
    }
    if (mine === loads) loaded(text, scriptName(f.name), `Opened ${f.name}.`);
  }
  /* a load that failed: said in the notice, the editor untouched */
  function fail(msg) {
    if (running) { statusText.textContent = msg; return; }
    badge.hidden = true;
    clearOut();
    notice.textContent = msg;
    notice.hidden = false;
    statusText.textContent = 'Nothing was loaded; the editor is unchanged.';
  }

  return {
    el: root,
    useExample,
    show(container) {
      if (root.parentNode !== container) container.replaceChildren(root);
      if (!started) {
        started = true;
        const draft = load(DRAFT_KEY);
        if (draft != null && draft.trim()) { ta.value = draft; ed.refresh(); fileName = load(NAME_KEY) || DEFAULT_NAME; }
        else { ta.value = app.modelScript(); ed.refresh(); }
        app.client.warm()?.catch?.(() => {});           // the worker starts now, on the first open
        showForget();
      }
    },
  };
}
