/* Accessibility and touch polish, in headless Chromium.

     BASE_URL=http://localhost:8765/ node tests/browser/a11y.mjs        (npm run a11y)

   axe-core (a devDependency, MPL-2.0, used unmodified by the tests only and never shipped) runs on
   every view: each phone tab and its sub-views on an iPhone 15 Pro, each desktop tab in light and
   in dark, and the open sheets and dialogs; a serious or critical violation fails. Then the checks
   axe cannot make: the sheets are modal dialogs that take the focus and give it back, the tab bar's
   tabs control their panels, the signature chart has a summary and a table of its minima, every
   keyboard stop shows its focus, a keyboard alone gets from a shape to the governing minimum's
   mode, reduced motion stops the mode animation, and on a touch screen every target is 48 px. Every
   guide page passes axe in light and dark, on a desktop and a phone, with no sideways scroll. */
import { chromium, devices } from 'playwright';
import { readFileSync, readdirSync } from 'node:fs';

const BASE = (process.env.BASE_URL || 'http://localhost:8765/').replace(/\?.*$/, '') + '?test=1';
const AXE = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const SHOTS = process.env.SHOTS || 'tests/browser/shots';
let failed = 0;
const check = (ok, name, detail = '') => {
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? (typeof detail === 'string' && detail.length < 120 ? detail : '') : detail);
  if (!ok) failed++;
};
const ready = async (p) => {
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig?.pts?.length, null, { timeout: 60000 });
  await p.evaluate(() => window.__cufsm.idle());
};
async function axe(p, label) {
  if (!(await p.evaluate(() => !!window.axe))) await p.evaluate(AXE);
  const r = await p.evaluate(async () => {
    const res = await window.axe.run(document, { resultTypes: ['violations'] });
    return res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  });
  check(!r.length, `axe: ${label}`, r.join('\n       '));
}
const newPage = async (browser, opts) => {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(String(e)));
  await p.goto(BASE);
  await ready(p);
  return p;
};

const browser = await chromium.launch();
try {
  /* ------------------------------------------------------------ phone */
  {
    const p = await newPage(browser, { ...devices['iPhone 15 Pro'] });
    const views = [['section'], ['loads'], ['curve', 'sig'], ['curve', 'cfsm'], ['modes', 'mode'], ['modes', 'mode3d'],
      ['more', 'projects'], ['more', 'tables'], ['more', 'extensions'], ['more', 'python']];
    for (const [go, more] of views) {
      await p.click(`.tabbar [data-go="${go}"]`);
      if (more) await p.click(`.morenav[data-for="${go}"] [data-more="${more}"]`);
      await p.evaluate(() => window.__cufsm.idle());
      await p.waitForTimeout(150);
      await axe(p, `phone ${go}${more ? ' › ' + more : ''}`);
      // 48 px targets on a coarse pointer, everything visible and interactive in this view
      const small = await p.$$eval('button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button], summary',
        (els) => els.filter((e) => {
          if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false;
          const r = e.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          if (e.matches('input[type=radio], input[type=checkbox]') && e.closest('label')) {
            const l = e.closest('label').getBoundingClientRect();
            return l.height < 47.5 || l.width < 47.5;
          }
          if (e.closest('.ext-codearea, .cm, textarea') && e.tagName === 'TEXTAREA') return false;
          // a small mark with a larger hit area: an absolutely placed ::before reaching past its box
          const b = getComputedStyle(e, '::before');
          const grow = b.content !== 'none' && b.position === 'absolute' ? Math.max(0, -parseFloat(b.top) || 0) * 2 : 0;
          return r.height + grow < 47.5 || r.width + grow < 47.5;
        }).map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
      check(!small.length, `phone ${go}${more ? ' › ' + more : ''}: 48 px targets`, [...new Set(small)].slice(0, 10).join(', '));
    }
    // the tab bar's tabs control their panels
    const tabs = await p.$$eval('.tabbar [role=tab]', (bs) => bs.map((b) => {
      const id = b.getAttribute('aria-controls');
      return { go: b.dataset.go, id, ok: !!id && id.split(' ').every((i) => document.getElementById(i)) };
    }));
    check(tabs.every((t) => t.ok), 'the tab bar\'s tabs carry aria-controls to real panels', JSON.stringify(tabs));
    // the node sheet, opened from the Model sheet's list by a tap: a modal dialog with the focus
    await p.click('.tabbar [data-go="section"]');
    await p.click('#modelBtn');
    await p.waitForSelector('#modelSheet:not([hidden])');
    await axe(p, 'phone model sheet');
    const sheet = async (sel) => p.$eval(sel, (el) => ({
      role: el.getAttribute('role'), modal: el.getAttribute('aria-modal'),
      focusIn: el.contains(document.activeElement), label: !!(el.getAttribute('aria-labelledby') || el.getAttribute('aria-label')),
    }));
    let s = await sheet('#modelSheet');
    check(s.role === 'dialog' && s.modal === 'true' && s.focusIn && s.label, 'the model sheet is a labelled modal dialog holding the focus', JSON.stringify(s));
    await p.click('#mlistSeg [data-mlist="nodes"]');
    await p.click('#mlist button >> nth=0');
    await p.waitForSelector('#nodeSheet:not([hidden])');
    s = await sheet('#nodeSheet');
    check(s.role === 'dialog' && s.modal === 'true' && s.focusIn && s.label, 'the node sheet is a labelled modal dialog holding the focus', JSON.stringify(s));
    await axe(p, 'phone node sheet');
    await p.screenshot({ path: `${SHOTS}/a11y-node-sheet-iPhone-15-Pro.png` });
    await p.keyboard.press('Escape');
    await p.waitForSelector('#nodeSheet', { state: 'hidden', timeout: 3000 }).catch(() => {});
    const back = await p.evaluate(() => ({ closed: document.getElementById('nodeSheet').hidden,
      focusInModel: document.getElementById('modelSheet').contains(document.activeElement) }));
    check(back.closed && back.focusInModel, 'Esc closes the node sheet and the focus goes back to its row', JSON.stringify(back));
    await p.keyboard.press('Escape');
    await p.waitForSelector('#modelSheet', { state: 'hidden', timeout: 3000 }).catch(() => {});
    const back2 = await p.evaluate(() => ({ closed: document.getElementById('modelSheet').hidden, active: document.activeElement?.id }));
    check(back2.closed && back2.active === 'modelBtn', 'Esc closes the model sheet and the focus goes back to Model ▴', JSON.stringify(back2));
    check(!p.errs.length, 'no page errors (phone)', p.errs.join(' | '));
    await p.context().close();
  }

  /* ------------------------------------------------------------ desktop, light and dark */
  for (const scheme of ['light', 'dark']) {
    const p = await newPage(browser, { viewport: { width: 1280, height: 900 }, colorScheme: scheme });
    for (const t of ['sig', 'mode', 'mode3d', 'loads', 'cfsm', 'tables', 'extensions', 'python', 'projects']) {
      await p.click(`.tab[data-tab="${t}"]`);
      await p.evaluate(() => window.__cufsm.idle());
      await p.waitForTimeout(150);
      await axe(p, `desktop ${scheme} ${t}`);
    }
    if (scheme === 'light') {
      // the chart's text alternative: a summary naming the governing minimum and a table of the minima
      await p.click('.tab[data-tab="sig"]');
      const ch = await p.evaluate(() => {
        const svg = document.getElementById('sigChart');
        const tbl = document.getElementById('sigTable');
        return { role: svg.getAttribute('role'), label: svg.getAttribute('aria-label') || '',
          rows: tbl ? tbl.querySelectorAll('tbody tr').length : -1, minima: window.__cufsm.sig.minima.length,
          hidden: !!tbl?.closest('.sr-only') && tbl.closest('.sr-only').getBoundingClientRect().width <= 1 };
      });
      check(ch.role === 'img' && /governing|minimum/i.test(ch.label) && ch.rows > 0 && ch.hidden,
        'the signature chart is an image with a summary and a hidden table of its minima', JSON.stringify(ch));

      // the keyboard's scrub: Home, → read points; End then Enter selects the last minimum
      await p.focus('#sigChart');
      await p.keyboard.press('Home');
      const r0 = await p.textContent('#chartReadout');
      await p.keyboard.press('ArrowRight');
      const r1 = await p.textContent('#chartReadout');
      await p.keyboard.press('End');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(200);
      const scrub = await p.evaluate(() => ({ sel: window.__cufsm.selMin, last: window.__cufsm.sig.minima.length - 1,
        lastIsEnd: window.__cufsm.sig.minima.at(-1) === window.__cufsm.sig.pts.length - 1,
        focus: document.activeElement?.id }));
      check(/^L \d+ mm/.test(r0) && r1 !== r0 && (!scrub.lastIsEnd || scrub.sel === scrub.last) && scrub.focus === 'sigChart',
        'the chart reads point by point from the keyboard, and Enter selects a minimum', JSON.stringify({ r0, r1, ...scrub }));

      // every keyboard stop shows its focus (first 60 stops from the top)
      await p.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
      const noRing = [];
      for (let i = 0; i < 60; i++) {
        await p.keyboard.press('Tab');
        const f = await p.evaluate(() => {
          const e = document.activeElement;
          if (!e || e === document.body) return null;
          const cs = getComputedStyle(e);
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
          const box = e.closest('.inp, .seg label');
          const boxRing = box && (getComputedStyle(box).borderColor !== getComputedStyle(box.parentElement).borderColor
            || getComputedStyle(box).outlineStyle !== 'none');
          return { ring: ring || !!boxRing, name: `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${String(e.className).split(' ')[0]}` };
        });
        if (f && !f.ring) noRing.push(f.name);
      }
      check(!noRing.length, 'every keyboard stop shows a focus ring', [...new Set(noRing)].join(', '));

      // keyboard only: pick the Z shape, read the governing minimum, show its mode
      await p.focus('.shape[data-shape="z"]');
      await p.keyboard.press('Enter');
      await ready(p);
      await p.click('.tab[data-tab="sig"]');
      // the last minimum's chip, by Tab from the first (the focus stays on the chips as they re-render)
      await p.focus('.minrow [data-min="0"]');
      const nMin = await p.$$eval('.minrow [data-min]', (b) => b.length);
      for (let k = 1; k < nMin; k++) await p.keyboard.press('Tab');
      await p.keyboard.press('Enter');
      const onChip = await p.evaluate(() => document.activeElement?.dataset.min);
      while (await p.evaluate(() => document.activeElement?.id !== 'showMode')) await p.keyboard.press('Tab');
      await p.keyboard.press('Enter');
      await p.waitForSelector('#modeSvg[role=img]', { timeout: 10000 }).catch(() => {});
      const kb = await p.evaluate(() => ({ shape: document.querySelector('.shape.on')?.dataset.shape,
        selMin: window.__cufsm.selMin, label: document.getElementById('modeSvg')?.getAttribute('aria-label'),
        focusInPane: document.getElementById('pane').contains(document.activeElement) }));
      check(kb.shape === 'z' && onChip === String(nMin - 1) && kb.selMin === nMin - 1 && /mode \d+ of/.test(kb.label || '') && kb.focusInPane,
        'keyboard alone: a shape, the last minimum, its mode (the focus kept in the pane)', JSON.stringify({ ...kb, onChip }));
    }
    check(!p.errs.length, `no page errors (desktop ${scheme})`, p.errs.join(' | '));
    await p.screenshot({ path: `${SHOTS}/a11y-desktop-${scheme}.png` });
    await p.context().close();
  }

  /* ------------------------------------------------------------ the builder's full view */
  {
    const p = await newPage(browser, { viewport: { width: 1280, height: 900 } });
    await p.click('.tab[data-tab="extensions"]');
    await p.waitForSelector('.ext-mgr', { timeout: 15000 });
    const nb = p.locator('.ext-mgr button', { hasText: /New module/ }).first();
    if (await nb.count()) {
      await nb.click();
      const full = p.locator('button', { hasText: /Full view/i }).first();
      if (await full.count()) {
        await full.click();
        await p.waitForTimeout(200);
        const d = await p.evaluate(() => {
          const el = document.querySelector('.ext-builder.full, [role=dialog].ext-builder, .ext-full');
          return el ? { role: el.getAttribute('role'), modal: el.getAttribute('aria-modal'), focusIn: el.contains(document.activeElement) } : null;
        });
        check(d && d.role === 'dialog' && d.modal === 'true' && d.focusIn, 'the builder\'s full view is a modal dialog holding the focus', JSON.stringify(d));
        await axe(p, 'desktop builder full view');
      }
    }
    await p.context().close();
  }

  /* ------------------------------------------------------------ 130 % text on the smallest phone */
  {
    // the page's sizes are in px, so larger system text acts like a narrower screen: an iPhone SE's
    // 375 px at 130 % is a 288 px layout. Every tab must still fit without a sideways scroll.
    const p = await newPage(browser, { ...devices['iPhone SE'], viewport: { width: 288, height: 513 } });
    const wide = [];
    for (const go of ['section', 'loads', 'curve', 'modes', 'more']) {
      await p.click(`.tabbar [data-go="${go}"]`);
      await p.evaluate(() => window.__cufsm.idle());
      await p.waitForTimeout(150);
      if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(go);
    }
    await p.click('.tabbar [data-go="section"]');
    await p.screenshot({ path: `${SHOTS}/a11y-130pct-iPhone-SE.png` });
    check(!wide.length, '130 % text (a 288 px layout): no sideways scroll', wide.join(', '));
    await p.context().close();
  }

  /* ------------------------------------------------------------ the guide */
  {
    // every guide page: axe in light and dark on a desktop and on a phone, no sideways scroll on
    // the phone, and the folded Contents opens; the diagrams and tables are the ones at risk
    const pages = readdirSync(new URL('../../guide/', import.meta.url)).filter((f) => f.endsWith('.html')).sort();
    const root = BASE.replace(/\?.*$/, '') + 'guide/';
    for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { ...devices['iPhone 13'] }]]) {
      for (const scheme of ['light', 'dark']) {
        const ctx = await browser.newContext({ ...opts, colorScheme: scheme });
        const p = await ctx.newPage();
        const errs = [];
        p.on('pageerror', (e) => errs.push(String(e)));
        const wide = [];
        for (const f of pages) {
          await p.goto(root + f);
          await p.waitForLoadState('load');
          await axe(p, `guide ${label} ${scheme} ${f}`);
          if (label === 'phone' && await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(f);
        }
        if (label === 'phone') {
          check(!wide.length, `guide phone ${scheme}: no sideways scroll`, wide.join(', '));
          await p.click('.g-navbtn');
          check(await p.isVisible('#g-nav'), `guide phone ${scheme}: Contents opens the nav`);
        }
        check(!errs.length, `guide ${label} ${scheme}: no page errors`, errs.join(' | '));
        await ctx.close();
      }
    }
  }

  /* ------------------------------------------------------------ reduced motion */
  {
    const p = await newPage(browser, { ...devices['iPhone 15 Pro'], reducedMotion: 'reduce' });
    await p.click('.tabbar [data-go="modes"]');
    await p.waitForSelector('#playBtn');
    const lbl = await p.textContent('#playBtn');
    check(/Play/.test(lbl), 'reduced motion: the mode does not play by itself', lbl.trim());
    await p.context().close();
  }
} finally {
  await browser.close();
}
if (failed) { console.log(`${failed} failed`); process.exitCode = 1; }
