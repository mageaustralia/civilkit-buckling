const LAYOUTS = [['compact', 0], ['medium', 600], ['expanded', 1024]];
const listeners = new Set();
const sheets = [];
const opener = new WeakMap();      // the element that had the focus when a sheet opened

/* A sheet is a dialog: modal on a phone (a bottom sheet over the tab), a non-modal panel beside the
   drawing on a tablet or desktop. Opening it moves the focus to its title, so a screen reader reads
   it and Tab continues inside it (no keyboard pops up, as it would on a field); closing it gives the
   focus back to what opened it, or to the sheet below it. */
function show(el) {
  el.setAttribute('aria-modal', String(shell.layout === 'compact'));
  const title = el.querySelector('h3, [data-autofocus]');
  if (title) { if (!title.hasAttribute('tabindex')) title.tabIndex = -1; title.focus({ preventScroll: true }); }
}
function hide(el) {
  el.hidden = true;
  const had = el.contains(document.activeElement) || document.activeElement === document.body;
  const back = opener.get(el);
  opener.delete(el);
  if (!had) return;                // the focus has moved on by itself (another control was clicked)
  if (back && back.isConnected && back.offsetParent !== null) back.focus({ preventScroll: true });
  else if (sheets.length) show(sheets[sheets.length - 1]);
}
const classify = (w) => LAYOUTS.filter(([, min]) => w >= min).pop()[0];

export const shell = {
  layout: classify(document.documentElement.clientWidth),
  tab: 'section',
  onLayout(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  go(tab) {
    shell.tab = tab;
    document.body.dataset.tab = tab;
    for (const b of document.querySelectorAll('[data-go]')) b.setAttribute('aria-selected', String(b.dataset.go === tab));
    history.replaceState({ ...history.state, tab }, '');
  },
  openSheet(el, { detent = 'medium' } = {}) {
    el.dataset.detent = detent;
    const close = () => {
      const i = sheets.indexOf(el);
      if (i < 0) return;
      sheets.splice(i, 1);
      hide(el);
    };
    if (sheets.includes(el)) return close;                   // already open: a new detent only
    opener.set(el, document.activeElement);
    el.hidden = false;
    sheets.push(el);
    show(el);
    history.pushState({ sheet: sheets.length }, '');        // so Android back and iOS swipe close it
    /* wired once per sheet: a sheet opened again and again must not stack its close handlers,
       or one tap on Done would go back several entries */
    if (!el.dataset.closeWired) {
      el.dataset.closeWired = '1';
      for (const b of el.querySelectorAll('[data-close]'))
        b.addEventListener('click', () => { if (sheets.includes(el)) history.back(); });
    }
    return close;
  },
  /* close one open sheet through the history, as its own close button does */
  closeSheet(el) { if (sheets.includes(el)) history.back(); },
  isOpen(el) { return sheets.includes(el); },
  back() {
    if (sheets.length) { hide(sheets.pop()); return true; }
    return false;
  },
};

addEventListener('popstate', () => { shell.back(); });
/* Esc closes the top sheet, the way its ✕ does; on a phone, Tab and Shift-Tab stay inside it */
addEventListener('keydown', (e) => {
  const top = sheets[sheets.length - 1];
  if (!top || e.defaultPrevented) return;
  if (e.key === 'Escape') { e.preventDefault(); shell.closeSheet(top); return; }
  if (e.key !== 'Tab' || shell.layout !== 'compact') return;
  const f = [...top.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
new ResizeObserver(([e]) => {
  const next = classify(e.contentRect.width);
  if (next === shell.layout) return;
  shell.layout = next;
  document.body.dataset.layout = next;
  for (const el of sheets) el.setAttribute('aria-modal', String(next === 'compact'));
  for (const fn of listeners) fn(next);
}).observe(document.documentElement);
document.body.dataset.layout = shell.layout;
/* the app bar's real height, published as --appbar-h: the medium rail is pinned under it, and
   the header's height differs by width (wrapping) and layout, so a fixed value would either
   overlap it or leave a gap */
const appbar = document.querySelector('header');
if (appbar) new ResizeObserver(() => {
  document.documentElement.style.setProperty('--appbar-h',
    `${Math.round(appbar.getBoundingClientRect().height)}px`);   // border box: the sticky offset needs padding too
}).observe(appbar);

/* The soft keyboard. iOS overlays it on the layout viewport, so a bottom sheet (position: fixed;
   bottom: 0) would sit behind it; --kb is the height it covers, and the sheets stand on it. Android
   resizes the layout viewport instead, which leaves --kb at 0. */
const vv = window.visualViewport;
if (vv) {
  const kb = () => document.documentElement.style.setProperty("--kb", vv.scale > 1.01 ? "0px" :
    `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`);
  vv.addEventListener('resize', kb);
  vv.addEventListener('scroll', kb);
  kb();
}
