/* Python syntax highlighting for the module builder's editor, and the line a MicroPython
   traceback points at. Pure (no DOM): tokenize() splits source into typed pieces whose texts
   join back to the source exactly; highlight() turns them into escaped HTML spans. One pass over
   the whole text, so a triple-quoted string carries across lines with no per-line state.

   Token types (CSS class `py-<type>`): kw, builtin, const (True, False, None), str, comment,
   num, deco, def (the name after def or class), call (a name followed by "("), op. Anything
   else (names, brackets, commas, whitespace) is plain text: type null. */

const KEYWORDS = new Set(('and as assert async await break class continue def del elif else except finally for '
  + 'from global if import in is lambda nonlocal not or pass raise return try while with yield').split(' '));
const CONSTS = new Set(['True', 'False', 'None']);
const BUILTINS = new Set(('abs all any bin bool bytearray bytes callable chr classmethod dict dir divmod enumerate '
  + 'filter float format getattr globals hasattr hash hex id input int isinstance issubclass iter len list locals '
  + 'map max min next object oct open ord pow print property range repr reversed round set setattr slice sorted '
  + 'staticmethod str sum super tuple type vars zip self '
  + 'Exception BaseException ArithmeticError AssertionError AttributeError ImportError IndexError KeyError '
  + 'KeyboardInterrupt LookupError MemoryError NameError NotImplementedError OSError OverflowError RuntimeError '
  + 'StopIteration SyntaxError TypeError ValueError ZeroDivisionError').split(' '));

const IDENT = /[A-Za-z_À-￿][\wÀ-￿]*/y;
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?)/y;
const STRING_START = /(?:[rR][bBfF]?|[bBfF][rR]?|[uU])?(?:'''|"""|'|")/y;
const OPERATOR = /(?:->|:=|\*\*=?|\/\/=?|<<=?|>>=?|[-+*/%&|^@<>=!]=?|[~:])/y;
const DECORATOR = /@[A-Za-z_][\w.]*/y;

const at = (re, src, i) => { re.lastIndex = i; const m = re.exec(src); return m ? m[0] : null; };

/* The end of a string whose quote (', ", ''' or """) starts at `q`: a backslash skips the next
   character; a one-quote string also ends at a newline (unterminated), a triple-quoted one runs
   on to the end of the text if never closed. */
function stringEnd(src, q, quote) {
  const triple = quote.length === 3;
  let i = q + quote.length;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (!triple && c === '\n') return i;
    if (src.startsWith(quote, i)) return i + quote.length;
    i++;
  }
  return src.length;
}

export function tokenize(src) {
  src = String(src ?? '');
  const out = [];
  const push = (type, text) => {
    const last = out[out.length - 1];
    if (last && last.type === type && type === null) last.text += text;
    else out.push({ type, text });
  };
  let i = 0, afterDef = false, lineStart = true;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { push(null, c); i++; lineStart = true; afterDef = false; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { push(null, c); i++; continue; }
    const wasLineStart = lineStart;
    lineStart = false;
    if (c === '#') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = src.length;
      push('comment', src.slice(i, j)); i = j; continue;
    }
    const s = at(STRING_START, src, i);
    if (s) {
      const quote = s.replace(/^[A-Za-z]+/, '');
      const end = stringEnd(src, i + s.length - quote.length, quote);
      push('str', src.slice(i, end)); i = end; afterDef = false; continue;
    }
    const id = at(IDENT, src, i);
    if (id) {
      let type = null;
      if (afterDef) type = 'def';
      else if (CONSTS.has(id)) type = 'const';
      else if (KEYWORDS.has(id)) type = 'kw';
      else if (BUILTINS.has(id)) type = 'builtin';
      else if (/^[ \t]*\(/.test(src.slice(i + id.length, i + id.length + 40))) type = 'call';
      afterDef = type === 'kw' && (id === 'def' || id === 'class');
      push(type, id); i += id.length; continue;
    }
    afterDef = false;
    const n = /[\d.]/.test(c) ? at(NUMBER, src, i) : null;
    if (n && n !== '.') { push('num', n); i += n.length; continue; }
    if (c === '@' && wasLineStart) {
      const d = at(DECORATOR, src, i);
      if (d) { push('deco', d); i += d.length; continue; }
    }
    const op = at(OPERATOR, src, i);
    if (op) { push('op', op); i += op.length; continue; }
    push(null, c); i++;
  }
  return out;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

export function highlight(src) {
  return tokenize(src).map((t) => (t.type ? `<span class="py-${t.type}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text))).join('');
}

/* The main.py line a MicroPython error points at: { line, message } with line null when it names
   none. Module code runs as "<stdin>"; the host calls build_ui and check through a one-line
   wrapper, so a call's traceback starts with that wrapper's `line 1, in <module>` frame, which is
   not a line of main.py. The innermost remaining frame is the one that failed. Also reads the
   "(main.py line N)" a worked example's one-line error carries (errorText in examples.js). */
export function tracebackLine(text) {
  const msg = String(text ?? '');
  const lines = msg.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const frames = [];
  for (const l of lines) {
    const m = /^File "<stdin>", line (\d+)(?:, in (.+))?$/.exec(l);
    if (m) frames.push({ line: +m[1], fn: m[2] ?? null });
  }
  let message = lines.length ? lines[lines.length - 1] : '';
  if (!frames.length) {
    const m = /\(main\.py line (\d+)\)\s*$/.exec(msg);
    return m ? { line: +m[1], message: msg.slice(0, m.index).trim() } : { line: null, message };
  }
  if (frames[0].line === 1 && frames[0].fn === '<module>') frames.shift();
  const f = frames[frames.length - 1];
  return { line: f ? f.line : null, message };
}
