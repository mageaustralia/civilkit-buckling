/* The Extensions UI: the manager (install, installed modules with their badge,
   the store), a module view rendered by the vendored moduleui host, and the proposals a module
   makes back to the GUI. Everything the app owns (the drawing functions, the model snapshot,
   committing a proposed section) comes in through `app`; this file holds no app state.

   app = {
     openSession(bundle) -> Promise<{ tree, buildUi(inputs, result, calcLines), check(inputs, snapshot) }>
     runExamples(bundle) -> Promise<{ badge, examples: [{ id, pass, diffs }] }>   in the sandbox worker
     snapshot() -> { model, results }            the capabilities' view of the GUI
     drawSection(svg, model|null, opt)            the app's section drawing (null: the current model)
     drawChart(svg, cfg)                          the app's signature chart
     drawProposal(svg, model)                     current section with the proposal ghosted over it
     preview(model|null)                          ghost the proposal in the section card (null ends it)
     commit(model) -> Promise<undo()>             put a proposed section into the analysis
     fmt(v) -> string                             the app's number format
   } */
import { createRegistry } from '../../vendor/civilkit/registry.js';
import { createModuleHost } from '../../vendor/civilkit/host.js';
import { zipSync } from '../../vendor/civilkit/fflate.js';
import { validateModel } from '../model.js';
import { createBuilder, draftFromRecord, helpLink, loadDraft, saveDraft, sameDraft, starterDraft } from './builder.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const BADGE_TIP = 'Verified: every worked example reproduced its cited numbers. This is a test gate, not a review.';
const KIND_FAM = { G: 'glob', D: 'dist', L: 'local', O: 'other' };

const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (label, cls = 'btn', onclick) => {
  const b = h('button', cls, label);
  b.type = 'button';
  if (onclick) b.onclick = onclick;
  return b;
};
const badgeEl = (badge) => {
  const v = badge === 'verified';
  const b = h('span', `ext-badge ${v ? 'verified' : 'community'}`, v ? 'Verified' : 'Community');
  b.title = BADGE_TIP;
  return b;
};
const errText = (e) => String((e && e.message) || e);

/* MicroPython prints some floats with noise in the last digit (0.54409 comes out as
   0.5440899999999999). Result rows and table cells are shown to 12 significant figures, which
   drops that noise and nothing a module meant: display only, the values are unchanged. */
const clean = (v) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? Number(v.toPrecision(12)) : v);
export function tidy(n) {
  if (Array.isArray(n)) return n.map(tidy);
  if (!n || typeof n !== 'object') return n;
  const out = { ...n };
  if (n.type === 'result' && Array.isArray(n.items)) out.items = n.items.map((it) => (it && typeof it === 'object' ? { ...it, value: clean(it.value) } : it));
  if (n.type === 'table' && Array.isArray(n.rows)) out.rows = n.rows.map((r) => (Array.isArray(r) ? r.map(clean) : r && typeof r === 'object' ? Object.fromEntries(Object.entries(r).map(([k, x]) => [k, clean(x)])) : r));
  if (Array.isArray(n.children)) out.children = n.children.map(tidy);
  if (Array.isArray(n.tabs)) out.tabs = n.tabs.map(tidy);
  return out;
}

/* one toast at a time, bottom centre (above the tab bar on compact), with an optional action */
let toastEl = null, toastTimer = null;
export function toast(msg, action, onAction, ms = 7000) {
  if (!toastEl) {
    toastEl = h('div', 'ext-toast');
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.replaceChildren(h('span', 'ext-toast-msg', msg));
  if (action) toastEl.appendChild(button(action, 'btn ext-toast-act', async () => {
    hideToast();
    try { await onAction(); } catch (e) { toast(errText(e)); }
  }));
  toastEl.classList.add('on');
  toastTimer = setTimeout(hideToast, ms);
}
function hideToast() { clearTimeout(toastTimer); toastEl?.classList.remove('on'); }

export function createExtensionsUI(app) {
  let reg = null;                       // created on first show: no IndexedDB work on a plain page load
  const root = h('div', 'ext-view');
  const mgr = h('div', 'ext-mgr');
  let view = null;                      // the open module view, or null
  let pushed = false;                   // a history entry for the compact full-screen view

  /* ------------------------------------------------------------ manager */
  const head = h('div', 'ext-head');
  const headRow = h('div', 'ext-headrow');
  headRow.append(h('h3', null, 'Extensions'), helpLink('guide/using.html', 'using extensions'));
  head.append(headRow,
    h('p', 'note', 'Modules are .ckext files: Python that runs in a sandbox beside the engine, '
      + 'with no network or storage. A module only sees what its manifest declares.'));

  const install = h('section', 'ext-install');
  const file = h('input');
  file.type = 'file'; file.id = 'extFile'; file.accept = '.ckext'; file.hidden = true;
  const drop = h('div', 'ext-drop');
  drop.append(h('span', null, 'Drop a .ckext file here, or'),
              button('Choose a file…', 'btn', () => file.click()), file);
  const status = h('div', 'ext-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  install.append(drop, status);
  const say = (msg, kind = '') => { status.textContent = msg; status.className = `ext-status ${kind}`; };

  const installed = h('section', 'ext-installed');
  const store = h('section', 'ext-store');
  const links = h('div', 'ext-links');
  const newMod = button('New module…', 'btn', () => newModule());
  newMod.title = 'Write a module here: main.py, its manifest and worked examples; run, test and export it';
  links.append(newMod);
  mgr.append(head, install, installed, store, links);
  root.appendChild(mgr);

  /* The badge is decided at install: the registry hands each worked example to this runner, which
     runs it in the sandbox worker (js/ext/examples.js) and keeps the diffs of one that fails, so
     the status line can say why a module is Community. */
  let failed = null;
  const testRunners = {
    python: async ({ manifest, files, example }) => {
      const main = new TextDecoder().decode(files['main.py']);
      const r = await app.runExamples({ manifest, main, examples: [example] });
      const x = r.examples[0];
      if (!x.pass) failed = `${x.id}: ${x.diffs.join('; ')}`;
      return x.pass;
    },
  };
  const installed_ = (d) => {
    const why = d.badge !== 'verified' && failed ? ` Worked example ${failed}` : '';
    failed = null;
    return `Installed ${d.name} ${d.version} (${d.badge === 'verified' ? 'Verified' : 'Community'}).${why}`;
  };

  async function installBytes(bytes, label) {
    say(`Installing ${label}…`);
    failed = null;
    try {
      const d = await reg.install(bytes);
      say(installed_(d), d.badge === 'verified' ? 'ok' : '');
      renderInstalled(); renderStore();
    } catch (e) { say(errText(e), 'error'); }
  }
  file.onchange = async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (f) say(`Reading ${f.name}…`);
    if (f) await installBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault(); drop.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) say(`Reading ${f.name}…`);
    if (f) await installBytes(new Uint8Array(await f.arrayBuffer()), f.name);
  });

  function row(d, actions) {
    const r = h('div', 'ext-row');
    const info = h('div', 'ext-info');
    const name = h('div', 'ext-rname');
    name.append(h('b', null, d.name), ' ', h('span', 'ext-ver', d.version));
    if (d.badge) name.append(' ', badgeEl(d.badge));
    info.appendChild(name);
    if (d.description) info.appendChild(h('div', 'ext-desc', d.description));
    const acts = h('div', 'ext-acts');
    acts.append(...actions);
    r.append(info, acts);
    return r;
  }

  function renderInstalled() {
    const list = reg.list().sort((a, b) => a.name.localeCompare(b.name));
    installed.replaceChildren(h('h3', null, 'Installed'));
    if (!list.length) {
      installed.appendChild(h('div', 'ext-empty', 'No modules installed yet.'));
      return;
    }
    for (const d of list) installed.appendChild(row(d, [
      button('Open', 'btn primary', () => openModule(d.id)),
      button('Uninstall', 'btn', () => uninstall(d.id)),
    ]));
  }

  async function uninstall(id) {
    const rec = reg.get(id);
    if (!rec) return;
    await reg.uninstall(id);
    renderInstalled(); renderStore();
    say('');
    // undo re-installs the same files (the registry keeps them unzipped; zip them back up)
    toast(`Uninstalled ${rec.manifest.name}.`, 'Undo', async () => {
      await reg.install(zipSync(rec.files));
      renderInstalled(); renderStore();
    });
  }

  let storeIndex = null;                // null: not fetched yet; [] when missing or empty
  async function loadStore() {
    try {
      const r = await fetch('store/index.json', { cache: 'no-cache' });
      const j = r.ok ? await r.json() : [];
      storeIndex = Array.isArray(j) ? j.filter((x) => x && typeof x.id === 'string') : [];
    } catch { storeIndex = []; }
    renderStore();
  }
  function renderStore() {
    store.replaceChildren(h('h3', null, 'Store'));
    if (storeIndex === null) { store.appendChild(h('div', 'ext-empty', 'Loading the store…')); return; }
    if (!storeIndex.length) {
      store.appendChild(h('div', 'ext-empty', 'No modules in the store yet.'));
      return;
    }
    for (const s of storeIndex) {
      const have = reg.get(s.id);
      const same = have && have.manifest.version === s.version;
      const b = button(same ? 'Installed' : have ? 'Update' : 'Install', 'btn', async () => {
        b.disabled = true;
        say(`Installing ${s.name || s.id}…`);
        failed = null;
        try {
          const d = await reg.installFromStore(s.id);
          say(installed_(d), d.badge === 'verified' ? 'ok' : '');
        } catch (e) { say(errText(e), 'error'); }
        renderInstalled(); renderStore();
      });
      if (same) b.disabled = true;
      store.appendChild(row({ name: s.name || s.id, version: s.version || '', description: s.description || '' }, [b]));
    }
  }

  /* --------------------------------------------------------- host nodes */
  /* The drawings of the section in the analysis (a buckling.section node with no model of its
     own): redrawn when a proposal is used or undone, so a module never shows the section it was
     opened on after the analysis has moved to another. */
  const live = new Set();
  function redrawLive() {
    for (const d of live) {
      if (!d.svg.isConnected) { live.delete(d); continue; }
      try { app.drawSection(d.svg, null, { stress: d.stress }); } catch { /* the next run reports it */ }
    }
  }
  const customNodes = {
    'buckling.section': (node) => {
      const wrap = h('div', 'ext-draw');
      if (node.title) wrap.appendChild(h('div', 'mui-chart-title', String(node.title)));
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'sect');
      svg.setAttribute('viewBox', '0 0 420 320');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'The cross-section');
      let model = null;
      if (node.model != null) {
        try { validateModel(node.model); model = node.model; }
        catch (e) { wrap.appendChild(h('div', 'mui-unsupported', `buckling.section: ${errText(e)}`)); return wrap; }
      }
      try { app.drawSection(svg, model, { stress: !!node.stress }); }
      catch (e) { wrap.appendChild(h('div', 'mui-unsupported', `buckling.section: ${errText(e)}`)); return wrap; }
      if (model == null) live.add({ svg, stress: !!node.stress });
      wrap.appendChild(svg);
      return wrap;
    },
    'buckling.signature': (node) => {
      const wrap = h('div', 'ext-draw');
      if (node.title) wrap.appendChild(h('div', 'mui-chart-title', String(node.title)));
      const curve = (Array.isArray(node.curve) ? node.curve : [])
        .map((p) => (Array.isArray(p) ? { L: Number(p[0]), y: Number(p[1]) } : null))
        .filter((p) => p && Number.isFinite(p.L) && p.L > 0 && Number.isFinite(p.y));
      if (curve.length < 2) {
        wrap.appendChild(h('div', 'ext-empty', 'No signature curve yet: run the module.'));
        return wrap;
      }
      // a minimum points at its curve index; its kind (G/D/L/O), when the module classified it,
      // labels the marker like the app's own chart
      const markers = [];
      for (const m of Array.isArray(node.minima) ? node.minima : []) {
        const i = Number.isInteger(m?.index) ? m.index : curve.findIndex((p) => p.L === Number(m?.length));
        if (i < 0 || i >= curve.length) continue;
        curve[i].fam = KIND_FAM[m.kind];
        markers.push({ i });
      }
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'chart');
      app.drawChart(svg, { points: curve, series: [{ points: curve }], markers,
                           xlabel: node.xlabel, ylabel: node.ylabel || 'load factor λ', unit: node.unit ?? '' });
      wrap.appendChild(svg);
      return wrap;
    },
  };

  /* -------------------------------------------------------- module view */
  /* One view at a time replaces the manager: an installed module, the builder, or a module's
     code. On compact it is full screen, with a history entry so the system back closes it. */
  function closeModule() {
    if (!view) return;
    app.preview(null);
    view.destroy?.();
    view.el.remove();
    view = null;
    mgr.hidden = false;
    document.body.classList.remove('ext-full');
  }
  function back() {
    if (pushed) { history.back(); return; }        // popstate closes it
    closeModule();
  }
  /* On compact the module view is full screen. It cannot be position: fixed inside .app (a size
     container, so the containing block for fixed descendants), so it moves to <body> there and
     back into the pane when the layout widens. */
  function home() {
    if (!view) return;
    const compact = document.body.dataset.layout === 'compact';
    document.body.classList.toggle('ext-full', compact);
    const parent = compact ? document.body : root;
    if (view.el.parentNode !== parent) parent.appendChild(view.el);
  }
  new MutationObserver(home).observe(document.body, { attributes: true, attributeFilter: ['data-layout'] });
  addEventListener('popstate', () => {
    if (!pushed) return;
    pushed = false;
    closeModule();
  });
  function openView(el, destroy) {
    if (view) closeModule();
    mgr.hidden = true;
    root.appendChild(el);
    view = { el, destroy };
    home();
    if (document.body.dataset.layout === 'compact' && !pushed) {
      history.pushState({ ...history.state, extModule: true }, '');
      pushed = true;
    }
    return view;
  }

  /* A module running in `container`: its form (the moduleui host), Run through the sandbox, the
     error box, the busy line and the proposals it makes. Used by an installed module's view and
     by the builder's preview. */
  function mountRunner(container, bundle, name) {
    const errBox = h('div', 'ext-error');
    errBox.setAttribute('role', 'alert');
    errBox.hidden = true;
    const props = h('div', 'ext-proposals');
    const running = h('div', 'ext-running', 'Running…');
    running.hidden = true;
    const stale = h('div', 'note ext-stale', 'The section in the analysis has changed: Run the module again to update its results.');
    stale.hidden = true;
    const hostEl = h('div', 'ext-host');
    container.append(errBox, props, running, stale, hostEl);
    const v = { host: null, session: null, busy: false, again: false, alive: true };
    const showError = (msg) => { errBox.textContent = msg; errBox.hidden = !msg; };

    // module inputs keep their data-muiid; the element ids the host also sets would collide
    // with the app's own (a module field called fy, the app's #fy)
    const update = (tree) => {
      v.host.update(tidy(tree));
      for (const e of hostEl.querySelectorAll('[data-muiid][id]')) e.removeAttribute('id');
    };
    const setRunning = (on, text = 'Running…') => {
      running.textContent = text;
      running.hidden = !on;
      for (const b of hostEl.querySelectorAll('.mui-button')) b.disabled = on;
    };

    async function runCheck() {
      if (v.busy) { v.again = true; return; }
      v.busy = true;
      setRunning(true);
      stale.hidden = true;
      showError('');
      try {
        do {
          v.again = false;
          if (!v.session) v.session = await app.openSession(bundle);
          const inputs = v.host.getInputs();
          const out = await v.session.check(inputs, app.snapshot());
          const tree = await v.session.buildUi(inputs, out.result ?? [], out.calcLines ?? []);
          if (!v.alive) return;
          update(tree);
          setRunning(true);
          showProposals(out.proposals ?? []);
        } while (v.again);
      } catch (e) {
        // a stopped module restarts the worker and a Python error may leave it half-run:
        // the next Run loads the module afresh
        v.session = null;
        if (v.alive) showError(`${name}: ${errText(e)}`);
      } finally {
        v.busy = false;
        if (v.alive) setRunning(false);
      }
    }

    function showProposals(list) {
      app.preview(null);
      props.replaceChildren();
      for (const p of list) {
        if (p.error || !p.model) {
          const box = h('div', 'ext-proposal ext-proposal-error');
          box.setAttribute('role', 'alert');
          box.append(h('span', null, `${name} proposed an invalid section: ${p.error || 'no model'}`),
                     button('Dismiss', 'btn', () => box.remove()));
          props.appendChild(box);
          continue;
        }
        const m = p.model;
        const box = h('div', 'ext-proposal');
        const msg = h('span', 'ext-pmsg', `${name} proposes a section: ${m.nodes.length} nodes, ${m.elems.length} elements.`);
        const mini = document.createElementNS(SVGNS, 'svg');
        mini.setAttribute('class', 'sect ext-prop-svg');
        mini.setAttribute('viewBox', '0 0 420 300');
        mini.setAttribute('aria-label', 'The proposed section over the current one');
        mini.hidden = true;
        let on = false;
        const prev = button('Preview', 'btn', () => {
          on = !on;
          prev.textContent = on ? 'Hide preview' : 'Preview';
          prev.classList.toggle('on', on);
          app.preview(on ? m : null);
          if (on) { try { app.drawProposal(mini, m); } catch { /* the card preview still shows */ } }
          mini.hidden = !on;
        });
        const use = button('Use it', 'btn primary', async () => {
          use.disabled = true;
          try {
            const undo = await app.commit(m);
            box.remove();
            /* the module's drawing of the analysed section follows the commit and its undo; its
               results were computed on the old section, which the note says */
            const moved = () => { redrawLive(); if (v.alive) stale.hidden = false; };
            moved();
            toast(`The section from ${name} is now in the analysis.`, 'Undo', () => { undo(); moved(); });
          } catch (e) {
            use.disabled = false;
            box.replaceChildren(h('span', 'ext-proposal-error', `${name} proposed an invalid section: ${errText(e)}`),
                                button('Dismiss', 'btn', () => box.remove()));
            box.classList.add('ext-proposal-error');
          }
        });
        const dismiss = button('Dismiss', 'btn', () => { if (on) app.preview(null); box.remove(); });
        const acts = h('div', 'ext-acts');
        acts.append(prev, use, dismiss);
        box.append(msg, acts, mini);
        props.appendChild(box);
      }
    }

    v.host = createModuleHost(hostEl, {
      customNodes,
      onEvent: (e) => { if (e.action === 'run-check' || e.action === 'change') runCheck(); },
    });
    (async () => {
      setRunning(true, 'Starting the module…');
      try {
        v.session = await app.openSession(bundle);
        if (v.alive) update(v.session.tree);
      } catch (e) {
        v.session = null;
        if (v.alive) showError(`${name}: ${errText(e)}`);
      } finally {
        if (v.alive) setRunning(false);
      }
    })();
    return {
      getInputs: () => v.host.getInputs(),
      destroy() { v.alive = false; app.preview(null); v.host.destroy(); },
    };
  }

  async function openModule(id) {
    if (!reg) return;
    await reg.ready;
    const rec = reg.get(id);
    if (!rec) return;
    const el = h('div', 'ext-module ext-view');
    const bar = h('div', 'ext-bar');
    bar.append(button('‹ Extensions', 'btn ext-back', back), h('b', 'ext-name', rec.manifest.name),
               badgeEl(rec.badge), h('span', 'ext-ver', rec.manifest.version),
               button('View code', 'btn ext-codebtn', () => viewCode(id)));
    const body = h('div', 'ext-mbody');
    el.append(bar, body);
    let runner = null;
    openView(el, () => runner?.destroy());
    const main = rec.files['main.py'];
    if (!main) {
      const err = h('div', 'ext-error', 'This module has no main.py, so there is nothing to run.');
      err.setAttribute('role', 'alert');
      body.appendChild(err);
      return;
    }
    runner = mountRunner(body, { manifest: rec.manifest, main: new TextDecoder().decode(main) }, rec.manifest.name);
  }

  /* ------------------------------------------------------------ builder */
  const builderUi = {
    h, button, badgeEl, toast, mountRunner, back,
    runExamples: (bundle) => app.runExamples(bundle),
    snapshot: () => app.snapshot(),
  };
  function openBuilder(draft, { status = '', restart = false } = {}) {
    let b = null;
    const onRestart = restart ? () => {
      const prev = b.replace(starterDraft());
      b.say('Started a new module.');
      toast('Started a new module; your previous draft is replaced.', 'Undo', () => { b.replace(prev); b.say('Your previous draft is back.'); }, 15000);
    } : null;
    b = createBuilder({ draft, status, onRestart, ui: { ...builderUi, fork: () => {} } });
    openView(b.el, () => b.destroy());
    return b;
  }
  /* New module…: the saved draft when there is one (saying so, with a way to start afresh), or
     the starter. */
  function newModule() {
    const d = loadDraft();
    if (d && !sameDraft(d, starterDraft())) {
      const when = d.savedAt ? new Date(d.savedAt).toLocaleString() : 'earlier';
      openBuilder(d, { status: `Your draft from ${when} is restored.`, restart: true });
    } else {
      openBuilder(d ?? starterDraft());
    }
  }
  /* View code: the builder, read-only, on an installed module; Fork copies it into the draft
     (with its own id), and a draft it replaces can be brought back from the toast. */
  async function viewCode(id) {
    await reg.ready;
    const rec = reg.get(id);
    if (!rec) return;
    const fork = () => {
      const prev = loadDraft();
      const draft = draftFromRecord(rec, { fork: true });
      saveDraft(draft);
      const b = openBuilder(draft);
      b.say(`Forked ${rec.manifest.name}: this copy has the id ${draft.manifest.id}.`);
      if (prev && !sameDraft(prev, starterDraft()) && !sameDraft(prev, draft)) {
        toast('The fork replaced your previous draft.', 'Undo', () => { saveDraft(prev); openBuilder(prev, { status: 'Your previous draft is back.' }); }, 15000);
      }
    };
    const b = createBuilder({ draft: draftFromRecord(rec), readOnly: true, ui: { ...builderUi, fork } });
    openView(b.el, () => b.destroy());
  }

  /* --------------------------------------------------------------- show */
  let started = false;
  async function show(container) {
    if (root.parentNode !== container) container.replaceChildren(root);
    if (started) return;
    started = true;
    reg = createRegistry({ hostApiVersion: '1.0.0', dbName: 'civilkit_buckling_modules',
                           points: ['buckling.tool'], storeUrl: 'store/index.json', testRunners });
    installed.replaceChildren(h('h3', null, 'Installed'), h('div', 'ext-empty', 'Loading…'));
    renderStore();
    await reg.ready;
    renderInstalled();
    loadStore();
  }

  return {
    show,
    openModule,
    openExtensions: () => closeModule(),
    get open() { return view !== null; },
  };
}
