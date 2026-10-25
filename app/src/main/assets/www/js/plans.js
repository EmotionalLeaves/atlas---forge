// Districtr-style redistricting plans over cells, provinces or US counties.
import { districtColor } from './util.js';
import { cellVote } from './sim.js';

export const UNIT_TYPES = { cells: 'World grid cells', provinces: 'Provinces / states', counties: 'US counties', precincts: 'US precincts (real election data)' };
export const PRECINCT_PARTIES = [{ name: 'Democratic', pos: -0.5 }, { name: 'Other', pos: 0 }, { name: 'Republican', pos: 0.5 }];
export const PRECINCT_COLORS = [[64, 120, 214], [150, 150, 150], [214, 66, 66]];

// The polygons, attributes and adjacency behind a plan's units (null for grid cells or an unloaded precinct pack).
export function unitLayer(W, unit, pack) {
  const D = W.D;
  if (unit === 'provinces') return { units: D.units.provinces, geom: D.geom.prov, adj: D.adj.prov, key: 'provinces' };
  if (unit === 'counties') return { units: D.units.counties, geom: D.geom.county, adj: D.adj.county, key: 'counties' };
  if (unit === 'precincts') { const P = D.packs && D.packs[pack]; return P ? { units: P.units, geom: P.geom, adj: P.adj, pack: P, key: 'precincts:' + pack } : null; }
  return null;
}
export const planLayer = (W, p) => unitLayer(W, p.unit, p.pack);

export function newPlan(W, { name, unit, scope, n, pack }) {
  const L = unitLayer(W, unit, pack);
  const len = unit === 'cells' ? W.N : L.units.length;
  const p = { id: Date.now() % 1e9, name, unit, scope, n, assign: new Int16Array(len).fill(-1), locked: [], colors: [], electionsUse: unit !== 'precincts' };
  if (unit === 'precincts') { p.pack = pack; p.election = 0; p.scope = 0; }
  for (let k = 0; k < n; k++) p.colors.push(districtColor(k));
  W.plans.push(p); return p;
}
export function setDistrictCount(p, n) {
  p.n = n; while (p.colors.length < n) p.colors.push(districtColor(p.colors.length));
  for (let i = 0; i < p.assign.length; i++) if (p.assign[i] >= n) p.assign[i] = -1;
}

// Is unit u inside the plan's area?
export function eligible(W, p, u) {
  const D = W.D;
  if (p.unit === 'cells') return D.cells.country[u] !== 0 && W.owner[u] !== 0 && (!p.scope || D.cells.country[u] === p.scope);
  if (p.unit === 'provinces') return !p.scope || D.units.provinces[u].c === p.scope;
  return true;
}
// Real precinct results for the plan's chosen election: [dem, other, rep] per precinct (null if not a precinct plan)
export function precinctVotes(W, p) {
  if (p.unit !== 'precincts') return null; const L = planLayer(W, p); if (!L) return null;
  const E = L.pack.elections[p.election || 0] || L.pack.elections[0]; return E || null;
}
export function unitCount(W, p) { return p.assign.length; }

// population of each unit, scaled by how much its country has grown since 2026
export function unitPops(W, p) {
  const D = W.D;
  if (p.unit === 'cells') return W.pop;
  if (p.unit === 'precincts') { const L = planLayer(W, p); return L ? L.pack.pop : new Float32Array(p.assign.length); }
  const growth = countryGrowth(W);
  if (p.unit === 'provinces') return Float64Array.from(D.units.provinces, (u) => u.pop * (growth[u.c] || 1));
  const us = D.units.countries.findIndex((c) => c.a3 === 'USA') + 1;
  return Float64Array.from(D.units.counties, (u) => u.pop * (growth[us] || 1));
}
export function countryGrowth(W) {
  const nC = W.D.units.countries.length + 1, now = new Float64Array(nC), then = new Float64Array(nC), c = W.D.cells.country;
  for (const i of W.land) { now[c[i]] += W.pop[i]; then[c[i]] += W.pop0[i]; }
  return Array.from(now, (v, k) => then[k] > 0 ? v / then[k] : 1);
}
// average political lean of each unit (cells give it directly)
export function unitLeans(W, p) {
  if (p.unit === 'cells') return W.lean;
  if (p.unit === 'precincts') return new Float32Array(p.assign.length);
  const D = W.D, key = p.unit === 'provinces' ? D.cells.admin1 : D.cells.county;
  const n = p.assign.length, s = new Float64Array(n), w = new Float64Array(n);
  for (const i of W.land) { const u = key[i] - 1; if (u < 0) continue; s[u] += W.lean[i] * (W.pop[i] + 1); w[u] += W.pop[i] + 1; }
  return Float64Array.from(s, (v, k) => w[k] ? v / w[k] : 0);
}

function neighborsOf(W, p, u, out) {
  out.length = 0;
  if (p.unit === 'cells') {
    const Wd = W.Wd, x = u % Wd, y = (u / Wd) | 0;
    out.push(y * Wd + ((x + 1) % Wd), 1, y * Wd + ((x - 1 + Wd) % Wd), 1);
    if (y > 0) out.push(u - Wd, 0); if (y < W.Hd - 1) out.push(u + Wd, 0);
    return out;
  }
  const L = planLayer(W, p); const a = (L && L.adj[u]) || [];
  for (let k = 0; k < a.length; k++) out.push(a[k]);
  return out;
}

// Full statistics for each district.
export function planStats(W, p) {
  const pops = unitPops(W, p), leans = unitLeans(W, p), A = p.assign, n = p.n, D = W.D;
  const LY = planLayer(W, p), units = LY ? LY.units : null, adjL = LY ? LY.adj : null;
  const E = precinctVotes(W, p), PK = LY && LY.pack;
  const nRace = PK ? PK.race.length : 0;
  const res = Array.from({ length: n }, (_, k) => ({ k, pop: 0, area: 0, perim: 0, units: 0, pieces: 0, votes: [0, 0, 0], leanSum: 0, race: new Float64Array(nRace), vap: 0 }));
  let totalElig = 0, unassignedPop = 0, unassignedUnits = 0;
  const nation = !E && W.nations[p.scope] && W.nations[p.scope].alive ? W.nations[p.scope] : null;
  const parties = E ? PRECINCT_PARTIES : nation ? nation.parties : [{ pos: -0.55 }, { pos: 0 }, { pos: 0.55 }];
  const ruling = nation ? nation.ruling : 1, stab = nation ? nation.stab : 0.5;
  const cellKm = 111.32 * 180 / W.Hd;
  for (let u = 0; u < A.length; u++) {
    if (p.unit === 'cells' && !W.D.cells.country[u]) continue;
    if (!eligible(W, p, u)) continue;
    const pop = pops[u]; totalElig += pop; let d = A[u];
    if (d >= n) { A[u] = -1; d = -1; }
    if (d < 0) { unassignedPop += pop; unassignedUnits++; continue; }
    const R = res[d]; R.pop += pop; R.units++;
    if (E) { R.votes[0] += E.d[u]; R.votes[2] += E.r[u]; } else cellVote(leans[u], parties, ruling, stab, R.votes, pop);
    if (PK) { for (let k = 0; k < nRace; k++) R.race[k] += PK.race[k].data[u]; if (PK.vap) R.vap += PK.vap[u]; }
    if (p.unit === 'cells') {
      const row = (u / W.Wd) | 0; R.area += W.area[row];
      const lat = 90 - (row + 0.5) * 180 / W.Hd, cos = Math.cos(lat * Math.PI / 180);
      const x = u % W.Wd;
      const L = A[row * W.Wd + ((x + 1) % W.Wd)], Rr = A[row * W.Wd + ((x - 1 + W.Wd) % W.Wd)];
      const Up = row > 0 ? A[u - W.Wd] : -1, Dn = row < W.Hd - 1 ? A[u + W.Wd] : -1;
      if (L !== d) R.perim += cellKm; if (Rr !== d) R.perim += cellKm; if (Up !== d) R.perim += cellKm * cos; if (Dn !== d) R.perim += cellKm * cos;
    } else {
      R.area += units[u].area; R.perim += units[u].perim;
      const a = adjL[u] || [];
      for (let k = 0; k < a.length; k += 2) if (A[a[k]] === d) R.perim -= a[k + 1];
    }
  }
  // contiguity: count connected pieces per district
  const seen = new Uint8Array(A.length), stack = [], nb = [];
  for (let u = 0; u < A.length; u++) {
    const d = A[u]; if (d < 0 || seen[u]) continue;
    res[d].pieces++; seen[u] = 1; stack.push(u);
    while (stack.length) { const v = stack.pop(); neighborsOf(W, p, v, nb); for (let k = 0; k < nb.length; k += 2) { const w = nb[k]; if (!seen[w] && A[w] === d) { seen[w] = 1; stack.push(w); } } }
  }
  const ideal = totalElig / n;
  let seats = [0, 0, 0];
  for (const R of res) {
    R.dev = ideal ? (R.pop - ideal) / ideal : 0;
    R.pp = R.perim > 0 ? Math.min(1, 4 * Math.PI * R.area / (R.perim * R.perim)) : 0;
    const t = R.votes[0] + R.votes[1] + R.votes[2];
    R.shares = t ? R.votes.map((v) => v / t) : [0, 0, 0];
    R.winner = t ? R.shares.indexOf(Math.max(...R.shares)) : -1;
    if (R.winner >= 0) seats[R.winner]++;
  }
  const devs = res.filter((r) => r.units).map((r) => Math.abs(r.dev));
  // partisan fairness (Left vs Right; Centre counted as votes but not in the two-party measures)
  const V = [0, 0, 0], wasted = [0, 0, 0], lshare = []; let competitive = 0, contested = 0;
  for (const R of res) {
    const t = R.votes[0] + R.votes[1] + R.votes[2]; if (!t) continue; contested++;
    for (let k = 0; k < 3; k++) V[k] += R.votes[k];
    const sorted = [...R.votes].sort((a, b) => b - a), need = sorted[1];
    for (let k = 0; k < 3; k++) wasted[k] += k === R.winner ? R.votes[k] - need : R.votes[k];
    if ((sorted[0] - sorted[1]) / t < 0.1) competitive++;
    if (R.votes[0] + R.votes[2] > 0) lshare.push(R.votes[0] / (R.votes[0] + R.votes[2]));
  }
  const VT = V[0] + V[1] + V[2] || 1;
  const eg = (wasted[0] - wasted[2]) / VT; // > 0: Left wastes more votes -> map favours Right
  lshare.sort((a, b) => a - b);
  const mean = lshare.length ? lshare.reduce((a, b) => a + b, 0) / lshare.length : 0.5;
  const median = lshare.length ? (lshare.length % 2 ? lshare[(lshare.length - 1) >> 1] : (lshare[lshare.length / 2 - 1] + lshare[lshare.length / 2]) / 2) : 0.5;
  return { districts: res, ideal, totalPop: totalElig, unassignedPop, unassignedUnits, seats, maxDev: devs.length ? Math.max(...devs) : 0, parties,
    partyColors: E ? PRECINCT_COLORS : null, partyShort: E ? ['D', 'O', 'R'] : ['L', 'C', 'R'], partyNames: E ? ['Dem', 'Other', 'Rep'] : ['Left', 'Centre', 'Right'],
    election: E ? E.label : null, raceLabels: PK ? PK.race.map((r) => r.label) : null,
    voteShare: V.map((v) => v / VT), eg, meanMedian: median - mean, competitive, contested };
}

// Votes per district for a nation's election (used by the sim).
export function districtVotes(W, p, nation) {
  const s = planStats(W, p); return s.districts.map((d) => d.votes);
}

// Paint helpers. Each returns list of [unit, oldValue] for undo.
// noOverwrite: leave units that already belong to another district alone (Districtr's "forbid paint-over")
export function paintUnits(W, p, list, d, changes, noOverwrite = false) {
  for (const u of list) {
    if (u < 0 || u >= p.assign.length || !eligible(W, p, u)) continue;
    const old = p.assign[u]; if (old === d) continue;
    if (old >= 0 && (p.locked[old] || (noOverwrite && d >= 0))) continue;
    if (changes && !changes.has(u)) changes.set(u, old);
    p.assign[u] = d;
  }
}
export function brushCells(W, cx, cy, radius) {
  const out = [], r2 = (radius + 0.35) ** 2, R = Math.ceil(radius);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > r2) continue; const y = cy + dy; if (y < 0 || y >= W.Hd) continue;
    out.push(y * W.Wd + ((cx + dx + W.Wd) % W.Wd));
  }
  return out;
}
// flood-fill all contiguous units sharing the start unit's current district (bounded)
export function floodUnits(W, p, start, limit = 200000) {
  const target = p.assign[start], out = [start], seen = new Set([start]), nb = [];
  for (let q = 0; q < out.length && out.length < limit; q++) {
    neighborsOf(W, p, out[q], nb);
    for (let k = 0; k < nb.length; k += 2) { const v = nb[k]; if (!seen.has(v) && p.assign[v] === target && eligible(W, p, v)) { seen.add(v); out.push(v); } }
  }
  return out;
}
// Assign every unassigned unit to the neighbouring district with the smallest population.
export function autoFill(W, p) {
  const pops = unitPops(W, p), dp = new Float64Array(p.n);
  for (let u = 0; u < p.assign.length; u++) if (p.assign[u] >= 0) dp[p.assign[u]] += pops[u];
  const changes = new Map(); const nb = [];
  let frontier = [];
  for (let u = 0; u < p.assign.length; u++) if (p.assign[u] < 0 && (p.unit !== 'cells' || W.D.cells.country[u]) && eligible(W, p, u)) frontier.push(u);
  let guard = 0;
  while (frontier.length && guard++ < 4000) {
    const next = [];
    for (const u of frontier) {
      neighborsOf(W, p, u, nb); let best = -1;
      for (let k = 0; k < nb.length; k += 2) { const d = p.assign[nb[k]]; if (d >= 0 && !p.locked[d] && (best < 0 || dp[d] < dp[best])) best = d; }
      if (best >= 0) { changes.set(u, -1); p.assign[u] = best; dp[best] += pops[u]; } else next.push(u);
    }
    if (next.length === frontier.length) break;
    frontier = next;
  }
  return changes;
}
// Approximate position (degrees) of each unit, for spreading seeds.
function unitXY(W, p) {
  const D = W.D;
  if (p.unit === 'cells') return (u) => [-180 + ((u % W.Wd) + 0.5) * 360 / W.Wd, 90 - (((u / W.Wd) | 0) + 0.5) * 180 / W.Hd];
  if (p.unit === 'provinces') return (u) => D.units.provinces[u].l;
  if (p.unit === 'precincts') { const P = D.packs[p.pack]; return (u) => [P.cx[u] * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp((0.5 - P.cy[u]) * 2 * Math.PI)) - 90]; }
  if (!D._countyXY) {
    const g = D.geom.county, n = D.units.counties.length, x = new Float64Array(n), y = new Float64Array(n), c = new Float64Array(n);
    for (let v = 0; v < g.uid.length; v++) { const u = g.uid[v]; x[u] += g.pos[v * 2]; y[u] += g.pos[v * 2 + 1]; c[u]++; }
    D._countyXY = Array.from({ length: n }, (_, u) => c[u] ? [x[u] / c[u] * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp((0.5 - y[u] / c[u]) * 2 * Math.PI)) - 90] : [0, 0]);
  }
  return (u) => D._countyXY[u];
}
// Make a random, population-balanced plan: sweep across the area from a random direction,
// growing each district outward from its seed until it holds 1/n of the people.
export function randomPlan(W, p) {
  const pops = unitPops(W, p), elig = [];
  for (let u = 0; u < p.assign.length; u++) if ((p.unit !== 'cells' || W.D.cells.country[u]) && eligible(W, p, u)) elig.push(u);
  if (!elig.length) return;
  for (const u of elig) p.assign[u] = -1;
  const xy = unitXY(W, p), n = p.n, th = W.rng() * Math.PI * 2, cx = Math.cos(th), sy = Math.sin(th);
  // project on a random direction (handle the dateline by unwrapping around the mean longitude)
  let mx = 0, my = 0; for (const u of elig) { const [x] = xy(u); mx += Math.cos(x * Math.PI / 180); my += Math.sin(x * Math.PI / 180); }
  const lng0 = Math.atan2(my, mx) * 180 / Math.PI;
  const proj = new Map(); for (const u of elig) { const [x, y] = xy(u); let dx = x - lng0; if (dx > 180) dx -= 360; if (dx < -180) dx += 360; proj.set(u, dx * Math.cos(y * Math.PI / 180) * cx + y * sy); }
  const order = elig.slice().sort((a, b) => proj.get(a) - proj.get(b));
  let total = 0; for (const u of elig) total += pops[u];
  const isElig = (v) => (p.unit !== 'cells' || W.D.cells.country[v]) && eligible(W, p, v);
  let ptr = 0, assignedPop = 0; const nb = [];
  for (let d = 0; d < n; d++) {
    const target = (total - assignedPop) / (n - d); let dp = 0;
    while (dp < target * 0.995 || d === n - 1) {
      while (ptr < order.length && p.assign[order[ptr]] !== -1) ptr++;
      if (ptr >= order.length) break;
      const seed = order[ptr]; const q = [seed]; p.assign[seed] = d; dp += pops[seed];
      for (let h = 0; h < q.length && (dp < target * 0.995 || d === n - 1); h++) {
        neighborsOf(W, p, q[h], nb);
        // grow toward the sweep's leading edge first so leftovers stay contiguous
        const cand = []; for (let k = 0; k < nb.length; k += 2) { const v = nb[k]; if (p.assign[v] === -1 && isElig(v)) cand.push(v); }
        cand.sort((a, b) => proj.get(a) - proj.get(b));
        for (const v of cand) { if (dp >= target * 0.995 && d !== n - 1) break; p.assign[v] = d; dp += pops[v]; q.push(v); }
      }
    }
    assignedPop += dp;
  }
  autoFill(W, p);
  // make every district one piece, then even out populations along the borders
  const isE = (u) => (p.unit !== 'cells' || W.D.cells.country[u]) && eligible(W, p, u);
  for (let it = 0; it < 6; it++) { repairContiguity(W, p, pops, isE); if (!balanceStep(W, p, pops, isE)) break; }
  repairContiguity(W, p, pops, isE);
}

// Keep each district's largest connected piece; hand the other pieces to the neighbouring district with the fewest people.
export function repairContiguity(W, p, pops, isE) {
  const A = p.assign, n = p.n, nb = [], comp = new Int32Array(A.length).fill(-1); const comps = [];
  for (let u = 0; u < A.length; u++) {
    if (A[u] < 0 || comp[u] >= 0 || !isE(u)) continue;
    const id = comps.length, list = [u]; comp[u] = id;
    for (let q = 0; q < list.length; q++) { neighborsOf(W, p, list[q], nb); for (let k = 0; k < nb.length; k += 2) { const v = nb[k]; if (comp[v] < 0 && A[v] === A[u]) { comp[v] = id; list.push(v); } } }
    let pop = 0; for (const v of list) pop += pops[v] + 1e-6;
    comps.push({ d: A[u], list, pop });
  }
  const best = new Array(n).fill(-1); comps.forEach((c, k) => { if (best[c.d] < 0 || c.pop > comps[best[c.d]].pop) best[c.d] = k; });
  const dpop = new Float64Array(n); for (let u = 0; u < A.length; u++) if (A[u] >= 0) dpop[A[u]] += pops[u];
  let moved = 0;
  // smallest stray pieces first
  const strays = comps.map((c, k) => k).filter((k) => best[comps[k].d] !== k).sort((a, b) => comps[a].pop - comps[b].pop);
  for (const k of strays) {
    const c = comps[k], cnt = new Map();
    for (const u of c.list) { neighborsOf(W, p, u, nb); for (let j = 0; j < nb.length; j += 2) { const d = A[nb[j]]; if (d >= 0 && d !== c.d && !p.locked[d]) cnt.set(d, (cnt.get(d) || 0) + 1); } }
    if (!cnt.size || p.locked[c.d]) continue;
    let to = -1; for (const d of cnt.keys()) if (to < 0 || dpop[d] < dpop[to]) to = d;
    for (const u of c.list) A[u] = to; dpop[to] += c.pop; dpop[c.d] -= c.pop; moved++;
  }
  return moved;
}
// Move border units from over-populated districts into under-populated neighbours (one sweep). Returns true if anything moved.
function balanceStep(W, p, pops, isE) {
  const A = p.assign, n = p.n, nb = []; const dpop = new Float64Array(n); let tot = 0;
  for (let u = 0; u < A.length; u++) if (A[u] >= 0) { dpop[A[u]] += pops[u]; tot += pops[u]; }
  const ideal = tot / n; let moved = false;
  for (let u = 0; u < A.length; u++) {
    const d = A[u]; if (d < 0 || p.locked[d] || dpop[d] <= ideal * 1.005 || !isE(u)) continue;
    neighborsOf(W, p, u, nb); let to = -1, same = 0;
    for (let k = 0; k < nb.length; k += 2) { const e = A[nb[k]]; if (e === d) same++; else if (e >= 0 && !p.locked[e] && dpop[e] < ideal && (to < 0 || dpop[e] < dpop[to])) to = e; }
    if (to < 0 || same === 0) continue;
    const pu = pops[u]; if (dpop[d] - pu < ideal * 0.98 || dpop[to] + pu > ideal * 1.02) continue;
    A[u] = to; dpop[d] -= pu; dpop[to] += pu; moved = true;
  }
  return moved;
}

// Centre (lng, lat) of a cell / province / county.
export function unitCenter(W, unit, u, pack) { return unitXY(W, { unit, pack })(u); }

// Units sharing a "parent" area with u: cells -> province, counties -> state, provinces -> country.
export function parentUnits(W, p, u, provCells) {
  const D = W.D;
  if (p.unit === 'cells') {
    const pr = D.cells.admin1[u]; if (!pr || !provCells) return [u];
    const out = []; for (let k = provCells.start[pr]; k < provCells.start[pr + 1]; k++) out.push(provCells.items[k]); return out;
  }
  if (p.unit === 'precincts') {
    const P = D.packs[p.pack]; if (!P) return [u];
    if (!P._byCounty) { P._byCounty = new Map(); for (let k = 0; k < P.count; k++) { const c = P.county[k]; let a = P._byCounty.get(c); if (!a) P._byCounty.set(c, a = []); a.push(k); } }
    return P._byCounty.get(P.county[u]) || [u];
  }
  if (p.unit === 'counties') {
    if (!D._byState) { D._byState = new Map(); D.units.counties.forEach((c, k) => { let a = D._byState.get(c.s); if (!a) D._byState.set(c.s, a = []); a.push(k); }); }
    return D._byState.get(D.units.counties[u].s) || [u];
  }
  if (!D._byCountry) { D._byCountry = new Map(); D.units.provinces.forEach((c, k) => { let a = D._byCountry.get(c.c); if (!a) D._byCountry.set(c.c, a = []); a.push(k); }); }
  return D._byCountry.get(D.units.provinces[u].c) || [u];
}
export const PARENT_NAME = { cells: 'province', counties: 'state', provinces: 'country', precincts: 'county' };

// How many parent areas (provinces / states / countries) are split between districts.
export function planSplits(W, p, provCells) {
  const seen = new Map(); let parents = 0, split = 0;
  const P = p.unit === 'precincts' ? W.D.packs[p.pack] : null; if (p.unit === 'precincts' && !P) return { parents: 0, split: 0 };
  const parentOf = p.unit === 'cells' ? (u) => W.D.cells.admin1[u] : p.unit === 'counties' ? (u) => W.D.units.counties[u].s : p.unit === 'precincts' ? (u) => P.county[u] + 1 : (u) => W.D.units.provinces[u].c;
  for (let u = 0; u < p.assign.length; u++) {
    const d = p.assign[u]; if (d < 0) continue; const k = parentOf(u); if (!k) continue;
    let st = seen.get(k); if (!st) { st = new Set(); seen.set(k, st); }
    st.add(d);
  }
  for (const st of seen.values()) { parents++; if (st.size > 1) split++; }
  return { parents, split };
}

// Districtr-compatible CSV import: first column = unit id (GEOID/FIPS for counties, ISO code or name for provinces, "lat,lng" not supported), last column = district number.
export function importCSV(W, p, text) {
  const lines = text.trim().split(/\r?\n/); let ok = 0, bad = 0;
  const U = W.D.units; const idx = new Map();
  if (p.unit === 'counties') U.counties.forEach((c, k) => idx.set(String(c.fips).padStart(5, '0'), k));
  else if (p.unit === 'provinces') U.provinces.forEach((c, k) => { if (c.iso) idx.set(c.iso.toLowerCase(), k); idx.set(c.n.toLowerCase(), k); });
  else if (p.unit === 'precincts') { const P = W.D.packs[p.pack]; if (P) P.ids.forEach((id, k) => { idx.set(String(id).toLowerCase(), k); }); }
  for (const line of lines) {
    const f = line.split(',').map((x) => x.replace(/^"|"$/g, '').trim()); if (f.length < 2) continue;
    const d = parseInt(f[f.length - 1], 10); if (!(d >= 1)) continue;
    let u;
    if (p.unit === 'cells') { const lat = parseFloat(f[0]), lng = parseFloat(f[1]); if (!isFinite(lat) || !isFinite(lng)) { bad++; continue; } const x = Math.floor((lng + 180) / 360 * W.Wd), y = Math.floor((90 - lat) / 180 * W.Hd); u = y * W.Wd + x; }
    else { const key = p.unit === 'counties' ? f[0].padStart(5, '0').slice(-5) : f[0].toLowerCase(); u = idx.get(key); if (u == null && p.unit === 'precincts') u = idx.get(f[0].replace(/^0+/, '').toLowerCase()); }
    if (u == null || u < 0 || u >= p.assign.length) { bad++; continue; }
    if (d > p.n) setDistrictCount(p, d);
    p.assign[u] = d - 1; ok++;
  }
  return { ok, bad };
}

// Copy a real enacted/proposed plan from the precinct pack into p.
export function applyRealPlan(W, p, k) {
  const P = W.D.packs[p.pack], R = P && P.plans[k]; if (!R) return false;
  setDistrictCount(p, R.n); p.assign.set(R.assign); p.locked = [];
  return true;
}
