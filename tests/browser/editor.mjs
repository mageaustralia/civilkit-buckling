/* The builder's Python editor, driven: highlighting spans as you type, Tab / Shift-Tab / Enter
   indentation, Cmd-Enter runs into the preview, a deliberate error marks its line (from Run and
   from Test), and View code -> Edit & run opens a fork in the builder. Desktop light and dark and
   an iPhone 13. Screenshots go to SHOTS (default tests/browser/shots/editor). */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL || 'http://localhost:8765/?test=1';
const SHOTS = process.env.SHOTS || 'tests/browser/shots/editor';
mkdirSync(SHOTS, { recursive: true });
const B = '.ext-builder';
const TA = `${B} textarea.ext-code`;

const cases = [
  ['desktop-light', { viewport: { width: 1440, height: 900 }, colorScheme: 'light' }],
  ['desktop-dark', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }],
  ['iphone13', { ...devices['iPhone 13'], colorScheme: 'light' }],
];

const browser = await chromium.launch();
let failed = 0;
for (const [name, opts] of cases) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  const step = async (label, fn) => {
    try { await fn(); console.log('ok  ', name, label); } catch (e) {
      failed++; console.log('FAIL', name, label, String(e.message || e).split('\n')[0]);
      await p.screenshot({ path: `${SHOTS}/${name}-FAIL.png` }).catch(() => {});
    }
  };
  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  await p.evaluate(() => localStorage.removeItem('civilkit-buckling.builder-draft'));
  const mod = (await p.evaluate(() => navigator.platform)).startsWith('Mac') ? 'Meta' : 'Control';
  const toExt = async () => {
    const back = await p.$('.ext-back');
    if (back) await back.click();
    if (await p.isVisible('.tab[data-tab="extensions"]')) await p.click('.tab[data-tab="extensions"]');
    else { await p.click('.tabbar [data-go=more]'); await p.click('[data-more=extensions]'); }
    await p.waitForSelector('.ext-mgr .ext-store', { timeout: 15000 });
  };

  await step('New module opens the editor with highlighted starter code', async () => {
    await toExt();
    await p.click('.ext-links button:has-text("New module")');
    await p.waitForSelector(`${B} .ck-pre .py-kw`, { timeout: 10000 });
    const kinds = await p.$$eval(`${B} .ck-pre span`, (s) => [...new Set(s.map((e) => e.className))]);
    for (const k of ['py-kw', 'py-str', 'py-comment', 'py-def', 'py-call', 'py-builtin', 'py-num'])
      if (!kinds.includes(k)) throw new Error(`no ${k} in ${kinds}`);
    const same = await p.$eval(TA, (t) => t.value === document.querySelector('.ext-builder .ck-pre').textContent);
    if (!same) throw new Error('highlighted text differs from the textarea');
    const lines = await p.$$eval(`${B} .ck-gut-in > div`, (d) => d.length);
    const want = (await p.inputValue(TA)).split('\n').length;
    if (lines !== want) throw new Error(`${lines} gutter lines, ${want} in the text`);
    await p.screenshot({ path: `${SHOTS}/${name}-starter.png` });
  });

  await step('typing highlights; Enter keeps and adds indentation; Tab and Shift-Tab', async () => {
    await p.fill(TA, '');
    await p.focus(TA);
    await p.keyboard.type('def f(x):');
    await p.keyboard.press('Enter');
    let v = await p.inputValue(TA);
    if (v !== 'def f(x):\n    ') throw new Error(`after Enter: ${JSON.stringify(v)}`);
    await p.keyboard.type('y = 1  # one');
    await p.keyboard.press('Enter');
    v = await p.inputValue(TA);
    if (!v.endsWith('# one\n    ')) throw new Error(`indent not kept: ${JSON.stringify(v)}`);
    await p.keyboard.press('Shift+Tab');
    v = await p.inputValue(TA);
    if (!v.endsWith('# one\n')) throw new Error(`Shift-Tab: ${JSON.stringify(v)}`);
    await p.keyboard.press('Tab');
    await p.keyboard.type('return "s#"');
    await p.waitForTimeout(50);
    const html = await p.$eval(`${B} .ck-pre code`, (c) => c.innerHTML);
    for (const frag of ['<span class="py-kw">def</span>', '<span class="py-def">f</span>', '<span class="py-num">1</span>',
                        '<span class="py-comment"># one</span>', '<span class="py-str">"s#"</span>'])
      if (!html.includes(frag)) throw new Error(`missing ${frag} in ${html}`);
    await p.keyboard.press(`${mod}+z`);
    const undone = await p.inputValue(TA);
    if (undone === await p.evaluate(() => 0) || undone.endsWith('return "s#"')) throw new Error('undo did nothing');
  });

  await step('Cmd/Ctrl-Enter runs the starter and the preview renders', async () => {
    await p.click(`${B} .ext-btab[data-btab="manifest"]`);
    await p.click(`${B} .ext-btab[data-btab="main"]`);
    await p.evaluate(() => localStorage.removeItem('civilkit-buckling.builder-draft'));
    const { STARTER_MAIN } = await p.evaluate(async () => import('./js/ext/builder.js').then((m) => ({ STARTER_MAIN: m.STARTER_MAIN })));
    await p.fill(TA, STARTER_MAIN.replace('"My module"', '"Editor module"'));
    await p.focus(TA);
    await p.keyboard.press(`${mod}+Enter`);
    await p.waitForSelector(`${B} .ext-preview .mui-host:has-text("Editor module")`, { timeout: 30000 });
    await p.click(`${B} .ext-preview .mui-button:has-text("Run")`);
    await p.waitForSelector(`${B} .ext-preview .mui-result-item:has-text("Py")`, { timeout: 30000 });
    if (await p.$(`${B} .ck-band:not([hidden])`)) throw new Error('error band on a clean run');
  });

  await step('an error in check marks its line; the next edit clears it', async () => {
    const src = await p.inputValue(TA);
    const lines = src.split('\n');
    const at = lines.findIndex((l) => l.includes('props = call("sectionProps"'));
    lines.splice(at, 0, '    boom = 1 / 0');
    await p.fill(TA, lines.join('\n'));
    await p.focus(TA);
    await p.keyboard.press(`${mod}+Enter`);
    await p.waitForSelector(`${B} .ext-preview .mui-button:has-text("Run")`, { timeout: 30000 });
    await p.click(`${B} .ext-preview .mui-button:has-text("Run")`);
    await p.waitForSelector(`${B} .ck-msg:not([hidden])`, { timeout: 30000 });
    const msg = await p.textContent(`${B} .ck-msg`);
    if (!msg.startsWith(`Line ${at + 1}:`) || !/ZeroDivisionError/.test(msg)) throw new Error(`message "${msg}", want line ${at + 1}`);
    const g = await p.$eval(`${B} .ck-gut-in > div.ck-errline`, (d) => d.textContent);
    if (g !== String(at + 1)) throw new Error(`gutter mark on ${g}`);
    await p.screenshot({ path: `${SHOTS}/${name}-error.png` });
    await p.focus(TA);
    await p.keyboard.type(' ');
    if (await p.$(`${B} .ck-band:not([hidden])`) || await p.$(`${B} .ck-msg:not([hidden])`)) throw new Error('mark kept after an edit');
  });

  await step('Test marks the line an example fails on', async () => {
    await p.click(`${B} .ext-btab[data-btab="examples"]`);
    await p.click(`${B} button:has-text("Use the current model as a fixture")`);
    await p.click(`${B} button:has-text("Test")`);
    await p.waitForSelector(`${B} .ck-msg:not([hidden])`, { timeout: 30000 });
    const msg = await p.textContent(`${B} .ck-msg`);
    if (!/^Line \d+: worked example example-1: ZeroDivisionError/.test(msg)) throw new Error(`message "${msg}"`);
    if (!(await p.isVisible(TA))) throw new Error('main.py tab not shown');
  });

  await step('full view: a modal with the editor and the preview; Run updates it; Esc closes with the draft intact', async () => {
    await p.click(`${B} .ext-btab[data-btab="main"]`);
    const { STARTER_MAIN } = await p.evaluate(async () => import('./js/ext/builder.js').then((m) => ({ STARTER_MAIN: m.STARTER_MAIN })));
    await p.fill(TA, STARTER_MAIN.replace('"My module"', '"Full view module"'));
    const before = await p.inputValue(TA);
    await p.click(`${B} button.ck-expand`);
    const d = await p.$eval(B, (e) => ({ full: e.classList.contains('ck-full'), role: e.getAttribute('role'), modal: e.getAttribute('aria-modal'),
      parent: e.parentNode === document.body, lock: getComputedStyle(document.documentElement).overflow, focusIn: e.contains(document.activeElement) }));
    if (!d.full || d.role !== 'dialog' || d.modal !== 'true' || !d.parent || d.lock !== 'hidden' || !d.focusIn) throw new Error(`overlay: ${JSON.stringify(d)}`);
    await p.focus(TA);
    await p.keyboard.press(`${mod}+Enter`);
    await p.waitForSelector(`${B} .ext-preview .mui-host:has-text("Full view module")`, { timeout: 30000 });
    const r = await p.evaluate(() => {
      const q = (s) => document.querySelector(s).getBoundingClientRect();
      const ed = q('.ext-builder .ck-ed'), pv = q('.ext-builder .ext-preview');
      return { ed: [ed.left, ed.right, ed.top, ed.bottom], pv: [pv.left, pv.right, pv.top, pv.bottom], w: innerWidth, h: innerHeight };
    });
    if (r.w >= 900) {
      if (!(r.pv[0] >= r.ed[1] - 1 && r.ed[3] <= r.h + 1 && r.pv[2] < r.h)) throw new Error(`not side by side: ${JSON.stringify(r)}`);
    } else if (!(r.pv[2] >= r.ed[3] - 1)) throw new Error(`not stacked: ${JSON.stringify(r)}`);
    if (r.ed[1] - r.ed[0] < (r.w >= 900 ? 700 : r.w - 40)) throw new Error(`editor only ${r.ed[1] - r.ed[0]} px wide`);
    // Tab past the last control and Shift-Tab before the first stay inside the dialog
    const ends = `[...document.querySelectorAll('.ext-builder button, .ext-builder input, .ext-builder textarea')].filter((x) => !x.disabled && x.offsetParent)`;
    await p.evaluate(`(${ends}).at(-1).focus()`);
    await p.keyboard.press('Tab');
    const t1 = await p.evaluate(`document.activeElement === (${ends})[0]`);
    await p.keyboard.press('Shift+Tab');
    const t2 = await p.evaluate(`document.activeElement === (${ends}).at(-1)`);
    if (!t1 || !t2) throw new Error(`focus trap: wrap forward ${t1}, back ${t2}`);
    await p.screenshot({ path: `${SHOTS}/${name}-fullview.png` });
    await p.keyboard.press('Escape');
    const after = await p.$eval(B, (e) => ({ full: e.classList.contains('ck-full'), parent: e.parentNode === document.body && document.body.dataset.layout !== 'compact',
      lock: document.documentElement.classList.contains('ck-lock'), role: e.getAttribute('role') }));
    if (after.full || after.lock || after.role || after.parent) throw new Error(`after Esc: ${JSON.stringify(after)}`);
    if (await p.inputValue(TA) !== before) throw new Error('draft changed');
    if (!(await p.$(`${B} .ext-preview .mui-host:has-text("Full view module")`))) throw new Error('preview lost');
    const pref = await p.evaluate(() => localStorage.getItem('civilkit-buckling.builder-full'));
    if (pref !== '0') throw new Error(`remembered ${pref}`);
  });

  await step('View code shows highlighted read-only code; Edit & run opens a running fork', async () => {
    await toExt();
    await p.click('.ext-store button:has-text("Install")').catch(() => {});
    const row = p.locator('.ext-installed .ext-row', { hasText: 'DSM compression' }).first();
    await row.waitFor({ timeout: 30000 });
    await row.locator('button', { hasText: 'Open' }).click();
    await p.click('.ext-bar button:has-text("View code")');
    await p.waitForSelector(`${B}.readonly .ck-pre .py-kw`, { timeout: 10000 });
    if (!(await p.$eval(TA, (t) => t.readOnly))) throw new Error('View code is editable');
    await p.screenshot({ path: `${SHOTS}/${name}-viewcode.png` });
    await p.click(`${B} button:has-text("Edit & run")`);
    await p.waitForSelector(`${B}:not(.readonly) .ck-pre .py-kw`, { timeout: 10000 });
    await p.waitForSelector(`${B} .ext-preview .mui-host:has-text("DSM compression")`, { timeout: 30000 });
    const id = await p.evaluate(() => JSON.parse(localStorage.getItem('civilkit-buckling.builder-draft')).manifest.id);
    if (!id.endsWith('-fork')) throw new Error(`fork id ${id}`);
    await p.screenshot({ path: `${SHOTS}/${name}-fork.png` });
  });

  if (errs.length) { failed++; console.log('FAIL', name, 'page errors:', errs.slice(0, 3).join(' | ')); }
  await ctx.close();
}
await browser.close();
if (failed) process.exitCode = 1;
