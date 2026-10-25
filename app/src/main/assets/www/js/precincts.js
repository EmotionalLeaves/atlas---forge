// Real US precinct data packs (from MGGG States): downloaded once per state, then kept on the device.
import { getPack, putPack } from './store.js';

export const PACK_SOURCES = [
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
    state: H.state, title: H.title, count: n, bbox: H.bbox, source: H.source,
    pop: get(H.pop), vap: get(H.vap),
    race: H.race.map((r) => ({ label: r.label, data: get(r.data) })), vrace: H.vrace.map((r) => ({ label: r.label, data: get(r.data) })),
    elections: H.elections.map((e) => ({ key: e.key, label: e.label, d: get(e.d), r: get(e.r) })),
    plans: H.plans.map((p) => ({ key: p.key, label: p.label, n: p.n, assign: get(p.assign) })),
    county: get(H.county), countyNames: H.countyNames, names: H.names, ids: H.ids,
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
  P.units = Array.from({ length: n }, (_, u) => ({ n: P.names[u] || `Precinct ${P.ids[u] || u + 1}`, pop: P.pop[u], area: P.area[u], perim: P.perim[u] }));
  return P;
}

const loaded = new Map();
// Returns the parsed pack, downloading it if needed. progress(fraction, text)
export async function loadPack(state, progress = () => {}) {
  if (loaded.has(state)) return loaded.get(state);
  let raw = null;
  try { raw = await getPack(state); } catch {}
  if (!raw) {
    const srcs = (window.PACK_SOURCES_OVERRIDE || PACK_SOURCES);
    let lastErr = null;
    for (const base of srcs) {
      try {
        const res = await fetch(base + state + '.afp.gz', { cache: 'no-cache' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const total = +res.headers.get('content-length') || 0;
        if (res.body && res.body.getReader) {
          const rd = res.body.getReader(), parts = []; let got = 0;
          for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; progress(total ? got / total : 0, `Downloading ${state} precincts… ${(got / 1048576).toFixed(1)} MB`); }
          raw = await new Blob(parts).arrayBuffer();
        } else raw = await res.arrayBuffer();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!raw) throw new Error(`Couldn't download the ${state} precincts (${lastErr ? lastErr.message : 'offline'}). Check your internet connection.`);
    try { await putPack(state, raw); } catch {}
  }
  progress(1, 'Unpacking…');
  const P = parsePack(await gunzip(raw));
  loaded.set(state, P);
  return P;
}
export const isLoaded = (state) => loaded.has(state);
export const getLoaded = (state) => loaded.get(state) || null;
