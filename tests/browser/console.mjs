/* The Python console, driven as a user would, in headless Chromium:

     BASE_URL=http://localhost:8765/ node tests/browser/console.mjs        (npm run console)

   On a desktop (light and dark) and an iPhone 13: nothing of the console loads until it is opened;
   it opens on the script for the model on screen; the cufsm-rs-py README quickstart (numpy's
   logspace as a list, its results printed) is pasted and run, and its numbers are read off the
   page (minima about 7.27 / 0.353 and 43.9 / 0.544, L about 98 %, D about 94 %) with the runtime
   badge "Ran on: MicroPython"; "Use the model on screen" runs and prints the page's own minima;
   a numpy script asks before anything of the full runtime (Pyodide) is downloaded, saying its size,
   and Not now runs it on MicroPython, whose notice names the full runtime and marks the import's
   line; Load runs the README quickstart verbatim (numpy and matplotlib) on Pyodide, the badge
   "Ran on: full Python (Pyodide)", its numbers and its three matplotlib figures as images (each
   with an alt text and a Download SVG that saves an SVG file); the lip study's overlay example runs
   with no question once the files are on the device, the scipy example asks only for scipy; a
   script that fails partway on MicroPython (a str method it lacks) re-runs on Pyodide with one
   clean output; "Always" is remembered; Stop ends a Pyodide run; Stop ends an
   endless loop and the next run works; every example script (the lightest-section search within
   30 s, with its winner, and the catalogue check's pass count) in the Examples menu loads (Undo
   brings the old text back), runs and prints with no error, and its cufsm_rs.plot figures appear
   inline as SVG (role img, an aria-label), as many as it draws, in order between its printed
   lines (screenshots of each example's output); a figure's Download SVG saves a valid standalone
   SVG file in the colours on screen; Save output has a "[figure: ...]" line for each; Open loads a .py through the file
   input and a dropped file, and refuses an image and a file over 1 MB with a reason; Download
   saves the editor's text under the example's or the opened file's name, and Save output the
   run's output; Full view puts the console over the whole screen as a dialog under <body> and Esc
   puts it back in the pane; axe finds nothing serious, in full view too. Screenshots go to SHOTS (default
   tests/browser/shots/console). */
import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { EXAMPLES, FULL_EXAMPLES } from '../../js/py/examples.js';
import { PYODIDE } from '../../js/py/pyodide-files.js';

const BASE = (process.env.BASE_URL || 'http://localhost:8765/').replace(/\?.*$/, '') + '?test=1';
const SHOTS = process.env.SHOTS || 'tests/browser/shots/console';
const AXE = readFileSync(new URL('../../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
mkdirSync(SHOTS, { recursive: true });
const TA = '.pycon textarea.pycon-code';
/* the figures each example draws, in order (cufsm_rs.plot), and the line printed just before the first */
const FIGS = {
  'lightest_section.py': [['section', 'signature'], 'signature curve (fine grid), the minima classified:'],
  'catalogue_check.py': [['signature'], 'Its signature curve, the minima classified:'],
  'dsm_lip_study.py': [['signature'], "The best lip's signature curve, its minima classified:"],
  'end_conditions.py': [['mode', 'mode'], 'Mode shapes at 3000 mm: the weakest ends (C-F) and the strongest (C-C).'],
  'distortional_mode.py': [['section', 'signature', 'mode', 'signature'], '  Pcrd = 0.412 Py = 84.1 kN (cFSM D 87 %)'],
};
const exampleText = (file) => readFileSync(new URL(`../../py/examples/${file}`, import.meta.url), 'utf8');
/* the first line each example prints */
const FIRST = {
  'lightest_section.py': /^Lightest lipped C with φc Pn >= 80 kN,$/,
  'catalogue_check.py': /^Lipped C sections against N\* = 60 kN,$/,
  'dsm_lip_study.py': /^Lipped C 150 x 64 x 1\.5 mm, fy = 450 MPa,$/,
  'end_conditions.py': /^Lipped C 150 x 64 x 18 x 2\.4 mm, Py = 328\.8 kN/,
  'distortional_mode.py': /^Lipped C 150 x 64 x 15 x 1\.5 mm, Py = 203\.8 kN/,
};

/* the README quickstart of cufsm-rs-py 0.1.0, with np.logspace(0, 3, 80) as the same list and
   without numpy, and print() around the values its comments describe */
const QUICKSTART = `import cufsm_rs as fsm

# CUFSM's tutorial C: 9 x 5 x 1 in, t = 0.1 in (inches and ksi)
xz = [(5, 1), (5, 0), (2.5, 0), (0, 0), (0, 3), (0, 6), (0, 9), (2.5, 9), (5, 9), (5, 8)]
m = fsm.Model(
    prop=[[100, 29500, 29500, 0.3, 0.3, 11346.15]],
    node=[[i + 1, x, z, 1, 1, 1, 1, 0] for i, (x, z) in enumerate(xz)],
    elem=[[i + 1, i + 1, i + 2, 0.1, 100] for i in range(9)],
)

p = fsm.section_properties(m)          # p.A, p.Ixx, p.J, p.Cw, p.xs, ... (also p["Ixx"])
y = fsm.first_yield(m, fy=50)          # y.Py = 105, y.Mxx = 324.64 (element faces, as CUFSM)

mc = fsm.stress(m, P=y.Py)             # a new Model with the reference stresses set
sig = fsm.signature(mc, [10 ** (3 * i / 79) for i in range(80)])
print(sig)                             # StripResult(signature, bc=S-S, 80 lengths 1 to 1000, neigs=1, 2 minima)
print(sig.minima)                      # [[7.27, 0.353], [43.9, 0.544]]: [half-wavelength, load factor]
print(sig.classify_minima())           # [G, D, L, O] percent of each minimum's mode: L 98%, D 94%

r = fsm.strip(mc, [7.27, 43.9], neigs=3)   # any lengths, several modes
print(r.load_factors.shape)                # (2, 3)
shape = r.mode_shape(0)                    # the lowest mode at the first length
print(shape.at())                          # displacements summed over terms at mid-length

cc = fsm.strip(mc, [100.0, 200.0], m_all=10, bc="C-C", neigs=2)    # general end conditions
print(cc.classify().shape)                                          # (2, 2, 4): G, D, L, O percent
`;

const cases = [
  ['desktop-light', { viewport: { width: 1280, height: 900 }, colorScheme: 'light' }],
  ['desktop-dark', { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' }],
  ['iphone13', { ...devices['iPhone 13'], colorScheme: 'light' }],
];

const browser = await chromium.launch();
let failed = 0;
for (const [name, opts] of cases) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errs = [], requests = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('request', (r) => requests.push(r.url()));
  const step = async (label, fn) => {
    try { await fn(); console.log('ok  ', name, label); } catch (e) {
      failed++; console.log('FAIL', name, label, String(e.message || e).split('\n')[0]);
      await p.screenshot({ path: `${SHOTS}/${name}-FAIL.png`, fullPage: true }).catch(() => {});
      // a failed step leaves no question open for the next one
      if (await p.isVisible('.pycon-consent-later').catch(() => false)) await p.click('.pycon-consent-later').catch(() => {});
    }
  };
  const expect = (ok, msg) => { if (!ok) throw new Error(msg); };
  const axe = async (label) => {
    if (!(await p.evaluate(() => !!window.axe))) await p.evaluate(AXE);
    const v = await p.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
      .filter((x) => x.impact === 'serious' || x.impact === 'critical')
      .map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`));
    expect(!v.length, `axe (${label}): ${v.join(' | ')}`);
  };
  /* a finished run: the badge shows and the button is back */
  const runAndWait = async (timeout = 30000) => {
    await p.click('.pycon-run');
    const during = await p.evaluate(() => {
      const r = document.querySelector('.pycon');
      return { running: r.classList.contains('running'), out: !document.querySelector('.pycon-stream').hidden };
    });
    expect(!(during.running && during.out), 'output showed while the script was still running');
    await p.waitForFunction(() => !document.querySelector('.pycon').classList.contains('running')
      && !document.querySelector('.pycon-badge').hidden, null, { timeout });
    return p.evaluate(() => ({
      badge: document.querySelector('.pycon-badge').textContent,
      status: document.querySelector('.pycon-statustext').textContent,
      out: document.querySelector('.pycon-stream').hidden ? null
        : [...document.querySelectorAll('.pycon-stream > pre.pycon-stdout')].map((e) => e.textContent).join(''),
      figs: [...document.querySelectorAll('.pycon-stream > figure.pycon-fig')].map((f) => f.className.match(/pycon-fig-(\w+)/)[1]),
      tb: document.querySelector('.pycon-traceback').hidden ? null : document.querySelector('.pycon-traceback').textContent,
      imgs: [...document.querySelectorAll('.pycon-stream > figure.pycon-fig-mpl img')].map((i) => ({ alt: i.alt, w: i.naturalWidth })),
      why: document.querySelector('.pycon-why').hidden ? null : document.querySelector('.pycon-why').textContent,
      notice: document.querySelector('.pycon-notice').hidden ? null : document.querySelector('.pycon-notice').textContent,
    }));
  };
  /* paste: the clipboard into the editor, over everything in it */
  const paste = async (text) => {
    await p.focus(TA);
    await p.keyboard.press('ControlOrMeta+a');
    await p.evaluate((t) => navigator.clipboard.writeText(t), text);
    await p.keyboard.press('ControlOrMeta+v');
    const v = await p.inputValue(TA);
    if (v !== text) {                                    // no clipboard in this context: type it in one go
      await p.keyboard.press('ControlOrMeta+a');
      await p.keyboard.insertText(text);
    }
    expect((await p.inputValue(TA)) === text, 'the pasted script is not what the editor holds');
  };
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});

  await p.goto(BASE);
  await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig?.pts?.length, null, { timeout: 60000 });
  await p.evaluate(() => { try { localStorage.removeItem('civilkit-buckling.console-draft'); } catch { /* */ } });
  await p.evaluate(() => window.__cufsm.idle());

  await step('nothing of the console loads until it is opened', async () => {
    const early = requests.filter((u) => /js\/py\/|cufsm_rs_lite/.test(u));
    expect(!early.length, `loaded before the console was opened: ${early.join(', ')}`);
  });

  await step('the console opens from More, with the script for the model on screen', async () => {
    if (await p.isVisible('.tab[data-tab="python"]')) await p.click('.tab[data-tab="python"]');
    else { await p.click('.tabbar [data-go=more]'); await p.click('.morenav[data-for="more"] [data-more="python"]'); }
    await p.waitForSelector(TA, { timeout: 15000 });
    const v = await p.inputValue(TA);
    expect(v.includes('import cufsm_rs') && v.includes('model = cufsm_rs.Model('), 'the editor does not hold the model\'s script');
    await p.waitForSelector('.pycon .ck-pre .py-kw');
    const loaded = requests.filter((u) => /console-worker\.js|cufsm_rs_lite\/__init__\.py/.test(u));
    expect(loaded.length >= 2, `the console worker and the lite package did not load: ${loaded.join(', ')}`);
  });

  await step('the README quickstart, pasted and run: its numbers on the page, on MicroPython', async () => {
    await paste(QUICKSTART);
    const r = await runAndWait();
    expect(r.badge === 'Ran on: MicroPython', `badge: ${r.badge}`);
    expect(!r.tb && !r.notice, `an error: ${r.tb}`);
    const lines = r.out.split('\n');
    expect(lines[0] === 'StripResult(signature, bc=S-S, 80 lengths 1 to 1000, neigs=1, 2 minima)', `repr: ${lines[0]}`);
    const nums = (s) => s.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
    const [L1, f1, L2, f2] = nums(lines[1]);
    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    expect(near(L1, 7.27, 0.005) && near(f1, 0.353, 0.0005) && near(L2, 43.9, 0.05) && near(f2, 0.544, 0.0005),
      `minima ${lines[1]}`);
    const cls = nums(lines[2]);                                    // [G, D, L, O] for each minimum
    expect(Math.round(cls[2]) === 98 && Math.round(cls[5]) === 94, `classification ${lines[2]}`);
    expect(lines[3] === '(2, 3)' && lines[lines.length - 1] === '(2, 2, 4)', `shapes ${lines[3]} ${lines[lines.length - 1]}`);
    expect(/^Displacements\(y=3\.635, u=Array\(/.test(lines[4]), `mode shape ${lines[4].slice(0, 60)}`);
    console.log('     minima', L1, f1, '/', L2, f2, ' L', cls[2].toFixed(2), '% D', cls[5].toFixed(2), '%');
    await p.$eval('.pycon-out', (e) => e.scrollIntoView({ block: 'start' }));
    await p.screenshot({ path: `${SHOTS}/${name}-quickstart.png` });
    await p.$eval('.pycon', (e) => e.scrollIntoView({ block: 'start' }));
    await p.screenshot({ path: `${SHOTS}/${name}-editor.png` });
    await axe('after the quickstart run');
  });

  await step('"Use the model on screen" runs the analysis on screen and prints the page\'s minima', async () => {
    await p.click('.pycon-model');
    const v = await p.inputValue(TA);
    expect(v.startsWith('# CivilKit Buckling (CUFSM)'), 'the model script did not replace the editor\'s text');
    const r = await runAndWait();
    expect(r.badge === 'Ran on: MicroPython' && !r.tb, `run: ${r.tb}`);
    const page = await p.evaluate(() => window.__cufsm.sig.minima.map((i) => [window.__cufsm.sig.pts[i].L, window.__cufsm.sig.pts[i].lf]));
    const printed = [...r.out.matchAll(/L = (\S+) mm\s+load factor (\S+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(page.length && printed.length, `no minima: page ${page.length}, printed ${printed.length}`);
    for (const [L, lf] of page)
      expect(printed.some(([pl, pf]) => Math.abs(pl - L) <= 1e-5 * L && Math.abs(pf - lf) <= 1e-9 * lf),
        `the page's minimum at ${L} (${lf}) is not in the script's output:\n${r.out}`);
    console.log('     page minima', JSON.stringify(page), 'printed', printed.length);
  });

  const pyodideRequests = () => requests.filter((u) => u.includes('/vendor/pyodide/'));
  /* a run that stops at the download prompt */
  const runToPrompt = async () => {
    await p.click('.pycon-run');
    await p.waitForSelector('.pycon-consent:not([hidden])', { timeout: 30000 });
    return p.$eval('.pycon-consent', (e) => e.innerText);
  };
  const finished = (timeout = 180000) => p.waitForFunction(() => !document.querySelector('.pycon').classList.contains('running')
    && !document.querySelector('.pycon-badge').hidden, null, { timeout }).then(() => p.evaluate(() => ({
    badge: document.querySelector('.pycon-badge').textContent,
    status: document.querySelector('.pycon-statustext').textContent,
    out: [...document.querySelectorAll('.pycon-stream > pre.pycon-stdout')].map((e) => e.textContent).join(''),
    imgs: [...document.querySelectorAll('.pycon-stream > figure.pycon-fig-mpl img')].map((i) => ({ alt: i.alt, w: i.naturalWidth, h: i.naturalHeight })),
    tb: document.querySelector('.pycon-traceback').hidden ? null : document.querySelector('.pycon-traceback').textContent,
    why: document.querySelector('.pycon-why').hidden ? null : document.querySelector('.pycon-why').textContent,
  })));
  const loadExample = async (file) => {
    await p.selectOption('.pycon-examples', file);
    await p.waitForFunction((t) => document.querySelector('.pycon textarea.pycon-code').value === t, exampleText(file), { timeout: 10000 });
  };

  await step('a numpy script asks before anything is downloaded; Not now runs MicroPython, naming the full runtime', async () => {
    await paste('import cufsm_rs\nimport numpy as np\nprint(np.logspace(0, 3, 80))\n');
    const text = await runToPrompt();
    expect(!pyodideRequests().length, `fetched before consent: ${pyodideRequests().join(', ')}`);
    expect(/This script needs full Python/.test(text) && /imports numpy/.test(text), `prompt: ${text}`);
    const mb = /Download now: ([\d.]+) MB/.exec(text);
    expect(mb && +mb[1] > 10 && +mb[1] < 25, `size: ${text}`);
    expect(/Pyodide 314\.0\.7/.test(text) && /numpy: 2\.8 MB/.test(text) && /Always load it on this device/.test(text), `prompt: ${text}`);
    expect(await p.evaluate(() => document.activeElement?.classList.contains('pycon-consent-load')), 'Load has the focus');
    await p.$eval('.pycon-consent', (e) => e.scrollIntoView({ block: 'center' }));
    await p.screenshot({ path: `${SHOTS}/${name}-consent.png` });
    await axe('the download prompt');
    await p.click('.pycon-consent-later');
    const r = await finished(30000);
    expect(r.badge === 'Ran on: MicroPython', `badge ${r.badge}`);
    const notice = await p.$eval('.pycon-notice', (e) => (e.hidden ? null : e.textContent));
    expect(notice && /numpy/.test(notice) && /full Python runtime/.test(notice) && !/later version/.test(notice), `notice: ${notice}`);
    expect(r.why && /Not now/.test(r.why), `why: ${r.why}`);
    const marked = await p.$eval('.pycon .ck-gut-in .ck-errline', (d) => d.textContent).catch(() => null);
    const msg = await p.$eval('.pycon .ck-msg', (d) => (d.hidden ? null : d.textContent));
    expect(marked === '2' && msg === "Line 2: ImportError: no module named 'numpy'", `marked line ${marked}: ${msg}`);
    expect(!pyodideRequests().length, `Not now fetched ${pyodideRequests().length} files`);
    await p.$eval('.pycon-out', (e) => e.scrollIntoView({ block: 'center' }));
    await p.screenshot({ path: `${SHOTS}/${name}-numpy.png` });
    await axe('the full-runtime notice and a traceback');
  });

  await step('Load runs the README quickstart verbatim on full Python: its numbers and three matplotlib figures', async () => {
    await loadExample('full/readme_quickstart.py');
    await runToPrompt();
    const t0 = Date.now();
    await p.click('.pycon-consent-load');
    const r = await finished();
    const first = Date.now() - t0;
    expect(r.badge === 'Ran on: full Python (Pyodide)', `badge ${r.badge}: ${r.tb}`);
    expect(!r.tb, `traceback ${r.tb}`);
    expect(/\[\[ 7\.26981342 {2}0\.35324649\]\n \[43\.87331372 {2}0\.54410451\]\]/.test(r.out), `minima: ${r.out.slice(0, 300)}`);
    expect(/^StripResult\(signature, bc=S-S, 80 lengths 1 to 1000, neigs=1, 2 minima\)$/m.test(r.out), 'repr');
    expect(r.imgs.length === 3 && r.imgs.every((i) => i.w > 300 && /^matplotlib figure: /.test(i.alt)), `figures ${JSON.stringify(r.imgs)}`);
    expect(/Full python ran this script|Full Python ran this script: it imports numpy/.test(r.why ?? ''), `why ${r.why}`);
    const files = await p.evaluate(async (c) => (await (await caches.open(c)).keys()).map((q) => q.url.split('/').pop()), `ckpy-${PYODIDE.version}`);
    expect(PYODIDE.core.every((f) => files.includes(f)) && files.some((f) => f.startsWith('numpy-')) && !files.some((f) => f.startsWith('scipy-')),
      `the device's copy: ${files.join(', ')}`);
    console.log(`      first full run (download, boot, numpy and matplotlib, the script): ${(first / 1000).toFixed(1)} s; ${r.status}`);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.locator('.pycon-fig-mpl .pycon-figdl').first().click()]);
    const svg = readFileSync(await dl.path(), 'utf8');
    expect(dl.suggestedFilename() === 'readme_quickstart-figure-1.svg' && /^<\?xml[\s\S]*<svg[\s\S]*<\/svg>\s*$/.test(svg), `download ${dl.suggestedFilename()}`);
    const t1 = Date.now();
    await p.click('.pycon-run');
    const again = await finished();
    console.log(`      the same script again (Pyodide loaded): ${((Date.now() - t1) / 1000).toFixed(1)} s; ${again.status}`);
    await p.$eval('.pycon-out', (e) => e.scrollIntoView({ block: 'start' }));
    await p.screenshot({ path: `${SHOTS}/${name}-pyodide-quickstart.png`, fullPage: true });
    await axe('a full Python run with figures');
  });

  await step('the lip study overlay runs with no question (its files are on the device), two figures', async () => {
    await loadExample('full/lip_study_plots.py');
    await p.click('.pycon-run');
    const r = await finished();
    expect(await p.$eval('.pycon-consent', (e) => e.hidden), 'it asked again');
    expect(r.badge === 'Ran on: full Python (Pyodide)' && !r.tb, `${r.badge} ${r.tb}`);
    expect(/^Best lip: d = 16 mm \(d\/B = 0\.250\), 227\.8 MPa, Pn = 103\.9 kN, local governs\.$/m.test(r.out), `best lip: ${r.out.slice(-300)}`);
    expect(!/Warning/.test(r.out), `warnings in the output: ${r.out}`);
    expect(r.imgs.length === 2 && /Signature curves by lip depth/.test(r.imgs[0].alt) && /9 lines|lines/.test(r.imgs[0].alt), `figures ${JSON.stringify(r.imgs)}`);
    const clip = await p.$eval('.pycon-out', (e) => { const b = e.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; });
    await p.screenshot({ path: `${SHOTS}/${name}-overlay.png`, fullPage: true, clip });
  });

  await step('the scipy example asks only for scipy, then finds the winner and the exact thickness', async () => {
    await loadExample('full/lightest_numpy.py');
    const text = await runToPrompt();
    expect(/scipy/.test(text) && !/Python 3\.14/.test(text) && !/numpy: /.test(text), `prompt: ${text}`);
    await p.click('.pycon-consent-load');
    const r = await finished(240000);
    expect(r.badge === 'Ran on: full Python (Pyodide)' && !r.tb, `${r.badge} ${r.tb}`);
    expect(/^Winner: 100 x 50 x 13 x 1\.5 mm, 2\.59 kg\/m; on the fine grid φc Pn = 81\.8 kN\.$/m.test(r.out), `winner: ${r.out.slice(0, 600)}`);
    expect(/^The same shape carries exactly 80 kN at t = 1\.478 mm/m.test(r.out) && /UNVERIFIED/.test(r.out), 'brentq and the note');
    expect(r.imgs.length === 1, `${r.imgs.length} figures`);
    console.log(`      lightest_numpy.py: ${r.status}`);
  });

  await step('a script that fails partway on MicroPython re-runs on full Python, with one clean output', async () => {
    await paste('import cufsm_rs\nprint("before")\nprint("7".zfill(3))\n');
    await p.click('.pycon-run');
    const r = await finished();
    expect(r.badge === 'Ran on: full Python (Pyodide)' && r.out === 'before\n007', `${r.badge}: ${JSON.stringify(r.out)}`);
    expect(/MicroPython stopped at line 3 \(AttributeError/.test(r.why ?? ''), `why ${r.why}`);
  });

  await step('Stop ends a full Python run; the next run works', async () => {
    await paste('import numpy\nprint("spinning")\nwhile True:\n    pass\n');
    await p.click('.pycon-run');
    await p.waitForTimeout(2500);
    await p.click('.pycon-stop');
    expect(/Stopped/.test(await p.$eval('.pycon-statustext', (e) => e.textContent)), 'stopped');
    await paste('import numpy as np\nprint(np.arange(3).sum())\n');
    await p.click('.pycon-run');
    const r = await finished();
    expect(r.out === '3' && r.badge === 'Ran on: full Python (Pyodide)', `after Stop: ${r.out} ${r.tb}`);
  });

  await step('Remove deletes the device\'s copy and asks again; "Always" is remembered', async () => {
    await p.click('.pycon-forget');
    await p.waitForFunction(() => /was removed/.test(document.querySelector('.pycon-statustext').textContent), null, { timeout: 10000 });
    expect(!(await p.evaluate(async (c) => caches.has(c), `ckpy-${PYODIDE.version}`)), 'the copy is still there');
    await paste('import numpy as np\nprint(np.ones(2).sum())\n');
    await runToPrompt();
    await p.check('.pycon-consent-always');
    await p.click('.pycon-consent-load');
    let r = await finished();
    expect(r.out === '2.0', `run: ${r.out} ${r.tb}`);
    expect(await p.evaluate(() => localStorage.getItem('civilkit-buckling.full-python-always')) === '1', 'not remembered');
    // with "always", even with nothing on the device, a full run starts without a question
    await p.evaluate(async (c) => { await caches.delete(c); }, `ckpy-${PYODIDE.version}`);
    await p.reload();
    await p.waitForFunction(() => window.__cufsm?.engine && window.__cufsm?.sig?.pts?.length, null, { timeout: 60000 });
    if (await p.isVisible('.tab[data-tab="python"]')) await p.click('.tab[data-tab="python"]');
    else { await p.click('.tabbar [data-go=more]'); await p.click('.morenav[data-for="more"] [data-more="python"]'); }
    await p.waitForSelector(TA, { timeout: 15000 });
    await paste('import numpy as np\nprint(np.ones(3).sum())\n');
    await p.click('.pycon-run');
    r = await finished();
    expect(r.out === '3.0' && await p.$eval('.pycon-consent', (e) => e.hidden), `"always": ${r.out}`);
    await p.click('.pycon-forget');
    await p.waitForFunction(() => /was removed/.test(document.querySelector('.pycon-statustext').textContent), null, { timeout: 10000 });
    expect(await p.evaluate(() => localStorage.getItem('civilkit-buckling.full-python-always')) === '', 'Remove keeps "always"');
  });

  await step('a Python error is its traceback, with the script\'s line marked', async () => {
    await paste('def f(x):\n    return 1 / x\n\nprint(f(0))\n');
    const r = await runAndWait();
    expect(/ZeroDivisionError/.test(r.tb) && !r.notice, `traceback ${r.tb}, notice ${r.notice}`);
    const marked = await p.$eval('.pycon .ck-gut-in .ck-errline', (d) => d.textContent).catch(() => null);
    expect(marked === '2', `marked line ${marked}`);
  });

  await step('Stop ends an endless loop; the next run works', async () => {
    await paste('print("before")\nwhile True:\n    pass\n');
    await p.click('.pycon-run');
    await p.waitForTimeout(1200);
    const st = await p.evaluate(() => ({ running: document.querySelector('.pycon').classList.contains('running'),
      stop: !document.querySelector('.pycon-stop').disabled, out: !document.querySelector('.pycon-stream').hidden }));
    expect(st.running && st.stop && !st.out, `while running: ${JSON.stringify(st)}`);
    await p.click('.pycon-stop');
    const after = await p.evaluate(() => ({ running: document.querySelector('.pycon').classList.contains('running'),
      status: document.querySelector('.pycon-statustext').textContent }));
    expect(!after.running && /Stopped/.test(after.status), `after Stop: ${JSON.stringify(after)}`);
    await paste('import cufsm_rs\nprint("again", cufsm_rs.__version__)\n');
    const r = await runAndWait();
    expect(r.out === 'again 0.1.0', `after a restart: ${r.out} ${r.tb}`);
  });

  const coarse = await p.evaluate(() => matchMedia('(pointer: coarse)').matches);
  /* a download: what the page saves when the button is pressed */
  const download = async (sel) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click(sel)]);
    return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') };
  };

  await step('each example in the menu loads, runs and prints with no error', async () => {
    for (const { file, label } of EXAMPLES) {
      await p.selectOption('.pycon-examples', file);
      await p.waitForFunction((t) => document.querySelector('.pycon textarea.pycon-code').value === t, exampleText(file), { timeout: 10000 });
      const st = await p.evaluate(() => ({ menu: document.querySelector('.pycon-examples').value,
        status: document.querySelector('.pycon-statustext').textContent }));
      expect(st.menu === '' && st.status.includes(label), `after loading ${file}: ${JSON.stringify(st)}`);
      const r = await runAndWait(180000);
      expect(r.badge === 'Ran on: MicroPython' && !r.tb && !r.notice, `${file}: ${r.tb ?? r.notice}`);
      expect(r.out && FIRST[file].test(r.out.split('\n')[0]), `${file} printed: ${(r.out ?? '').slice(0, 80)}`);
      console.log('     ', file, r.out.split('\n').length, 'lines,', r.figs.length, 'figures,', r.status);
      /* the search runs a few hundred analyses in about 15 s on an idle desktop; the budget is
         about 30 s. The guard here is 45 s, because a loaded test machine measured 34 s once. */
      if (file === 'lightest_section.py') {
        const took = /in ([\d.]+) s\b/.exec(r.status);
        const search = /^(\d+) analyses of \d+ pre-qualified sections in ([\d.]+) s\.$/m.exec(r.out);
        console.log('      the search:', search?.[0]);
        expect(took && +took[1] <= 45, `the search took ${r.status}: over 45 s`);
        expect(search && /^Winner: 100 x 50 x 13 x 1\.5 mm, 2\.59 kg\/m$/m.test(r.out), `the search's winner: ${r.out.slice(0, 200)}`);
      }
      if (file === 'catalogue_check.py') expect(/^10 of 12 sections pass\.$/m.test(r.out), 'catalogue: 10 of 12 pass');
      /* the figures: as many as the script draws, in its order, each an inline SVG with its text
         alternative, drawn (strips, curves) and placed after the line printed before it */
      const [kinds, before] = FIGS[file];
      expect(JSON.stringify(r.figs) === JSON.stringify(kinds), `${file} figures ${JSON.stringify(r.figs)}, expected ${JSON.stringify(kinds)}`);
      const figs = await p.$$eval('.pycon-stream > figure.pycon-fig', (fs) => fs.map((f) => {
        const svg = f.querySelector('svg.pycon-figsvg');
        const prev = f.previousElementSibling;
        const box = svg.getBoundingClientRect();
        return { role: svg.getAttribute('role'), label: svg.getAttribute('aria-label'), w: box.width, h: box.height,
                 marks: svg.querySelectorAll('polyline, polygon').length,
                 prev: prev?.matches('pre') ? prev.textContent.replace(/\n$/, '').split('\n').pop() : null,
                 cap: f.querySelector('.pycon-figcap').textContent };
      }));
      figs.forEach((f, k) => {
        expect(f.role === 'img' && f.label && f.label.length > 30, `${file} figure ${k + 1}: role ${f.role}, label ${f.label}`);
        expect(f.marks >= 1 && f.w > 200 && f.h > 120, `${file} figure ${k + 1} is not drawn: ${JSON.stringify(f)}`);
        expect(f.cap.startsWith(`Figure ${k + 1} · `), `${file} caption ${f.cap}`);
      });
      expect(figs[0].prev === before, `${file}: the first figure follows "${figs[0].prev}", not "${before}"`);
      if (kinds[0] === 'signature') expect(/minim/.test(figs[0].label) && /%: /.test(figs[0].label), `signature label ${figs[0].label}`);
      expect(r.status.includes(`with ${kinds.length} figure`), `status ${r.status}`);
      /* the whole output, from a full-page capture (an element capture scrolls, and stamps the
         sticky header over the middle of a tall one) */
      const clip = await p.$eval('.pycon-out', (e) => {
        const b = e.getBoundingClientRect();
        return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
      });
      await p.screenshot({ path: `${SHOTS}/${name}-${file.replace('.py', '')}.png`, fullPage: true, clip });
    }
    await axe('after the examples');
  });

  await step('Download saves the editor\'s script under the example\'s name; Save output its output', async () => {
    const d = await download('.pycon-download');
    const last = EXAMPLES[EXAMPLES.length - 1].file;
    expect(d.name === last && d.text === exampleText(last), `download ${d.name}, ${d.text.length} chars`);
    /* Save output is text: the printed lines, and a placeholder line where each figure was */
    const out = await p.$$eval('.pycon-stream > *', (es) => {
      let t = '';
      for (const e of es) {
        if (e.matches('pre')) t += e.textContent;
        else t += (t && !t.endsWith('\n') ? '\n' : '') + `[figure: ${e.querySelector('.pycon-figcap').textContent.split(' · ')[1]}]\n`;
      }
      return t.replace(/\n$/, '');
    });
    const o = await download('.pycon-saveout');
    expect(o.name === last.replace('.py', '-output.txt') && o.text === `${out}\n`, `output ${o.name}: ${o.text.slice(0, 60)}`);
    expect((o.text.match(/^\[figure: (cross-section|signature curve|mode shape)\]$/gm) ?? []).length === FIGS[last][0].length,
      `placeholders in the saved output: ${o.text.match(/\[figure[^\n]*/g)}`);
  });

  await step('Download SVG saves a figure as a valid standalone SVG file, in the colours on screen', async () => {
    const n = await p.$$eval('.pycon-figdl', (b) => b.length);
    expect(n === FIGS[EXAMPLES[EXAMPLES.length - 1].file][0].length, `${n} Download SVG buttons`);
    for (let k = 0; k < n; k++) {
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.locator('.pycon-figdl').nth(k).click()]);
      const text = readFileSync(await dl.path(), 'utf8');
      const kind = FIGS[EXAMPLES[EXAMPLES.length - 1].file][0][k];
      expect(dl.suggestedFilename() === `distortional_mode-figure-${k + 1}-${kind}.svg`, `name ${dl.suggestedFilename()}`);
      const v = await p.evaluate(([t, k]) => {
        const doc = new DOMParser().parseFromString(t, 'image/svg+xml');
        const root = doc.documentElement;
        const shown = document.querySelectorAll('.pycon-fig svg.pycon-figsvg')[k];
        const stroke = (sel) => { const e = shown.querySelector(sel); return e && getComputedStyle(e).stroke; };
        const fileStroke = (sel) => {
          // the same element in the file: the n-th of its tag, as in the page
          const tag = sel.split('.')[0], all = [...shown.querySelectorAll(tag)], i = all.indexOf(shown.querySelector(sel));
          return [...root.querySelectorAll(tag)][i]?.style.stroke;
        };
        const sel = shown.querySelector('polyline.deformed') ? 'polyline.deformed' : shown.querySelector('polyline.series') ? 'polyline.series' : 'polygon.strip';
        return { error: !!doc.querySelector('parsererror'), root: root.localName, ns: root.namespaceURI,
                 viewBox: root.getAttribute('viewBox'), width: +root.getAttribute('width'), title: root.querySelector('title')?.textContent,
                 classes: root.querySelectorAll('[class]').length, marks: root.querySelectorAll('polyline, polygon').length,
                 shown: stroke(sel), file: fileStroke(sel), xml: t.startsWith('<?xml') };
      }, [text, k]);
      expect(!v.error && v.xml && v.root === 'svg' && v.ns === 'http://www.w3.org/2000/svg', `figure ${k + 1}: not a valid SVG file ${JSON.stringify(v)}`);
      expect(/^0 0 \d+ \d+$/.test(v.viewBox) && v.width > 0 && v.title && v.title.length > 30, `figure ${k + 1}: ${JSON.stringify(v)}`);
      expect(v.classes === 0 && v.marks >= 1, `figure ${k + 1}: needs the page's style sheet (${v.classes} classes) or draws nothing`);
      expect(v.shown && v.shown === v.file, `figure ${k + 1}: the line is ${v.file} in the file and ${v.shown} on screen`);
    }
  });

  if (!coarse) await step('Undo brings back the text an example replaced', async () => {
    await paste('print("mine")\n');
    await p.selectOption('.pycon-examples', 'end_conditions.py');
    await p.waitForFunction(() => document.querySelector('.pycon textarea.pycon-code').value.startsWith('# General end'));
    await p.focus(TA);
    await p.keyboard.press('ControlOrMeta+z');
    const v = await p.inputValue(TA);
    expect(v === 'print("mine")\n', `after Undo: ${v.slice(0, 40)}`);
  });

  await step('Open loads a .py through the file input; it runs and downloads under its own name', async () => {
    const text = 'import cufsm_rs\n# opened from a file\nprint("opened", cufsm_rs.__version__)\n';
    await p.setInputFiles('.pycon-file', { name: 'my_study.py', mimeType: 'text/x-python', buffer: Buffer.from(text) });
    await p.waitForFunction((t) => document.querySelector('.pycon textarea.pycon-code').value === t, text, { timeout: 10000 });
    const status = await p.$eval('.pycon-statustext', (e) => e.textContent);
    expect(status === 'Opened my_study.py. Press Run.', `status ${status}`);
    const r = await runAndWait();
    expect(r.out === 'opened 0.1.0', `run: ${r.out} ${r.tb}`);
    const d = await download('.pycon-download');
    expect(d.name === 'my_study.py' && d.text === text, `download ${d.name}`);
  });

  await step('Open refuses an image and a file over 1 MB, with a reason, and keeps the editor', async () => {
    const before = await p.inputValue(TA);
    await p.setInputFiles('.pycon-file', { name: 'section.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });
    await p.waitForFunction(() => !document.querySelector('.pycon-notice').hidden);
    let n = await p.$eval('.pycon-notice', (e) => e.textContent);
    expect(/“section\.png” was not opened: the console opens Python \(\.py\) and text \(\.txt\) files/.test(n), `notice ${n}`);
    await p.setInputFiles('.pycon-file', { name: 'huge.py', mimeType: 'text/x-python', buffer: Buffer.alloc(1.5 * 1048576, 0x23) });
    await p.waitForFunction(() => /huge/.test(document.querySelector('.pycon-notice').textContent));
    n = await p.$eval('.pycon-notice', (e) => e.textContent);
    expect(/“huge\.py” was not opened: it is 1\.5 MB, and the console opens files up to 1 MB/.test(n), `notice ${n}`);
    expect((await p.inputValue(TA)) === before, 'a refused file changed the editor');
    await axe('a refused file');
  });

  await step('a .txt dropped on the editor opens like Open', async () => {
    const text = 'print("dropped")\n';
    await p.$eval('.pycon .ck-ed', (el, t) => {
      const dt = new DataTransfer();
      dt.items.add(new File([t], 'notes.txt', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, text);
    await p.waitForFunction((t) => document.querySelector('.pycon textarea.pycon-code').value === t, text, { timeout: 10000 });
    const d = await download('.pycon-download');
    expect(d.name === 'notes.py' && d.text === text, `download ${d.name}`);
  });

  await step('Full view: the console over the whole screen as a dialog; Esc puts it back in the pane', async () => {
    const where = () => p.evaluate(() => {
      const el = document.querySelector('.pycon');
      return { full: el.classList.contains('ck-full'), role: el.getAttribute('role'),
               body: el.parentElement === document.body, pane: !!el.closest('#pane') };
    });
    await p.click('.pycon-full');
    const on = await where();
    expect(on.full && on.role === 'dialog' && on.body && !on.pane, `full view: ${JSON.stringify(on)}`);
    await axe('in full view');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('.pycon').classList.contains('ck-full'), null, { timeout: 5000 });
    const off = await where();
    expect(!off.full && off.role === null && off.pane, `after Esc: ${JSON.stringify(off)}`);
  });

  await step('no page errors', async () => { expect(!errs.length, errs.join(' | ')); });
  await ctx.close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
