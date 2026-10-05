const steps = [];
export default steps;
import { encodeState } from '../../js/share.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

steps.push(['engine loads', async (p) => {
  // the engine now boots in a Web Worker, so wait for it rather than for the footer note
  // (the note's initial HTML already says "engine")
  await p.waitForFunction(() => !!window.__cufsm?.engine, null, { timeout: 30000 });
  if (!(await p.evaluate(() => !!window.__cufsm?.engine))) throw new Error('no engine');
}]);

const nodesTab = async (p) => { await p.click('[data-tab="tables"]'); };
steps.push(
  ['no numbers before the engine', async (p) => {
    const ctx = await p.context().browser().newContext();
    const q = await ctx.newPage();
    await q.route('**/cufsm.wasm', (r) => new Promise((res) => setTimeout(() => res(r.continue()), 1500)));
    await q.goto(p.url());
    const kpi = await q.textContent('#kpis');
    if (/\d/.test(kpi)) throw new Error(`KPIs show numbers before the engine loaded: ${kpi}`);
    await ctx.close();
  }],
  ['node table has 4 dof columns and all solved nodes', async (p) => {
    await nodesTab(p);
    const heads = await p.$$eval('#pane table.props thead th', (t) => t.map((x) => x.textContent));
    for (const h of ['xdof', 'zdof', 'ydof', 'qdof', 'stress']) if (!heads.includes(h)) throw new Error(`missing ${h}`);
    const rows = await p.$$eval('#pane table.nodes tbody tr', (r) => r.length);
    const solved = await p.evaluate(() => window.__cufsm.model.nodes.length);
    if (rows !== solved) throw new Error(`${rows} rows, ${solved} solved nodes`);
  }],
  ['paste the video model', async (p) => {
    const v = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../fixtures/video-c.json', import.meta.url)));
    await nodesTab(p);
    await p.click('#pasteCufsm');
    await p.fill('#pasteProp', v.prop); await p.fill('#pasteNode', v.node); await p.fill('#pasteElem', v.elem);
    await p.click('#pasteApply');
    await p.waitForFunction(() => window.__cufsm.model.nodes.length === 10);
    const t = await p.inputValue('#pane table.elems tbody tr:first-child input[data-t]');
    if (+t !== 0.1) throw new Error(`t = ${t}`);
  }],
);
steps.push(
  ['first yield reproduces the video', async (p) => {
    // the video model is loaded by the paste step above
    await p.click('[data-tab="loads"]');
    await p.fill('#fy', '50'); await p.uncheck('#extremeFibre'); await p.dispatchEvent('#fy', 'change');
    const read = async (id) => +(await p.textContent(id));
    const near = (a, b) => Math.abs(a - b) <= 1e-4 * Math.abs(b);
    // the yield readouts come from the engine in the worker now: wait for the value,
    // it is the assertion (a wrong value still fails with it after the timeout)
    const readNear = async (id, want) => {
      const t = Date.now();
      for (;;) {
        const v = await read(id);
        if (near(v, want)) return;
        if (Date.now() - t > 15000) throw new Error(`${id} ${v}`);
        await p.waitForTimeout(100);
      }
    };
    await readNear('#Py', 105);
    await readNear('#Mxxy', 328.25);
    await readNear('#Mzzy', 112.51375);
    await p.check('#extremeFibre');
    await readNear('#Mxxy', 324.642857142857);
    await readNear('#Mzzy', 110.850985221675);
  }],
  ['Py button fills P and regenerates the stress', async (p) => {
    await p.click('#useP');
    // the handler now asks the worker for the yield and the new stresses: wait for both
    // the input and the stress column to land before reading them
    await p.waitForFunction(() => {
      const inp = document.getElementById('P');
      return !!inp && +inp.value === 105 &&
        window.__cufsm.model.nodes.every((n) => Math.abs(n.stress - 50) < 1e-9);
    }, null, { timeout: 15000 });
    const P = +(await p.inputValue('#P'));
    const s = await p.evaluate(() => window.__cufsm.model.nodes.map((n) => n.stress));
    if (!s.every((v) => Math.abs(v - 50) < 1e-9)) throw new Error(`stresses ${s}`);
    if (P !== 105) throw new Error(`P ${P}`);
  }],
  ['generate-from-stress shows err before applying', async (p) => {
    await p.click('#fromStress');
    await p.waitForSelector('#s2aConfirm');
    const t = await p.textContent('#s2aConfirm');
    if (!/err/i.test(t)) throw new Error('no error norm shown');
    await p.click('#s2aCancel');
  }],
);
steps.push(
  ['general BC with 3 terms shows the C-C shape function', async (p) => {
    await p.check('#solGeneral'); await p.selectOption('#bc', 'C-C'); await p.fill('#terms', '3');
    await p.dispatchEvent('#terms', 'change');
    if (!(await p.$('#shapeFnSvg path'))) throw new Error('no shape function plot');
  }],
  ['higher modes: mode 2 has a higher lambda', async (p) => {
    await p.click('[data-tab="mode"]');
    const l1 = +(await p.getAttribute('#modeRead [data-lf]', 'data-lf'));
    await p.click('#modeNext');
    // the mode browser re-renders through the worker now: wait for the stepper to show
    // mode 2 before reading its lambda, or the read is the old mode's
    await p.waitForFunction(() => /mode 2 \//.test(document.getElementById('pane')?.textContent || ''),
      null, { timeout: 15000 });
    const l2 = +(await p.getAttribute('#modeRead [data-lf]', 'data-lf'));
    if (!(l2 >= l1)) throw new Error(`${l2} < ${l1}`);
  }],
);
steps.push(
  ['a malformed share link falls back to the default section', async (p) => {
    const bad = { v: 2,
      model: { mats: [{ id: 1, ex: 200000, ey: 200000, vx: 0.3, vy: 0.3, g: 77000 }],
               nodes: [{ x: 0, z: 0 }], elems: [{ i: 0, j: 0, t: 1, mat: 1 }],
               springs: [], constraints: [] },
      ui: { tab: 'tables', norm: 'stress' } };                 // a node with no fixity flags
    const ctx = await p.context().browser().newContext();
    const q = await ctx.newPage();
    const errs = [];
    q.on('pageerror', (e) => errs.push(String(e)));
    q.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await q.goto(p.url().split('#')[0] + await encodeState(bad));
    await q.waitForFunction(() => document.getElementById('footerNote')?.textContent.includes('⚠'));
    const note = await q.textContent('#footerNote');
    if (!/no fixity data/.test(note)) throw new Error(`no reason in the footer: ${note}`);
    if (!/default section/.test(note)) throw new Error(`no fallback sentence: ${note}`);
    const n = await q.evaluate(() => window.__cufsm.model.nodes.length);
    if (n !== 21) throw new Error(`${n} nodes, expected the default 21`);
    if (errs.length) throw new Error(`page errors: ${errs.join(' | ')}`);
    await ctx.close();
  }],
  ['share link reopens the same analysis with the shape function drawn', async (p) => {
    const nodesBefore = await p.evaluate(() => window.__cufsm.model.nodes.length);
    await p.click('#shareBtn');
    await p.waitForFunction(() => location.hash.startsWith('#v2.'), null, { timeout: 30000 });
    const ctx = await p.context().browser().newContext();
    const q = await ctx.newPage();
    const errs = [];
    q.on('pageerror', (e) => errs.push(String(e)));
    q.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await q.goto(p.url());
    await q.waitForFunction((n) => window.__cufsm?.model?.nodes.length === n, nodesBefore, { timeout: 60000 });
    if (!(await q.$('#shapeFnSvg path'))) throw new Error('shape function not drawn on open');
    const sol = await q.isChecked('#solGeneral');
    const bc = await q.inputValue('#bc');
    const terms = await q.inputValue('#terms');
    if (!sol || bc !== 'C-C' || terms !== '3') throw new Error(`solution ${sol}, bc ${bc}, terms ${terms}`);
    if (errs.length) throw new Error(`page errors: ${errs.join(' | ')}`);
    await ctx.close();
  }],
);
steps.push(
  ['sharing says what happened instead of failing silently', async (p) => {
    await p.evaluate(() => history.replaceState(null, '', location.pathname + location.search));
    await p.click('#shareBtn');
    await p.waitForFunction(() => location.hash.startsWith('#v2.'), null, { timeout: 30000 });
    // either the clipboard took it or the block is reported on the button; silence fails
    await p.waitForFunction(() => /Copied|clipboard/.test(document.getElementById('shareBtn').textContent),
      null, { timeout: 5000 });
  }],
);
steps.push(
  ['report has first yield', async (p) => {
    const html = await p.evaluate(() => window.__cufsm.buildReportHtml());
    const missing = ['Py', 'M11y', 'Cw', 'mat#'].filter((s) => !html.includes(s));
    if (missing.length) throw new Error(`report is missing ${missing.join(', ')}`);
    if (!html.includes('First yield (')) throw new Error('report has no first-yield section');
  }],
);
steps.push(
  ['a blocked worker script shows the engine error and Retry recovers', async (p) => {
    const ctx = await p.context().browser().newContext();
    const q = await ctx.newPage();
    const errs = [];
    q.on('pageerror', (e) => errs.push(String(e)));
    q.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await q.route('**/js/worker.js', (r) => r.abort());
    await q.goto(p.url());
    // the page only boots if the load failure rejects engine.ready: an empty pane is a hang
    await q.waitForFunction(() => !!window.__cufsm, null, { timeout: 15000 });
    await q.waitForSelector('#pane .engineRetry', { timeout: 15000 });
    const err = await q.evaluate(() => window.__cufsm.err);
    if (!err || !/engine/i.test(err) || !/fail|error|load|stop/i.test(err))
      throw new Error(`no engine load failure reported: ${err}`);
    await q.unroute('**/js/worker.js');
    await q.click('#pane .engineRetry');
    await q.waitForFunction(() => window.__cufsm.sig && !window.__cufsm.err, null, { timeout: 30000 });
    const footer = await q.textContent('#footerNote');
    if (/⚠/.test(footer)) throw new Error(`footer still shows a warning after Retry: ${footer}`);
    const pageErrs = errs.filter((s) => !/worker\.js|Failed to load resource|net::ERR_/i.test(s));
    if (pageErrs.length) throw new Error(`page errors: ${pageErrs.join(' | ')}`);
    await ctx.close();
  }],
  ['the Loads tab shows the engine error with Retry', async (p) => {
    const ctx = await p.context().browser().newContext();
    const q = await ctx.newPage();
    const errs = [];
    q.on('pageerror', (e) => errs.push(String(e)));
    await q.goto(p.url());
    await q.waitForFunction(() => !!window.__cufsm?.engine, null, { timeout: 30000 });
    await q.evaluate(() => window.__cufsm.breakEngine());
    // one edit so the next solve hits the dead worker and sets the error state
    await q.fill('#lengths', await q.inputValue('#lengths'));
    await q.waitForFunction(() => !!window.__cufsm.err, null, { timeout: 15000 });
    await q.click('[data-tab="loads"]');
    await q.waitForSelector('#pane .engineRetry', { timeout: 15000 });
    const note = await q.textContent('#pane .engineerr');
    if (!/engine/i.test(note)) throw new Error(`no engine error on the Loads tab: ${note}`);
    if (errs.length) throw new Error(`page errors: ${errs.join(' | ')}`);
    await ctx.close();
  }],
  ['the engine object is only exposed under ?test=1', async (p) => {
    const ctx = await p.context().browser().newContext();
    const q = await ctx.newPage();
    const errs = [];
    q.on('pageerror', (e) => errs.push(String(e)));
    await q.goto(p.url().split('?')[0]);            // production page: no query at all
    await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
    const r = await q.evaluate(() => ({
      engine: window.__cufsm.engine,
      setEngine: typeof window.__cufsm.setEngine,
      breakEngine: typeof window.__cufsm.breakEngine,
      err: typeof window.__cufsm.err,
      sigNodes: window.__cufsm.sig ? window.__cufsm.sig.pts.length : 0,
      geoNodes: window.__cufsm.geo ? window.__cufsm.geo.nodes.length : 0,
      crash: (() => { try { window.__cufsm.engine.crash(); return 'reached crash()'; }
                      catch (e) { return String(e); } })(),
    }));
    if (r.engine !== null) throw new Error(`engine exposed on a production page: ${r.engine}`);
    if (r.setEngine !== 'undefined' || r.breakEngine !== 'undefined')
      throw new Error(`test hooks present without ?test=1: ${r.setEngine}/${r.breakEngine}`);
    if (r.err !== 'object' || !r.sigNodes || !r.geoNodes)
      throw new Error(`read-only getters missing or the app did not solve: ${JSON.stringify(r)}`);
    if (r.crash === 'reached crash()') throw new Error('crash() is reachable without ?test=1');
    if (errs.length) throw new Error(`page errors: ${errs.join(' | ')}`);
    await ctx.close();
  }],
);
steps.push(
  ['materials: a preset sticks and a material row can be deleted', async (p) => {
    await p.click('[data-tab="tables"]');
    await p.click('[data-tbl="materials"]');
    await p.selectOption('select.npreset >> nth=0', 'S235');       // E changes: cells must follow
    if (await p.inputValue('select.npreset >> nth=0') !== 'S235') throw new Error('preset snapped back after S235');
    if (await p.inputValue('#fy') !== '235') throw new Error(`#fy ${await p.inputValue('#fy')}, expected 235`);
    await p.selectOption('select.npreset >> nth=0', 'C450L0');     // shares E and ν with G250: must not snap back
    if (await p.inputValue('select.npreset >> nth=0') !== 'C450L0') throw new Error('preset snapped back to a lookalike grade');
    await p.click('#addMat');
    const n2 = await p.$$eval('#pane table.mats tbody tr', (r) => r.length);
    if (n2 !== 2) throw new Error(`${n2} rows after add`);
    await p.click('[data-delmat="1"]');
    const n1 = await p.$$eval('#pane table.mats tbody tr', (r) => r.length);
    if (n1 !== 1) throw new Error(`${n1} rows after delete`);
    if (!(await p.$eval('[data-delmat="0"]', (b) => b.disabled))) throw new Error('the last material is deletable');
  }],
);
const FIX = 'tests/fixtures/ckext/';
const extManager = async (p) => {
  const back = await p.$('.ext-back');
  if (back) await back.click();
  await p.click('.tab[data-tab="extensions"]');
  await p.waitForSelector('.ext-mgr .ext-store', { timeout: 15000 });
};
const extDrop = async (p, file) => {
  await extManager(p);
  await (await p.$('#extFile')).setInputFiles(FIX + file);
};
const extOpenRow = async (p, name) => {
  const row = p.locator('.ext-installed .ext-row', { hasText: name }).first();
  await row.locator('button', { hasText: 'Open' }).click();
  await p.waitForSelector('.ext-module', { timeout: 15000 });
};

steps.push(
  ['extensions: the manager and its store section render', async (p) => {
    await extManager(p);
    const store = await p.textContent('.ext-store h3');
    if (!store || !store.includes('Store')) throw new Error(`no store section: "${store}"`);
  }],
  ['extensions: the store lists both reference modules and installs DSM compression as Verified', async (p) => {
    await extManager(p);
    await p.waitForSelector('.ext-store .ext-row:has-text("DSM compression")', { timeout: 15000 });
    if (!(await p.$('.ext-store .ext-row:has-text("Rounded C / Z section")'))) throw new Error('rounded C/Z missing from the store');
    const row = p.locator('.ext-store .ext-row', { hasText: 'DSM compression' }).first();
    const btn = row.locator('button').first();
    if ((await btn.textContent()).trim() === 'Install') await btn.click();
    const inst = p.locator('.ext-installed .ext-row', { hasText: 'DSM compression' }).first();
    await inst.waitFor({ timeout: 30000 });
    const t = await inst.textContent();
    if (!/Verified/.test(t)) throw new Error(`installed from the store without the Verified badge: "${t}"`);
  }],
  ['extensions: a module drawing a signature and a section renders both, in light and dark', async (p) => {
    await extDrop(p, 'draw.ckext');
    await p.waitForSelector('.ext-installed .ext-row:has-text("Draw")', { timeout: 15000 });
    await extOpenRow(p, 'Draw');
    await p.click('.ext-module .mui-button:has-text("Run")');
    await p.waitForSelector('.ext-module svg.chart polyline', { timeout: 30000 });
    if (!(await p.$('.ext-module svg.sect polygon'))) throw new Error('no section drawing');
    await p.click('#themeBtn');                       // light theme: the drawing still renders
    if (!(await p.$('.ext-module svg.chart polyline'))) throw new Error('curve gone after theme switch');
    await p.click('#themeBtn');                       // back to dark for the later steps
  }],
  ['extensions: dropping hello installs it with a badge', async (p) => {
    await extDrop(p, 'hello.ckext');
    const row = p.locator('.ext-installed .ext-row', { hasText: 'Hello' }).first();
    await row.waitFor({ timeout: 15000 });
    const text = await row.textContent();
    if (!text.includes('Community')) throw new Error(`no badge on the installed row: "${text}"`);
  }],
  ['extensions: open hello, run, the Py row reads 105', async (p) => {
    await extOpenRow(p, 'Hello');
    await p.fill('.ext-module [data-muiid="fy"]', '50');
    await p.click('.ext-module .mui-button:has-text("Run")');
    await p.waitForSelector('.ext-module .mui-result-item:has-text("Py")', { timeout: 30000 });
    const text = await p.textContent('.ext-module .mui-result-item:has-text("Py")');
    const v = parseFloat(text.replace(/[^0-9.]/g, ''));
    if (!(Math.abs(v - 105) < 1e-6)) throw new Error(`Py row reads "${text}"`);
    await p.click('.ext-back');
    await p.waitForSelector('.ext-mgr', { timeout: 10000 });
  }],
  ['extensions: a module whose worked examples reproduce their numbers installs as Verified', async (p) => {
    await extDrop(p, 'hello-verified.ckext');
    const row = p.locator('.ext-installed .ext-row', { hasText: 'Hello (verified)' }).first();
    await row.waitFor({ timeout: 30000 });
    const text = await row.textContent();
    if (!text.includes('Verified')) throw new Error(`badge on the installed row: "${text}"`);
  }],
  ['extensions: a worked example the engine refuses leaves the module Community, saying why', async (p) => {
    await extDrop(p, 'zero-thickness.ckext');
    await p.waitForFunction(() => (document.querySelector('.ext-status') || {}).textContent?.includes('Zero thickness'),
      null, { timeout: 30000 });
    const msg = await p.textContent('.ext-status');
    if (!msg.includes('Community') || !msg.includes('thickness 0')) throw new Error(`status: "${msg}"`);
  }],
  ['extensions: a Studio module is refused and nothing is installed', async (p) => {
    const before = (await p.$$('.ext-installed .ext-row')).length;
    await (await p.$('#extFile')).setInputFiles(FIX + 'studio-deflection.ckext');
    await p.waitForFunction(() => (document.querySelector('.ext-status') || {}).textContent
      ?.includes('This module is for CivilKit Studio'), null, { timeout: 15000 });
    const after = (await p.$$('.ext-installed .ext-row')).length;
    if (after !== before) throw new Error(`${before} rows before, ${after} after the refusal`);
  }],
  ['extensions: a bad proposal is refused and the model is untouched', async (p) => {
    const nodesBefore = await p.evaluate(() => window.__cufsm.model.nodes.length);
    await extDrop(p, 'badprop.ckext');
    await extOpenRow(p, 'BadProp');
    await p.click('.ext-module .mui-button:has-text("Run")');
    await p.waitForSelector('.ext-proposal-error', { timeout: 15000 });
    const msg = await p.textContent('.ext-proposal-error');
    if (!msg.includes('proposed an invalid section')) throw new Error(`message: "${msg}"`);
    const nodesAfter = await p.evaluate(() => window.__cufsm.model.nodes.length);
    if (nodesAfter !== nodesBefore) throw new Error(`model changed: ${nodesBefore} -> ${nodesAfter} nodes`);
  }],
);

/* The reference modules, packed by the CLI from extensions/ into a temp folder (the store is
   deferred, so they are installed as files). */
const packRef = (name) => {
  const out = join(mkdtempSync(join(tmpdir(), 'ckext-')), `${name}.ckext`);
  execFileSync('node', ['tools/ckext.mjs', 'pack', `extensions/${name}`, '-o', out]);
  return out;
};
steps.push(
  ['reference module: dsm-compression installs as Verified and runs on the section', async (p) => {
    await extManager(p);
    await (await p.$('#extFile')).setInputFiles(packRef('dsm-compression'));
    const row = p.locator('.ext-installed .ext-row', { hasText: 'DSM compression' }).first();
    await row.waitFor({ timeout: 60000 });
    if (!(await row.textContent()).includes('Verified')) throw new Error(`badge: "${await row.textContent()}"`);
    await extOpenRow(p, 'DSM compression');
    await p.click('.ext-module .mui-button:has-text("Run")');
    await p.waitForSelector('.ext-module .mui-result-item:has-text("Governs")', { timeout: 60000 });
    if (!(await p.$('.ext-module svg.chart polyline'))) throw new Error('no signature curve drawn');
    const pn = await p.textContent('.ext-module .mui-result-item:has-text("φcPn")');
    if (!/\d.*kN/.test(pn)) throw new Error(`φcPn row: "${pn}"`);
  }],
  ['reference module: section-rounded-cz installs as Verified and proposes its section', async (p) => {
    await extManager(p);
    await (await p.$('#extFile')).setInputFiles(packRef('section-rounded-cz'));
    const row = p.locator('.ext-installed .ext-row', { hasText: 'Rounded C / Z' }).first();
    await row.waitFor({ timeout: 60000 });
    if (!(await row.textContent()).includes('Verified')) throw new Error(`badge: "${await row.textContent()}"`);
    await extOpenRow(p, 'Rounded C / Z');
    await p.click('.ext-module .mui-button:has-text("Use this section")');
    await p.waitForSelector('.ext-proposal:has-text("25 nodes, 24 elements")', { timeout: 30000 });
    await p.click('.ext-back');
  }],
);

/* The module builder: New module…, Run in the sandbox, Test for the badge, Export a
   .ckext the CLI verifies, a draft that survives a reload, and Fork from an installed module. */
const B = '.ext-builder';
const builderTab = async (p, name) => { await p.click(`${B} .ext-btabs [data-btab="${name}"]`); };
const readFix = (path) => readFileSync(FIX + path, 'utf8');
steps.push(
  ['builder: New module… opens the builder with the starter main.py', async (p) => {
    await extManager(p);
    await p.click('.ext-links button:has-text("New module")');
    await p.waitForSelector(`${B} textarea.ext-code`, { timeout: 10000 });
    const src = await p.inputValue(`${B} textarea.ext-code`);
    if (!src.includes('def build_ui') || !src.includes('def check') || !src.includes('firstYield'))
      throw new Error(`starter main.py: ${src.slice(0, 200)}`);
  }],
  ['builder: Run renders the module UI in the preview, through the sandbox', async (p) => {
    const src = await p.inputValue(`${B} textarea.ext-code`);
    await p.fill(`${B} textarea.ext-code`, src.replace('"My module"', '"Smoke module"'));
    await p.focus(`${B} textarea.ext-code`);
    await p.keyboard.press('Control+Enter');
    await p.waitForSelector(`${B} .ext-preview .mui-host:has-text("Smoke module")`, { timeout: 30000 });
    await p.click(`${B} .ext-preview .mui-button:has-text("Run")`);
    await p.waitForSelector(`${B} .ext-preview .mui-result-item:has-text("Py")`, { timeout: 30000 });
    const py = await p.textContent(`${B} .ext-preview .mui-result-item:has-text("Py")`);
    if (!/\d.*kN/.test(py)) throw new Error(`Py row: "${py}"`);
  }],
  ['builder: Tab indents by four spaces in the editor', async (p) => {
    await builderTab(p, 'main');
    const ta = `${B} textarea.ext-code`;
    const before = await p.inputValue(ta);
    await p.$eval(ta, (t) => { t.focus(); t.setSelectionRange(0, 0); });
    await p.keyboard.press('Tab');
    const after = await p.inputValue(ta);
    if (after !== '    ' + before) throw new Error(`Tab gave ${JSON.stringify(after.slice(0, 12))}`);
    await p.fill(ta, before);
  }],
  ['builder: Test shows the badge and each example\'s diffs', async (p) => {
    const good = JSON.parse(readFix('hello-module/tests/worked-examples.json'));
    const bad = { ...good[0], id: 'wrong-on-purpose', expected: { result: [{ label: 'Py', value: 106, unit: 'N' }] } };
    await p.fill(`${B} textarea.ext-code`, readFix('hello-module/main.py'));
    await builderTab(p, 'examples');
    await p.fill(`${B} textarea.ext-examples`, JSON.stringify([good[0], bad], null, 1));
    await p.click(`${B} button:has-text("Test")`);
    await p.waitForSelector(`${B} .ext-test .ext-badge`, { timeout: 30000 });
    const t1 = await p.textContent(`${B} .ext-test`);
    if (!t1.includes('Community') || !t1.includes('Py: expected 106, got 105')) throw new Error(`report: "${t1}"`);
    await p.fill(`${B} textarea.ext-examples`, JSON.stringify(good, null, 1));
    await p.click(`${B} button:has-text("Test")`);
    await p.waitForFunction(() => /Verified/.test(document.querySelector('.ext-builder .ext-test')?.textContent || ''),
      null, { timeout: 30000 });
  }],
  ['builder: the manifest form writes manifest.json', async (p) => {
    await builderTab(p, 'manifest');
    await p.fill(`${B} input[name="id"]`, 'smoke.builder-hello');
    await p.fill(`${B} input[name="name"]`, 'Builder hello');
    const caps = await p.$$eval(`${B} input[data-cap]`, (els) => els.map((e) => e.dataset.cap));
    for (const c of ['getModel', 'firstYield', 'signature', 'proposeModel']) if (!caps.includes(c)) throw new Error(`no ${c} in ${caps}`);
    const json = JSON.parse(await p.textContent(`${B} .ext-manifest-json`));
    if (json.id !== 'smoke.builder-hello' || json.name !== 'Builder hello' || !json.capabilities.includes('firstYield')
        || json.contributes[0].point !== 'buckling.tool') throw new Error(`manifest.json: ${JSON.stringify(json)}`);
  }],
  ['builder: Export downloads a .ckext that ckext test verifies', async (p) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }),
                                    p.click(`${B} button:has-text("Export .ckext")`)]);
    const out = join(mkdtempSync(join(tmpdir(), 'ckext-')), dl.suggestedFilename());
    await dl.saveAs(out);
    if (!out.endsWith('.ckext')) throw new Error(`file name ${out}`);
    const r = JSON.parse(execFileSync('node', ['tools/ckext.mjs', 'test', out, '--json']).toString());
    if (r.badge !== 'verified') throw new Error(`ckext test: ${JSON.stringify(r).slice(0, 300)}`);
  }],
  ['builder: Use the current model as a fixture adds an example with the model on screen', async (p) => {
    await builderTab(p, 'examples');
    await p.click(`${B} button:has-text("Use the current model as a fixture")`);
    const list = JSON.parse(await p.inputValue(`${B} textarea.ext-examples`));
    const last = list[list.length - 1];
    const n = await p.evaluate(() => window.__cufsm.model.nodes.length);
    if (list.length !== 2 || !last.model || last.model.nodes.length !== n) throw new Error(`examples: ${list.length}, ${last.model?.nodes?.length} nodes vs ${n}`);
  }],
  ['builder: the draft survives a reload', async (p) => {
    await p.waitForTimeout(600);                         // past the draft-save debounce
    await p.reload();
    await p.waitForFunction(() => !!window.__cufsm?.engine, null, { timeout: 30000 });
    await extManager(p);
    await p.click('.ext-links button:has-text("New module")');
    await p.waitForSelector(`${B} textarea.ext-code`, { timeout: 10000 });
    const src = await p.inputValue(`${B} textarea.ext-code`);
    if (!src.includes('"Hello"')) throw new Error(`draft lost: ${src.slice(0, 120)}`);
    const note = await p.textContent(`${B} .ext-bstatus`);
    if (!/draft/i.test(note)) throw new Error(`no restored-draft note: "${note}"`);
    await builderTab(p, 'manifest');
    if (await p.inputValue(`${B} input[name="id"]`) !== 'smoke.builder-hello') throw new Error('manifest not in the draft');
  }],
  ['builder: Fork from an installed module opens its source, and its label change runs', async (p) => {
    await extManager(p);
    await extOpenRow(p, 'DSM compression');
    await p.click('.ext-bar button:has-text("View code")');
    await p.waitForSelector(`${B}.readonly textarea.ext-code`, { timeout: 10000 });
    if (!(await p.$eval(`${B} textarea.ext-code`, (t) => t.readOnly))) throw new Error('View code is editable');
    if (!(await p.inputValue(`${B} textarea.ext-code`)).includes('Direct Strength')) throw new Error('not the DSM source');
    await p.click(`${B} button:has-text("Fork")`);
    await p.waitForSelector(`${B}:not(.readonly) textarea.ext-code`, { timeout: 10000 });
    // the earlier draft was replaced, with an Undo offered rather than lost silently
    const t = await p.textContent('.ext-toast');
    if (!/draft/i.test(t) || !/Undo/.test(t)) throw new Error(`toast: "${t}"`);
    const src = await p.inputValue(`${B} textarea.ext-code`);
    await p.fill(`${B} textarea.ext-code`, src.replace('"title": "DSM compression"', '"title": "DSM compression (forked)"'));
    await p.click(`${B} button:has-text("Run")`);
    await p.waitForSelector(`${B} .ext-preview .mui-host:has-text("DSM compression (forked)")`, { timeout: 30000 });
    await builderTab(p, 'manifest');
    const id = await p.inputValue(`${B} input[name="id"]`);
    if (id === 'civilkit.dsm-compression') throw new Error('the fork kept the original id, so installing it would replace it');
    await p.click('.ext-back');
  }],
);

steps.push(['no Content-Security-Policy violations on a fresh load', async (p) => {
  // Registered as an init script so violations raised during the reload's own load
  // (theme, module scripts, worker, wasm) are caught, not just later ones.
  await p.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  await p.reload();
  await p.waitForFunction(() => !!window.__cufsm?.engine, null, { timeout: 30000 });
  const v = await p.evaluate(() => window.__cspViolations);
  if (v.length) throw new Error(`CSP violations: ${v.join('; ')}`);
}]);
const extManifest = (id, capabilities) => ({
  id, name: id, version: '1.0.0', civilkitApi: '^1.0',
  contributes: [{ point: 'buckling.tool', id: 'main' }], capabilities,
});
const extFixture = async (p, file, id, capabilities) => p.evaluate(async ({ file, manifest }) => {
  const main = await (await fetch(`tests/fixtures/ckext/${file}`)).text();
  const s = await window.__cufsm.ext.open({ manifest, main });
  try { return await s.check({}, { model: window.__cufsm.model, results: null }); }
  catch (e) { return { err: String((e && e.message) || e) }; }
}, { file, manifest: extManifest(id, capabilities) });

steps.push(
  ['extension: the hostile module reaches nothing and no request leaves the page', async (p) => {
    const requests = [];
    p.on('request', (r) => requests.push(r.url()));
    const out = await extFixture(p, 'hostile.py', 'test.hostile', []);
    const rows = out.result;
    const reached = rows.filter((r) => r.value === 'REACHED');
    if (reached.length) throw new Error(`sandbox escapes: ${reached.map((r) => r.label).join(', ')}`);
    const wanted = ['fetch', 'eval', 'importScripts', 'indexedDB', 'Worker', 'postMessage'];
    const got = rows.map((r) => r.label);
    for (const w of wanted) if (!got.includes(w)) throw new Error(`no result row for ${w}`);
    if (requests.some((u) => u.includes('example.com'))) throw new Error('a request left the page for example.com');
  }],
  ['extension: a spinning module is stopped, and the next module still works', async (p) => {
    await p.goto(`${p.url()}${p.url().includes('?') ? '&' : '?'}extTimeout=2000`);
    await p.waitForFunction(() => !!window.__cufsm?.engine, null, { timeout: 30000 });
    const spun = await extFixture(p, 'spin.py', 'test.spin', []);
    if (spun.err !== 'The module stopped responding and was stopped.')
      throw new Error(`expected the stop error, got: ${JSON.stringify(spun)}`);
    const banner = await p.evaluate(() => window.__cufsm.ext.banner());
    if (!banner.includes('stopped responding')) throw new Error(`no banner: "${banner}"`);
    const hello = await p.evaluate(async () => {
      const main = await (await fetch('tests/fixtures/ckext/hello.py')).text();
      const s = await window.__cufsm.ext.open({
        manifest: { id: 'test.hello', name: 'Hello', version: '1.0.0', civilkitApi: '^1.0',
                    contributes: [{ point: 'buckling.tool', id: 'main' }], capabilities: ['firstYield'] },
        main });
      return s.check({ fy: 50 }, { model: window.__cufsm.model, results: null });
    });
    const py = hello.result.find((r) => r.label === 'Py');
    if (!py || Math.abs(py.value - 105) > 1e-6) throw new Error(`hello after restart: ${JSON.stringify(hello)}`);
  }],
);

/* Defect 9: the test hook is ?test=1 exactly, not any query that happens to contain "test=1". */
steps.push(['the test hook ignores ?latest=1', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('?')[0].split('#')[0] + '?latest=1');
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  const r = await q.evaluate(() => ({ engine: window.__cufsm.engine, set: typeof window.__cufsm.setEngine }));
  await ctx.close();
  if (r.engine !== null || r.set !== 'undefined') throw new Error(`?latest=1 opened the test hook: ${JSON.stringify(r)}`);
}]);

/* Defect 11: a worker restart in the middle of a solve drops that solve quietly, like a cancel. */
steps.push(['a restart mid-solve is not reported as an engine error', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig && !!window.__cufsm.engine, null, { timeout: 30000 });
  const err = await q.evaluate(async () => {
    const ta = document.getElementById('lengths');
    ta.value = Array.from({ length: 400 }, (_, i) => 10 + i * 12).join('\n');
    ta.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 150));          // past the 60 ms debounce: solving now
    window.__cufsm.engine.restart();
    await window.__cufsm.idle();
    return window.__cufsm.err;
  });
  await ctx.close();
  if (err) throw new Error(`a restart surfaced as an error: ${err}`);
}]);

/* Defect 8: an 804-byte link describing 2,000 nodes tied the engine up for most of a minute;
   the link is refused with a footer note and the default section opens at once. */
steps.push(['a link to an enormous model is refused with a footer note', async (p) => {
  const n = 2000;
  const big = { v: 2,
    model: { mats: [{ id: 1, ex: 200000, ey: 200000, vx: 0.3, vy: 0.3, g: 76923.0769230769 }],
             nodes: Array.from({ length: n }, (_, i) => ({ x: i, z: (i * 7) % 13, free: [1, 1, 1, 1], stress: 1 })),
             elems: Array.from({ length: n - 1 }, (_, i) => ({ i, j: i + 1, t: 1, mat: 1 })),
             springs: [], constraints: [] },
    analysis: { solution: 'signature', lengths: [10, 100, 1000] }, ui: { tab: 'sig' } };
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  const errs = [];
  q.on('pageerror', (e) => errs.push(String(e)));
  const t0 = Date.now();
  await q.goto(p.url().split('#')[0] + await encodeState(big));
  await q.waitForFunction(() => window.__cufsm?.sig, null, { timeout: 15000 });
  const note = await q.textContent('#footerNote');
  const nodes = await q.evaluate(() => window.__cufsm.model.nodes.length);
  await ctx.close();
  if (!/too large to open: 2000 nodes; the limit is 500/.test(note)) throw new Error(`footer: ${note}`);
  if (nodes !== 21) throw new Error(`${nodes} nodes on screen, expected the default 21`);
  if (errs.length) throw new Error(`page errors: ${errs.join(' | ')}`);
  console.log(`      refused and solved the default in ${Date.now() - t0} ms`);
}]);

/* Defect 7: a link with 20 terms reopens with 20 (it was capped at 8 silently); a link whose
   values are clamped says so in the footer; the tube's p and q take whole numbers only. */
const linkModel = () => ({ mats: [{ id: 1, ex: 200000, ey: 200000, vx: 0.3, vy: 0.3, g: 76923.0769230769 }],
  nodes: [[50, 15], [50, 0], [0, 0], [0, 100], [50, 100], [50, 85]].map(([x, z]) => ({ x, z, free: [1, 1, 1, 1], stress: 1 })),
  elems: [0, 1, 2, 3, 4].map((i) => ({ i, j: i + 1, t: 1.5, mat: 1 })), springs: [], constraints: [] });
steps.push(['a link keeps 20 terms, and names what it clamps', async (p) => {
  const ctx = await p.context().browser().newContext();
  let q;
  const open = async (analysis) => {
    q = await ctx.newPage();                                   // a hash-only goto would not reload
    await q.goto(p.url().split('#')[0] + await encodeState({ v: 2, model: linkModel(), analysis, ui: { tab: 'sig' } }));
    await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 60000 });
    return { terms: await q.inputValue('#terms'), note: await q.textContent('#footerNote') };
  };
  const a = await open({ solution: 'general', bc: 'C-C', terms: 20, lengths: [100, 1000, 3000] });
  if (a.terms !== '20') throw new Error(`terms ${a.terms}, expected 20`);
  if (/⚠/.test(a.note)) throw new Error(`a clean link shows a warning: ${a.note}`);
  const b = await open({ solution: 'general', bc: 'Q-Q', terms: 150, neigs: 99, lengths: [100] });
  if (b.terms !== '100') throw new Error(`terms ${b.terms}, expected 100`);
  for (const want of [/terms 150 became 100/, /eigenvalues 99 became 50/, /boundary condition Q-Q/, /fewer than two/])
    if (!want.test(b.note)) throw new Error(`footer lacks ${want}: ${b.note}`);
  await ctx.close();
}]);
steps.push(['the tube takes whole harmonics only', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  await q.click('[data-shape="tube"]');
  await q.waitForSelector('#ft_p');
  await q.fill('#ft_p', '2.5');
  await q.$eval('#ft_p', (e) => e.blur());                 // the inline message waits for the field to be left
  await q.waitForTimeout(400);
  await q.waitForFunction(() => window.__cufsm.idle());
  const text = await q.textContent('#pane');
  const bad = await q.$eval('#ft_p', (e) => e.getAttribute('aria-invalid') === 'true'
    && /whole number/.test(e.closest('.numfield').querySelector('.msg').textContent));
  await ctx.close();
  if (/2\.5 harmonics/.test(text)) throw new Error('a fractional harmonic count reached the solve');
  if (!bad) throw new Error('the input does not say 2.5 is refused');
}]);

/* Defect 2: after the length list changes, the mode browser re-selects by length - the length it
   shows (and the report prints) is the highlighted minimum's, not whatever now sits at the old
   list index. */
steps.push(['the mode browser follows the minimum, not the old index, when lengths change', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  await q.click('[data-tab="mode"]');
  await q.waitForSelector('#pane .chip.sel');
  await q.click('#pane [data-min="1"]');                    // the second minimum
  await q.waitForFunction(() => /L = \d+ mm/.test(document.getElementById('pane').textContent));
  await q.fill('#Lmin', '5'); await q.fill('#Lmax', '800');
  await q.click('#fillLog');
  await q.waitForFunction(() => Math.round(window.__cufsm.sig?.pts[0].L) === 5, null, { timeout: 30000 });
  // the pane re-renders after the solve lands (it asks the worker for the modes first)
  await q.waitForFunction(() => {
    const L = +(/L = (\d+) mm/.exec(document.getElementById('pane').textContent)?.[1]);
    return L > 0 && L <= 800;
  }, null, { timeout: 30000 });
  const r = await q.evaluate(async () => {
    const chip = document.querySelector('#pane .chip.sel')?.textContent || '';
    const shown = /L = (\d+) mm/.exec(document.getElementById('pane').textContent)?.[1];
    const html = await window.__cufsm.buildReportHtml();
    const rep = /8 Mode shape \(L = (\d+) mm/.exec(html)?.[1];
    return { chip, shown, rep };
  });
  await ctx.close();
  const chipL = /@ (\d+) mm/.exec(r.chip)?.[1];
  if (!chipL || chipL !== r.shown || r.rep !== r.shown)
    throw new Error(`chip "${r.chip}", browser shows L = ${r.shown} mm, report L = ${r.rep} mm`);
}]);

/* Defect 3: the 2D mode shape's deformation is drawn relative to the section's size (about 10 %
   of it at the peak), so an inch-scale section stays inside the drawing like a mm one does. */
const pasteVideo = async (q) => {
  const v = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../fixtures/video-c.json', import.meta.url)));
  await q.click('[data-tab="tables"]');
  await q.click('#pasteCufsm');
  await q.fill('#pasteProp', v.prop); await q.fill('#pasteNode', v.node); await q.fill('#pasteElem', v.elem);
  await q.click('#pasteApply');
  await q.waitForFunction(() => window.__cufsm.model.nodes.length === 10);
};
const deformedReach = (q) => q.evaluate(async () => {
  await window.__cufsm.idle();
  const svg = document.getElementById('modeSvg');
  const vb = svg.viewBox.baseVal;
  const pts = (sel) => [...svg.querySelectorAll(sel)].flatMap((e) => e.getAttribute('points').trim().split(/\s+/)
    .map((s) => s.split(',').map(Number)));
  const und = pts('polyline.undeformed'), def = pts('polyline.deformed');
  const xs = und.map((p) => p[0]), ys = und.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const out = def.filter(([x, y]) => x < 0 || y < 0 || x > vb.width || y > vb.height).length;
  return { size, out, n: def.length, vb: [vb.width, vb.height] };
});
steps.push(['the 2D mode shape stays in the drawing for mm and inch sections', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  const run = async (label) => {
    await q.click('[data-tab="mode"]');
    await q.click('#playBtn').catch(() => {});                   // pause: the phase stays put
    await q.evaluate(() => { const s = document.getElementById('scrub'); s.value = 0; s.dispatchEvent(new Event('input')); });
    await q.waitForSelector('#modeSvg polyline.deformed');
    const r = await deformedReach(q);
    if (!r.n) throw new Error(`${label}: no deformed shape`);
    if (r.out) throw new Error(`${label}: ${r.out} of ${r.n} deformed points outside the ${r.vb.join('x')} drawing`);
    return r;
  };
  await run('default mm section');
  await pasteVideo(q);
  await q.waitForFunction(() => window.__cufsm.sig && window.__cufsm.sig.em.nodes === 10, null, { timeout: 30000 });
  await run('inch tutorial C');
  await ctx.close();
}]);

/* Defects 1 and 4: a CUFSM paste brings its own stresses. The Loads panel and the report then
   show the actions the engine fits to those stresses (not the previous section's P = A), and the
   length list is recommended for the pasted model, so the video C's local minimum near L = 5 is
   on the curve. */
steps.push(['a paste fits the loads to its stresses and recommends its lengths', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  await pasteVideo(q);
  await q.waitForFunction(() => window.__cufsm.sig && window.__cufsm.sig.em.nodes === 10, null, { timeout: 30000 });
  await q.evaluate(() => window.__cufsm.idle());
  const st = await q.evaluate(() => ({ s: window.__cufsm.model.nodes.map((n) => n.stress), L: { ...window.__cufsm.loads },
    lens: window.__cufsm.sig.pts.map((x) => x.L), minima: window.__cufsm.sig.minima.map((i) => window.__cufsm.sig.pts[i].L) }));
  if (Math.abs(st.s[1] + 50) > 1e-9 || Math.abs(st.s[8] - 50) > 1e-9) throw new Error(`pasted stresses changed: ${st.s}`);
  if (!(Math.abs(st.L.M11 - 328.25) < 1e-3 * 328.25)) throw new Error(`M11 ${st.L.M11}, expected the fit 328.25`);
  if (!(Math.abs(st.L.P) < 1e-6)) throw new Error(`P ${st.L.P}, expected about 0 for pure bending`);
  await q.click('[data-tab="loads"]');
  await q.waitForSelector('#pane #loadFit');
  const fitNote = await q.textContent('#pane #loadFit');
  if (!/pasted stresses/.test(fitNote)) throw new Error(`no fit note on the Loads panel: ${fitNote}`);
  const shownM11 = +(await q.inputValue('#M11'));
  if (Math.abs(shownM11 - st.L.M11) > 1e-6 * Math.abs(st.L.M11)) throw new Error(`M11 input ${shownM11}`);
  const html = await q.evaluate(() => window.__cufsm.buildReportHtml());
  if (!/pasted stresses/.test(html)) throw new Error('the report does not say the loads are a fit to the pasted stresses');
  if (/<td>P<\/td><td>525/.test(html)) throw new Error('the report still prints the previous P = 525');
  if (!(st.lens[0] <= 2 && st.lens.at(-1) >= 1000)) throw new Error(`lengths ${st.lens[0]} .. ${st.lens.at(-1)} not recommended`);
  if (!st.minima.some((L) => L > 2 && L < 10)) throw new Error(`no local minimum near L = 5: ${st.minima}`);
  await ctx.close();
}]);

/* Defect 6: with General BC the chart's x axis is the physical (member) length, and minimum
   labels that would print over each other are moved or left to the list under the chart. */
const chartLabels = (q, sel) => q.evaluate((sel) => {
  const svg = document.querySelector(sel);
  const boxes = [...svg.querySelectorAll('text.mlabel')].map((t) => { const b = t.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height, t.textContent]; });
  const hit = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) hit.push(`${a[4]} / ${b[4]}`);
  }
  const vb = svg.viewBox.baseVal;
  const outside = boxes.filter((b) => b[0] < 0 || b[2] > vb.width || b[1] < 0 || b[3] > vb.height).map((b) => b[4]);
  return { n: boxes.length, hit, outside, x: [...svg.querySelectorAll('text.axlabel')].map((t) => t.textContent) };
}, sel);
steps.push(['General BC: the x axis says physical length and minimum labels do not overprint', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  const sigRun = await chartLabels(q, '#sigChart');
  if (!sigRun.x.some((t) => /half-wavelength/.test(t))) throw new Error(`signature axis: ${sigRun.x}`);
  await q.check('#solGeneral'); await q.selectOption('#bc', 'S-S'); await q.fill('#terms', '8');
  await q.waitForFunction(() => window.__cufsm.sig && window.__cufsm.sig.pts.length && document.querySelector('#sigChart'));
  await q.evaluate(() => window.__cufsm.idle());
  await q.waitForSelector('#sigChart text.mlabel');
  const r = await chartLabels(q, '#sigChart');
  await ctx.close();
  if (!r.x.some((t) => /physical length/.test(t)) || r.x.some((t) => /half-wavelength/.test(t)))
    throw new Error(`General BC x axis reads: ${r.x}`);
  if (r.hit.length) throw new Error(`overprinting minimum labels: ${r.hit.join('; ')}`);
  if (r.outside.length) throw new Error(`labels outside the chart: ${r.outside.join('; ')}`);
}]);

/* Defect 13: General BC, S-S, 8 terms - the recurring local minimum is one entry, not eight. */
steps.push(['a recurring local minimum is listed once', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  await q.check('#solGeneral'); await q.selectOption('#bc', 'S-S'); await q.fill('#terms', '8');
  await q.waitForTimeout(200);
  await q.evaluate(() => window.__cufsm.idle());
  const rows = await q.$$eval('#pane .readout > div', (d) => d.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  const local = rows.filter((r) => /^local minimum/.test(r));
  await ctx.close();
  if (local.length !== 1) throw new Error(`${local.length} local-minimum rows: ${rows.join(' | ')}`);
  if (!/recurs/.test(local[0])) throw new Error(`the row does not say the mode recurs: ${local[0]}`);
}]);

/* Defect 12: on a phone only the app bar's first row (all tools, brand, theme) stays pinned; the
   Copy link | Report row scrolls away with the page instead of holding ~165 px of the screen. */
steps.push(['phone: only the first app-bar row is sticky', async (p) => {
  const { devices } = await import('playwright');
  const ctx = await p.context().browser().newContext({ ...devices['iPhone 15 Pro'] });
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  const top0 = await q.evaluate(() => document.getElementById('shareBtn').getBoundingClientRect().top);
  await q.evaluate(() => window.scrollTo(0, 800));
  await q.waitForTimeout(150);
  const r = await q.evaluate(() => {
    const rect = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
    return { brand: rect(document.querySelector('.brand')), theme: rect(document.getElementById('themeBtn')),
             share: rect(document.getElementById('shareBtn')), report: rect(document.getElementById('reportBtn')),
             y: scrollY };
  });
  await ctx.close();
  if (r.y < 400) throw new Error(`the page did not scroll (${r.y})`);
  if (r.brand.top < 0 || r.theme.top < 0) throw new Error(`the first row scrolled away: ${JSON.stringify(r)}`);
  if (r.share.bottom > 0 || r.report.bottom > 0) throw new Error(`Copy link / Report stayed on screen: ${JSON.stringify(r)} (started at ${top0})`);
  if (r.theme.bottom > 80) throw new Error(`the pinned bar is ${r.theme.bottom} px tall`);
}]);

/* Defect 14: after Use it (and after Undo) the module's own drawing of the current section shows
   the section now in the analysis, not the one it was drawn from. */
steps.push(['extensions: the module drawing follows Use it and Undo', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  await extDrop(q, 'propose.ckext');
  await q.waitForSelector('.ext-installed .ext-row:has-text("Propose")', { timeout: 15000 });
  await extOpenRow(q, 'Propose');
  const nodes = () => q.$$eval('.ext-module svg.sect:not(.ext-prop-svg) circle.node', (c) => c.length);
  await q.waitForSelector('.ext-module svg.sect circle.node', { timeout: 15000 });
  const before = await nodes();
  await q.click('.ext-module .mui-button:has-text("Run")');
  await q.click('.ext-proposal button:has-text("Use it")', { timeout: 30000 });
  await q.waitForFunction(() => window.__cufsm.model.nodes.length === 3, null, { timeout: 15000 });
  await q.waitForTimeout(200);
  const used = await nodes();
  await q.click('.ext-toast button:has-text("Undo")');
  await q.waitForFunction((n) => window.__cufsm.model.nodes.length === n, before, { timeout: 15000 });
  await q.waitForTimeout(200);
  const undone = await nodes();
  await ctx.close();
  if (before !== 21) throw new Error(`the module drew ${before} nodes at first, expected the default 21`);
  if (used !== 3) throw new Error(`after Use it the module still draws ${used} nodes, not the proposal's 3`);
  if (undone !== 21) throw new Error(`after Undo the module draws ${undone} nodes, not 21`);
}]);

/* Defect 5: the report's Python is a cufsm-rs-py script that rebuilds the model on screen. */
steps.push(['the report\'s Python rebuilds the model for cufsm-rs-py', async (p) => {
  const ctx = await p.context().browser().newContext();
  const q = await ctx.newPage();
  await q.goto(p.url().split('#')[0]);
  await q.waitForFunction(() => !!window.__cufsm?.sig, null, { timeout: 30000 });
  const html = await q.evaluate(() => window.__cufsm.buildReportHtml());
  await ctx.close();
  const pre = /<pre>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? '';
  if (!/^import cufsm_rs$/m.test(pre)) throw new Error('no import cufsm_rs');
  if (/mesh=|cufsm\.model\(/.test(pre)) throw new Error('the old made-up API is still there');
  if ((pre.match(/^ {4}\[\d+, [-\d.e]+, [-\d.e]+, [01], [01], [01], [01], /mg) || []).length !== 21)
    throw new Error('the node table does not have the 21 default nodes');
}]);
