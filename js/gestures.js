/* Touch gestures on the section drawing: two-finger pinch zooms and pans, one finger pans an
   empty part of a zoomed drawing, a tap picks a node or an element, a long-press on a node drags
   it, and a double-tap on empty canvas fits the view. Pointer Events throughout, so a pen works
   like a finger. A mouse keeps the page's own click and drag editing: it only pans a zoomed
   drawing from empty canvas, and a trackpad pinch (ctrl + wheel) zooms.

   Three coordinate spaces: the client (CSS px), the SVG's viewBox ("screen" units here), and the
   drawing - the viewBox coordinates the section was drawn in before the view transform
   { s, tx, ty } was applied (screen = drawing * s + t). The app maps drawing to model mm with the
   same fit it drew with. The pure helpers below carry the arithmetic and are unit-tested. */

export const S_MIN = 0.25, S_MAX = 20;
const clampS = (s) => Math.min(S_MAX, Math.max(S_MIN, s));

export const toView = (v, q) => ({ x: q.x * v.s + v.tx, y: q.y * v.s + v.ty });
export const fromView = (v, p) => ({ x: (p.x - v.tx) / v.s, y: (p.y - v.ty) / v.s });

/* the view after a pinch from fingers `a0` to fingers `a1` (two points each), started at view v0:
   the scale follows the finger spread, and the drawing point that was under the fingers' midpoint
   stays under it */
export function pinchView(v0, a0, a1) {
  const d0 = Math.hypot(a0[0].x - a0[1].x, a0[0].y - a0[1].y) || 1;
  const d1 = Math.hypot(a1[0].x - a1[1].x, a1[0].y - a1[1].y);
  const m0 = { x: (a0[0].x + a0[1].x) / 2, y: (a0[0].y + a0[1].y) / 2 };
  const m1 = { x: (a1[0].x + a1[1].x) / 2, y: (a1[0].y + a1[1].y) / 2 };
  const s = clampS(v0.s * d1 / d0), q = fromView(v0, m0);
  return { s, tx: m1.x - q.x * s, ty: m1.y - q.y * s };
}

/* zoom by `factor` about screen point c (the ± buttons zoom about the centre) */
export function zoomAbout(v, factor, c) {
  const s = clampS(v.s * factor), q = fromView(v, c);
  return { s, tx: c.x - q.x * s, ty: c.y - q.y * s };
}

/* index of the nearest point within radiusPx on screen (pxPerUnit = screen px per drawing unit),
   or -1 */
export function nearestNode(pts, q, radiusPx, pxPerUnit) {
  let best = -1, bd = Infinity;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y) * pxPerUnit;
    if (d <= radiusPx && d < bd) { bd = d; best = i; }
  });
  return best;
}

/* index of the nearest segment [a, b] within radiusPx on screen, or -1 */
export function nearestSegment(segs, q, radiusPx, pxPerUnit) {
  let best = -1, bd = Infinity;
  segs.forEach(([a, b], i) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const u = L2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2)) : 0;
    const d = Math.hypot(a.x + u * dx - q.x, a.y + u * dy - q.y) * pxPerUnit;
    if (d <= radiusPx && d < bd) { bd = d; best = i; }
  });
  return best;
}

/* v rounded to the nearest multiple of step, without float noise (and never -0) */
export const snapTo = (v, step) => +(Math.round(v / step) * step).toPrecision(12) || 0;

const LONG_PRESS = 350, SLOP = 6, TAP2 = 300;

/* h: {
     pick(q, pxPerUnit) -> { node } | { elem } | null    what lies under drawing point q
     onTap(q, target, pointerType)                         a tap (not a drag) at drawing point q
     onLongPressDrag(node, q)                              the dragged node is now under q
     onDragEnd(node)
     onViewChange(view)
     addMode() -> bool                                     a double-tap does not fit in add mode
   } */
export function attachCanvasGestures(svg, h) {
  const pts = new Map();                 // pointerId -> screen point (touch and pen)
  let view = { s: 1, tx: 0, ty: 0 }, pinch = null, press = null, timer = 0, lastTap = null;
  const ctm = () => svg.getScreenCTM();
  const toScreen = (e) => {
    const m = ctm();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const pxPerUnit = () => (ctm()?.a || 1) * view.s;
  const zoomed = () => view.s !== 1 || view.tx !== 0 || view.ty !== 0;
  const apply = () => h.onViewChange?.({ ...view });
  const dragging = () => !!(press && press.dragging);

  svg.style.touchAction = 'pan-y';       // a finger can still scroll the page past the drawing
  /* the page scrolls only when the gesture is not ours: a pinch, a node drag, or a pan of a
     zoomed drawing keep their touchmoves (non-passive, so preventDefault holds) */
  svg.addEventListener('touchmove', (e) => {
    if (pinch || e.touches.length > 1 || dragging() || (press && !press.target && zoomed())) e.preventDefault();
  }, { passive: false });
  svg.addEventListener('gesturestart', (e) => e.preventDefault());   // iOS page zoom

  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') {
      if (e.button !== 0 || !zoomed()) return;
      const p = toScreen(e);
      if (h.pick(fromView(view, p), pxPerUnit())) return;   // a node: the page's own mouse drag
      press = { p, c: { x: e.clientX, y: e.clientY }, target: null, moved: false, dragging: false, mouse: true };
      return;
    }
    try { svg.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    pts.set(e.pointerId, toScreen(e));
    if (pts.size === 2) {                // a pinch starts: whatever the first finger began is off
      clearTimeout(timer);
      if (press?.dragging) h.onDragEnd?.(press.target.node);
      press = null;
      pinch = { a0: [...pts.values()], v0: { ...view } };
      return;
    }
    if (pts.size > 2) return;
    const p = toScreen(e), target = h.pick(fromView(view, p), pxPerUnit());
    press = { p, c: { x: e.clientX, y: e.clientY }, target, moved: false, dragging: false };
    if (target?.node != null)
      timer = setTimeout(() => {
        if (press && !press.moved) { press.dragging = true; navigator.vibrate?.(10); }
      }, LONG_PRESS);
  });

  svg.addEventListener('pointermove', (e) => {
    if (press?.mouse) {
      const p = toScreen(e);
      if (!press.moved && Math.hypot(e.clientX - press.c.x, e.clientY - press.c.y) <= SLOP) return;
      press.moved = true;
      view = { ...view, tx: view.tx + (p.x - press.p.x), ty: view.ty + (p.y - press.p.y) };
      press.p = p; apply();
      return;
    }
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, toScreen(e));
    if (pinch) {
      if (pts.size === 2) { view = pinchView(pinch.v0, pinch.a0, [...pts.values()]); apply(); }
      return;
    }
    if (!press) return;
    const p = toScreen(e);
    if (!press.moved && Math.hypot(e.clientX - press.c.x, e.clientY - press.c.y) > SLOP) {
      press.moved = true;
      if (!press.dragging) clearTimeout(timer);
    }
    if (press.dragging) h.onLongPressDrag?.(press.target.node, fromView(view, p));
    else if (press.moved && !press.target) {          // one finger pans the drawing
      view = { ...view, tx: view.tx + (p.x - press.p.x), ty: view.ty + (p.y - press.p.y) };
      press.p = p; apply();
    }
  });

  const end = (e) => {
    if (press?.mouse) {
      if (press.moved)                  // a pan is not a click: the page's click handler skips it
        svg.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
      press = null;
      return;
    }
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size === 0) pinch = null; return; }   // lifting a pinch is never a tap
    clearTimeout(timer);
    if (!press) return;
    const pr = press;
    press = null;
    if (pr.dragging) { h.onDragEnd?.(pr.target.node); return; }
    if (pr.moved || e.type === 'pointercancel') return;
    const now = performance.now();
    if (!pr.target && lastTap && now - lastTap.t < TAP2 && Math.hypot(pr.c.x - lastTap.c.x, pr.c.y - lastTap.c.y) < 24
        && !h.addMode?.()) {
      lastTap = null;
      api.fit();
      return;
    }
    lastTap = { t: now, c: pr.c };
    h.onTap?.(fromView(view, pr.p), pr.target, e.pointerType);
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('wheel', (e) => {          // a trackpad pinch arrives as ctrl + wheel
    if (!e.ctrlKey) return;
    e.preventDefault();
    view = zoomAbout(view, Math.exp(-e.deltaY / 100), toScreen(e));
    apply();
  }, { passive: false });

  const api = {
    get view() { return { ...view }; },
    get dragging() { return dragging(); },
    fit() { view = { s: 1, tx: 0, ty: 0 }; apply(); },
    setView(v) { view = { s: clampS(v.s), tx: v.tx, ty: v.ty }; apply(); },
    zoom(factor) {
      const vb = svg.viewBox.baseVal;
      view = zoomAbout(view, factor, { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 });
      apply();
    },
    detach() { /* listeners live on the svg, which the page keeps for its lifetime */ },
  };
  return api;
}
