/* Places the minimum labels on a chart so none prints over another or leaves the plot.
   items: [{ px, py, w, h? }] - the marker's position and the label's width in chart units, in
   priority order (the first is placed first). frame: { x0, y0, x1, y1 }, the plot area.
   Returns per item { x, y, w, h, anchor } (x the left edge, y the text baseline) or null when no
   candidate place is free: the readout under the chart lists every minimum, so a dropped label
   loses nothing. The candidates are right or left of the marker, above or below it, then two
   step further out vertically, staggering a pair of close minima. Obstacles ([x0, y0, x1, y1]
   boxes, such as the markers) are kept clear too. */
export function placeLabels(items, frame, { h = 12, gap = 9, obstacles = [] } = {}) {
  const placed = obstacles.map((box) => ({ box }));        // e.g. the markers themselves
  const free = (b) => b[0] >= frame.x0 && b[2] <= frame.x1 && b[1] >= frame.y0 && b[3] <= frame.y1 &&
    !placed.some((p) => p && b[0] < p.box[2] && p.box[0] < b[2] && b[1] < p.box[3] && p.box[1] < b[3]);
  return items.map(({ px, py, w, h: hh = h }) => {
    const rightFirst = px + gap + w <= frame.x1;
    const sides = rightFirst ? ['start', 'end'] : ['end', 'start'];
    for (const dy of [-gap, gap + hh, -gap - hh - 4, gap + 2 * hh + 4])
      for (const anchor of sides) {
        const x = anchor === 'start' ? px + gap : px - gap - w;
        const y = py + dy;                                        // baseline
        const b = [x, y - hh, x + w, y + 2];                      // descenders below the baseline
        if (free(b)) {
          const l = { x, y, w, h: hh, anchor, box: b };
          placed.push(l);
          return { x, y, w, h: hh, anchor };
        }
      }
    placed.push(null);
    return null;
  });
}
