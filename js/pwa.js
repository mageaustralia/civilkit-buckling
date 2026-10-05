/* The installable offline app: the service worker, the "new version" prompt,
   the offline indicator and the install button. Web only: the store apps (Task 9) ship their files
   inside the app and skip the worker.

   The worker (sw.js, written by tools/precache.mjs) sits beside index.html and is registered by a
   relative URL with scope './', so on the site it is the /apps/buckling/ folder's and nothing else's.
   On localhost it is registered only with ?sw=1, and one left over from such a visit is removed
   without it, so a developer's edit and reload always shows the edit. */
const $ = (id) => document.getElementById(id);

export function startPwa({ toast = () => {} } = {}) {
  offlineIndicator();
  installButton();
  if (!('serviceWorker' in navigator) || window.Capacitor?.isNativePlatform?.()) return;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (local && !new URLSearchParams(location.search).has('sw')) {
    navigator.serviceWorker.getRegistrations()
      .then((rs) => rs.forEach((r) => { if (r.scope === new URL('./', location.href).href) r.unregister(); }))
      .catch(() => {});
    return;
  }
  register(toast).catch((e) => console.warn('service worker:', e));
}

async function register(toast) {
  let controlled = !!navigator.serviceWorker.controller;   // false: this visit installs the first worker
  const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
  let reloading = false, asked = false;
  /* the new worker took over: in the tab that asked, load the new release; in any other open tab,
     say so (its modules are the old release's, so a lazy load could now meet a newer file) */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }    // the first install claiming this page
    if (asked) { if (!reloading) { reloading = true; location.reload(); } return; }
    showUpdate(null, 'A new version is running in another tab.');
  });
  const offer = (w) => showUpdate(() => { asked = true; w.postMessage('skipWaiting'); });
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    let fresh = false;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') { if (navigator.serviceWorker.controller) offer(w); else fresh = true; }
      if (w.state === 'activated' && fresh) toast('Ready to work offline.', '', null, 4000);
    });
  });
  // a page left open for days still learns of a release: look again when it comes back to view
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

/* the update prompt: persistent until Reload or Later (a 6 s toast would be missed) */
function showUpdate(onReload, msg = 'A new version is ready.') {
  const bar = $('swUpdate');
  if (!bar) return;
  bar.querySelector('span').textContent = msg;
  const [reload, later] = bar.querySelectorAll('button');
  reload.onclick = () => {
    reload.disabled = true;
    if (onReload) onReload(); else location.reload();
  };
  later.onclick = () => { bar.hidden = true; };
  bar.hidden = false;
}

/* navigator.onLine alone says true on a network with no way out, so the page also asks the server
   for sw.js's headers: a HEAD request, which the worker leaves to the network */
async function reachable() {
  if (!navigator.onLine) return false;
  try { await fetch(`sw.js?online=${Date.now()}`, { method: 'HEAD', cache: 'no-store' }); return true; }
  catch { return false; }
}
function offlineIndicator() {
  const chip = $('netState');
  if (!chip) return;
  let gen = 0;
  const sync = async () => { const g = ++gen, ok = await reachable(); if (g === gen) chip.hidden = ok; };
  addEventListener('online', sync);
  addEventListener('offline', sync);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  sync();
}

/* Chromium's install prompt, kept for the Install button; Safari has none (Share, Add to Home
   Screen), and an installed app (display-mode: standalone) shows no button. */
function installButton() {
  const b = $('installBtn');
  if (!b) return;
  let deferred = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    b.hidden = matchMedia('(display-mode: standalone)').matches;
  });
  b.onclick = async () => {
    if (!deferred) return;
    b.hidden = true;
    const ev = deferred;
    deferred = null;
    await ev.prompt();
  };
  addEventListener('appinstalled', () => { b.hidden = true; deferred = null; });
}
