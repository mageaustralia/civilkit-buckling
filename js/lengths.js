/* The analysis length list: log-spaced fills and a sanitising parser for the textarea. */
export function logLengths(min, max, n) {
  const a = Math.log10(min), b = Math.log10(max);
  return Array.from({ length: n }, (_, i) => 10 ** (a + (b - a) * i / (n - 1)));
}

export function parseLengths(text) {
  const seen = new Set(), lengths = [], dropped = [];
  for (const tok of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const v = Number(tok);
    if (!Number.isFinite(v) || v <= 0) { dropped.push(tok); continue; }
    if (seen.has(v)) { dropped.push(`duplicate ${tok}`); continue; }
    seen.add(v); lengths.push(v);
  }
  return { lengths: lengths.sort((x, y) => x - y), dropped };
}
