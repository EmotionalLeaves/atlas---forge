// Real US precinct data packs (from MGGG States): downloaded once per state, then kept on the device.
import { getPack, putPack } from './store.js';

// Bundled in the app first; the online copies are only a fallback.
export const PACK_SOURCES = [
  'packs/',
  'https://raw.githubusercontent.com/EmotionalLeaves/atlas---forge/main/packs/',
  'https://cdn.jsdelivr.net/gh/EmotionalLeaves/atlas---forge@main/packs/',
];
let manifest = null;
export async function packList() {
  if (manifest) return manifest;
  try { manifest = await (await fetch('data/packs.json')).json(); } catch { manifest = []; }
  return manifest;
}

const TYPES = { Float32Array, Uint16Array, Int16Array, Uint8Array, Uint32Array, Int32Array };
async function gunzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return buf;
  return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export function parsePack(raw) {
  const u8 = new Uint8Array(raw);
  if (String.fromCharCode(...u8.slice(0, 4)) !== 'AFP1') throw new Error('Not a precinct pack');
  const hl = new DataView(raw).getUint32(4, true);
  const H = JSON.parse(new TextDecoder().decode(u8.slice(8, 8 + hl)));
  const base = 8 + hl + ((8 - ((8 + hl) % 8)) % 8);
  const data = raw.slice(base);
  const get = (ref) => ref ? new TYPES[ref.t](data, ref.o, ref.n) : null;
  const n = H.count, [ox, oy] = H.origin;
  const P = {
    state: H.state, title: H.title, kind: H.kind || 'precincts', iso: H.iso, level: H.level, levelName: H.levelName, count: n, bbox: H.bbox, source: H.source,
    pop: get(H.pop), vap: get(H.vap),
    race: H.race.map((r) => ({ label: r.label, data: get(r.data) })), vrace: H.vrace.map((r) => ({ label: r.label, data: get(r.data) })),
    elections: H.elections.map((e) => ({ key: e.key, label: e.label, d: get(e.d), r: get(e.r) })),
    plans: H.plans.map((p) => ({ key: p.key, label: p.label, n: p.n, assign: get(p.assign) })),
    county: get(H.county), countyNames: H.countyNames, stateFips: H.stateFips || '', names: H.names, ids: H.ids,
    area: get(H.area), perim: get(H.perim),
  };
  // geometry -> world coordinates
  const g = H.geom, pos = Float32Array.from(get(g.pos)), lpos = Float32Array.from(get(g.lpos));
  for (let k = 0; k < pos.length; k += 2) { pos[k] += ox; pos[k + 1] += oy; }
  for (let k = 0; k < lpos.length; k += 2) { lpos[k] += ox; lpos[k + 1] += oy; }
  P.geom = { pos, uid: get(g.uid), idx: get(g.idx), lpos, luid: get(g.luid), lnb: get(g.lnb) };
  const c = get(H.center); P.cx = new Float64Array(n); P.cy = new Float64Array(n);
  for (let u = 0; u < n; u++) { P.cx[u] = c[u * 2] + ox; P.cy[u] = c[u * 2 + 1] + oy; }
  // adjacency lists [neighbour, km, neighbour, km, ...]
  const A = get(H.adj), AL = get(H.adjLen); P.adj = Array.from({ length: n }, () => []);
  for (let k = 0; k < A.length; k += 2) { const a = A[k], b = A[k + 1], L = AL[k / 2]; P.adj[a].push(b, L); P.adj[b].push(a, L); }
  // units look like provinces/counties to the rest of the app
  P.units = Array.from({ length: n }, (_, u) => ({ n: P.names[u] || `${P.kind === 'admin' ? 'Area' : 'Precinct'} ${P.ids[u] || u + 1}`, pop: P.pop[u], area: P.area[u], perim: P.perim[u] }));
  return P;
}

// ---- manifests ----
let levelsMf = null, usMf = null;
export async function levelList() {
  if (levelsMf) return levelsMf;
  try { levelsMf = await (await fetch('levels/levels.json')).json(); } catch { levelsMf = []; }
  // US precincts (real election results) become United States level 5
  try {
    const pk = await packList();
    if (pk.length && !levelsMf.some((m) => m.iso === 'USA' && m.level === 5)) levelsMf.push({ iso: 'USA', title: 'United States', level: 5, levelName: 'Voting precinct', count: pk.reduce((s, p) => s + p.count, 0), source: 'MGGG States', byState: true, precincts: true,
      parts: pk.map((p) => ({ key: 'P_' + p.state, pk: p.state, title: p.title, count: p.count, bbox: p.bbox, verts: Math.round(p.bytes / 18) })), bbox: [-180, 18, -66, 72] });
  } catch {}
  return levelsMf;
}
export async function usList() { if (usMf) return usMf; try { usMf = await (await fetch('us/us.json')).json(); } catch { usMf = []; } return usMf; }

// key formats: 'PA' (precincts), 'L:FRA_2' (admin level, may have parts), 'T:42' (US tracts), 'B:42' (US block groups)
export function packPath(key) {
  if (key.startsWith('L:')) return 'levels/' + key.slice(2) + '.afp.gz';
  if (key.startsWith('T:')) return 'us/tract_' + key.slice(2) + '.afp.gz';
  if (key.startsWith('B:')) return 'us/bg_' + key.slice(2) + '.afp.gz';
  return 'packs/' + key + '.afp.gz';
}
async function fetchRaw(rel, progress, label) {
  const res = await fetch(rel); if (!res.ok) throw new Error('HTTP ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !res.body.getReader) return res.arrayBuffer();
  const rd = res.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total > 2e6) progress(got / total, `${label}… ${(got / 1048576).toFixed(1)} MB`); }
  return new Blob(parts).arrayBuffer();
}
// Load one pack file (no caching) — used directly by the level view.
export async function readPack(key, progress = () => {}) {
  const rel = packPath(key);
  let raw = null, lastErr = null;
  const srcs = key.includes(':') ? [''] : (window.PACK_SOURCES_OVERRIDE || PACK_SOURCES).map((b) => b === 'packs/' ? '' : b);
  for (const base of srcs) {
    try { raw = await fetchRaw(base ? base + key + '.afp.gz' : rel, progress, `Loading ${key}`); break; } catch (e) { lastErr = e; }
  }
  if (!raw) { try { raw = await getPack(key); } catch {} }
  if (!raw) throw new Error(`Couldn't load ${key} (${lastErr ? lastErr.message : 'missing'})`);
  const P = parsePack(await gunzip(raw)); P.key = key; return P;
}
// Join the parts of a split level into one pack (ids become 32-bit if needed).
export function mergePacks(list, key) {
  if (list.length === 1) { list[0].key = key; return list[0]; }
  const n = list.reduce((s2, P) => s2 + P.count, 0), big = n > 65535;
  const cat = (f, T) => { const out = new T(list.reduce((s2, P) => s2 + f(P).length, 0)); let o = 0; for (const P of list) { out.set(f(P), o); o += f(P).length; } return out; };
  let uo = 0, vo = 0; const uid = new (big ? Uint32Array : Uint16Array)(list.reduce((s2, P) => s2 + P.geom.uid.length, 0)), luid = new (big ? Uint32Array : Uint16Array)(list.reduce((s2, P) => s2 + P.geom.luid.length, 0)), lnb = new (big ? Uint32Array : Uint16Array)(luid.length), idx = new Uint32Array(list.reduce((s2, P) => s2 + P.geom.idx.length, 0));
  let a = 0, b = 0, c = 0; const adj = [];
  for (const P of list) {
    for (let i = 0; i < P.geom.uid.length; i++) uid[a + i] = P.geom.uid[i] + uo;
    for (let i = 0; i < P.geom.idx.length; i++) idx[c + i] = P.geom.idx[i] + vo;
    for (let i = 0; i < P.geom.luid.length; i++) { luid[b + i] = P.geom.luid[i] + uo; const nb = P.geom.lnb[i]; lnb[b + i] = nb === 65535 ? (big ? 0xffffffff : 65535) : nb + uo; }
    for (let u = 0; u < P.count; u++) adj.push(P.adj[u].map((v, k) => k % 2 ? v : v + uo));
    a += P.geom.uid.length; b += P.geom.luid.length; c += P.geom.idx.length; vo += P.geom.pos.length / 2; uo += P.count;
  }
  const f = list[0];
  const M = { ...f, key, count: n, bbox: [Math.min(...list.map((P) => P.bbox[0])), Math.min(...list.map((P) => P.bbox[1])), Math.max(...list.map((P) => P.bbox[2])), Math.max(...list.map((P) => P.bbox[3]))],
    pop: cat((P) => P.pop, Float32Array), area: cat((P) => P.area, Float32Array), perim: cat((P) => P.perim, Float32Array), county: cat((P) => P.county, Uint16Array),
    names: list.flatMap((P) => P.names), ids: list.flatMap((P) => P.ids), cx: cat((P) => P.cx, Float64Array), cy: cat((P) => P.cy, Float64Array), adj,
    units: list.flatMap((P) => P.units), geom: { pos: cat((P) => P.geom.pos, Float32Array), uid, idx, lpos: cat((P) => P.geom.lpos, Float32Array), luid, lnb, noNb: big ? 0xffffffff : 65535 } };
  return M;
}

const loaded = new Map();
// Load a pack for Draw / single-pack views (kept in memory). progress(fraction, text)
export async function loadPack(key, progress = () => {}) {
  if (loaded.has(key)) return loaded.get(key);
  let P;
  if (key.startsWith('L:')) {
    const mf = await levelList(), [iso, L, part] = key.slice(2).split('_'), m = mf.find((x) => x.iso === iso && x.level === +L);
    if (!m) throw new Error('Unknown level ' + key);
    if (part != null) { // one state / part of a level
      const pi = m.parts.find((x) => x.key === key.slice(2)); P = await readPack(key, progress); P.key = key; P.levelName = m.levelName; P.title = pi && pi.title ? pi.title : m.title;
    } else {
      const parts = []; for (let i = 0; i < m.parts.length; i++) { progress(i / m.parts.length, `Loading ${m.title} · ${m.levelName} (${i + 1}/${m.parts.length})`); parts.push(await readPack('L:' + m.parts[i].key)); }
      P = mergePacks(parts, key); P.title = m.title; P.levelName = m.levelName;
    }
  } else P = await readPack(key, progress);
  progress(1, 'Ready');
  if (loaded.size > 3) loaded.delete(loaded.keys().next().value); // keep memory in check
  loaded.set(key, P);
  return P;
}
export const isLoaded = (state) => loaded.has(state);
export const getLoaded = (state) => loaded.get(state) || null;
