/* A virtual list: only the rows in view (and a few either side) are in the DOM, so a pasted
   2,000-node model scrolls on a phone. Rows have one fixed height. */
export function virtualList(container, { count, rowHeight, render }) {
  container.classList.add('vlist');
  container.style.overflowY = 'auto';
  container.style.position = 'relative';
  const spacer = document.createElement('div');
  spacer.style.position = 'relative';
  container.replaceChildren(spacer);
  let n = count, frame = 0;
  const draw = () => {
    frame = 0;
    spacer.style.height = `${n * rowHeight}px`;
    const h = container.clientHeight || rowHeight * 12;
    const first = Math.max(0, Math.floor(container.scrollTop / rowHeight) - 5);
    const last = Math.min(n, Math.ceil((container.scrollTop + h) / rowHeight) + 5);
    const rows = [];
    for (let i = first; i < last; i++) {
      const el = render(i);
      el.classList.add('vlist-row');
      el.style.cssText += `;position:absolute;left:0;right:0;top:${i * rowHeight}px;height:${rowHeight}px`;
      rows.push(el);
    }
    spacer.replaceChildren(...rows);
  };
  container.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(draw); }, { passive: true });
  draw();
  return { refresh(c = n) { n = c; draw(); } };
}
