/* The guide's page script: Python highlighting (the module builder's own highlighter), a Copy
   button on code blocks, a keyboard stop on code and tables that scroll, the Contents toggle on
   narrow screens, and the theme button, which cycles and stores the theme exactly as the app's ◐ does (same localStorage key, read before
   first paint by ../js/theme.js). Every page works without it: the code is plain text, Contents
   is a link to #g-nav, and the theme follows the system. */
import { highlight } from '../js/ext/pyhighlight.js';

for (const code of document.querySelectorAll('pre > code.language-python')) {
  code.innerHTML = highlight(code.textContent);           // highlight() escapes every character
}

for (const pre of document.querySelectorAll('.g-main pre')) {
  const code = pre.querySelector('code');
  if (!code || !navigator.clipboard) continue;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'g-copy';
  b.textContent = 'Copy';
  b.setAttribute('aria-label', 'Copy this code');
  b.onclick = async () => {
    try { await navigator.clipboard.writeText(code.textContent); b.textContent = 'Copied'; }
    catch { b.textContent = 'Select and copy'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1500);
  };
  const wrap = document.createElement('div');            // the button sits on the wrapper, so it
  wrap.className = 'g-code';                              // stays put while the code scrolls sideways
  pre.replaceWith(wrap);
  wrap.append(pre, b);
}

/* code and tables can scroll sideways (and long code down): each is a keyboard stop, so it can be
   scrolled without a mouse */
for (const el of document.querySelectorAll('.g-main pre, .g-main .g-table')) el.tabIndex = 0;

const nav = document.getElementById('g-nav');
const navBtn = document.querySelector('.g-navbtn');
if (nav && navBtn) {
  navBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    navBtn.setAttribute('aria-expanded', String(open));
    if (open) nav.querySelector('a[aria-current="page"]')?.focus({ preventScroll: true });
  });
  nav.addEventListener('click', (e) => {         // a link on this page closes the folded nav
    if (e.target.closest('a') && nav.classList.contains('open')) {
      nav.classList.remove('open');
      navBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

const themeBtn = document.querySelector('.g-theme');
if (themeBtn) themeBtn.onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('cufsmTheme', next); } catch { /* the theme just isn't remembered */ }
};
