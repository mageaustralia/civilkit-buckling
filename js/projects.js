/* Projects on the device: IndexedDB records { id, name, state, updated }, where state is the shape
   a share link carries ({ v: 2, model, loads, analysis, ui }). Nothing here touches the network: a
   project lives in this browser (or app) only, and a .ckb.json file is how it leaves.
   Where IndexedDB is missing or refused (some private-browsing modes), memoryDb() keeps the same
   interface for the session, and the page says that nothing will outlive it. */
import { validateState } from './share.js';

const STORE = 'projects';
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/* rejects when there is no IndexedDB, it is refused, or it does not answer within timeoutMs (a
   blocked open can otherwise wait for ever) */
export function openDb(name = 'civilkit-buckling', { timeoutMs = 4000 } = {}) {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) { rej(new Error('IndexedDB is not available')); return; }
    const timer = setTimeout(() => rej(new Error('IndexedDB did not answer')), timeoutMs);
    let r;
    try { r = indexedDB.open(name, 1); } catch (e) { clearTimeout(timer); rej(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('updated', 'updated');
    r.onsuccess = () => { clearTimeout(timer); res(r.result); };
    r.onerror = () => { clearTimeout(timer); rej(r.error || new Error('IndexedDB refused to open')); };
    r.onblocked = () => { clearTimeout(timer); rej(new Error('IndexedDB is blocked by another tab')); };
  });
}

/* the session-only fallback: the same calls, a Map, copies in and out */
export function memoryDb() {
  return { memory: true, rows: new Map() };
}

const tx = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
/* two saves in the same millisecond still order newest first */
let lastUpdated = 0;
const stamp = () => (lastUpdated = Math.max(Date.now(), lastUpdated + 1));

async function put(db, rec) {
  if (db.memory) { db.rows.set(rec.id, structuredClone(rec)); return; }
  await req(tx(db, 'readwrite').put(rec));
}

export async function saveProject(db, { id, name, state }) {
  const rec = { id: id ?? uuid(), name, state, updated: stamp() };
  await put(db, rec);
  return rec.id;
}
/* put a record back exactly as it was, its time included (the Undo of a delete) */
export const restoreProject = (db, rec) => put(db, rec);

export async function listProjects(db) {
  const all = db.memory ? [...db.rows.values()] : await req(tx(db, 'readonly').getAll());
  return all.sort((a, b) => b.updated - a.updated).map(({ id, name, updated }) => ({ id, name, updated }));
}
export async function loadProject(db, id) {
  if (db.memory) { const r = db.rows.get(id); return r ? structuredClone(r) : undefined; }
  return req(tx(db, 'readonly').get(id));
}
export async function deleteProject(db, id) {
  if (db.memory) { db.rows.delete(id); return; }
  await req(tx(db, 'readwrite').delete(id));
}

/* What a project is held to, on save and on restore: the share link's own checks and size caps
   (validateState), worded for a project. null when it can be used. */
export function checkState(state, noun = 'project') {
  if (state && typeof state === 'object' && state.v !== undefined && state.v !== 2)
    return `This ${noun} is from an older version of CivilKit Buckling and cannot be opened.`;
  return validateState(state, noun);
}

/* .ckb.json: { format, version: 2, name, state } */
export const FILE_MAX = 4 * 1024 * 1024;   // a 500-node model with 1,000 lengths is well under 1 MB
export function toFile({ name, state }) {
  return new Blob([JSON.stringify({ format: 'civilkit-buckling', version: 2, name, state }, null, 1)],
                  { type: 'application/json' });
}
export function fileName(name) {
  const base = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  return `${base || 'project'}.ckb.json`;
}
export async function fromFile(file) {
  const not = 'This is not a CivilKit Buckling file.';
  if (file.size > FILE_MAX) throw new Error(`This file is too large to be a CivilKit Buckling project (${Math.round(file.size / 1048576)} MB).`);
  let j;
  try { j = JSON.parse(await file.text()); } catch { throw new Error(not); }
  if (!j || typeof j !== 'object' || j.format !== 'civilkit-buckling') throw new Error(not);
  if (typeof j.version !== 'number' || j.version < 2)
    throw new Error('This file is from an older version of CivilKit Buckling and cannot be opened.');
  if (j.version > 2)
    throw new Error('This file is from a newer version of CivilKit Buckling. Update the app to open it.');
  const bad = checkState(j.state, 'file');
  if (bad) throw new Error(bad);
  const name = typeof j.name === 'string' && j.name.trim() ? j.name.trim().slice(0, 120)
    : (file.name || 'project').replace(/\.ckb\.json$|\.json$/i, '');
  return { name, state: j.state };
}
