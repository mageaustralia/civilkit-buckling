import { chromium } from 'playwright';
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(BASE);
await page.waitForFunction(() => document.getElementById('footerNote')?.textContent.includes('engine'));
const steps = (await import('./steps.mjs')).default;       // grows task by task
for (const [name, fn] of steps) {
  try { await fn(page); console.log('ok  ', name); }
  catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; }
}
if (errors.length) { console.log('page errors:\n' + errors.join('\n')); process.exitCode = 1; }
await browser.close();
