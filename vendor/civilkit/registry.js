// @ts-check
// @civilkit/moduleui/registry - IndexedDB-backed module registry.
// Implements the module registry interface: list()/get(id) are synchronous on an
// in-memory cache; install()/uninstall()/installFromStore() are async and
// persist to IndexedDB. A memory fallback is used when IndexedDB is unavailable
// (e.g. Node tests).

import { unzipSync } from './fflate.js';

const HOST_API_VERSION = '1.0.0';
const DB_NAME = 'civilkit_modules';
const DB_VERSION = 1;
const STORE_NAME = 'modules';
// Which app each contribution point belongs to, so a refusal can name the app the
// module was written for (used by readBundle's point check).
/** @type {Record<string, string>} */
const HOST_NAMES = { 'design-check': 'CivilKit Studio', 'buckling.tool': 'CivilKit Buckling' };

function semverParts(/** @type {any} */ v) {
  const m = String(v).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2] || '0', 10), parseInt(m[3] || '0', 10)];
}

function satisfiesHost(/** @type {any} */ versionOrRange, /** @type {any} */ hostApiVersion) {
  // hostApiVersion defaults to this module's own literal, so the parse cannot fail on it.
  const host = /** @type {number[]} */ (semverParts(hostApiVersion));
  const range = String(versionOrRange).trim();
  const exact = semverParts(range);
  if (exact && range.match(/^\d+(?:\.\d+)*(?:-[\w.]+)?$/)) {
    return (
      exact[0] === host[0] &&
      (exact[0] > host[0] || (exact[0] === host[0] && exact[1] > host[1]) ||
        (exact[0] === host[0] && exact[1] === host[1] && exact[2] <= host[2]))
    );
  }
  const caret = range.match(/^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (caret) {
    const major = parseInt(caret[1], 10);
    const minor = caret[2] != null ? parseInt(caret[2], 10) : 0;
    if (host[0] !== major) return false;
    if (minor != null && caret[2] != null && host[1] < minor) return false;
    return true;
  }
  const ge = range.match(/^>=(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (ge) {
    const needed = [parseInt(ge[1], 10), parseInt(ge[2] || '0', 10), parseInt(ge[3] || '0', 10)];
    for (let i = 0; i < 3; i++) {
      if (host[i] > needed[i]) return true;
      if (host[i] < needed[i]) return false;
    }
    return true;
  }
  // Unknown range syntax: reject rather than guess.
  return false;
}

function validateManifest(/** @type {any} */ manifest, /** @type {string} */ hostApiVersion = HOST_API_VERSION) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json missing or not JSON');
  }
  const required = ['id', 'name', 'version', 'civilkitApi', 'contributes'];
  for (const key of required) {
    if (manifest[key] == null) throw new Error(`manifest.json missing required field: ${key}`);
  }
  if (typeof manifest.id !== 'string' || !manifest.id.trim()) {
    throw new Error('manifest.id must be a non-empty string');
  }
  if (!semverParts(manifest.version)) {
    throw new Error('manifest.version is not a valid semver');
  }
  if (!satisfiesHost(manifest.civilkitApi, hostApiVersion)) {
    throw new Error(`manifest.civilkitApi ${manifest.civilkitApi} is incompatible with host ${hostApiVersion}`);
  }
  if (!Array.isArray(manifest.contributes)) {
    throw new Error('manifest.contributes must be an array');
  }
}

// Read and validate a bundle: unzip, parse and validate the manifest, and - when
// the host passes `points` - refuse a module whose contribution points are all
// another app's, naming that app. A module that contributes to no point is
// for no app in particular and is not refused. A null `points` accepts any host. Pure: no
// IndexedDB, no registry, usable headless (Node CLI) and from any host app.
/**
 * @param {Uint8Array} bytes
 * @param {{ hostApiVersion?: string, points?: string[] | null }} [opts]
 */
export function readBundle(bytes, opts = {}) {
  const hostApiVersion = opts.hostApiVersion ?? HOST_API_VERSION;
  const points = opts.points ?? null;
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('readBundle expects a Uint8Array');
  }
  let files;
  try {
    files = /** @type {Record<string, Uint8Array>} */ ((/** @type {any} */ (unzipSync))(bytes));
  } catch (e) {
    throw new Error('Failed to unzip bundle: ' + (e instanceof Error ? e.message : String(e)));
  }

  const manifestBytes = files['manifest.json'];
  if (!manifestBytes) throw new Error('Bundle missing manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (e) {
    throw new Error('manifest.json is not valid JSON: ' + (e instanceof Error ? e.message : String(e)));
  }

  validateManifest(manifest, hostApiVersion);

  if (points != null) {
    const contributed = manifest.contributes
      .map((/** @type {{point?: string}} */ c) => (c && typeof c.point === 'string' ? c.point : null))
      .filter(Boolean);
    if (contributed.length && !contributed.some((/** @type {string} */ p) => points.includes(p))) {
      const first = contributed[0] || null;
      const name = (first && HOST_NAMES[first]) || 'another app';
      throw new Error(`This module is for ${name}: its contribution points (${contributed.join(', ')}) are not among this app's (${points.join(', ')})`);
    }
  }

  return { manifest, files };
}

function descriptorFromBundle(/** @type {any} */ bundle) {
  const { manifest, badge } = bundle;
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    badge,
    // Display / licensing metadata (self-declared - shown, never trusted).
    description: manifest.description || '',
    author: manifest.author || null,
    license: manifest.license || null,
    homepage: manifest.homepage || null,
    menus: manifest.menus || [],
    contributes: manifest.contributes || []
  };
}

function entryTypeFromFiles(/** @type {any} */ files) {
  if (files['main.wasm']) return 'wasm';
  if (files['main.py']) return 'python';
  if (files['main.js']) return 'js';
  return 'unknown';
}

async function runBundledTests(/** @type {any} */ bundle, /** @type {any} */ testRunners) {
  const manifest = bundle.manifest;
  const files = bundle.files;
  const testPath = manifest.tests || 'tests/worked-examples.json';
  const testBytes = files[testPath];
  if (!testBytes) return { ran: false, pass: false };

  let examples;
  try {
    examples = JSON.parse(new TextDecoder().decode(testBytes));
  } catch (e) {
    return { ran: true, pass: false, error: 'tests JSON parse failed: ' + (/** @type {any} */ (e)).message };
  }
  if (!Array.isArray(examples) || examples.length === 0) {
    return { ran: false, pass: false };
  }

  const entryType = entryTypeFromFiles(files);
  const runner = testRunners[entryType];
  if (!runner) return { ran: false, pass: false };

  for (const ex of examples) {
    try {
      const ok = await runner({ manifest, files, example: ex });
      if (!ok) return { ran: true, pass: false, error: `worked example ${ex.id || '?'} failed` };
    } catch (e) {
      return { ran: true, pass: false, error: `worked example ${ex.id || '?'} threw: ${(/** @type {any} */ (e)).message}` };
    }
  }
  return { ran: true, pass: true };
}

export function createRegistry(opts = /** @type {any} */ ({})) {
  const testRunners = opts.testRunners || {};
  const storeUrl = opts.storeUrl || './store/index.json';
  const hostApiVersion = opts.hostApiVersion ?? HOST_API_VERSION;
  const dbName = opts.dbName ?? DB_NAME;
  // null (the default) accepts modules for any host, as before; a host app passes
  // its own contribution points so a module for another app is refused at install.
  const points = opts.points ?? null;
  const cache = new Map();
  /** @type {any} */
  let db = null;
  /** @type {any} */
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  async function openDb() {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const d = (/** @type {any} */ (event.target)).result;
        if (!d.objectStoreNames.contains(STORE_NAME)) {
          d.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  async function loadAll() {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const all = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    for (const record of all) {
      cache.set(record.id, record);
    }
  }

  async function persist(/** @type {any} */ bundle) {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const request = store.put(bundle);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async function removeFromDb(/** @type {any} */ id) {
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async function init() {
    try {
      db = await openDb();
      await loadAll();
    } catch (e) {
      // Fall back to in-memory only.
      db = null;
    }
    readyResolve();
  }

  function list() {
    return Array.from(cache.values()).map(descriptorFromBundle);
  }

  function get(/** @type {any} */ id) {
    return cache.get(id) || null;
  }

  async function install(/** @type {any} */ bytes, installOpts = /** @type {any} */ ({})) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('install() expects a Uint8Array');
    }
    const { manifest, files } = readBundle(bytes, { hostApiVersion, points });

    // Trust: untrusted/community modules must be wasm or python only.
    // Trust is HOST-supplied at install time (installOpts.trusted), never read
    // from the bundle's own manifest - a bundle cannot self-declare trust.
    if (files['main.js'] && !installOpts.trusted) {
      throw new Error('Untrusted bundles may not ship main.js');
    }

    const testResult = await runBundledTests({ manifest, files, badge: 'community' }, testRunners);
    const badge = testResult.ran && testResult.pass ? 'verified' : 'community';

    const bundle = { id: manifest.id, manifest, files, badge };
    await persist(bundle);
    cache.set(manifest.id, bundle);
    return descriptorFromBundle(bundle);
  }

  async function installFromStore(/** @type {any} */ id) {
    const response = await fetch(storeUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Failed to fetch store index: ${response.status}`);
    const index = await response.json();
    if (!Array.isArray(index)) throw new Error('Store index is not an array');
    const entry = index.find(x => x.id === id);
    if (!entry) throw new Error(`Module ${id} not found in store`);
    // Resolve the bundle URL relative to the store index location (portable from
    // any page), not the document - so the same store works from the demo and Studio.
    const base = (typeof document !== 'undefined' && document.baseURI) || undefined;
    const bundleUrl = new URL(entry.url, new URL(storeUrl, base)).href;
    const bundleResponse = await fetch(bundleUrl, { cache: 'no-cache' });
    if (!bundleResponse.ok) throw new Error(`Failed to fetch bundle: ${bundleResponse.status}`);
    const bytes = new Uint8Array(await bundleResponse.arrayBuffer());
    return install(bytes);
  }

  async function uninstall(/** @type {any} */ id) {
    cache.delete(id);
    await removeFromDb(id);
  }

  init();

  return { list, get, install, installFromStore, uninstall, ready };
}
