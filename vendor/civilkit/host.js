// @ts-check
// @civilkit/moduleui/host - declarative host-owned module UI renderer.
// Security invariant: a module emits a JSON tree; the host creates EVERY DOM node.
// Module text is always set via textContent. There is no HTML-injection path.
//
// This file has NO imports: it is the renderer body, vendored as-is by any host
// (units conversion and calc-line typesetting are injected through options).

// ---- shapes ---------------------------------------------------------------------
// The UI tree is open JSON from a sandboxed module: `type` picks the renderer, the keys
// below are the ones this renderer reads, and anything else is passed through untouched
// (hosts and modules ship their own keys, hence the open index signatures).

/**
 * One node of the module UI tree.
 * @typedef {{ [k: string]: any,
 *   type?: string, id?: string, label?: string, title?: string, unit?: string,
 *   inputType?: string, default?: any, step?: number|string, min?: number|string, max?: number|string,
 *   help?: string, variant?: string, action?: string, collapsed?: boolean, cols?: number|string[],
 *   tone?: string, shortcut?: string, separator?: boolean, disabled?: boolean, group?: string,
 *   children?: UINode[], columns?: {key: string, label?: string}[],
 *   rows?: Record<string, any>[],
 *   items?: {label?: string, value?: any, unit?: string, status?: string}[],
 *   lines?: CalcLine[],
 *   options?: (string | {value?: string, label?: string})[],
 *   chart?: string, height?: number, xLabel?: string, yLabel?: string,
 *   xMin?: number, xMax?: number, yMin?: number, yMax?: number, markers?: boolean,
 *   labelWidth?: number, threshold?: number, thresholdLabel?: string,
 *   series?: XYSeries[], bars?: XYBar[] }} UINode
 */
/**
 * @typedef {{ x: any, y: any }} XYPoint
 * @typedef {{ label?: string, points?: XYPoint[], color?: string }} XYSeries
 * @typedef {{ kind?: string, points?: number[][], at?: number[], from?: number[], to?: number[],
 *   r?: number, text?: string, tone?: string, width?: number, dash?: boolean,
 *   fill?: string|boolean, anchor?: string }} DrawItem
 * @typedef {{ id?: any, label?: string, value?: any, valueLabel?: string, tone?: string, sub?: string }} XYBar
 * @typedef {{ standard?: string, year?: string, clause?: string, label?: string, eq?: string, tex?: string }} CalcLine
 * @typedef {{ toDisplay: (v: number|null|undefined, unit: string, system?: string) => number|null|undefined,
 *             fromDisplay: (v: number|null|undefined, unit: string, system?: string) => number|null|undefined,
 *             unitLabel: (unit: string, system?: string) => string }} UnitsAdapter
 * @typedef {{ [k: string]: any,
 *   onEvent?: (e: HostEvent) => void, system?: string,
 *   units?: UnitsAdapter, typeset?: (el: Element) => void,
 *   customNodes?: Record<string, (node: UINode, h: { svgEl: typeof svgEl, makeEl: typeof makeEl, setText: typeof setText, onEvent: (e: HostEvent) => void }) => Element> }} ModuleHostOpts
 * @typedef {{ action: string, target?: string, id?: any, label?: string, value?: number,
 *             inputs?: Record<string, string|number|boolean|null|undefined>, [k: string]: any }} HostEvent
 * @typedef {{ el: EventTarget, type: string, fn: EventListener }} Listener
 * @typedef {{ focusId?: string|null, vals: Record<string, string|boolean> }} Snapshot
 * @typedef {{ separator?: boolean, disabled?: boolean, id?: string, label?: string,
 *             action?: string, shortcut?: string, moduleId?: string }} MenuItem
 * @typedef {{ label?: string, group?: string, children?: MenuItem[] }} MenuDef
 * @typedef {{ id: string, name?: string, badge?: string, menus?: MenuDef[] }} ModuleDescriptor
 * @typedef {{ list: () => ModuleDescriptor[], ready?: Promise<void> }} RegistryLike
 * @typedef {{ [k: string]: any, registry?: RegistryLike|null,
 *   onEvent?: (e: HostEvent) => void, getTrust?: (id: string) => string }} MenuBarOpts
 */

const SYSTEM = 'si';

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  // Every colour is a --mui-* variable; the block below holds the defaults (Studio's
  // dark palette). A host themes by overriding the variables on its own scope -
  // e.g. light/dark tokens, or --mui-target: 48px under `pointer: coarse`.
  const css = `
    .mui-host {
      --mui-bg:#0f1218;
      --mui-panel:#161b22;
      --mui-hover:#1e2733;
      --mui-line:#2b3040;
      --mui-line2:#20242e;
      --mui-ink:#dfe4ee;
      --mui-ink2:#cdd3df;
      --mui-ink3:#8a93a6;
      --mui-ink4:#6e7681;
      --mui-ink5:#aab;
      --mui-accent:#4f7bd0;
      --mui-accent-hi:#5d87d8;
      --mui-accent-lo:#4471c4;
      --mui-inv:#fff;
      --mui-ok:#7fd07f;
      --mui-ok-bg:#152515;
      --mui-ok-line:#2a4a2a;
      --mui-warn:#f0c674;
      --mui-warn-bg:#2d2415;
      --mui-warn-line:#5a4a20;
      --mui-fail:#e08a8a;
      --mui-fail-bg:#2a1515;
      --mui-fail-line:#5a2a2a;
      --mui-thr:#e0b34a;
      --mui-series-1:#4f7bd0;
      --mui-series-2:#4bbf73;
      --mui-series-3:#e0b34a;
      --mui-series-4:#c07de0;
      --mui-div-1:#3a6ecb;
      --mui-div-2:#6f9be0;
      --mui-div-3:#a9c1ef;
      --mui-div-4:#9aa4b6;
      --mui-div-5:#e0a9a9;
      --mui-div-6:#d47a7a;
      --mui-div-7:#c05252;
      --mui-target:0px;
      color:var(--mui-ink);
      font:14px/1.5 -apple-system,system-ui,sans-serif;
    }
    .mui-host * { box-sizing:border-box; }
    .mui-panel { background:var(--mui-bg); border:1px solid var(--mui-line); border-radius:8px; padding:16px; }
    .mui-panel-title { font-size:15px; font-weight:600; margin:0 0 12px; color:var(--mui-ink); }
    .mui-tabs { display:flex; gap:4px; border-bottom:1px solid var(--mui-line); margin-bottom:12px; }
    .mui-tab { padding:8px 14px; cursor:pointer; color:var(--mui-ink3); border-bottom:2px solid transparent; font-size:13px; background:transparent; border-top:none; border-left:none; border-right:none; }
    .mui-tab.active { color:var(--mui-ink); border-bottom-color:var(--mui-accent); }
    .mui-tab-body { display:none; }
    .mui-tab-body.active { display:block; }
    .mui-section { border:1px solid var(--mui-line); border-radius:6px; margin-bottom:10px; overflow:hidden; }
    .mui-section-title { background:var(--mui-panel); padding:8px 12px; cursor:pointer; color:var(--mui-ink); font-size:13px; font-weight:600; display:flex; justify-content:space-between; }
    .mui-section-body { padding:12px; }
    .mui-section.collapsed .mui-section-body { display:none; }
    .mui-row { display:grid; gap:14px; margin-bottom:10px; align-items:start; }
    .mui-field { margin-bottom:10px; }
    .mui-field label { display:block; color:var(--mui-ink3); font-size:12px; margin-bottom:4px; }
    .mui-field input, .mui-field select { width:100%; background:var(--mui-bg); border:1px solid var(--mui-line); border-radius:4px; color:var(--mui-ink); padding:7px 9px; font-size:13px; min-height:var(--mui-target); }
    .mui-field input:focus, .mui-field select:focus { outline:none; border-color:var(--mui-accent); }
    .mui-field-bool label { display:flex; align-items:center; gap:8px; color:var(--mui-ink); font-size:13px; margin:0; cursor:pointer; min-height:var(--mui-target); }
    .mui-field-bool input[type=checkbox] { width:auto; min-height:0; margin:0; padding:0; flex:none; accent-color:var(--mui-accent); }
    .mui-field-unit { color:var(--mui-ink3); margin-left:4px; }
    .mui-field-help { color:var(--mui-ink4); font-size:11px; margin-top:3px; }
    .mui-button { background:var(--mui-accent); border:none; border-radius:5px; color:var(--mui-inv); padding:8px 14px; font-size:13px; cursor:pointer; transition:background .12s, transform .06s; min-height:var(--mui-target); }
    .mui-button:hover { background:var(--mui-accent-hi); }
    .mui-button:active { transform:translateY(1px); background:var(--mui-accent-lo); }
    .mui-button.secondary { background:transparent; border:1px solid var(--mui-line); color:var(--mui-ink5); }
    .mui-button:disabled { opacity:0.5; cursor:not-allowed; }
    .mui-table { width:100%; border-collapse:collapse; font-size:12px; }
    .mui-table th, .mui-table td { text-align:left; padding:7px 9px; border-bottom:1px solid var(--mui-line2); }
    .mui-table th { color:var(--mui-ink3); font-weight:600; }
    .mui-result { background:var(--mui-bg); border:1px solid var(--mui-line); border-radius:8px; padding:12px; }
    .mui-result-item { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid var(--mui-line2); }
    .mui-result-item:last-child { border-bottom:none; }
    .mui-result-value.ok { color:var(--mui-ok); }
    .mui-result-value.over { color:var(--mui-fail); }
    .mui-calc { position:relative; }
    .mui-copy { position:absolute; top:0; right:0; background:transparent; border:1px solid var(--mui-line); color:var(--mui-ink3); border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer; }
    .mui-copy:hover { color:var(--mui-ink); border-color:var(--mui-accent); }
    .mui-calc-line { padding:8px 0; border-top:1px solid var(--mui-line2); }
    .mui-calc-clause { color:var(--mui-ink3); font-size:11px; }
    .mui-calc-label { font-size:12px; margin:2px 0; }
    .mui-calc-eq { font-size:12px; color:var(--mui-ink2); }
    .mui-text { color:var(--mui-ink5); font-size:13px; margin:6px 0; }
    .mui-badge { display:inline-block; border-radius:4px; padding:2px 8px; font-size:11px; }
    .mui-badge.ok { background:var(--mui-ok-bg); color:var(--mui-ok); border:1px solid var(--mui-ok-line); }
    .mui-badge.warn { background:var(--mui-warn-bg); color:var(--mui-warn); border:1px solid var(--mui-warn-line); }
    .mui-badge.fail { background:var(--mui-fail-bg); color:var(--mui-fail); border:1px solid var(--mui-fail-line); }
    .mui-unsupported { color:var(--mui-fail); font-size:12px; border:1px dashed var(--mui-fail-line); padding:6px 8px; border-radius:4px; }
    .mui-chart { margin:6px 0 2px; }
    .mui-chart-title { font-size:12px; color:var(--mui-ink3); text-transform:uppercase; letter-spacing:.03em; margin:0 0 8px; }
    .mui-chart-note { color:var(--mui-ink3); font-size:11px; margin:2px 0 4px; }
    .mui-chart-svg { width:100%; max-width:760px; height:auto; display:block; font-family:-apple-system,system-ui,sans-serif; }
    .mui-chart-lbl { fill:var(--mui-ink2); font-size:11px; }
    .mui-chart-val { fill:var(--mui-ink3); font-size:11px; }
    .mui-chart-bar rect { transition:opacity .12s; }
    .mui-chart-bar.clickable:hover rect { opacity:.82; }
    .mui-chart-bar.clickable:hover .mui-chart-val { fill:var(--mui-ink); }
    .mui-chart-thr { stroke:var(--mui-thr); stroke-width:1; stroke-dasharray:3 3; opacity:.85; }
    .mui-chart-thrlbl { fill:var(--mui-thr); font-size:10px; }
    .mui-chart-axis { stroke:var(--mui-line); stroke-width:1; }
    .mui-chart-axlbl { fill:var(--mui-ink3); font-size:11px; text-anchor:middle; }
    .mui-chart-tick { fill:var(--mui-ink3); font-size:10px; text-anchor:middle; }
    .mui-chart-grid { stroke:var(--mui-line); stroke-width:1; opacity:.45; }
    .mui-chart-minor { stroke:var(--mui-line2); stroke-width:1; }
    .mui-chart-annot circle { fill:var(--mui-accent); stroke:none; }
    .mui-chart-annot.ok circle { fill:var(--mui-ok); }
    .mui-chart-annot.warn circle { fill:var(--mui-warn); }
    .mui-chart-annot.fail circle { fill:var(--mui-fail); }
    .mui-chart-annot text { fill:var(--mui-ink2); font-size:10px; }
    .mui-chart-hit { fill:transparent; pointer-events:all; }
    .mui-chart-hover rect { fill:var(--mui-bg); stroke:var(--mui-line); }
    .mui-chart-hover text { fill:var(--mui-ink2); font-size:11px; }
    .mui-chart-legend { display:flex; flex-wrap:wrap; gap:12px; margin:4px 0 2px; font-size:11px; color:var(--mui-ink3); align-items:center; }
    .mui-legend-sw { display:inline-block; width:14px; height:3px; border-radius:2px; margin-right:5px; vertical-align:middle; }
    .mui-drawing { margin:6px 0 2px; }
    .mui-drawing svg { width:100%; height:auto; display:block; font-family:-apple-system,system-ui,sans-serif; }
    .mui-draw-line { fill:none; stroke:var(--mui-ink2); stroke-width:1.5; }
    .mui-drawing .tone-ok { stroke:var(--mui-ok); }
    .mui-drawing .tone-warn { stroke:var(--mui-warn); }
    .mui-drawing .tone-fail { stroke:var(--mui-fail); }
    .mui-drawing .tone-accent { stroke:var(--mui-accent); }
    .mui-draw-fill { fill:var(--mui-accent); fill-opacity:.15; }
    .mui-draw-circle { fill:none; stroke:var(--mui-ink3); }
    .mui-draw-text { fill:var(--mui-ink3); font-size:11px; }
    .mui-draw-dim { stroke:var(--mui-ink4); stroke-width:1; fill:none; }
    .mui-draw-dimtext { fill:var(--mui-ink4); font-size:10px; text-anchor:middle; }
    .mui-menubar { display:flex; gap:2px; background:var(--mui-bg); border:1px solid var(--mui-line); border-radius:6px; padding:4px; margin-bottom:12px; }
    .mui-menu { position:relative; }
    .mui-menu-btn { background:transparent; border:none; color:var(--mui-ink5); padding:6px 12px; font-size:13px; cursor:pointer; border-radius:4px; min-height:var(--mui-target); }
    .mui-menu-btn:hover { background:var(--mui-hover); color:var(--mui-ink); }
    .mui-menu-body { position:absolute; top:100%; left:0; min-width:160px; background:var(--mui-bg); border:1px solid var(--mui-line); border-radius:6px; padding:4px; display:none; z-index:100; }
    .mui-menu.open > .mui-menu-body { display:block; }
    .mui-menuitem { display:flex; justify-content:space-between; align-items:center; padding:6px 10px; cursor:pointer; border-radius:4px; color:var(--mui-ink); font-size:13px; min-height:var(--mui-target); }
    .mui-menuitem:hover { background:var(--mui-hover); }
    .mui-menuitem.disabled { color:var(--mui-ink4); cursor:not-allowed; }
    .mui-menuitem-kbd { color:var(--mui-ink3); font-size:11px; }
    .mui-separator { height:1px; background:var(--mui-line); margin:4px 0; }
    .mui-submenu-title { color:var(--mui-ink3); font-size:11px; padding:4px 10px; text-transform:uppercase; }
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}

function deepFreeze(/** @type {any} */ o) {
  if (o === null || typeof o !== 'object') return o;
  if (Object.isFrozen(o)) return o;
  Object.freeze(o);
  Object.getOwnPropertyNames(o).forEach(k => deepFreeze(o[k]));
  return o;
}

/**
 * @param {Record<string, unknown>} granted
 * @param {string[] | (() => string[] | null) | null} [allow]
 */
export function createCapabilityBridge(granted, allow = null) {
  const g = Object.assign({}, granted);
  // Optional per-manifest allow-list (least privilege): when a module's .ckext manifest declares the
  // capabilities it needs, only those are exposed - a capability the host offers but the module did not
  // declare throws, exactly like an undeclared one. Omit `allow` (null) to expose everything granted
  // (backward-compatible: a module with no declared capability list keeps the full read-only surface).
  //
  // `allow` may be an array (a fixed list) OR a function returning an array-or-null, resolved on each
  // call. The function form lets one shared bridge (registered once into a MicroPython runtime) narrow
  // to whichever module is currently running - the host sets the current module's declared list before
  // executing it, without re-registering the js module.
  const resolveAllow = () => {
    const a = typeof allow === 'function' ? (/** @type {Function} */ (allow))() : allow;
    return Array.isArray(a) ? new Set(a) : null;
  };
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      const allowSet = resolveAllow();
      if (allowSet && !allowSet.has(prop)) {
        return () => { throw new Error(`Capability '${prop}' not declared in the module manifest`); };
      }
      if (!(prop in g)) {
        return () => { throw new Error(`Capability '${prop}' not granted`); };
      }
      const fn = g[prop];
      if (typeof fn !== 'function') {
        return () => { throw new Error(`Capability '${prop}' is not callable`); };
      }
      // Return a deep-frozen COPY so a capability that hands back a reference to
      // the host's live model does not get the host's own object frozen in place.
      return (/** @type {unknown[]} */ ...args) => {
        const out = fn(...args);
        if (out && typeof out === 'object') {
          try { return deepFreeze(structuredClone(out)); } catch { return deepFreeze(out); }
        }
        return out;
      };
    }
  });
}

/**
 * @param {Element} el
 * @param {unknown} value
 */
function setText(el, value) {
  el.textContent = value == null ? '' : String(value);
}

/**
 * @template {keyof HTMLElementTagNameMap} T
 * @param {T} tag
 * @param {string} [cls]
 * @returns {HTMLElementTagNameMap[T]}
 */
function makeEl(tag, cls = undefined) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}

/**
 * @param {Element} el
 * @param {string|null|undefined} tone
 */
function applyTone(el, tone) {
  if (!tone) return;
  el.classList.add(tone);
}

const SVGNS = 'http://www.w3.org/2000/svg';
/**
 * @template {keyof SVGElementTagNameMap} T
 * @param {T} tag
 * @param {Record<string, string|number>} [attrs]
 * @returns {SVGElementTagNameMap[T]}
 */
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) el.setAttribute(k, /** @type {string} */ (attrs[k]));
  return el;
}
/** @type {Record<string, string>} */
const CHART_TONE = { ok: 'var(--mui-series-2)', warn: 'var(--mui-thr)', over: 'var(--mui-fail)', bad: 'var(--mui-fail)', accent: 'var(--mui-accent)' };

/**
 * @param {HTMLElement} mount
 * @param {ModuleHostOpts} [opts]
 */
export function createModuleHost(mount, opts = {}) {
  if (!mount) throw new Error('createModuleHost requires a mount element');
  injectStyles();

  const onEvent = opts.onEvent || (() => {});
  const system = opts.system || SYSTEM;
  // Units adapter and calc-line typesetter are injected; identity units and a
  // no-op typeset are the defaults (a host that carries no unit system or KaTeX
  // still renders - fields carry units in their labels).
  /** @type {UnitsAdapter} */
  const units = opts.units || { toDisplay: (v) => v, fromDisplay: (v) => v, unitLabel: () => '' };
  const typeset = opts.typeset || (() => {});
  // Host-defined node types: checked before the unsupported fallback, so a host can
  // render its own (e.g. buckling.section) while every unknown type still renders the box.
  const customNodes = opts.customNodes;

  const host = makeEl('div', 'mui-host');
  mount.appendChild(host);

  /** @type {string|null|undefined} */
  let activeTab = null;
  /** @type {UINode|null} */
  let tree = null;
  /** @type {Listener[]} */
  const listeners = [];

  function snapshot() {
    const focused = document.activeElement;
    const focusEl = /** @type {HTMLElement|null} */ (focused);
    const focusId = focusEl && focusEl.dataset && focusEl.dataset.muiid;
    /** @type {Record<string, string|boolean>} */
    const vals = {};
    (/** @type {NodeListOf<HTMLInputElement>} */ (host.querySelectorAll('[data-muiid]'))).forEach((el) => {
      vals[/** @type {string} */ (el.dataset.muiid)] = el.type === 'checkbox' ? el.checked : el.value;
    });
    return { focusId, vals };
  }

  function restore(/** @type {Snapshot|null|undefined} */ snap) {
    if (!snap) return;
    (/** @type {NodeListOf<HTMLInputElement>} */ (host.querySelectorAll('[data-muiid]'))).forEach((el) => {
      const id = /** @type {string} */ (el.dataset.muiid);
      if (id in snap.vals) {
        const v = snap.vals[id];
        if (el.type === 'checkbox') el.checked = !!v;
        else el.value = /** @type {string} */ (v);
      }
    });
    if (snap.focusId) {
      const el = /** @type {HTMLInputElement|null} */ (host.querySelector(`[data-muiid="${CSS.escape(snap.focusId)}"]`));
      if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
    }
  }

  /**
   * @param {EventTarget} el
   * @param {string} type
   * @param {EventListener} fn
   */
  function addListener(el, type, fn) {
    el.addEventListener(type, fn);
    listeners.push({ el, type, fn });
  }

  function renderNode(/** @type {UINode} */ node) {
    if (!node || typeof node !== 'object') {
      const el = makeEl('span', 'mui-unsupported');
      setText(el, 'unsupported node');
      return el;
    }
    const type = node.type;
    if (typeof type !== 'string') {
      const el = makeEl('span', 'mui-unsupported');
      setText(el, 'unsupported node: ' + String(type));
      return el;
    }

    switch (type) {
      case 'panel': return renderPanel(node);
      case 'tabs': return renderTabs(node);
      case 'tab': return renderTab(node);
      case 'section': return renderSection(node);
      case 'row': return renderRow(node);
      case 'field': return renderField(node);
      case 'button': return renderButton(node);
      case 'table': return renderTable(node);
      case 'result': return renderResult(node);
      case 'calc': return renderCalc(node);
      case 'text': return renderText(node);
      case 'badge': return renderBadge(node);
      case 'chart': return renderChart(node);
      case 'drawing': return renderDrawing(node);
      case 'menu': return renderMenu(node);
      case 'menuitem': return renderMenuitem(node);
      default: {
        const custom = customNodes && typeof customNodes === 'object' ? customNodes[type] : undefined;
        if (typeof custom === 'function') return custom(node, { svgEl, makeEl, setText, onEvent });
        const el = makeEl('div', 'mui-unsupported');
        setText(el, 'unsupported node: ' + type);
        return el;
      }
    }
  }

  /**
   * @param {Element} container
   * @param {UINode[]|undefined} children
   */
  function renderChildren(container, children) {
    if (!Array.isArray(children)) return;
    for (const c of children) container.appendChild(renderNode(c));
  }

  function renderPanel(/** @type {UINode} */ node) {
    const el = makeEl('div', 'mui-panel');
    if (node.title) {
      const h = makeEl('div', 'mui-panel-title');
      setText(h, node.title);
      el.appendChild(h);
    }
    renderChildren(el, node.children);
    return el;
  }

  function renderTabs(/** @type {UINode} */ node) {
    const wrap = makeEl('div', 'mui-tabs-wrap');
    const strip = makeEl('div', 'mui-tabs');
    const bodies = makeEl('div', 'mui-tab-bodies');
    const tabs = (node.children || []).filter((c) => c && c.type === 'tab');
    const first = activeTab && tabs.some((t) => t.label === activeTab) ? activeTab : (tabs[0] && tabs[0].label);

    tabs.forEach((t, idx) => {
      const btn = makeEl('button', 'mui-tab' + (t.label === first ? ' active' : ''));
      setText(btn, t.label || ('Tab ' + (idx + 1)));
      addListener(btn, 'click', () => {
        activeTab = t.label;
        strip.querySelectorAll('.mui-tab').forEach((b) => b.classList.toggle('active', b === btn));
        (/** @type {NodeListOf<HTMLElement>} */ (bodies.querySelectorAll('.mui-tab-body'))).forEach((b) => b.classList.toggle('active', b.dataset.label === t.label));
      });
      strip.appendChild(btn);

      const body = makeEl('div', 'mui-tab-body' + (t.label === first ? ' active' : ''));
      body.dataset.label = t.label || '';
      renderChildren(body, t.children);
      bodies.appendChild(body);
    });

    wrap.appendChild(strip);
    wrap.appendChild(bodies);
    return wrap;
  }

  function renderTab(/** @type {UINode} */ node) {
    // Tabs render their children directly inside a body; this helper is only used if a tab is rendered standalone.
    const el = makeEl('div', 'mui-tab-body active');
    renderChildren(el, node.children);
    return el;
  }

  function renderSection(/** @type {UINode} */ node) {
    const el = makeEl('div', 'mui-section' + (node.collapsed ? ' collapsed' : ''));
    const title = makeEl('div', 'mui-section-title');
    const span = makeEl('span');
    setText(span, node.title || '');
    title.appendChild(span);
    const arrow = makeEl('span');
    setText(arrow, node.collapsed ? '▸' : '▾');
    title.appendChild(arrow);
    addListener(title, 'click', () => {
      el.classList.toggle('collapsed');
      setText(arrow, el.classList.contains('collapsed') ? '▸' : '▾');
    });
    el.appendChild(title);
    const body = makeEl('div', 'mui-section-body');
    renderChildren(body, node.children);
    el.appendChild(body);
    return el;
  }

  function renderRow(/** @type {UINode} */ node) {
    const el = makeEl('div', 'mui-row');
    const cols = node.cols;
    // cols may be a number (N equal columns) or an array of fr ratios ([1,2] -> 33/66).
    if (Array.isArray(cols)) el.style.gridTemplateColumns = cols.map((c) => c + 'fr').join(' ');
    else el.style.gridTemplateColumns = `repeat(${cols || (node.children || []).length || 1}, 1fr)`;
    renderChildren(el, node.children);
    return el;
  }

  function renderField(/** @type {UINode} */ node) {
    const typ = node.inputType || 'string';
    // A checkbox sits INSIDE its label, before the text, as a form shows a yes/no: on its own row under
    // the label it was stretched to the field width and centred, reading as a stray control. Inside the
    // label the text is also its click target.
    const bool = typ === 'boolean';
    const wrap = makeEl('div', bool ? 'mui-field mui-field-bool' : 'mui-field');
    const label = makeEl('label');
    const labelText = bool ? makeEl('span') : label;
    setText(labelText, node.label || node.id || '');
    if (node.unit) {
      const u = makeEl('span', 'mui-field-unit');
      setText(u, units.unitLabel(node.unit, system));
      labelText.appendChild(u);
    }
    wrap.appendChild(label);

    let input;
    if (typ === 'enum' && Array.isArray(node.options)) {
      input = makeEl('select');
      for (const opt of node.options) {
        const o = makeEl('option');
        o.value = typeof opt === 'string' ? opt : (opt.value ?? '');
        setText(o, typeof opt === 'string' ? opt : (opt.label ?? opt.value ?? ''));
        input.appendChild(o);
      }
    } else if (typ === 'boolean') {
      input = makeEl('input');
      input.type = 'checkbox';
    } else {
      input = makeEl('input');
      input.type = typ === 'integer' ? 'number' : (typ === 'number' ? 'number' : 'text');
      if (node.step != null) input.step = String(node.step);
      if (node.min != null) input.min = String(node.min);
      if (node.max != null) input.max = String(node.max);
    }

    input.dataset.muiid = node.id || '';
    if (node.id) input.id = node.id;
    if (node.default != null) {
      if (typ === 'boolean') (/** @type {HTMLInputElement} */ (input)).checked = !!node.default;
      else {
        const displayDefault = node.unit ? units.toDisplay(node.default, node.unit, system) : node.default;
        input.value = displayDefault;
      }
    }
    // Emit a live change event so hosts can recompute without a button press.
    addListener(input, 'change', () => {
      onEvent({ action: 'change', target: node.id, inputs: getInputs() });
    });
    if (bool) { label.appendChild(input); label.appendChild(labelText); }
    else wrap.appendChild(input);

    if (node.help) {
      const help = makeEl('div', 'mui-field-help');
      setText(help, node.help);
      wrap.appendChild(help);
    }
    return wrap;
  }

  function renderButton(/** @type {UINode} */ node) {
    const btn = makeEl('button', 'mui-button' + (node.variant === 'secondary' ? ' secondary' : ''));
    setText(btn, node.label || node.id || 'Button');
    btn.type = 'button';
    addListener(btn, 'click', () => {
      onEvent({ action: node.action || 'click', target: node.id, inputs: getInputs() });
    });
    return btn;
  }

  function renderTable(/** @type {UINode} */ node) {
    const table = makeEl('table', 'mui-table');
    const thead = makeEl('thead');
    const htr = makeEl('tr');
    for (const col of (node.columns || [])) {
      const th = makeEl('th');
      setText(th, col.label || col.key || '');
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = makeEl('tbody');
    for (const row of (node.rows || [])) {
      const tr = makeEl('tr');
      for (const col of (node.columns || [])) {
        const td = makeEl('td');
        const v = row[col.key];
        setText(td, v == null ? '' : String(v));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
  }

  function renderResult(/** @type {UINode} */ node) {
    const el = makeEl('div', 'mui-result');
    for (const item of (node.items || [])) {
      const row = makeEl('div', 'mui-result-item');
      const lbl = makeEl('span');
      setText(lbl, item.label || '');
      row.appendChild(lbl);
      const val = makeEl('b', 'mui-result-value');
      let text = '';
      if (item.value != null) text += item.value;
      if (item.unit) text += (text ? ' ' : '') + item.unit;
      setText(val, text);
      applyTone(val, item.status);
      row.appendChild(val);
      el.appendChild(row);
    }
    return el;
  }

  // ---- chart node: host-drawn inline SVG (no external lib; injection-safe - the module
  //      supplies numbers, the host draws). chart:'bar' (horizontal, ranked, clickable) |
  //      'line' | 'scatter' (XY, e.g. interaction curves). All text via textContent. -------
  //      XY additions (all optional; a tree without them renders exactly as it always did):
  //      xScale/yScale 'linear'|'log', ticks, grid, legend, annotations, hover.
  function renderChart(/** @type {UINode} */ node) {
    const kind = node.chart || 'bar';
    const wrap = makeEl('div', 'mui-chart');
    if (node.title) { const h = makeEl('div', 'mui-chart-title'); setText(h, node.title); wrap.appendChild(h); }
    wrap.appendChild(kind === 'bar' ? chartBar(node) : chartXY(node, kind));
    return wrap;
  }

  function seriesColor(/** @type {XYSeries} */ s, /** @type {number} */ i) {
    return s.color || `var(--mui-series-${(i % 4) + 1})`;
  }

  function chartXY(/** @type {UINode} */ node, /** @type {string} */ kind) {
    const series = Array.isArray(node.series) ? node.series : [];
    const w = 720, h = node.height || 300, m = { l: 52, r: 14, t: 12, b: 34 };
    const xLog = node.xScale === 'log', yLog = node.yScale === 'log';

    // A log axis refuses values <= 0 (and any non-finite input): they are dropped from
    // the domain, counted, and reported as a note - never mapped into NaN geometry.
    let refused = 0;
    const kept = series.map((s) => {
      const sp = [];
      for (const pt of (Array.isArray(s.points) ? s.points : [])) {
        const x = Number(pt.x), y = Number(pt.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || (xLog && !(x > 0)) || (yLog && !(y > 0))) { refused++; continue; }
        sp.push({ x, y, raw: pt });
      }
      return { s, pts: sp };
    });
    const xs = kept.flatMap((k) => k.pts.map((p) => p.x));
    const ys = kept.flatMap((k) => k.pts.map((p) => p.y));
    const tx = xLog ? Math.log10 : (/** @type {number} */ v) => v;
    const ty = yLog ? Math.log10 : (/** @type {number} */ v) => v;
    const xMinOf = node.xMin != null && (!xLog || Number(node.xMin) > 0) ? tx(Number(node.xMin)) : null;
    const xMaxOf = node.xMax != null && (!xLog || Number(node.xMax) > 0) ? tx(Number(node.xMax)) : null;
    const yMinOf = node.yMin != null && (!yLog || Number(node.yMin) > 0) ? ty(Number(node.yMin)) : null;
    const yMaxOf = node.yMax != null && (!yLog || Number(node.yMax) > 0) ? ty(Number(node.yMax)) : null;
    // Domain: linear keeps the old defaults exactly (0 always inside); log spans only the
    // valid values, in log10 space.
    const xmin = xMinOf ?? (xLog ? (xs.length ? Math.min(...xs.map(tx)) : 0) : Math.min(0, ...xs, 0));
    const xmax = xMaxOf ?? (xLog ? (xs.length ? Math.max(...xs.map(tx)) : 1) : Math.max(...xs, 1));
    const ymin = yMinOf ?? (yLog ? (ys.length ? Math.min(...ys.map(ty)) : 0) : Math.min(0, ...ys, 0));
    const ymax = yMaxOf ?? (yLog ? (ys.length ? Math.max(...ys.map(ty)) : 1) : Math.max(...ys, 1));
    const spanX = (xmax - xmin) || 1;
    const spanY = (ymax - ymin) || 1;
    const sx = (/** @type {number} */ x) => m.l + (w - m.l - m.r) * ((tx(x) - xmin) / spanX);
    const sy = (/** @type {number} */ y) => (h - m.b) - (h - m.t - m.b) * ((ty(y) - ymin) / spanY);

    const box = makeEl('div', 'mui-chart-xy');
    if (refused > 0) {
      const note = makeEl('div', 'mui-chart-note');
      setText(note, `${refused} point${refused > 1 ? 's' : ''} outside the ${xLog || yLog ? 'logarithmic ' : ''}axis range ignored`);
      box.appendChild(note);
    }
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'mui-chart-svg', preserveAspectRatio: 'xMinYMin meet' });
    svg.appendChild(svgEl('line', { x1: m.l, y1: h - m.b, x2: w - m.r, y2: h - m.b, class: 'mui-chart-axis' }));
    svg.appendChild(svgEl('line', { x1: m.l, y1: m.t, x2: m.l, y2: h - m.b, class: 'mui-chart-axis' }));
    if (node.xLabel) { const t = svgEl('text', { x: (m.l + w - m.r) / 2, y: h - 4, class: 'mui-chart-axlbl' }); t.textContent = node.xLabel; svg.appendChild(t); }
    if (node.yLabel) { const yc = (m.t + h - m.b) / 2; const t = svgEl('text', { x: 14, y: yc, class: 'mui-chart-axlbl', transform: `rotate(-90 14 ${yc})` }); t.textContent = node.yLabel; svg.appendChild(t); }

    // Ticks: log axes always get decade labels; linear axes get nice-number (1, 2, 5 x 10^n)
    // labels when `ticks` is set. `grid` adds the matching gridlines. Minor 2/5 ticks are
    // drawn unlabelled on log axes.
    const wantTicks = node.ticks || xLog || yLog;
    const niceStep = (/** @type {number} */ range) => {
      const raw = range / 5;
      const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
      const n = (raw || 1) / mag;
      return mag * (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10);
    };
    const fmtTick = (/** @type {number} */ v, /** @type {number} */ step) => {
      const dec = Math.max(0, -Math.floor(Math.log10(step || 1)));
      const s = v.toFixed(Math.min(dec, 10));
      return dec ? s.replace(/\.?0+$/, '') : s;
    };
    /** Ticks on one axis. isX: labels below the axis; otherwise labels to its left. */
    const drawTicks = (/** @type {boolean} */ isLog, /** @type {number} */ lo, /** @type {number} */ hi,
      /** @type {(v: number) => number} */ map, /** @type {boolean} */ isX) => {
      if (!wantTicks) return;
      const tickLen = 4;
      const addTick = (/** @type {number} */ pos, /** @type {string} */ label, /** @type {boolean} */ minor) => {
        const px = isX ? pos : m.l;
        const py = isX ? h - m.b : pos;
        if (minor) {
          svg.appendChild(isX
            ? svgEl('line', { x1: px, y1: h - m.b, x2: px, y2: h - m.b + tickLen, class: 'mui-chart-minor' })
            : svgEl('line', { x1: m.l - tickLen, y1: py, x2: m.l, y2: py, class: 'mui-chart-minor' }));
          return;
        }
        svg.appendChild(isX
          ? svgEl('line', { x1: px, y1: h - m.b, x2: px, y2: h - m.b + tickLen, class: 'mui-chart-axis' })
          : svgEl('line', { x1: m.l - tickLen, y1: py, x2: m.l, y2: py, class: 'mui-chart-axis' }));
        if (node.grid) {
          svg.appendChild(isX
            ? svgEl('line', { x1: px, y1: m.t, x2: px, y2: h - m.b, class: 'mui-chart-grid' })
            : svgEl('line', { x1: m.l, y1: py, x2: w - m.r, y2: py, class: 'mui-chart-grid' }));
        }
        if (!label) return;
        const t = isX
          ? svgEl('text', { x: px, y: h - m.b + 15, class: 'mui-chart-tick' })
          : svgEl('text', { x: m.l - tickLen - 4, y: py + 3, class: 'mui-chart-tick' });
        if (!isX) t.style.textAnchor = 'end';
        t.textContent = label;
        svg.appendChild(t);
      };
      if (isLog) {
        for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
          const dec = Math.pow(10, k);
          addTick(map(dec), String(dec), false);
          for (const mult of [2, 5]) {
            const t = k + Math.log10(mult);
            if (t > lo && t < hi) addTick(map(mult * dec), '', true);
          }
        }
      } else {
        const step = niceStep(hi - lo);
        const first = Math.ceil(lo / step) * step;
        for (let v = first; v <= hi + step * 1e-9; v += step) {
          const val = Math.abs(v) < step * 1e-9 ? 0 : v;
          addTick(map(val), fmtTick(val, step), false);
        }
      }
    };
    if (wantTicks) {
      drawTicks(xLog, xmin, xmax, sx, true);
      drawTicks(yLog, ymin, ymax, sy, false);
    }

    series.forEach((s, i) => {
      const color = seriesColor(s, i);
      const sp = (Array.isArray(s.points) ? s.points : []).filter((pt) => {
        const x = Number(pt.x), y = Number(pt.y);
        return Number.isFinite(x) && Number.isFinite(y) && (!xLog || x > 0) && (!yLog || y > 0);
      });
      if (kind === 'line' && sp.length) {
        const pl = svgEl('polyline', { points: sp.map((pt) => `${sx(Number(pt.x))},${sy(Number(pt.y))}`).join(' '), fill: 'none', 'stroke-width': 2 });
        pl.style.stroke = color;
        svg.appendChild(pl);
      }
      if (kind === 'scatter' || node.markers) sp.forEach((pt) => {
        const c = svgEl('circle', { cx: sx(Number(pt.x)), cy: sy(Number(pt.y)), r: 3 });
        c.style.fill = color;
        svg.appendChild(c);
      });
    });

    // Annotations: marked, labelled points (e.g. curve minima).
    for (const a of (Array.isArray(node.annotations) ? node.annotations : [])) {
      const ax = Number(a.x), ay = Number(a.y);
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || (xLog && !(ax > 0)) || (yLog && !(ay > 0))) continue;
      const px = sx(ax), py = sy(ay);
      const g = svgEl('g', { class: 'mui-chart-annot' });
      applyTone(g, a.tone);
      g.appendChild(svgEl('circle', { cx: px, cy: py, r: 4 }));
      const atLeft = px > w - m.r - 80;
      const t = svgEl('text', { x: atLeft ? px - 7 : px + 7, y: Math.max(m.t + 10, py - 7) });
      if (atLeft) t.setAttribute('text-anchor', 'end');
      t.textContent = a.label == null ? '' : String(a.label);
      g.appendChild(t);
      svg.appendChild(g);
    }

    // Hover: a transparent hit rect over the plot; the nearest point in screen space gets a
    // readout group. touch-action:pan-y keeps a vertical page scroll working on touch.
    if (node.hover && kept.some((k) => k.pts.length)) {
      svg.style.touchAction = 'pan-y';
      const plotW = w - m.l - m.r, plotH = h - m.t - m.b;
      const hit = svgEl('rect', { x: m.l, y: m.t, width: plotW, height: plotH, class: 'mui-chart-hit' });
      addListener(hit, 'pointermove', (e) => {
        const { offsetX, offsetY } = /** @type {{ offsetX: number, offsetY: number }} */ (/** @type {unknown} */ (e));
        const ox = Math.min(Math.max(Number(offsetX) || 0, 0), plotW);
        const oy = Math.min(Math.max(Number(offsetY) || 0, 0), plotH);
        let best = null, bestD = Infinity;
        for (const k of kept) {
          for (const p of k.pts) {
            const d = Math.pow(sx(p.x) - m.l - ox, 2) + Math.pow(sy(p.y) - m.t - oy, 2);
            if (d < bestD) { bestD = d; best = { s: k.s, p }; }
          }
        }
        const prev = svg.querySelector('.mui-chart-hover');
        if (prev) prev.remove();
        if (!best) return;
        const label = `${best.s.label || 'point'} @ ${best.p.raw.x},${best.p.raw.y}`;
        const g = svgEl('g', { class: 'mui-chart-hover' });
        const px = sx(best.p.x), py = sy(best.p.y);
        const bw = label.length * 6.4 + 12, bh = 18;
        const bx = Math.min(px + 8, w - m.r - bw), by = Math.max(m.t, py - bh - 6);
        g.appendChild(svgEl('rect', { x: bx, y: by, width: bw, height: bh, rx: 3 }));
        const t = svgEl('text', { x: bx + 6, y: by + 13 });
        t.textContent = label;
        g.appendChild(t);
        svg.appendChild(g);
      });
      svg.appendChild(hit);
    }

    box.appendChild(svg);
    if (node.legend) {
      const legend = makeEl('div', 'mui-chart-legend');
      series.forEach((s, i) => {
        const item = makeEl('span');
        const sw = makeEl('span', 'mui-legend-sw');
        sw.style.background = seriesColor(s, i);
        item.appendChild(sw);
        const lbl = makeEl('span');
        setText(lbl, s.label || `series ${i + 1}`);
        item.appendChild(lbl);
        legend.appendChild(item);
      });
      box.appendChild(legend);
    }
    return box;
  }

  function chartBar(/** @type {UINode} */ node) {
    const bars = Array.isArray(node.bars) ? node.bars : [];
    const rowH = 22, top = 6, padL = 4, padR = 10, labelW = node.labelWidth || 150, valueW = 52;
    const w = 720, plotL = padL + labelW, plotR = w - padR - valueW, plotW = Math.max(40, plotR - plotL);
    const threshold = (node.threshold != null) ? Number(node.threshold) : null;
    const maxVal = node.max != null ? Number(node.max)
      : Math.max(threshold || 0, ...bars.map((b) => Number(b.value) || 0), 0.0001);
    const h = top + Math.max(bars.length, 1) * rowH + 4;
    const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, class: 'mui-chart-svg', preserveAspectRatio: 'xMinYMin meet' });
    if (threshold != null && threshold <= maxVal) {
      const tx = plotL + plotW * (threshold / maxVal);
      svg.appendChild(svgEl('line', { x1: tx, y1: 2, x2: tx, y2: h - 2, class: 'mui-chart-thr' }));
      const tl = svgEl('text', { x: tx + 3, y: 11, class: 'mui-chart-thrlbl' });
      tl.textContent = node.thresholdLabel || String(threshold);
      svg.appendChild(tl);
    }
    bars.forEach((b, i) => {
      const y = top + i * rowH, val = Number(b.value) || 0;
      const bw = Math.max(1, plotW * Math.min(val / maxVal, 1));
      const tone = b.tone || (threshold != null ? (val > threshold ? 'over' : 'ok') : 'accent');
      const fill = CHART_TONE[tone] || CHART_TONE.accent;
      const lbl = svgEl('text', { x: padL, y: y + rowH * 0.64, class: 'mui-chart-lbl' });
      lbl.textContent = b.label == null ? '' : String(b.label);
      svg.appendChild(lbl);
      const g = svgEl('g', { class: 'mui-chart-bar' + (b.id != null ? ' clickable' : '') });
      g.appendChild(svgEl('rect', { x: plotL, y: y + 3, width: bw, height: rowH - 8, rx: 3, fill }));
      const vt = svgEl('text', { x: plotL + bw + 6, y: y + rowH * 0.64, class: 'mui-chart-val' });
      vt.textContent = (b.valueLabel != null ? b.valueLabel : val.toFixed(2));
      g.appendChild(vt);
      if (b.id != null) {
        g.style.cursor = 'pointer';
        addListener(g, 'click', () => onEvent({ action: 'chartclick', target: node.id, id: b.id, label: b.label, value: val }));
        const ttl = svgEl('title'); ttl.textContent = (b.sub || b.label || '') + ' - ' + val.toFixed(2); g.appendChild(ttl);
      }
      svg.appendChild(g);
    });
    return svg;
  }

  // ---- drawing node: geometry, not a chart. Equal axes, auto-fit, host-drawn. The module
  //      supplies points; the host scales, flips and draws with textContent-only labels. ----
  function renderDrawing(/** @type {UINode} */ node) {
    // (Drawing items share the `items` key with result/badge nodes; the shapes differ per
    // kind, so they are read as open records and validated per field.)
    const items = /** @type {DrawItem[]} */ (/** @type {unknown} */ (Array.isArray(node.items) ? node.items : []));
    const flipY = node.flipY !== false;
    const maxH = Number(node.height) || 320;
    const pxs = [], pys = [];
    const take = (/** @type {number[]|undefined} */ p) => {
      const x = Number(p && p[0]), y = Number(p && p[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) { pxs.push(x); pys.push(y); }
    };
    for (const it of items) {
      if (it.kind === 'polyline' || it.kind === 'polygon') (Array.isArray(it.points) ? it.points : []).forEach(take);
      else if (it.kind === 'circle') { take(it.at); const r = Number(it.r) || 0; if (Array.isArray(it.at)) { pxs.push(Number(it.at[0]) - r, Number(it.at[0]) + r); pys.push(Number(it.at[1]) - r, Number(it.at[1]) + r); } }
      else if (it.kind === 'text') take(it.at);
      else if (it.kind === 'dimension') { take(it.from); take(it.to); }
    }
    const box = makeEl('div', 'mui-drawing');
    if (!pxs.length) {
      const bad = makeEl('div', 'mui-unsupported');
      setText(bad, 'unsupported drawing: nothing to draw');
      box.appendChild(bad);
      return box;
    }
    let xmin = Math.min(...pxs), xmax = Math.max(...pxs);
    let ymin = Math.min(...pys), ymax = Math.max(...pys);
    if (xmax - xmin < 1e-12) { xmin -= 0.5; xmax += 0.5; }
    if (ymax - ymin < 1e-12) { ymin -= 0.5; ymax += 0.5; }
    // 5% padding on each axis' own span keeps the data aspect ratio exact.
    const padX = 0.05 * (xmax - xmin), padY = 0.05 * (ymax - ymin);
    xmin -= padX; xmax += padX; ymin -= padY; ymax += padY;
    const dx = xmax - xmin, dy = ymax - ymin;
    const scale = Math.min(720 / dx, maxH / dy);
    const W = dx * scale, H = dy * scale;
    const tx = (/** @type {number} */ x) => (x - xmin) * scale;
    const ty = (/** @type {number} */ y) => (flipY ? ymax - y : y - ymin) * scale;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
    // colorBy: per-vertex values coloured by a blue-neutral-red ramp over [-max|v|, +max|v|].
    const ramp = (/** @type {number} */ v, /** @type {number} */ maxAbs) => {
      const t = maxAbs > 0 ? Math.max(-1, Math.min(1, v / maxAbs)) : 0;
      return `var(--mui-div-${Math.max(1, Math.min(7, Math.round((t + 1) * 3) + 1))})`;
    };
    for (const it of items) {
      const tone = it.tone ? ` ${it.tone}` : '';
      if (it.kind === 'polyline' || it.kind === 'polygon') {
        const pts = (Array.isArray(it.points) ? it.points : []).filter((p) => Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
        if (pts.length < 2) continue;
        if (node.colorBy && Array.isArray(node.colorBy.values)) {
          // Segmented colouring: one segment per vertex pair, its colour from the ramp.
          const vals = node.colorBy.values;
          const maxAbs = vals.reduce((/** @type {number} */ a, /** @type {number} */ v) => Math.max(a, Math.abs(Number(v) || 0)), 0);
          for (let i = 0; i < pts.length - 1; i++) {
            const v0 = Number(vals[i]), v1 = Number(vals[i + 1]);
            const seg = svgEl('polyline', {
              points: `${tx(Number(pts[i][0]))},${ty(Number(pts[i][1]))} ${tx(Number(pts[i + 1][0]))},${ty(Number(pts[i + 1][1]))}`,
              class: 'mui-draw-line'
            });
            seg.style.stroke = ramp((v0 + v1) / 2, maxAbs);
            svg.appendChild(seg);
          }
          continue;
        }
        const tag = it.kind === 'polygon' ? 'polygon' : 'polyline';
        /** @type {Record<string, string|number>} */
        const attrs = { points: pts.map((p) => `${tx(Number(p[0]))},${ty(Number(p[1]))}`).join(' '), class: `mui-draw-line${tone}` };
        if (it.width) attrs['stroke-width'] = Number(it.width);
        if (it.dash) attrs['stroke-dasharray'] = '5 4';
        const el = svgEl(tag, attrs);
        if (it.fill === true) el.classList.add('mui-draw-fill');
        else if (typeof it.fill === 'string' && it.fill) el.style.fill = it.fill;
        svg.appendChild(el);
      } else if (it.kind === 'circle') {
        const at = it.at || [0, 0];
        const c = svgEl('circle', { cx: tx(Number(at[0])), cy: ty(Number(at[1])), r: Math.max(1, (Number(it.r) || 1) * scale), class: `mui-draw-circle${tone}` });
        svg.appendChild(c);
      } else if (it.kind === 'text') {
        const at = it.at || [0, 0];
        const t = svgEl('text', { x: tx(Number(at[0])), y: ty(Number(at[1])), class: 'mui-draw-text' });
        if (it.anchor) t.setAttribute('text-anchor', it.anchor);
        t.textContent = it.text == null ? '' : String(it.text);
        svg.appendChild(t);
      } else if (it.kind === 'dimension') {
        const a = it.from || [0, 0], b = it.to || [0, 0];
        const x1 = tx(Number(a[0])), y1 = ty(Number(a[1])), x2 = tx(Number(b[0])), y2 = ty(Number(b[1]));
        svg.appendChild(svgEl('line', { x1, y1, x2, y2, class: 'mui-draw-dim' }));
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const t = svgEl('text', { x: mx, y: my - 4, class: 'mui-draw-dimtext' });
        t.textContent = it.text == null ? '' : String(it.text);
        svg.appendChild(t);
      } else {
        const bad = makeEl('div', 'mui-unsupported');
        setText(bad, 'unsupported drawing item: ' + String(it.kind));
        box.appendChild(bad);
      }
    }
    box.appendChild(svg);
    return box;
  }

  function calcCopyText(/** @type {CalcLine[]|undefined} */ lines) {
    return (lines || []).map((l) => {
      const ref = (l.standard ? l.standard + (l.year ? ':' + l.year : '') + ' ' : '') + (l.clause || '');
      return [ref.trim(), l.label, l.eq].filter(Boolean).join('\n');
    }).join('\n\n');
  }

  function renderCalc(/** @type {UINode} */ node) {
    const el = makeEl('div', 'mui-calc');
    const copyBtn = makeEl('button', 'mui-copy');
    copyBtn.type = 'button';
    setText(copyBtn, 'Copy');
    addListener(copyBtn, 'click', () => {
      const text = calcCopyText(node.lines);
      const done = () => { setText(copyBtn, 'Copied'); setTimeout(() => setText(copyBtn, 'Copy'), 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {});
    });
    el.appendChild(copyBtn);
    for (const l of (node.lines || [])) {
      const line = makeEl('div', 'mui-calc-line');
      if (l.clause || l.standard || l.year) {
        const clause = makeEl('div', 'mui-calc-clause');
        setText(clause, `${l.standard ? l.standard + (l.year ? ':' + l.year + ' ' : ' ') : ''}${l.clause || ''}`);
        line.appendChild(clause);
      }
      if (l.label) {
        const lab = makeEl('div', 'mui-calc-label');
        setText(lab, l.label);
        line.appendChild(lab);
      }
      const eq = makeEl('div', 'mui-calc-eq');
      eq.classList.add('dw-eq');
      if (l.tex) eq.dataset.tex = l.tex;
      setText(eq, l.eq || '');
      line.appendChild(eq);
      el.appendChild(line);
    }
    // KaTeX typeset lazily (injected; no-op by default).
    Promise.resolve().then(() => typeset(el));
    return el;
  }

  function renderText(/** @type {UINode} */ node) {
    const el = makeEl('div', 'mui-text');
    applyTone(el, node.tone);
    setText(el, node.value || '');
    return el;
  }

  function renderBadge(/** @type {UINode} */ node) {
    const el = makeEl('span', 'mui-badge');
    applyTone(el, node.tone);
    setText(el, node.value || '');
    return el;
  }

  function renderMenu(/** @type {UINode} */ node) {
    const wrap = makeEl('div', 'mui-menu');
    const btn = makeEl('button', 'mui-menu-btn');
    btn.type = 'button';
    setText(btn, node.label || 'Menu');
    addListener(btn, 'click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.contains('open');
      document.querySelectorAll('.mui-menu.open').forEach(m => m.classList.remove('open'));
      wrap.classList.toggle('open', !open);
    });
    wrap.appendChild(btn);
    const body = makeEl('div', 'mui-menu-body');
    renderChildren(body, node.children);
    wrap.appendChild(body);
    return wrap;
  }

  function renderMenuitem(/** @type {UINode} */ node) {
    if (node.separator) {
      return makeEl('div', 'mui-separator');
    }
    const el = makeEl('div', 'mui-menuitem' + (node.disabled ? ' disabled' : ''));
    const span = makeEl('span');
    setText(span, node.label || node.id || '');
    el.appendChild(span);
    if (node.shortcut) {
      const kbd = makeEl('span', 'mui-menuitem-kbd');
      setText(kbd, node.shortcut);
      el.appendChild(kbd);
    }
    if (!node.disabled) {
      addListener(el, 'click', (e) => {
        e.stopPropagation();
        onEvent({ action: node.action || 'click', target: node.id });
      });
    }
    return el;
  }

  function getInputs() {
    /** @type {Record<string, string|number|boolean|null|undefined>} */
    const out = {};
    (/** @type {NodeListOf<HTMLInputElement>} */ (host.querySelectorAll('[data-muiid]'))).forEach((el) => {
      const id = el.dataset.muiid;
      if (!id) return;
      const val = el.type === 'checkbox' ? el.checked : el.value;
      // Find the field node to recover unit/type for conversion back to SI.
      /** @type {(n: UINode|null) => UINode|null} */
      const findField = (n) => {
        if (!n || typeof n !== 'object') return null;
        if (n.type === 'field' && n.id === id) return n;
        if (Array.isArray(n.children)) {
          for (const c of n.children) { const f = findField(c); if (f) return f; }
        }
        return null;
      };
      const field = findField(tree);
      if (field && field.unit && typeof val === 'string' && val !== '') {
        const num = parseFloat(val);
        if (!isNaN(num)) out[id] = units.fromDisplay(num, field.unit, system);
        else out[id] = val;
      } else if (field && field.inputType === 'boolean') {
        out[id] = !!val;
      } else if (field && (field.inputType === 'number' || field.inputType === 'integer') && typeof val === 'string' && val !== '') {
        const num = field.inputType === 'integer' ? parseInt(val, 10) : parseFloat(val);
        out[id] = isNaN(num) ? val : num;
      } else {
        out[id] = val;
      }
    });
    return out;
  }

  function update(/** @type {UINode|null|undefined} */ newTree) {
    tree = newTree ?? null;
    const snap = snapshot();
    host.textContent = '';
    if (newTree) host.appendChild(renderNode(newTree));
    restore(snap);
  }

  function destroy() {
    for (const { el, type, fn } of listeners) el.removeEventListener(type, fn);
    listeners.length = 0;
    host.remove();
    styleInjected = false;
  }

  return { update, getInputs, destroy };
}

// Menu bar host chrome: auto-discovers installed modules from `registry` and builds
// the top-level Custom menu. Verified modules may also contribute to core menus
// via their `group` hint. The host owns every DOM node; module text is textContent.
/**
 * @param {HTMLElement} mount
 * @param {MenuBarOpts} [opts]
 */
export function createModuleMenuBar(mount, opts = {}) {
  if (!mount) throw new Error('createModuleMenuBar requires a mount element');
  injectStyles();

  const registry = opts.registry;
  const onEvent = opts.onEvent || (() => {});
  const getTrust = opts.getTrust || (() => 'community');
  /** @type {Listener[]} */
  const listeners = [];

  /**
   * @param {EventTarget} el
   * @param {string} type
   * @param {EventListener} fn
   */
  function addListener(el, type, fn) {
    el.addEventListener(type, fn);
    listeners.push({ el, type, fn });
  }

  function makeMenuItem(/** @type {MenuItem} */ item, /** @type {string|undefined} */ moduleId) {
    if (item.separator) return makeEl('div', 'mui-separator');
    const el = makeEl('div', 'mui-menuitem' + (item.disabled ? ' disabled' : ''));
    const span = makeEl('span');
    setText(span, item.label || item.id || '');
    el.appendChild(span);
    if (item.shortcut) {
      const kbd = makeEl('span', 'mui-menuitem-kbd');
      setText(kbd, item.shortcut);
      el.appendChild(kbd);
    }
    if (!item.disabled) {
      addListener(el, 'click', (e) => {
        e.stopPropagation();
        onEvent({ action: item.action || 'click', target: item.id, moduleId });
      });
    }
    return el;
  }

  function render() {
    mount.textContent = '';
    const bar = makeEl('div', 'mui-menubar');
    const customWrap = makeEl('div', 'mui-menu');
    const customBtn = makeEl('button', 'mui-menu-btn');
    customBtn.type = 'button';
    setText(customBtn, 'Custom');
    addListener(customBtn, 'click', (e) => {
      e.stopPropagation();
      const open = customWrap.classList.contains('open');
      mount.querySelectorAll('.mui-menu.open').forEach((m) => m.classList.remove('open'));
      customWrap.classList.toggle('open', !open);
    });
    customWrap.appendChild(customBtn);
    const customBody = makeEl('div', 'mui-menu-body');

    const mods = registry ? registry.list() : [];
    if (mods.length === 0) {
      const empty = makeEl('div', 'mui-menuitem disabled');
      setText(empty, 'No installed modules');
      customBody.appendChild(empty);
    }

    /** @type {Record<string, MenuItem[]>} */

    const coreMenus = {};

    for (const m of mods) {
      const items = (m.menus && m.menus.length)
        ? m.menus.flatMap((menu) => (menu.children || []))
        : [{ id: 'open', label: 'Open', action: 'open' }];

      // Custom / <module>
      const title = makeEl('div', 'mui-submenu-title');
      setText(title, m.name || m.id);
      customBody.appendChild(title);
      for (const item of items) customBody.appendChild(makeMenuItem(item, m.id));

      // Core menu contributions are trust-gated to Verified modules.
      if (getTrust(m.id) === 'verified' && m.menus) {
        for (const menu of m.menus) {
          const group = menu.group || 'Tools';
          coreMenus[group] = coreMenus[group] || [];
          for (const item of (menu.children || [])) {
            coreMenus[group].push({ ...item, moduleId: m.id });
          }
        }
      }
    }
    customWrap.appendChild(customBody);
    bar.appendChild(customWrap);

    // Core menus (Verified only)
    for (const [label, items] of Object.entries(coreMenus)) {
      const wrap = makeEl('div', 'mui-menu');
      const btn = makeEl('button', 'mui-menu-btn');
      btn.type = 'button';
      setText(btn, label);
      addListener(btn, 'click', (e) => {
        e.stopPropagation();
        const open = wrap.classList.contains('open');
        mount.querySelectorAll('.mui-menu.open').forEach((m) => m.classList.remove('open'));
        wrap.classList.toggle('open', !open);
      });
      wrap.appendChild(btn);
      const body = makeEl('div', 'mui-menu-body');
      for (const item of items) body.appendChild(makeMenuItem(item, item.moduleId));
      wrap.appendChild(body);
      bar.appendChild(wrap);
    }

    mount.appendChild(bar);
  }

  addListener(document, 'click', () => {
    mount.querySelectorAll('.mui-menu.open').forEach((m) => m.classList.remove('open'));
  });

  function refresh() { render(); }
  function destroy() {
    for (const { el, type, fn } of listeners) el.removeEventListener(type, fn);
    listeners.length = 0;
    mount.textContent = '';
  }

  render();
  // The registry cache loads from IndexedDB asynchronously; re-render once it is
  // ready so persisted modules appear even if the bar was built before boot finished.
  if (registry && registry.ready && typeof registry.ready.then === 'function') {
    registry.ready.then(() => render());
  }
  return { refresh, destroy };
}
