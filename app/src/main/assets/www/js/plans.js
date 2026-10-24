// Districtr-style redistricting plans over cells, provinces or US counties.
import { districtColor } from './util.js';
import { cellVote } from './sim.js';

export const UNIT_TYPES = { cells: 'World grid cells', provinces: 'Provinces / states', counties: 'US counties' };

export function newPlan(W, { name, unit, scope, n }) {
  const len = unit === 'cells' ? W.N : unit === 'provinces' ? W.D.units.provinces.length : W.D.units.counties.length;
  const p = { id: Date.now() % 1e9, name, unit, scope, n, assign: new Int16Array(len).fill(-1), locked: [], colors: [], electionsUse: true };
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
export function unitCount(W, p) { return p.assign.length; }

// population of each unit, scaled by how much its country has grown since 2026
export function unitPops(W, p) {
  const D = W.D;
  if (p.unit === 'cells') return W.pop;
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
  const a = (p.unit === 'provinces' ? W.D.adj.prov : W.D.adj.county)[u] || [];
  for (let k = 0; k < a.length; k++) out.push(a[k]);
  return out;
}

// Full statistics for each district.
export function planStats(W, p) {
  const pops = unitPops(W, p), leans = unitLeans(W, p), A = p.assign, n = p.n, D = W.D;
  const units = p.unit === 'provinces' ? D.units.provinces : p.unit === 'counties' ? D.units.counties : null;
  const res = Array.from({ length: n }, (_, k) => ({ k, pop: 0, area: 0, perim: 0, units: 0, pieces: 0, votes: [0, 0, 0], leanSum: 0 }));
  let totalElig = 0, unassignedPop = 0, unassignedUnits = 0;
  const nation = W.nations[p.scope] && W.nations[p.scope].alive ? W.nations[p.scope] : null;
  const parties = nation ? nation.parties : [{ pos: -0.55 }, { pos: 0 }, { pos: 0.55 }];
  const ruling = nation ? nation.ruling : 1, stab = nation ? nation.stab : 0.5;
  const cellKm = 111.32 * 180 / W.Hd;
  for (let u = 0; u < A.length; u++) {
    if (p.unit === 'cells' && !W.D.cells.country[u]) continue;
    if (!eligible(W, p, u)) continue;
    const pop = pops[u]; totalElig += pop; const d = A[u];
    if (d < 0) { unassignedPop += pop; unassignedUnits++; continue; }
    const R = res[d]; R.pop += pop; R.units++;
    cellVote(leans[u], parties, ruling, stab, R.votes, pop);
    if (p.unit === 'cells') {
      const row = (u / W.Wd) | 0; R.area += W.area[row];
      const lat = 90 - (row + 0.5) * 180 / W.Hd, cos = Math.cos(lat * Math.PI / 180);
      const x = u % W.Wd;
      const L = A[row * W.Wd + ((x + 1) % W.Wd)], Rr = A[row * W.Wd + ((x - 1 + W.Wd) % W.Wd)];
      const Up = row > 0 ? A[u - W.Wd] : -1, Dn = row < W.Hd - 1 ? A[u + W.Wd] : -1;
      if (L !== d) R.perim += cellKm; if (Rr !== d) R.perim += cellKm; if (Up !== d) R.perim += cellKm * cos; if (Dn !== d) R.perim += cellKm * cos;
    } else {
      R.area += units[u].area; R.perim += units[u].perim;
      const a = (p.unit === 'provinces' ? D.adj.prov : D.adj.county)[u] || [];
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
  return { districts: res, ideal, totalPop: totalElig, unassignedPop, unassignedUnits, seats, maxDev: devs.length ? Math.max(...devs) : 0, parties };
}

// Votes per district for a nation's election (used by the sim).
export function districtVotes(W, p, nation) {
  const s = planStats(W, p); return s.districts.map((d) => d.votes);
}

// Paint helpers. Each returns list of [unit, oldValue] for undo.
export function paintUnits(W, p, list, d, changes) {
  for (const u of list) {
    if (u < 0 || u >= p.assign.length || !eligible(W, p, u)) continue;
    const old = p.assign[u]; if (old === d) continue;
    if (old >= 0 && p.locked[old]) continue;
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
}
