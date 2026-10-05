/* The installable offline app, in headless Chromium.

   It serves the repo itself, the way the site does: under a sub-path (/apps/buckling/), with every
   stylesheet, script, module and wasm URL stamped ?v=<release> as the deploy sync stamps them,
   and with Cache-Control: max-age=0, must-revalidate. A release is simulated by changing a file
   and serving the sw.js tools/precache.mjs would write for it.

     node tests/browser/offline.mjs            (npm run offline)

   Checks: the worker's scope is the app folder; the manifest parses and every icon loads at its
   size; Chromium reports no installability errors; offline, a reload boots the app, the engine
   solves, the last project reopens with its edit, a store module installs (its worked examples
   run in the sandbox) and the guide opens; full Python (Pyodide), downloaded once online after the
   user agreed, runs a numpy and matplotlib script offline from its own cache (the app's precache
   holds none of it); a new release shows the update prompt and its Reload
   brings the new files in, leaving one cache; the same offline boot on an iPhone 13; and no
   worker on localhost unless ?sw=1. */
import { chromium, devices } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { precacheFiles, buildSw } from '../../tools/precache.mjs';
import { PYODIDE } from '../../js/py/pyodide-files.js';

const REPO = process.cwd();
const MOUNT = '/apps/buckling/';
const SHOTS = process.env.SHOTS || 'tests/browser/shots';
mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ckext': 'application/zip', '.py': 'text/x-python',
  '.zip': 'application/zip', '.whl': 'application/octet-stream' };

let release = 'r1';
const overrides = new Map();          // path → Buffer, per release
const source = (f) => overrides.get(f) ?? readFileSync(join(REPO, f));
// the deploy sync's stamping, applied to what is served
const imports = (t, v) => t
  .replace(/((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"?]+\.m?js)(['"])/g, `$1$2?v=${v}$3`)
  .replace(/(new URL\(\s*['"])(\.{1,2}\/[^'"?]+\.(?:m?js|wasm))(['"])/g, `$1$2?v=${v}$3`);
function stamped(f, buf) {
  const v = release;
  if (f === 'index.html') return Buffer.from(String(buf)
    .replace(/(href=")((?![a-z]+:|\/\/)[^"]+\.css)"/g, `$1$2?v=${v}"`)
    .replace(/(src="app\.js)"/, `$1?v=${v}"`));
  if (f === 'app.js') return Buffer.from(imports(String(buf), v).replace(/(new URL\('cufsm\.wasm)'/, `$1?v=${v}'`));
  if (/^(js|vendor)\/.*\.m?js$/.test(f)) return Buffer.from(imports(String(buf), v));
  return buf;
}
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(MOUNT)) { res.writeHead(404); res.end(); return; }
  let f = decodeURIComponent(url.pathname.slice(MOUNT.length));
  if (f === '' || f.endsWith('/')) f += 'index.html';
  let body;
  if (f === 'sw.js' && release !== 'r1') body = Buffer.from(buildSw(precacheFiles(REPO), source));
  else if (overrides.has(f)) body = overrides.get(f);
  else if (existsSync(join(REPO, f)) && statSync(join(REPO, f)).isFile()) body = readFileSync(join(REPO, f));
  if (!body) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream',
    'Cache-Control': 'max-age=0, must-revalidate' });
  res.end(stamped(f, body));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://localhost:${server.address().port}`;
const APP = ORIGIN + MOUNT;

let failed = 0;
const check = (ok, name, detail = '') => {
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : detail);
  if (!ok) failed++;
};
const solved = (p) => p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig?.pts?.length, null, { timeout: 60000 });
const controlled = (p) => p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });

const browser = await chromium.launch();
try {
  /* ------------------------------------------------------------ desktop */
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(APP + '?sw=1&test=1');
  await solved(p);
  await controlled(p);
  const reg = await p.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active.scriptURL };
  });
  check(reg.scope === APP && reg.script === APP + 'sw.js', 'the worker is the app folder\'s', JSON.stringify(reg));

  const man = await p.evaluate(async () => {
    const l = document.querySelector('link[rel=manifest]');
    const j = await (await fetch(l.href)).json();
    const icons = [];
    for (const i of j.icons) {
      const img = new Image();
      img.src = new URL(i.src, l.href).href;
      try { await img.decode(); icons.push([i.sizes, `${img.naturalWidth}x${img.naturalHeight}`]); }
      catch { icons.push([i.sizes, 'failed']); }
    }
    const apple = document.querySelector('link[rel=apple-touch-icon]');
    const ai = new Image(); ai.src = apple.href;
    let appleSize = 'failed';
    try { await ai.decode(); appleSize = `${ai.naturalWidth}x${ai.naturalHeight}`; } catch { /* */ }
    return { name: j.name, display: j.display, icons, appleSize,
      themes: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => m.content) };
  });
  check(man.name === 'CivilKit Buckling' && man.display === 'standalone', 'the manifest parses', JSON.stringify(man));
  check(man.icons.length >= 3 && man.icons.every(([s, got]) => s === got), 'every manifest icon loads at its size', JSON.stringify(man.icons));
  check(man.appleSize === '180x180', 'the apple-touch-icon loads at 180', man.appleSize);
  check(man.themes.length === 2, 'theme-color for light and dark', JSON.stringify(man.themes));
  const cdp = await ctx.newCDPSession(p);
  const am = await cdp.send('Page.getAppManifest');
  check(!am.errors.length, 'Chromium parses the manifest without errors', JSON.stringify(am.errors));
  const inst = await cdp.send('Page.getInstallabilityErrors');
  const instErrs = inst.installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito');
  check(!instErrs.length, 'Chromium finds the app installable', JSON.stringify(inst.installabilityErrors));

  // an edit that autosaves, to reopen offline
  await p.click('.shape[data-shape="z"]');
  await p.waitForFunction(() => window.__cufsm?.sig?.pts?.length, null, { timeout: 60000 });
  await p.evaluate(() => window.__cufsm.idle());
  await p.waitForTimeout(800);

  /* full Python: never precached with the app; online, a numpy script asks, Load fetches it */
  const PY = `import numpy as np\nimport matplotlib.pyplot as plt\nimport cufsm_rs as fsm\n`
    + `sig = fsm.signature(fsm.lipped_c(150, 64, 15, 1.5), np.logspace(1, 3.4, 40))\n`
    + `print(np.round(sig.minima, 4))\nplt.semilogx(sig.lengths, sig.curve)\nplt.show()\n`;
  const openConsole = async () => {
    await p.click('.tab[data-tab="python"]');
    await p.waitForSelector('.pycon textarea.pycon-code', { timeout: 15000 });
    await p.fill('.pycon textarea.pycon-code', PY);
  };
  const ran = () => p.waitForFunction(() => !document.querySelector('.pycon').classList.contains('running')
    && !document.querySelector('.pycon-badge').hidden, null, { timeout: 180000 }).then(() => p.evaluate(() => ({
    badge: document.querySelector('.pycon-badge').textContent,
    out: [...document.querySelectorAll('.pycon-stream > pre')].map((e) => e.textContent).join(''),
    imgs: document.querySelectorAll('.pycon-figimg').length,
    tb: document.querySelector('.pycon-traceback').hidden ? null : document.querySelector('.pycon-traceback').textContent,
  })));
  const precached = await p.evaluate(async () => {
    const k = (await caches.keys()).find((n) => n.startsWith('ckb-'));
    return (await (await caches.open(k)).keys()).map((r) => r.url);
  });
  check(precached.length > 50 && !precached.some((u) => u.includes('/vendor/pyodide/')), 'the app\'s precache holds none of Pyodide',
    String(precached.filter((u) => u.includes('pyodide')).length));
  await openConsole();
  await p.click('.pycon-run');
  await p.waitForSelector('.pycon-consent:not([hidden])', { timeout: 30000 });
  await p.click('.pycon-consent-load');
  const online = await ran();
  check(online.badge === 'Ran on: full Python (Pyodide)' && online.imgs === 1, 'online: full Python runs after Load', JSON.stringify(online));
  const pyCache = await p.evaluate(async (c) => (await (await caches.open(c)).keys()).length, `ckpy-${PYODIDE.version}`);
  check(pyCache >= 15, 'full Python\'s files are in their own cache', String(pyCache));

  await ctx.setOffline(true);
  await p.reload();
  await solved(p);
  await p.waitForFunction(() => !document.getElementById('netState').hidden, null, { timeout: 5000 }).catch(() => {});
  const off = await p.evaluate(() => ({
    shape: document.querySelector('.shape.on')?.dataset.shape,
    pts: window.__cufsm.sig.pts.length,
    chip: !document.getElementById('netState').hidden,
    onLine: navigator.onLine,
  }));
  check(off.pts > 0, 'offline: the page boots and the engine solves', JSON.stringify(off));
  check(off.shape === 'z', 'offline: the last project reopens with its edit', JSON.stringify(off));
  check(off.chip, 'offline: the indicator shows', JSON.stringify(off));

  await p.click('.tab[data-tab="extensions"]');
  await p.waitForSelector('.ext-store .ext-row:has-text("DSM compression")', { timeout: 15000 });
  await p.locator('.ext-store .ext-row', { hasText: 'DSM compression' }).locator('button').first().click();
  const instRow = p.locator('.ext-installed .ext-row', { hasText: 'DSM compression' }).first();
  let badge = '';
  try { await instRow.waitFor({ timeout: 60000 }); badge = await instRow.textContent(); } catch (e) { badge = String(e.message); }
  check(/Verified/.test(badge), 'offline: a store module installs from the cache, Verified', badge.slice(0, 200));

  const g = await ctx.newPage();
  await g.goto(APP + 'guide/');
  const gt = await g.title();
  check(/guide|extension/i.test(gt), 'offline: the guide opens', gt);
  await g.close();

  await openConsole();
  await p.click('.pycon-run');
  const off2 = await ran();
  check(off2.badge === 'Ran on: full Python (Pyodide)' && !off2.tb && off2.imgs === 1 && off2.out === online.out,
    'offline: full Python runs from the device\'s copy, with its figure, the same numbers', JSON.stringify({ ...off2, online: online.out }));
  check(await p.$eval('.pycon-consent', (e) => e.hidden), 'offline: no question (nothing to download)');
  await p.screenshot({ path: `${SHOTS}/offline-pyodide-desktop.png` });
  check(!errs.length, 'no page errors (desktop)', errs.join(' | '));

  /* ------------------------------------------------------------ a new release */
  await ctx.setOffline(false);
  release = 'r2';
  overrides.set('index.html', Buffer.from(readFileSync(join(REPO, 'index.html'), 'utf8')
    .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="ckb-release" content="r2">')));
  await p.reload();
  await solved(p);
  check(!(await p.$('meta[name=ckb-release]')), 'the open page stays on its release until asked');
  await p.waitForFunction(() => document.getElementById('netState').hidden, null, { timeout: 5000 }).catch(() => {});
  check(await p.evaluate(() => document.getElementById('netState').hidden), 'online again: the indicator goes',
    String(await p.evaluate(() => navigator.onLine)));
  let prompt = false;
  try { await p.waitForSelector('#swUpdate:not([hidden])', { timeout: 30000 }); prompt = true; } catch { /* */ }
  check(prompt, 'a new release shows the update prompt');
  await p.screenshot({ path: `${SHOTS}/update-prompt-desktop.png` });
  if (prompt) {
    await Promise.all([p.waitForNavigation({ timeout: 30000 }), p.click('#swUpdate button[data-act="reload"]')]);
    await solved(p);
    const after = await p.evaluate(async () => ({
      meta: document.querySelector('meta[name=ckb-release]')?.content,
      app: document.querySelector('script[type=module]').getAttribute('src'),
      caches: (await caches.keys()).filter((k) => k.startsWith('ckb-')).length,
    }));
    check(after.meta === 'r2' && after.app === 'app.js?v=r2', 'Reload brings the new release in', JSON.stringify(after));
    check(after.caches === 1, 'the old release\'s cache is gone', JSON.stringify(after));
    const kept = await p.evaluate(async (c) => (await caches.has(c)) && (await (await caches.open(c)).keys()).length, `ckpy-${PYODIDE.version}`);
    check(kept >= 15, 'a new app release keeps the device\'s full Python', String(kept));
  }
  await ctx.close();

  /* ------------------------------------------------------------ iPhone 13 */
  {
    const c = await browser.newContext({ ...devices['iPhone 13'] });
    const q = await c.newPage();
    const e2 = [];
    q.on('pageerror', (e) => e2.push(String(e)));
    await q.goto(APP + '?sw=1&test=1');
    await solved(q);
    await controlled(q);
    await c.setOffline(true);
    await q.reload();
    await solved(q);
    await q.waitForFunction(() => !document.getElementById('netState').hidden, null, { timeout: 5000 }).catch(() => {});
    check(await q.evaluate(() => window.__cufsm.sig.pts.length > 0 && !document.getElementById('netState').hidden),
      'iPhone 13 offline: boots, solves, shows the indicator');
    await q.screenshot({ path: `${SHOTS}/offline-iPhone-13.png` });
    check(!e2.length, 'no page errors (iPhone 13)', e2.join(' | '));
    await c.close();
  }

  /* ------------------------------------------------------------ localhost without ?sw=1 */
  {
    const c = await browser.newContext();
    const q = await c.newPage();
    await q.goto(APP + '?test=1');
    await solved(q);
    await q.waitForTimeout(500);
    check((await q.evaluate(() => navigator.serviceWorker.getRegistrations())).length === 0,
      'no service worker on localhost unless ?sw=1 (an edit and a reload show the edit)');
    await c.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) { console.log(`${failed} failed`); process.exitCode = 1; }
