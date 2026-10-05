import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, highlight, escapeHtml, tracebackLine } from '../js/ext/pyhighlight.js';
import { errorText } from '../js/ext/examples.js';

const typed = (src) => tokenize(src).filter((t) => t.type).map((t) => [t.type, t.text]);
const kinds = (src, type) => tokenize(src).filter((t) => t.type === type).map((t) => t.text);

test('the tokens join back to the source exactly', () => {
  for (const src of ['', 'x', 'def f(a, b=2):\n    return a ** b  # done\n', '"""a\n#b\n"""\n@d\nclass K: pass',
                     "s = 'it\\'s'\n", 'x = """never closed\n\n', '<a href="&">']) {
    assert.equal(tokenize(src).map((t) => t.text).join(''), src);
  }
});

test('keywords, builtins and constants', () => {
  assert.deepEqual(kinds('if x and not y: return None', 'kw'), ['if', 'and', 'not', 'return']);
  assert.deepEqual(kinds('n = len(xs) + float(v)', 'builtin'), ['len', 'float']);
  assert.deepEqual(kinds('a = True or False is None', 'const'), ['True', 'False', 'None']);
  assert.deepEqual(kinds('raise ValueError("no")', 'builtin'), ['ValueError']);
  assert.deepEqual(kinds('iffy = classic', 'kw'), []);            // a keyword prefix is a name
});

test('def and class names, and function calls', () => {
  assert.deepEqual(typed('def check(inputs):'), [['kw', 'def'], ['def', 'check'], ['op', ':']]);
  assert.deepEqual(kinds('class Beam(object):', 'def'), ['Beam']);
  assert.deepEqual(kinds('y = call("firstYield", {"fy": fy})\nz = obj.method (1)\nw = name', 'call'), ['call', 'method']);
});

test('strings: quotes, prefixes and escaped quotes', () => {
  assert.deepEqual(kinds(`a = 'one' + "two"`, 'str'), [`'one'`, `"two"`]);
  assert.deepEqual(kinds(`r'\\d+' b"x" f"{v}" rb'y' Rb"z" u'w'`, 'str'), [`r'\\d+'`, 'b"x"', 'f"{v}"', "rb'y'", 'Rb"z"', "u'w'"]);
  assert.deepEqual(kinds(`s = "say \\"hi\\"" + 'it\\'s'`, 'str'), [`"say \\"hi\\""`, `'it\\'s'`]);
  // an unterminated one-quote string stops at the end of its line
  assert.deepEqual(typed(`a = 'oops\nb = 1`), [['op', '='], ['str', "'oops"], ['op', '='], ['num', '1']]);
});

test('a triple-quoted string spans lines, quotes and all', () => {
  const src = 'x = """first\nit\'s "quoted"\n# not a comment\n"""\ny = 2';
  assert.deepEqual(kinds(src, 'str'), ['"""first\nit\'s "quoted"\n# not a comment\n"""']);
  assert.deepEqual(kinds(src, 'comment'), []);
  assert.deepEqual(kinds(src, 'num'), ['2']);
  assert.deepEqual(kinds("d = '''a\nb'''", 'str'), ["'''a\nb'''"]);
  assert.deepEqual(kinds('t = """open\nto the end', 'str'), ['"""open\nto the end']);
});

test('a # inside a string is not a comment; one outside is, to the end of its line', () => {
  assert.deepEqual(kinds('s = "#ff0000"  # red\nt = 1', 'comment'), ['# red']);
  assert.deepEqual(kinds('s = "#ff0000"  # red\nt = 1', 'str'), ['"#ff0000"']);
  assert.deepEqual(kinds("# 'not a string'", 'str'), []);
});

test('numbers: ints, floats, exponents, hex, octal, binary, complex', () => {
  assert.deepEqual(kinds('a = 1 + 2.5 - .5 + 1. + 1e6 + 2.5E-3 + 0xFF + 0o17 + 0b101 + 1_000 + 3j', 'num'),
    ['1', '2.5', '.5', '1.', '1e6', '2.5E-3', '0xFF', '0o17', '0b101', '1_000', '3j']);
  assert.deepEqual(kinds('x1 = y2', 'num'), []);                   // digits inside a name
});

test('decorators at the start of a line; @ elsewhere is an operator', () => {
  assert.deepEqual(kinds('@property\n  @functools.wraps(f)\ndef g(): pass', 'deco'), ['@property', '@functools.wraps']);
  assert.deepEqual(kinds('c = a @ b', 'deco'), []);
  assert.deepEqual(kinds('c = a @ b', 'op'), ['=', '@']);
});

test('operators', () => {
  assert.deepEqual(kinds('a += b ** 2 // c != d -> e := f <= g', 'op'), ['+=', '**', '//', '!=', '->', ':=', '<=']);
});

test('HTML special characters are escaped everywhere', () => {
  assert.equal(escapeHtml(`<b a="1">'&'</b>`), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;');
  const html = highlight('s = "<script>alert(1)</script>"  # a < b & c\nx = a<b');
  assert.ok(!/<script|<\/script|<b\b/.test(html), html);
  assert.match(html, /<span class="py-str">&quot;&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;<\/span>/);
  assert.match(html, /<span class="py-comment"># a &lt; b &amp; c<\/span>/);
  assert.match(html, /x <span class="py-op">=<\/span> a<span class="py-op">&lt;<\/span>b$/);
});

test('highlight wraps each typed token in its class and leaves plain text bare', () => {
  assert.equal(highlight('def f(x):\n    return x'),
    '<span class="py-kw">def</span> <span class="py-def">f</span>(x)<span class="py-op">:</span>\n    <span class="py-kw">return</span> x');
});

test('tracebackLine: the main.py line from a MicroPython traceback', () => {
  // a syntax error while loading
  assert.deepEqual(tracebackLine('Traceback (most recent call last):\n  File "<stdin>", line 4\nSyntaxError: invalid syntax\n'),
    { line: 4, message: 'SyntaxError: invalid syntax' });
  // a top-level error while loading
  assert.deepEqual(tracebackLine('Traceback (most recent call last):\n  File "<stdin>", line 2, in <module>\nNameError: name \'q\' isn\'t defined\n').line, 2);
  // inside check, called through the host's one-line wrapper: the inner frame, prefixed by the module name
  assert.deepEqual(tracebackLine('My module: Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n  File "<stdin>", line 6, in check\nZeroDivisionError: divide by zero\n'),
    { line: 6, message: 'ZeroDivisionError: divide by zero' });
  // the wrapper's own frame is not a line of main.py
  assert.equal(tracebackLine('Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\nNameError: name \'check\' isn\'t defined\n').line, null);
  assert.equal(tracebackLine('fy must be positive').line, null);
  // a worked example's one-line error
  assert.deepEqual(tracebackLine('ZeroDivisionError: divide by zero (main.py line 6)'), { line: 6, message: 'ZeroDivisionError: divide by zero' });
});

test('errorText keeps the failing main.py line on its one line', () => {
  const tb = 'Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n  File "<stdin>", line 6, in check\nZeroDivisionError: divide by zero\n';
  assert.equal(errorText(new Error(tb)), 'ZeroDivisionError: divide by zero (main.py line 6)');
  assert.equal(errorText(new Error('plain')), 'plain');
});
