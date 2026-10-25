// World state: who owns each cell, how many people live there, nations, diplomacy.
import { makeRng, vnoise, clamp, nationColor, makeParties } from './util.js';

export const MAXN = 640;
export const HAB = [0, 0, 0, 0.01, 0.05, 0.35, 1, 0.9, 0.06, 0.4, 0.65, 1.5];
export const GOVS = ['Republic', 'Monarchy', 'Autocracy', 'Junta', 'Provisional'];
export const prodOf = (dev) => 300 * Math.pow(10, dev * 2.477); // GDP per capita (USD) for a development level
const PROD = Float32Array.from({ length: 1025 }, (_, k) => prodOf(k / 1024));
export const prodFast = (dev) => PROD[(dev * 1024 + 0.5) | 0];
export const LEAN_BINS = 32;

export function createWorld(D, opts = {}) {
  const { units, cells } = D;
  const Wd = units.grid.W, Hd = units.grid.H, N = Wd * Hd;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const rng = makeRng(seed);
  const landList = [];
  for (let i = 0; i < N; i++) if (cells.country[i]) landList.push(i);
  const W = {
    D, Wd, Hd, N, seed, rng, land: Int32Array.from(landList),
    owner: new Uint16Array(N), pop: new Float32Array(cells.pop), dev: new Float32Array(N), lean: new Float32Array(N),
    terrain: new Uint8Array(cells.terrain),
    custom: {}, nations: [null], rel: new Float32Array(MAXN * MAXN), wars: [], truce: {}, blocs: [null],
    month: 0, startYear: 2026, news: [], mood: new Float32Array(MAXN),
    settings: { wars: true, rebels: true, elections: true, disasters: true, aggression: 1, govs: opts.govs || 'republics' },
    plans: [], formulas: [], name: opts.name || 'Earth 2026', version: 1,
  };
  W.area = new Float32Array(Hd); // km2 per cell, by row
  for (let r = 0; r < Hd; r++) { const lat = 90 - (r + 0.5) * 180 / Hd; W.area[r] = (111.32 * 180 / Hd) ** 2 * Math.cos(lat * Math.PI / 180); }
  // nations from real countries
  const ATA = units.countries.findIndex((c) => c.a3 === 'ATA') + 1;
  units.countries.forEach((c, k) => {
    const id = k + 1;
    const n = newNation(W, { name: c.name, color: nationColor(c.mapcolor || 1, id), orig: id, a3: c.a3 });
    n.alive = id !== ATA;
    if (W.settings.govs === 'random') n.gov = GOVS[Math.floor(rng() * 4)];
  });
  if (opts.light) { W.pop0 = new Float32Array(W.pop); W.lean0 = new Float32Array(N); return W; } // deserialize overwrites the rest
  // ownership, development, lean
  const gdppc = units.countries.map((c) => c.pop > 0 && c.gdp > 0 ? c.gdp * 1e6 / c.pop : 3000);
  for (const i of W.land) {
    const c = cells.country[i]; W.owner[i] = c === ATA ? 0 : c;
    const row = (i / Wd) | 0, x = i % Wd, lat = 90 - (row + 0.5) * 180 / Hd, lng = -180 + (x + 0.5) * 360 / Wd;
    const base = clamp(Math.log10(gdppc[c - 1] / 300) / 2.477, 0.03, 0.98);
    const dens = W.pop[i] / W.area[row];
    W.dev[i] = clamp(base + 0.06 * Math.log10(1 + dens / 200) - 0.03 + 0.04 * (vnoise(lng / 3, lat / 3, 5) - 0.5), 0.01, 1);
    W.lean[i] = clamp(0.7 * (0.45 - clamp(Math.log10(1 + dens) / 4, 0, 1)) + 1.5 * (vnoise(lng / 7, lat / 7, 9) - 0.5) + 0.6 * (vnoise(lng / 1.5, lat / 1.5, 21) - 0.5), -1, 1);
  }
  for (let n = 1; n < W.nations.length; n++) W.mood[n] = (rng() - 0.5) * 0.5;
  for (const i of W.land) W.lean[i] = clamp(W.lean[i] + W.mood[W.owner[i]], -1, 1);
  W.pop0 = new Float32Array(W.pop); W.lean0 = new Float32Array(W.lean);
  // capitals
  const caps = units.cities.filter((c) => c.cap);
  for (const ct of caps) { const n = W.nations[ct.country]; if (!n || n.capital >= 0) continue; const i = cellAt(W, ct.lng, ct.lat); if (W.owner[i] === ct.country) n.capital = i; }
  computeAggregates(W);
  for (const n of W.nations) if (n && n.alive && n.capital < 0) n.capital = n.topCell;
  // initial relations
  computeAdjacency(W);
  const cs = units.countries;
  for (let a = 1; a < W.nations.length; a++) for (let b = a + 1; b < W.nations.length; b++) {
    let r = (rng() - 0.4) * 50;
    if (cs[a - 1].continent === cs[b - 1].continent) r += 12;
    if (cs[a - 1].subregion === cs[b - 1].subregion) r += 10;
    if (W.adj.has(a * MAXN + b)) r -= 8 + rng() * 20;
    setRel(W, a, b, clamp(r, -100, 100));
  }
  for (const n of W.nations) if (n) { n.hist = { m: [], pop: [], gdp: [], cells: [], stab: [] }; snapshot(W, n); n.lastElection = -Math.floor(rng() * 48); }
  initTimeline(W);
  return W;
}

export function newNation(W, { name, color, orig = 0, a3 = '', gov = 'Republic' }) {
  const id = W.nations.length < MAXN ? W.nations.length : W.nations.findIndex((n, k) => k > 0 && !n.alive && n.cells === 0 && !n.orig);
  if (id < 1) return null;
  const n = {
    id, name, color, orig, a3, gov, alive: true, capital: -1, founded: W.month, parties: makeParties(W.rng), ruling: 1, lastElection: -999,
    stab: 0.6 + W.rng() * 0.25, exh: 0, mil: 0, pop: 0, gdp: 0, cells: 0, devAvg: 0, occ: 0, bloc: 0, seats: null,
    hist: { m: [], pop: [], gdp: [], cells: [], stab: [] },
  };
  n.ruling = Math.floor(W.rng() * 3);
  W.nations[id] = n; W.mood[id] = 0;
  for (const k of Object.keys(W.truce)) { const a = Math.floor(k / MAXN), b = k % MAXN; if (a === id || b === id) delete W.truce[k]; }
  for (let k = 0; k < MAXN; k++) { W.rel[id * MAXN + k] = 0; W.rel[k * MAXN + id] = 0; }
  return n;
}

export const cellAt = (W, lng, lat) => {
  const x = Math.floor(((lng + 180) % 360 + 360) % 360 / 360 * W.Wd), y = clamp(Math.floor((90 - lat) / 180 * W.Hd), 0, W.Hd - 1);
  return y * W.Wd + Math.min(W.Wd - 1, x);
};
export const cellLngLat = (W, i) => [-180 + ((i % W.Wd) + 0.5) * 360 / W.Wd, 90 - (Math.floor(i / W.Wd) + 0.5) * 180 / W.Hd];
export const rel = (W, a, b) => W.rel[a * MAXN + b];
export const setRel = (W, a, b, v) => { W.rel[a * MAXN + b] = v; W.rel[b * MAXN + a] = v; };
export const pairKey = (a, b) => a < b ? a * MAXN + b : b * MAXN + a;

// Sum up every nation's population, economy, territory and label position.
export function computeAggregates(W) {
  const nn = W.nations.length, { owner, pop, dev, lean, land, Wd } = W, country = W.D.cells.country;
  const P = new Float64Array(nn), G = new Float64Array(nn), C = new Int32Array(nn), DV = new Float64Array(nn), OC = new Int32Array(nn), LE = new Float64Array(nn);
  const SX = new Float64Array(nn), SY = new Float64Array(nn), SZ = new Float64Array(nn), TOP = new Int32Array(nn).fill(-1), TOPV = new Float32Array(nn);
  if (!W.colCos || W.colCos.length !== Wd) { W.colCos = Float32Array.from({ length: Wd }, (_, x) => Math.cos(x / Wd * 2 * Math.PI)); W.colSin = Float32Array.from({ length: Wd }, (_, x) => Math.sin(x / Wd * 2 * Math.PI)); }
  const cc = W.colCos, cs = W.colSin, orig = new Uint16Array(nn); for (let o = 1; o < nn; o++) orig[o] = W.nations[o].orig;
  const LH = W.leanHist = new Float64Array(nn * LEAN_BINS);
  for (let k = 0; k < land.length; k++) {
    const i = land[k], o = owner[i]; if (!o) continue;
    const p = pop[i], d = dev[i], l = lean[i]; P[o] += p; G[o] += p * PROD[(d * 1024 + 0.5) | 0]; C[o]++; DV[o] += d * p; LE[o] += l * p;
    LH[o * LEAN_BINS + Math.min(LEAN_BINS - 1, ((l + 1) * 0.5 * LEAN_BINS) | 0)] += p;
    if (orig[o] && orig[o] !== country[i]) OC[o]++;
    const y = (i / Wd) | 0, x = i - y * Wd;
    SX[o] += cc[x]; SY[o] += cs[x]; SZ[o] += y;
    if (p > TOPV[o]) { TOPV[o] = p; TOP[o] = i; }
  }
  for (let o = 1; o < nn; o++) {
    const n = W.nations[o];
    n.pop = P[o]; n.gdp = G[o] / 1e6; n.cells = C[o]; n.devAvg = P[o] ? DV[o] / P[o] : 0; n.leanAvg = P[o] ? LE[o] / P[o] : 0; n.occ = C[o] ? OC[o] / C[o] : 0; n.topCell = TOP[o];
    if (C[o]) { let a = Math.atan2(SY[o], SX[o]); if (a < 0) a += 2 * Math.PI; n.cx = a / (2 * Math.PI) * Wd; n.cy = SZ[o] / C[o]; }
    const govMul = { Republic: 1, Monarchy: 1, Autocracy: 1.25, Junta: 1.4, Provisional: 0.8 }[n.gov] || 1;
    n.mil = Math.pow(Math.max(1, n.gdp), 0.62) * Math.pow(Math.max(1, n.pop), 0.18) * govMul * (1 - 0.5 * n.exh) / 100;
    if (n.alive && !C[o]) { n.alive = false; n.bloc = 0; }
    if (!n.alive && C[o]) n.alive = true;
    if (n.alive && (n.capital < 0 || owner[n.capital] !== o)) n.capital = TOP[o];
  }
}

// Which nations touch each other (and how long their shared border is).
export function computeAdjacency(W) {
  const { owner, Wd, Hd } = W; const adj = new Map();
  for (let y = 0; y < Hd; y++) for (let x = 0; x < Wd; x++) {
    const i = y * Wd + x, a = owner[i]; if (!a) continue;
    const r = y * Wd + ((x + 1) % Wd), b = owner[r];
    if (b && b !== a) { const k = pairKey(a, b); adj.set(k, (adj.get(k) || 0) + 1); }
    if (y + 1 < Hd) { const c = owner[i + Wd]; if (c && c !== a) { const k = pairKey(a, c); adj.set(k, (adj.get(k) || 0) + 1); } }
  }
  W.adj = adj;
  W.neighbors = Array.from({ length: W.nations.length }, () => []);
  for (const k of adj.keys()) { const a = Math.floor(k / MAXN), b = k % MAXN; W.neighbors[a].push(b); W.neighbors[b].push(a); }
}

export function snapshot(W, n) {
  const h = n.hist; h.m.push(W.month); h.pop.push(Math.round(n.pop)); h.gdp.push(Math.round(n.gdp)); h.cells.push(n.cells); h.stab.push(Math.round(n.stab * 100) / 100);
  if (h.m.length > 400) for (const k of Object.keys(h)) h[k].splice(0, h[k].length - 400);
}

export function addNews(W, text, kind = 'info', nations = []) {
  W.news.unshift({ m: W.month, t: text, k: kind, n: nations });
  if (W.news.length > 400) W.news.length = 400;
  if (W.onNews) W.onNews(W.news[0]);
}

export function warBetween(W, a, b) { return W.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a)); }
export function atWarSet(W) { const s = new Set(); for (const w of W.wars) { s.add(w.a); s.add(w.b); } return s; }

// Transfer cells between nations (used by sim + god mode); returns count changed.
export function transferCells(W, cellsList, to) {
  let n = 0; for (const i of cellsList) if (W.owner[i] !== to && W.D.cells.country[i]) { W.owner[i] = to; n++; }
  return n;
}

// ---- border history: a keyframe plus yearly sparse deltas of cell ownership (over land cells) ----
export function initTimeline(W) {
  const key = new Uint16Array(W.land.length); for (let k = 0; k < W.land.length; k++) key[k] = W.owner[W.land[k]];
  W.timeline = { start: W.month, key, deltas: [] }; W.tlLast = key.slice();
}
export function recordTimeline(W) {
  if (!W.timeline) initTimeline(W);
  const last = W.tlLast, idx = [], val = [];
  for (let k = 0; k < W.land.length; k++) { const o = W.owner[W.land[k]]; if (o !== last[k]) { idx.push(k); val.push(o); last[k] = o; } }
  W.timeline.deltas.push({ m: W.month, idx: Int32Array.from(idx), val: Uint16Array.from(val) });
}
// full-grid owner array as it was at month m (nearest recorded year at or before m)
export function ownerAt(W, m) {
  const T = W.timeline, cur = T.key.slice();
  for (const d of T.deltas) { if (d.m > m) break; for (let k = 0; k < d.idx.length; k++) cur[d.idx[k]] = d.val[k]; }
  const out = new Uint16Array(W.N); for (let k = 0; k < W.land.length; k++) out[W.land[k]] = cur[k];
  return out;
}
