// Saving worlds: IndexedDB slots + portable export files (.atlas, gzip).
import { createWorld, computeAggregates, computeAdjacency, initTimeline, MAXN } from './world.js';

const DB = 'atlasforge', STORE = 'worlds', PACKS = 'packs';
let dbp = null;
function db() {
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); if (!d.objectStoreNames.contains(PACKS)) d.createObjectStore(PACKS); };
    r.onsuccess = () => res(r.result); r.onerror = () => { dbp = null; rej(r.error); };
  }));
}
async function tx(mode, fn, store = STORE) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); });
}
export const getPack = (k) => tx('readonly', (s) => s.get(k), PACKS);
export const putPack = (k, v) => tx('readwrite', (s) => s.put(v, k), PACKS);
export const delPack = (k) => tx('readwrite', (s) => s.delete(k), PACKS);
export const packKeys = () => tx('readonly', (s) => s.getAllKeys(), PACKS);
export const putSlot = (key, obj) => tx('readwrite', (s) => s.put(obj, key));
export const getSlot = (key) => tx('readonly', (s) => s.get(key));
export const delSlot = (key) => tx('readwrite', (s) => s.delete(key));
export async function listSlots() {
  const d = await db();
  return new Promise((res, rej) => {
    const out = []; const t = d.transaction(STORE, 'readonly'); const c = t.objectStore(STORE).openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return; const v = cur.value; out.push({ key: cur.key, name: v.name, month: v.month, startYear: v.startYear, savedAt: v.savedAt, nations: v.aliveCount }); cur.continue(); };
    t.oncomplete = () => res(out.sort((a, b) => b.savedAt - a.savedAt)); t.onerror = () => rej(t.error);
  });
}

const onLand = (W, arr, T) => { const out = new T(W.land.length); for (let k = 0; k < W.land.length; k++) out[k] = arr[W.land[k]]; return out; };
const fromLand = (W, src, dst) => { for (let k = 0; k < W.land.length; k++) dst[W.land[k]] = src[k]; };

export function serialize(W) {
  const nn = W.nations.length;
  const rel = new Float32Array(nn * nn);
  for (let a = 0; a < nn; a++) for (let b = 0; b < nn; b++) rel[a * nn + b] = W.rel[a * MAXN + b];
  const custom = {}; for (const [k, v] of Object.entries(W.custom)) custom[k] = onLand(W, v, Float32Array);
  return {
    format: 'atlasforge', v: 1, name: W.name, savedAt: Date.now(), seed: W.seed, rng: W.rng.state(), month: W.month, startYear: W.startYear,
    settings: W.settings, nations: W.nations.map((n) => n && { ...n }), blocs: W.blocs, wars: W.wars, truce: W.truce, news: W.news.slice(0, 150),
    formulas: W.formulas, mood: W.mood.slice(0, nn), nn, rel,
    owner: onLand(W, W.owner, Uint16Array), pop: onLand(W, W.pop, Float32Array), pop0: onLand(W, W.pop0, Float32Array), dev: onLand(W, W.dev, Float32Array),
    lean: onLand(W, W.lean, Float32Array), lean0: onLand(W, W.lean0, Float32Array), terrain: onLand(W, W.terrain, Uint8Array), custom,
    plans: W.plans.map((p) => ({ ...p, assign: p.unit === 'cells' ? onLand(W, p.assign, Int16Array) : p.assign.slice(), coiAssign: p.coiAssign ? (p.unit === 'cells' ? onLand(W, p.coiAssign, Int16Array) : p.coiAssign.slice()) : null })),
    aliveCount: W.nations.filter((n) => n && n.alive).length,
    game: W.game || null,
    timeline: W.timeline ? { start: W.timeline.start, key: W.timeline.key, deltas: W.timeline.deltas } : null,
  };
}

export function deserialize(D, S) {
  if (!S || S.format !== 'atlasforge') throw new Error('Not an Atlas Forge world');
  const W = createWorld(D, { seed: S.seed, light: true });
  W.name = S.name; W.month = S.month; W.startYear = S.startYear; W.settings = { ...W.settings, ...S.settings };
  W.rng.setState(S.rng);
  W.nations = S.nations.map((n) => n && { ...n });
  W.blocs = S.blocs; W.wars = S.wars; W.truce = S.truce; W.news = S.news; W.formulas = S.formulas || [];
  W.mood.fill(0); W.mood.set(S.mood); W.game = S.game || null;
  W.rel.fill(0); const nn = S.nn; for (let a = 0; a < nn; a++) for (let b = 0; b < nn; b++) W.rel[a * MAXN + b] = S.rel[a * nn + b];
  W.owner.fill(0); fromLand(W, S.owner, W.owner); fromLand(W, S.pop, W.pop); fromLand(W, S.pop0, W.pop0); fromLand(W, S.dev, W.dev); fromLand(W, S.lean, W.lean); if (S.lean0) fromLand(W, S.lean0, W.lean0); else W.lean0.set(W.lean); fromLand(W, S.terrain, W.terrain);
  W.custom = {}; for (const [k, v] of Object.entries(S.custom || {})) { const a = new Float32Array(W.N); fromLand(W, v, a); W.custom[k] = a; }
  const unland = (p, a) => { if (!a) return null; if (p.unit === 'cells') { const x = new Int16Array(W.N).fill(-1); fromLand(W, a, x); return x; } return Int16Array.from(a); };
  W.plans = (S.plans || []).map((p) => ({ ...p, assign: unland(p, p.assign), coiAssign: unland(p, p.coiAssign) }));
  if (S.timeline && S.timeline.key && S.timeline.key.length === W.land.length) {
    W.timeline = { start: S.timeline.start, key: Uint16Array.from(S.timeline.key), deltas: S.timeline.deltas.map((d) => ({ m: d.m, idx: Int32Array.from(d.idx), val: Uint16Array.from(d.val) })) };
    W.tlLast = W.timeline.key.slice(); for (const d of W.timeline.deltas) for (let k = 0; k < d.idx.length; k++) W.tlLast[d.idx[k]] = d.val[k];
  } else initTimeline(W);
  computeAggregates(W); computeAdjacency(W);
  return W;
}

// ---- portable file format: "AFW1" + u32 header length + JSON header + binary blobs, gzipped ----
const TYPES = { Float32Array, Uint16Array, Int16Array, Uint8Array, Int32Array, Float64Array };
export async function exportBlob(W) {
  const S = serialize(W); const blobs = []; let off = 0;
  const walk = (v) => {
    if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice(); const pad = (8 - (off % 8)) % 8; if (pad) { blobs.push(new Uint8Array(pad)); off += pad; } const ref = { $t: v.constructor.name, o: off, n: v.length }; blobs.push(b); off += b.byteLength; return ref; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x); return o; }
    return v;
  };
  const head = new TextEncoder().encode(JSON.stringify(walk(S)));
  const pre = new Uint8Array(8); pre.set([65, 70, 87, 49]); new DataView(pre.buffer).setUint32(4, head.length, true);
  const pad = new Uint8Array((8 - ((8 + head.length) % 8)) % 8);
  const raw = new Blob([pre, head, pad, ...blobs]);
  if (typeof CompressionStream !== 'undefined') return new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return raw;
}
export async function importBlob(D, blob) {
  let buf = new Uint8Array(await blob.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if (String.fromCharCode(...buf.slice(0, 4)) !== 'AFW1') throw new Error('This file is not an Atlas Forge world');
  const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(buf.slice(8, 8 + hl)));
  const base = 8 + hl + ((8 - ((8 + hl) % 8)) % 8);
  const data = buf.slice(base).buffer;
  const unwalk = (v) => {
    if (v && typeof v === 'object' && v.$t) return new TYPES[v.$t](data, v.o, v.n);
    if (Array.isArray(v)) return v.map(unwalk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = unwalk(x); return o; }
    return v;
  };
  return deserialize(D, unwalk(head));
}
