/* Full view: an element shown over the whole viewport as a modal dialog, and put back where it was.
   The element moves to <body> (fixed positioning inside the app's size container would be clipped
   to it) with a placeholder where it was; the focus is kept inside, Esc leaves, and the viewer's
   choice is remembered under storageKey. Used by the module builder and the Python console. */
export function fullView({ el, button, label, storageKey, focusTarget = () => button, onChange = () => {},
  openText = '⤢ Full view', closeText = '✕ Close full view', openTitle = 'Open over the whole screen' }) {
  let full = false, placeholder = null, returnFocus = null;
  const toBody = () => {
    placeholder?.remove();
    placeholder = document.createComment('full view');
    el.replaceWith(placeholder);
    document.body.appendChild(el);
  };
  function set(on, remember = false) {
    if (on === full || (on && !el.isConnected)) return;
    full = on;
    if (remember && storageKey) { try { localStorage.setItem(storageKey, on ? '1' : '0'); } catch { /* a per-viewer nicety */ } }
    if (on) {
      returnFocus = document.activeElement;
      toBody();
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', typeof label === 'function' ? label() : label);
    } else {
      if (placeholder?.isConnected) placeholder.replaceWith(el);
      placeholder = null;
      for (const a of ['role', 'aria-modal', 'aria-label']) el.removeAttribute(a);
    }
    el.classList.toggle('ck-full', on);
    document.documentElement.classList.toggle('ck-lock', on);
    button.textContent = on ? closeText : openText;
    button.setAttribute('aria-pressed', String(on));
    button.title = on ? 'Back to the normal view (Esc)' : openTitle;
    onChange(on);
    if (on) focusTarget().focus({ preventScroll: true });
    else if (remember && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else if (remember) button.focus({ preventScroll: true });
  }
  button.textContent = openText;
  button.title = openTitle;
  button.setAttribute('aria-pressed', 'false');
  button.classList.add('ck-expand');
  button.addEventListener('click', () => set(!full, true));

  /* a layout change can move the element's old parent: keep the full view on top */
  const layoutWatch = new MutationObserver(() => {
    if (full && el.parentNode !== document.body && el.isConnected) toBody();
  });
  layoutWatch.observe(document.body, { attributes: true, attributeFilter: ['data-layout'] });
  const trapFocus = (e) => {
    if (full && !el.contains(e.target) && !e.target.closest?.('.ext-toast')) focusTarget().focus({ preventScroll: true });
  };
  document.addEventListener('focusin', trapFocus);
  /* Esc on the document, not just the element: a button that disables itself while it works (Run)
     drops the focus to <body>, and Esc must still leave */
  const onEsc = (e) => {
    if (full && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); set(false, true); }
  };
  document.addEventListener('keydown', onEsc);
  el.addEventListener('keydown', (e) => {
    if (!full || e.key !== 'Tab' || e.defaultPrevented) return;
    const f = [...el.querySelectorAll('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });
  return {
    set,
    get on() { return full; },
    /* reopen if the viewer left it open last time */
    restore(alive = () => true) {
      setTimeout(() => {
        let want = false;
        try { want = storageKey && localStorage.getItem(storageKey) === '1'; } catch { /* */ }
        if (want && alive()) set(true);
      }, 0);
    },
    destroy() {
      if (full) set(false);
      layoutWatch.disconnect();
      document.removeEventListener('focusin', trapFocus);
      document.removeEventListener('keydown', onEsc);
    },
  };
}
