// Applied before first paint (loaded as a plain script, ahead of app.js) so the stored
// theme does not flash. Kept out of index.html because the page now carries a CSP.
try { const t = localStorage.getItem('cufsmTheme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch { /* */ }