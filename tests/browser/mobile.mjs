import { chromium, devices } from 'playwright';
import { readFile } from 'node:fs/promises';
import { encodeState } from '../../js/share.js';
const BASE = (process.env.BASE_URL || 'http://localhost:8765/') + '?test=1';
const cases = [
  ['iPhone SE', devices['iPhone SE'], 'compact'],
  ['iPhone 15 Pro', devices['iPhone 15 Pro'], 'compact'],
  ['Pixel 7', devices['Pixel 7'], 'compact'],
  ['iPhone 15 Pro landscape', devices['iPhone 15 Pro landscape'], 'medium'],
  ['iPad Mini', devices['iPad Mini'], 'medium'],
  ['iPad Pro 11 landscape', devices['iPad Pro 11 landscape'], 'expanded'],
];
const browser = await chromium.launch();
const innerWidthOf = (dev) => dev.viewport.height;   // a phone turned to landscape: its portrait height across
for (const [name, dev, want] of cases) {
  const ctx = await browser.newContext({ ...dev });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE);
  // engine loaded AND the first solve done: the screenshots then show the real pane, and the
  // overflow / target checks run against chart content rather than a "solving" stub
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  const got = await p.evaluate(() => window.__cufsm.layout);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const small = await p.$$eval('button, [role=tab], input, select, .chip',
    (els) => els.filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44))
                .map((e) => e.id || e.className || e.tagName));
  const bad = [];
  if (got !== want) bad.push(`layout ${got}, want ${want}`);
  if (overflow) bad.push('horizontal scroll');
  if (small.length) bad.push(`targets under 44 px: ${[...new Set(small)].slice(0, 8).join(', ')}`);
  if (errs.length) bad.push(`page errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
  await p.screenshot({ path: `tests/browser/shots/${name.replace(/\s+/g, '-')}.png` });
  console.log(bad.length ? 'FAIL' : 'ok  ', name, bad.join('; '));
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}

/* Step 5: rotation mid-edit keeps the layout class, the open sheet and the solve's result. Since
   Task 3 the sheet is the real node sheet, opened by tapping node 1 on the drawing. */
{
  const dev = devices['iPhone 15 Pro'];
  const ctx = await browser.newContext({ ...dev });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  await p.evaluate(() => window.__cufsm.idle());
  await p.$eval('#sectionSvg', (e) => e.scrollIntoView({ block: 'center' }));
  const n1 = await p.$eval('#sectionSvg [data-node="0"]', (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p.touchscreen.tap(n1.x, n1.y);
  await p.waitForSelector('#nodeSheet:not([hidden])', { timeout: 3000 }).catch(() => {});
  const opened = await p.evaluate(() => {
    const el = document.getElementById('nodeSheet');
    window.__sigMark = window.__cufsm.sig;                // identity, not a copy
    return { open: !el.hidden, detent: el.dataset.detent, layout: window.__cufsm.layout };
  });
  const bad = [];
  if (!opened.open || opened.detent !== 'medium') bad.push(`sheet open on start: ${JSON.stringify(opened)}`);
  if (opened.layout !== 'compact') bad.push(`start layout ${opened.layout}`);
  const url0 = p.url();
  const check = async (want) => {
    const r = await p.evaluate(() => ({
      layout: window.__cufsm.layout,
      open: !document.getElementById('nodeSheet').hidden,
      sameSig: window.__cufsm.sig === window.__sigMark,
    }));
    if (r.layout !== want) bad.push(`layout ${r.layout}, want ${want}`);
    if (!r.open) bad.push('sheet closed');
    if (!r.sameSig) bad.push('sig replaced');
    return r;
  };
  await p.setViewportSize(devices['iPhone 15 Pro landscape'].viewport);
  await p.waitForFunction(() => window.__cufsm.layout === 'medium', null, { timeout: 10000 });
  const land = await check('medium');
  await p.setViewportSize(dev.viewport);
  await p.waitForFunction(() => window.__cufsm.layout === 'compact', null, { timeout: 10000 });
  const port = await check('compact');
  if (p.url() !== url0) bad.push(`reloaded: ${p.url()} !== ${url0}`);
  if (errs.length) bad.push(`page errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
  console.log(bad.length ? 'FAIL' : 'ok  ', 'rotate keeps state',
    bad.join('; ') || `medium: ${JSON.stringify(land)}, compact: ${JSON.stringify(port)}`);
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}

// every view is reachable on a phone: the bottom bar has five tabs for seven views, so Curve and
// Modes carry their own switch (signature | cFSM, 2D | 3D), and a tab reopens the view left there
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.waitForFunction(() => document.getElementById('footerNote')?.textContent.includes('The engine has loaded'), null, { timeout: 60000 });
  const bad = [];
  const sel = (v) => p.evaluate((x) => document.querySelector(`[data-more="${x}"]`).getAttribute('aria-selected'), v);
  await p.click('.tabbar [data-go=modes]');
  await p.click('[data-more=mode3d]');
  if (await sel('mode3d') !== 'true') bad.push('3D mode not reachable');
  await p.click('.tabbar [data-go=curve]');
  await p.click('[data-more=cfsm]');
  if (await sel('cfsm') !== 'true') bad.push('cFSM not reachable');
  await p.click('.tabbar [data-go=modes]');
  if (await sel('mode3d') !== 'true') bad.push('Modes did not reopen 3D');
  console.log(bad.length ? 'FAIL' : 'ok  ', 'every view reachable on a phone', bad.join('; '));
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}
// the module builder opens on a phone, full screen, says it is best on a larger screen, and
// keeps its controls tappable with no sideways scroll
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE);
  await p.waitForFunction(() => !!window.__cufsm?.engine, null, { timeout: 60000 });
  const bad = [];
  await p.click('.tabbar [data-go=more]');
  await p.click('[data-more=extensions]');
  await p.click('.ext-links button:has-text("New module")');
  await p.waitForSelector('.ext-builder textarea.ext-code', { timeout: 10000 });
  const note = await p.$eval('.ext-builder .ext-compact-note', (e) => (e.offsetParent ? e.textContent : '')).catch(() => '');
  if (!/tablet or desktop/.test(note)) bad.push(`no compact note: "${note}"`);
  if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) bad.push('horizontal scroll');
  const small = await p.$$eval('.ext-builder button, .ext-builder input, .ext-builder select',
    (els) => els.filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44))
                .map((e) => e.textContent.trim() || e.name || e.className));
  if (small.length) bad.push(`targets under 44 px: ${[...new Set(small)].slice(0, 8).join(', ')}`);
  if (errs.length) bad.push(`page errors: ${errs.slice(0, 3).join(' | ')}`);
  await p.screenshot({ path: 'tests/browser/shots/builder-iPhone-13.png' });
  console.log(bad.length ? 'FAIL' : 'ok  ', 'the module builder on a phone', bad.join('; '));
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}
/* The touch section editor on a phone. Real touch input through CDP (pointerType
   touch): tap a node and its sheet edits it, ↶ puts it back, a pinch zooms, a long-press drags a
   node and the curve re-solves, ＋ Node adds a node and a strip, and undo / redo walk them. */
const touch = async (p) => {
  const cdp = await p.context().newCDPSession(p);
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const pt = (x, y, id = 0) => ({ x, y, id, radiusX: 2, radiusY: 2, force: 1 });
  return {
    async tap(x, y) { await send('touchStart', [pt(x, y)]); await send('touchEnd', []); },
    async longDrag(x0, y0, x1, y1, steps = 8) {
      await send('touchStart', [pt(x0, y0)]);
      await p.waitForTimeout(450);
      for (let k = 1; k <= steps; k++) {
        await send('touchMove', [pt(x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps)]);
        await p.waitForTimeout(30);
      }
      await send('touchEnd', []);
    },
    async pinch(cx, cy, d0, d1, steps = 6) {
      await send('touchStart', [pt(cx - d0 / 2, cy, 0), pt(cx + d0 / 2, cy, 1)]);
      for (let k = 1; k <= steps; k++) {
        const d = d0 + (d1 - d0) * k / steps;
        await send('touchMove', [pt(cx - d / 2, cy, 0), pt(cx + d / 2, cy, 1)]);
        await p.waitForTimeout(20);
      }
      await send('touchEnd', []);
    },
  };
};
const nodeAt = (p, i) => p.$eval(`#sectionSvg [data-node="${i}"]`, (c) => {
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
{
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  await p.evaluate(() => window.__cufsm.idle());
  const bad = [];
  const t = await touch(p);
  const model = () => p.evaluate(() => structuredClone(window.__cufsm.model));
  await p.$eval('#sectionSvg', (e) => e.scrollIntoView({ block: 'center' }));
  const x0 = (await model()).nodes[0].x;
  // tap node 1: its sheet opens; x = 12, Done; the model's node 0 has x = 12
  const n1 = await nodeAt(p, 0);
  await t.tap(n1.x, n1.y);
  await p.waitForSelector('#nodeSheet:not([hidden])', { timeout: 3000 }).catch(() => bad.push('tap did not open the node sheet'));
  if (!bad.length) {
    await p.fill('#nsX', '12');
    await p.press('#nsX', 'Enter');
    await p.$eval('#nsX', (e) => e.blur());
    await p.click('#nodeSheet .sheetfoot [data-close]');
    await p.waitForSelector('#nodeSheet', { state: 'hidden', timeout: 3000 }).catch(() => bad.push('Done did not close the sheet'));
    await p.evaluate(() => window.__cufsm.idle());
    if ((await model()).nodes[0].x !== 12) bad.push(`node 1 x = ${(await model()).nodes[0].x}, want 12`);
    await p.click('#cvUndo');
    await p.evaluate(() => window.__cufsm.idle());
    if ((await model()).nodes[0].x !== x0) bad.push(`after ↶ node 1 x = ${(await model()).nodes[0].x}, want ${x0}`);
  }
  // pinch out about the drawing's centre: the view zooms in
  const box = await p.$eval('#sectionSvg', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await t.pinch(box.x, box.y, 60, 180);
  const v = await p.evaluate(() => window.__cufsm.view);
  if (!(v.s > 1.5)) bad.push(`pinch: view.s = ${v.s}`);
  await p.click('#cvFit');
  // long-press node 6 and drag it 40 px right: it moves, and a new signature arrives
  const sig0 = await p.evaluate(() => { window.__sigMark = window.__cufsm.sig; return window.__cufsm.sig.pts[0].y; });
  const before = (await model()).nodes[5];
  const n6 = await nodeAt(p, 5);
  await t.longDrag(n6.x, n6.y, n6.x + 40, n6.y);
  await p.evaluate(() => window.__cufsm.idle());
  const after = (await model()).nodes[5];
  if (!(after.x > before.x + 5)) bad.push(`drag: node 6 x ${before.x} -> ${after.x}`);
  if (Math.abs(after.x * 2 - Math.round(after.x * 2)) > 1e-9) bad.push(`drag did not snap to 0.5 mm: ${after.x}`);
  const resolved = await p.evaluate(() => window.__cufsm.sig !== window.__sigMark);
  if (!resolved) bad.push('no new signature after the drag');
  const sig1 = await p.evaluate(() => window.__cufsm.sig.pts[0].y);
  // ＋ Node: a tap on empty canvas adds a node joined to the last one
  const counts = async () => { const m = await model(); return [m.nodes.length, m.elems.length]; };
  const [nn, ne] = await counts();
  await p.click('#cvAdd');
  const svgBox = await p.$eval('#sectionSvg', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  await t.tap(svgBox.l + svgBox.w * 0.7, svgBox.t + svgBox.h * 0.5);
  await p.evaluate(() => window.__cufsm.idle());
  const [nn2, ne2] = await counts();
  if (nn2 !== nn + 1 || ne2 !== ne + 1) bad.push(`add node: ${nn}/${ne} -> ${nn2}/${ne2}`);
  await p.click('#cvAdd');
  await p.screenshot({ path: 'tests/browser/shots/touch-editor-iPhone-15-Pro.png' });
  // undo the add and the drag, then redo both (a disabled button is a failure, not a hang)
  const press = async (id) => {
    if (await p.$eval(id, (b) => b.disabled)) bad.push(`${id} disabled`);
    else await p.click(id);
    await p.evaluate(() => window.__cufsm.idle());
  };
  await press('#cvUndo');
  if ((await counts())[0] !== nn) bad.push('undo did not remove the added node');
  await press('#cvUndo');
  if ((await model()).nodes[5].x !== before.x) bad.push('undo did not put the dragged node back');
  await press('#cvRedo');
  if ((await model()).nodes[5].x !== after.x) bad.push('redo did not move the node again');
  await press('#cvRedo');
  if ((await counts())[0] !== nn + 1) bad.push('redo did not add the node again');
  if (await p.evaluate(() => window.__cufsm.history.canRedo)) bad.push('redo still enabled at the newest step');
  if (errs.length) bad.push(`page errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
  console.log(bad.length ? 'FAIL' : 'ok  ', 'touch section editor', bad.join('; ')
    || `pinch s = ${v.s.toFixed(2)}; drag x ${before.x} -> ${after.x}, curve[0] ${sig0.toFixed(2)} -> ${sig1.toFixed(2)} MPa`);
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}
/* The compact model editor. Pixel 7: a pasted 2,000-node model's node list keeps at
   most 60 rows in the DOM. iPhone SE: node 7's sheet, its stress field focused, then a 260 px soft
   keyboard (the viewport shrinks): the field is still inside what is left. Also: a dimension and a
   sheet field take a decimal comma, ± flips the sign, and a bad value is refused inline. */
{
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  const bad = [];
  await p.tap('#modelBtn');
  await p.tap('[data-mlist="nodes"]');
  const rows0 = await p.$$eval('.vlist-row', (r) => r.length);
  if (!rows0) bad.push('the node list is empty');
  await p.tap('#mlistPaste');
  await p.waitForSelector('#pastePanel', { timeout: 5000 });
  const N = 2000;
  await p.fill('#pasteProp', '100 200000 200000 0.3 0.3 76923.0769');
  await p.fill('#pasteNode', Array.from({ length: N }, (_, i) => `${i + 1} ${i * 0.5} ${(i % 2) * 0.1} 1 1 1 1 1`).join('\n'));
  await p.fill('#pasteElem', Array.from({ length: N - 1 }, (_, i) => `${i + 1} ${i + 1} ${i + 2} 1 100`).join('\n'));
  await p.tap('#pasteApply');
  await p.waitForFunction((n) => window.__cufsm.model.nodes.length === n, N, { timeout: 10000 });
  await p.tap('.tabbar [data-go=section]');
  await p.tap('#modelBtn');
  await p.tap('[data-mlist="nodes"]');
  const rows = await p.$$eval('.vlist-row', (r) => r.length);
  await p.$eval('#mlist', (e) => { e.scrollTop = 1000 * 56; e.dispatchEvent(new Event('scroll')); });
  await p.waitForTimeout(100);
  const mid = await p.$$eval('.vlist-row', (r) => [r.length, r.map((x) => +x.firstChild.textContent)]);
  if (rows > 60 || mid[0] > 60) bad.push(`${rows} / ${mid[0]} rows in the DOM`);
  if (!mid[1].includes(1001)) bad.push(`scrolled to row 1001 but the DOM has ${mid[1][0]} to ${mid[1].at(-1)}`);
  if (errs.length) bad.push(`page errors: ${errs.slice(0, 3).join(' | ')}`);
  console.log(bad.length ? 'FAIL' : 'ok  ', 'a 2,000-node list stays virtual', bad.join('; ') || `${rows} rows at the top, ${mid[0]} at row 1001`);
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}
{
  const dev = devices['iPhone SE'];
  const ctx = await browser.newContext({ ...dev });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  await p.evaluate(() => window.__cufsm.idle());
  const bad = [];
  // a dimension with a decimal comma, then a refused value
  await p.fill('#p_h', '160,5'); await p.$eval('#p_h', (e) => e.blur());
  await p.evaluate(() => window.__cufsm.idle());
  const zmax = await p.evaluate(() => Math.max(...window.__cufsm.model.nodes.map((n) => n.z)));
  if (zmax !== 160.5) bad.push(`h = 160,5 gave a ${zmax} mm deep model`);
  await p.fill('#p_h', '-3'); await p.$eval('#p_h', (e) => e.blur());
  const msg = await p.$eval('#p_h', (e) => e.closest('.numfield').querySelector('.msg').textContent);
  if (!/positive/.test(msg)) bad.push(`no inline message for h = -3: "${msg}"`);
  if (await p.evaluate(() => Math.max(...window.__cufsm.model.nodes.map((n) => n.z))) !== 160.5) bad.push('h = -3 reached the model');
  // node 7 from the model sheet; ± on z
  await p.tap('#modelBtn');
  await p.tap('[data-mlist="nodes"]');
  await p.tap('.vlist-row:nth-child(7)');
  await p.waitForSelector('#nodeSheet:not([hidden])');
  if (!/Node 7$/.test(await p.textContent('#nodeSheetTitle'))) bad.push(`opened ${await p.textContent('#nodeSheetTitle')}`);
  await p.fill('#nsZ', '12,5'); await p.$eval('#nsZ', (e) => e.blur());
  await p.tap('#nodeSheet .numfield:has(#nsZ) .pm');
  await p.evaluate(() => window.__cufsm.idle());
  const z7 = await p.evaluate(() => window.__cufsm.model.nodes[6].z);
  if (z7 !== -12.5) bad.push(`node 7 z = ${z7}, want -12.5`);
  // the soft keyboard
  await p.tap('#nsS');
  await p.setViewportSize({ width: dev.viewport.width, height: dev.viewport.height - 260 });
  await p.waitForTimeout(700);
  const box = await p.$eval('#nsS', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
  if (box.top < 0 || box.bottom > box.h) bad.push(`the stress field (${box.top.toFixed(0)} to ${box.bottom.toFixed(0)}) is outside the ${box.h} px left above the keyboard`);
  await p.screenshot({ path: 'tests/browser/shots/keyboard-iPhone-SE.png' });
  if (errs.length) bad.push(`page errors: ${errs.slice(0, 3).join(' | ')}`);
  console.log(bad.length ? 'FAIL' : 'ok  ', 'compact editors and the keyboard', bad.join('; ')
    || `h 160,5 -> ${zmax} mm; node 7 z -> ${z7}; stress field at ${box.top.toFixed(0)} to ${box.bottom.toFixed(0)} of ${box.h} px`);
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}

/* Results on a phone (iPhone 15 Pro, real CDP touch). Curve: a finger dragged
   along the chart reads it in #chartReadout, and a release near a minimum selects that minimum.
   Landscape: the chart goes full screen (.full, position: fixed) and ✕ leaves it. Modes: the
   length and mode steppers are 48 px and in the thumb zone (the bottom 40 %), ▸ and a swipe on
   the drawing step the mode. A tab switch scrolls back to the top. */
{
  const dev = devices['iPhone 15 Pro'];
  const ctx = await browser.newContext({ ...dev });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  await p.evaluate(() => window.__cufsm.idle());
  const bad = [];
  const cdp = await ctx.newCDPSession(p);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const pt = (x, y) => ({ x, y, id: 0, radiusX: 2, radiusY: 2, force: 1 });
  // the tab switch goes back to the top of the new view
  await p.evaluate(() => scrollTo(0, 400));
  await p.tap('.tabbar [data-go=curve]');
  await p.waitForTimeout(700);
  const sy = await p.evaluate(() => scrollY);
  if (sy > 1) bad.push(`Curve opened at scrollY ${sy}`);
  await p.waitForSelector('#sigChart .marker');
  await p.$eval('#sigChart', (e) => e.scrollIntoView({ block: 'center' }));
  const box = await p.$eval('#sigChart', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const marks = await p.$$eval('#sigChart circle.marker', (cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return r.left + r.width / 2; }));
  const nMin = await p.evaluate(() => window.__cufsm.disp.minima.length);
  if (marks.length !== nMin || nMin < 2) bad.push(`${marks.length} markers for ${nMin} minima`);
  const target = nMin - 1;                                    // the last minimum: not the one selected at boot
  const y = box.t + box.h * 0.5;
  const reads = new Set();
  const read = async () => reads.add(await p.textContent('#chartReadout'));
  await read();
  await send('touchStart', [pt(box.l + box.w * 0.1, y)]);
  for (let k = 1; k <= 10; k++) {
    await send('touchMove', [pt(box.l + box.w * (0.1 + 0.08 * k), y)]);
    await p.waitForTimeout(25);
    if (k % 3 === 0) await read();
  }
  await send('touchMove', [pt(marks[target] + box.w * 0.02, y)]);
  await read();
  await send('touchEnd', []);
  await p.waitForTimeout(150);
  if (reads.size < 3) bad.push(`#chartReadout did not follow the finger: ${[...reads].join(' | ')}`);
  const st = await p.evaluate(() => ({ selMin: window.__cufsm.selMin, selL: window.__cufsm.selL,
    L: window.__cufsm.disp.pts[window.__cufsm.disp.minima[window.__cufsm.disp.minima.length - 1]].L }));
  if (st.selMin !== target || st.selL !== st.L) bad.push(`release near minimum ${target + 1}: selMin ${st.selMin}, L ${st.selL} (want ${st.L})`);
  const after = await p.textContent('#chartReadout');
  await p.screenshot({ path: 'tests/browser/shots/curve-scrub-iPhone-15-Pro.png' });
  // landscape: the chart full screen, then ✕
  await p.setViewportSize({ width: dev.viewport.height, height: dev.viewport.width });
  await p.waitForSelector('.resview.full', { timeout: 5000 }).catch(() => bad.push('landscape: no .full chart'));
  const pos = await p.$eval('.resview', (e) => ({ full: e.classList.contains('full'), pos: getComputedStyle(e).position,
    w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
  if (!pos.full || pos.pos !== 'fixed' || pos.w < innerWidthOf(dev) - 1) bad.push(`landscape chart: ${JSON.stringify(pos)}`);
  await p.screenshot({ path: 'tests/browser/shots/curve-landscape-iPhone-15-Pro.png' });
  await p.click('.resview .fullx');
  if (await p.$eval('.resview', (e) => e.classList.contains('full'))) bad.push('✕ did not leave full screen');
  await p.setViewportSize(dev.viewport);
  await p.waitForFunction(() => window.__cufsm.layout === 'compact');
  // Modes: the steppers in the thumb zone
  await p.tap('.tabbar [data-go=modes]');
  await p.waitForSelector('#modeNext');
  const geom = await p.$$eval('#lenNext, #modeNext', (bs) => bs.map((b) => { const r = b.getBoundingClientRect();
    return { id: b.id, w: r.width, h: r.height, top: r.top, ih: innerHeight }; }));
  for (const g of geom) {
    if (g.w < 48 || g.h < 48) bad.push(`${g.id} is ${g.w.toFixed(0)} × ${g.h.toFixed(0)} px`);
    if (g.top < g.ih * 0.6) bad.push(`${g.id} at ${g.top.toFixed(0)} px is above the thumb zone (${(g.ih * 0.6).toFixed(0)})`);
  }
  const modeNo = () => p.evaluate(() => window.__cufsm.selModeIdx);
  const m0 = await modeNo();
  await p.tap('#modeNext');
  await p.waitForFunction((m) => window.__cufsm.selModeIdx === m + 1, m0, { timeout: 5000 }).catch(() => bad.push('▸ did not step the mode'));
  const ms = await p.$eval('#modeSvg', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
  const sy2 = ms.t + ms.h / 2;
  await send('touchStart', [pt(ms.l + ms.w * 0.8, sy2)]);
  for (let k = 1; k <= 6; k++) { await send('touchMove', [pt(ms.l + ms.w * (0.8 - 0.1 * k), sy2)]); await p.waitForTimeout(16); }
  await send('touchEnd', []);
  await p.waitForFunction((m) => window.__cufsm.selModeIdx === m + 2, m0, { timeout: 5000 }).catch(() => bad.push('a swipe did not step the mode'));
  await p.screenshot({ path: 'tests/browser/shots/modes-steppers-iPhone-15-Pro.png' });
  if (errs.length) bad.push(`page errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
  console.log(bad.length ? 'FAIL' : 'ok  ', 'results on a phone', bad.join('; ')
    || `${reads.size} readouts while scrubbing, snapped to minimum ${target + 1} ("${after}"); steppers ${geom.map((g) => `${g.id} ${g.h.toFixed(0)} px at ${(g.top / g.ih * 100).toFixed(0)} %`).join(', ')}`);
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}

/* Projects on the device (iPhone 13). Autosave survives a reload; More › Projects
   renames, makes a new one, reopens, deletes with Undo; Save to file and Open file round trip; a
   file from an older version is explained, not opened; a #v2. link opens as a "Shared link"
   project; with IndexedDB gone (private browsing) the page says the projects last the session. */
{
  const dev = devices['iPhone 13'];
  const ctx = await browser.newContext({ ...dev, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  const bad = [];
  const boot = async () => {
    await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
    await p.evaluate(() => window.__cufsm.idle());
  };
  const x0 = async () => p.evaluate(() => window.__cufsm.model.nodes[0].x);
  const names = () => p.$$eval('#projList .pn', (e) => e.map((x) => x.textContent));
  const projects = async () => { await p.tap('.tabbar [data-go=more]'); await p.tap('[data-more=projects]'); await p.waitForSelector('#projList > li:not(.loading)'); };
  await p.goto(BASE); await boot();
  // autosave survives reload: node 1 x = 12 through its sheet, then a reload with no hash
  await p.$eval('#sectionSvg', (e) => e.scrollIntoView({ block: 'center' }));
  const n1 = await p.$eval('#sectionSvg [data-node="0"]', (c) => { const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.touchscreen.tap(n1.x, n1.y);
  await p.waitForSelector('#nodeSheet:not([hidden])');
  await p.fill('#nsX', '12'); await p.press('#nsX', 'Enter');
  await p.tap('#nodeSheet .sheetfoot [data-close]');
  await p.evaluate(() => window.__cufsm.idle());
  await p.waitForTimeout(700);                                // past the 400 ms autosave
  await p.reload(); await boot();
  if (await x0() !== 12) bad.push(`after reload node 1 x = ${await x0()}, want 12`);
  // rename the open project
  await projects();
  if ((await names()).length !== 1) bad.push(`projects after the first edit: ${await names()}`);
  await p.tap('#projList .projrow.cur .projren');
  await p.fill('#projList .projinput', 'Purlin C');
  await p.tap('#projList .projok');
  await p.waitForFunction(() => document.querySelector('#projName')?.textContent === 'Purlin C');
  // New: the default section, a second project
  await p.tap('#projNew');
  await boot();
  await p.waitForTimeout(700);
  if (await x0() === 12) bad.push('New kept the edited section');
  await projects();
  await p.waitForFunction(() => document.querySelectorAll('#projList .projrow').length === 2, null, { timeout: 5000 }).catch(() => {});
  const two = await names();
  if (two.length !== 2 || !two.includes('Purlin C')) bad.push(`after New: ${two}`);
  await p.screenshot({ path: 'tests/browser/shots/projects-iPhone-13.png' });
  // reopen Purlin C
  await p.tap('#projList .projrow:has(.pn:text-is("Purlin C")) .projopen');
  await p.waitForFunction(() => window.__cufsm.model.nodes[0].x === 12, null, { timeout: 10000 }).catch(() => {});
  await boot();
  if (await x0() !== 12) bad.push(`reopened Purlin C has node 1 x = ${await x0()}`);
  // Save to file, then delete the other project with Undo, then for good
  await projects();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.tap('#projSaveFile')]);
  const fname = dl.suggestedFilename();
  const saved = JSON.parse(await readFile(await dl.path(), 'utf8'));
  if (fname !== 'Purlin C.ckb.json' || saved.format !== 'civilkit-buckling' || saved.version !== 2 || saved.state.model.nodes[0].x !== 12)
    bad.push(`saved file ${fname}: ${JSON.stringify(saved).slice(0, 120)}`);
  const other = (await names()).find((n) => n !== 'Purlin C');
  await p.tap(`#projList .projrow:has(.pn:text-is("${other}")) .projdel`);
  await p.waitForFunction(() => document.querySelectorAll('#projList .projrow').length === 1);
  await p.tap('#appToast button');
  await p.waitForFunction(() => document.querySelectorAll('#projList .projrow').length === 2, null, { timeout: 5000 })
    .catch(() => bad.push('Undo did not bring the deleted project back'));
  await p.tap(`#projList .projrow:has(.pn:text-is("${other}")) .projdel`);
  await p.waitForFunction(() => document.querySelectorAll('#projList .projrow').length === 1);
  // Open file: the saved file opens as a new project with its name and model
  await p.setInputFiles('#projFile', { name: fname, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await boot();
  await projects();
  await p.waitForFunction(() => document.querySelectorAll('#projList .projrow').length === 2, null, { timeout: 5000 }).catch(() => {});
  if ((await names()).filter((n) => n === 'Purlin C').length !== 2) bad.push(`after Open file: ${await names()}`);
  // an older version's file: a message, nothing replaced
  await p.setInputFiles('#projFile', { name: 'old.ckb.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'civilkit-buckling', version: 1, state: {} })) });
  await p.waitForSelector('#projMsg:not([hidden])');
  const msg = await p.textContent('#projMsg');
  if (!/older version/.test(msg)) bad.push(`old file: "${msg}"`);
  await p.screenshot({ path: 'tests/browser/shots/projects-old-file-iPhone-13.png' });
  // a deep link: a new page on the link opens it and keeps it as "Shared link"
  const st = saved.state; st.model.nodes[0].x = 7;
  const q = await ctx.newPage();
  q.on('pageerror', (e) => errs.push(String(e)));
  await q.goto(BASE + await encodeState(st));
  await q.waitForFunction(() => window.__cufsm?.sig && window.__cufsm.model.nodes[0].x === 7, null, { timeout: 60000 })
    .catch(() => bad.push('the link did not open its model'));
  await q.evaluate(() => window.__cufsm.idle());
  await q.waitForTimeout(700);
  if (q.url().includes('#v2.')) bad.push('the link stayed in the address bar after it was saved');
  await q.tap('.tabbar [data-go=more]'); await q.tap('[data-more=projects]');
  await q.waitForSelector('#projList .projrow');
  const qn = await q.$$eval('#projList .pn', (e) => e.map((x) => x.textContent));
  if (!qn.includes('Shared link')) bad.push(`no Shared link project: ${qn}`);
  await q.close();
  if (errs.length) bad.push(`page errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
  console.log(bad.length ? 'FAIL' : 'ok  ', 'projects on the device', bad.join('; ') || `${qn.length} projects: ${qn.join(', ')}; file ${fname}`);
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}
/* private browsing: no IndexedDB, so projects last the session, and the page says so (iPhone 13) */
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig, null, { timeout: 60000 });
  await p.evaluate(() => window.__cufsm.idle());
  await p.waitForTimeout(700);
  const bad = [];
  const t = await p.$eval('#appToast', (e) => (e.hidden ? '' : e.textContent));
  if (!/this session only/.test(t)) bad.push(`no toast about session-only projects: "${t}"`);
  await p.tap('.tabbar [data-go=more]'); await p.tap('[data-more=projects]');
  const status = await p.textContent('#projStatus');
  if (!/session only/.test(status)) bad.push(`status: "${status}"`);
  await p.screenshot({ path: 'tests/browser/shots/projects-private-iPhone-13.png' });
  if (errs.length) bad.push(`page errors: ${errs.slice(0, 3).join(' | ')}`);
  console.log(bad.length ? 'FAIL' : 'ok  ', 'projects without IndexedDB say so', bad.join('; '));
  if (bad.length) process.exitCode = 1;
  await ctx.close();
}
await browser.close();
