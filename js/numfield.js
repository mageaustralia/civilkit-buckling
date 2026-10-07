/* Number fields for touch: text inputs with the decimal keypad (inputmode="decimal"), a ± key
   where the value may be negative (the iOS decimal pad has no minus), the unit beside the value,
   and an inline message - never an alert - for a value that cannot be used, which is then not
   committed. parseNum is the one parser every numeric input in the app goes through. */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function parseNum(text, { min = -Infinity, max = Infinity, allowNegative = true, above, integer = false } = {}) {
  const t = String(text).trim().replace(/[−–]/g, '-').replace(/^(-?\d*),(\d+)$/, '$1.$2');
  if (t === '') return { ok: false, message: 'Enter a number' };
  const v = Number(t);
  if (!Number.isFinite(v)) return { ok: false, message: `"${String(text).trim()}" is not a number` };
  if (!allowNegative && v < 0) return { ok: false, message: 'Must be positive' };
  if (above !== undefined && !(v > above)) return { ok: false, message: `Must be above ${above}` };
  if (integer && !Number.isInteger(v)) return { ok: false, message: 'Must be a whole number' };
  if (v < min) return { ok: false, message: `Must be at least ${min}` };
  if (v > max) return { ok: false, message: `Must be at most ${max}` };
  return { ok: true, value: v };
}

/* the markup, for pages that build with template strings; bindNumField wires it */
export function numFieldHtml({ id, label, unit = '', value, allowNegative = true, cls = '', title = '' }) {
  return `<div class="field numfield ${cls}"${title ? ` title="${esc(title)}"` : ''}><label for="${esc(id)}">${esc(label)}</label>
    <div class="inp"><input id="${esc(id)}" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off"
      spellcheck="false" value="${esc(value)}">${unit ? `<span class="u">${esc(unit)}</span>` : ''}${
      allowNegative ? '<button type="button" class="pm" aria-label="Change sign" title="Change sign (+/−)" tabindex="-1">±</button>' : ''}</div>
    <div class="msg" role="alert" hidden></div></div>`;
}

/* live: commit on every keystroke that parses (the drawing follows as you type); the message
   then waits for the field to be left, so a half-typed "-" is not shouted at */
export function bindNumField(wrap, { min, max, allowNegative = true, above, integer, live = false, onCommit }) {
  const input = wrap.querySelector('input'), msg = wrap.querySelector('.msg');
  const opts = { min, max, allowNegative, above, integer };
  let last = parseNum(input.value, opts).ok ? parseNum(input.value, opts).value : undefined;
  const commit = (say) => {
    const r = parseNum(input.value, opts);
    if (say || r.ok) {
      msg.hidden = r.ok; msg.textContent = r.ok ? '' : r.message;
      input.setAttribute('aria-invalid', String(!r.ok));
    }
    if (r.ok && r.value !== last) { last = r.value; onCommit(r.value); }
  };
  input.addEventListener('change', () => commit(true));
  if (live) input.addEventListener('input', () => commit(false));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('focus', () => {
    /* the page may have set the value since (a shared link, a recommendation, undo): the next
       edit is compared with what the field shows, not with the last value typed into it */
    const r = parseNum(input.value, opts);
    last = r.ok ? r.value : undefined;
    revealAboveKeyboard(input);
  });
  wrap.querySelector('.pm')?.addEventListener('click', () => {
    const r = parseNum(input.value);
    if (!r.ok) return;
    input.value = String(-r.value || 0);
    commit(true);
  });
  return wrap;
}

export function numField(o) {
  const t = document.createElement('template');
  t.innerHTML = numFieldHtml(o).trim();
  return bindNumField(t.content.firstElementChild, o);
}

/* Keep a focused field above the soft keyboard: once the visual viewport has settled (the
   keyboard's resize, or a short wait where there is no resize), centre the field in what is left. */
export function revealAboveKeyboard(input) {
  const vv = window.visualViewport;
  let done = false;
  const reveal = () => {
    if (done || document.activeElement !== input) return;
    done = true;
    input.scrollIntoView({ block: 'center', behavior: 'instant' });
  };
  if (vv) vv.addEventListener('resize', reveal, { once: true });
  setTimeout(reveal, 400);
}
