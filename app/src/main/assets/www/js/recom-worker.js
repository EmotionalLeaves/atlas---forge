// ReCom (recombination) redistricting optimiser — runs in a Web Worker.
// Repeatedly merges two neighbouring districts, draws a random spanning tree over them and cuts it
// where both halves have balanced population. Moves that improve the chosen goals are kept
// (with simulated-annealing style acceptance of occasional worse moves).
let stop = false;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'stop') { stop = true; return; }
  if (m.type === 'run') { stop = false; try { run(m); } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); } }
};

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function run(m) {
  const { n: N, k: K, off, nb, pop, dem, rep, parent, timeMs, tol, goals } = m; // CSR graph over local units
  const assign = Int16Array.from(m.assign);
  const R = rng(m.seed || 12345);
  let total = 0; for (let u = 0; u < N; u++) total += pop[u];
  const ideal = total / K;
  const dpop = new Float64Array(K), ddem = new Float64Array(K), drep = new Float64Array(K);
  for (let u = 0; u < N; u++) { const d = assign[u]; dpop[d] += pop[u]; ddem[d] += dem[u]; drep[d] += rep[u]; }
  const totDem = ddem.reduce((a, b) => a + b, 0), totRep = drep.reduce((a, b) => a + b, 0), demShare = totDem / ((totDem + totRep) || 1);

  // ---- score (lower is better) ----
  function cutEdges() { let c = 0; for (let u = 0; u < N; u++) for (let j = off[u]; j < off[u + 1]; j++) { const v = nb[j]; if (v > u && assign[v] !== assign[u]) c++; } return c; }
  function splits() {
    if (!parent) return 0; const seen = new Map(); let s = 0;
    for (let u = 0; u < N; u++) { const p = parent[u]; let set = seen.get(p); if (!set) seen.set(p, set = new Set()); set.add(assign[u]); }
    for (const set of seen.values()) s += set.size - 1; return s;
  }
  function partisan() {
    let demSeats = 0, comp = 0;
    for (let d = 0; d < K; d++) { const t = ddem[d] + drep[d]; if (!t) continue; const sh = ddem[d] / t; if (sh > 0.5) demSeats++; if (Math.abs(sh - 0.5) < 0.05) comp++; }
    return { demSeats, comp };
  }
  function maxDev() { let m2 = 0; for (let d = 0; d < K; d++) m2 = Math.max(m2, Math.abs(dpop[d] - ideal) / ideal); return m2; }
  const W = { compact: goals.compact ? 1 : 0.15, counties: goals.counties ? 6 : 0, competitive: goals.competitive ? 25 : 0, proportional: goals.proportional ? 60 : 0 };
  function score() {
    let s = W.compact * cutEdges() / Math.sqrt(N / K) + W.counties * splits();
    if (W.competitive || W.proportional) { const p = partisan(); s -= W.competitive * p.comp; s += W.proportional * Math.abs(p.demSeats - demShare * K); }
    s += 400 * Math.max(0, maxDev() - tol); // balance first
    return s;
  }

  // ---- district adjacency: pairs of districts that touch ----
  function districtPairs() {
    const set = new Set(); const out = [];
    for (let u = 0; u < N; u++) for (let j = off[u]; j < off[u + 1]; j++) { const a = assign[u], b = assign[nb[j]]; if (a < b) { const key = a * 4096 + b; if (!set.has(key)) { set.add(key); out.push([a, b]); } } }
    return out;
  }

  // ---- one recombination step on districts a,b; returns true if applied ----
  const inRegion = new Int32Array(N).fill(-1), parentT = new Int32Array(N), order = new Int32Array(N), sub = new Float64Array(N), uf = new Int32Array(N);
  let stamp = 0;
  function find(x) { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; }
  function recom(a, b, tries = 4) {
    stamp++;
    const region = []; for (let u = 0; u < N; u++) if (assign[u] === a || assign[u] === b) { inRegion[u] = stamp; region.push(u); }
    const regionPop = dpop[a] + dpop[b];
    const loBal = Math.max(tol, Math.max(Math.abs(dpop[a] - ideal), Math.abs(dpop[b] - ideal)) / ideal);
    // edges inside the region
    const edges = []; for (const u of region) for (let j = off[u]; j < off[u + 1]; j++) { const v = nb[j]; if (v > u && inRegion[v] === stamp) edges.push(u, v); }
    for (let t = 0; t < tries; t++) {
      // random spanning tree: Kruskal on random weights
      const m2 = edges.length / 2, idx = new Uint32Array(m2); for (let i = 0; i < m2; i++) idx[i] = i;
      for (let i = m2 - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
      for (const u of region) uf[u] = u;
      const adjT = new Map(); for (const u of region) adjT.set(u, []);
      let used = 0;
      for (let i = 0; i < m2 && used < region.length - 1; i++) { const e = idx[i], u = edges[2 * e], v = edges[2 * e + 1], ru = find(u), rv = find(v); if (ru !== rv) { uf[ru] = rv; adjT.get(u).push(v); adjT.get(v).push(u); used++; } }
      if (used < region.length - 1) return false; // region not connected
      // root the tree, compute subtree populations
      const root = region[0]; let head = 0, tail = 0; order[tail++] = root; parentT[root] = -1;
      while (head < tail) { const u = order[head++]; for (const v of adjT.get(u)) if (v !== parentT[u]) { parentT[v] = u; order[tail++] = v; } }
      for (let i = tail - 1; i >= 0; i--) { const u = order[i]; sub[u] = pop[u]; for (const v of adjT.get(u)) if (v !== parentT[u]) sub[u] += sub[v]; }
      // balanced cuts
      const cuts = [];
      for (let i = 1; i < tail; i++) { const u = order[i], s1 = sub[u], s2 = regionPop - s1; if (Math.abs(s1 - ideal) / ideal <= loBal && Math.abs(s2 - ideal) / ideal <= loBal) cuts.push(u); }
      if (!cuts.length) continue;
      const cu = cuts[Math.floor(R() * cuts.length)];
      // nodes in cu's subtree -> a, rest -> b
      stamp++; const st = [cu]; inRegion[cu] = stamp; const side = [cu];
      while (st.length) { const u = st.pop(); for (const v of adjT.get(u)) if (v !== parentT[u] && inRegion[v] !== stamp) { inRegion[v] = stamp; st.push(v); side.push(v); } }
      const isA = new Set(side);
      for (const u of region) { const d = isA.has(u) ? a : b; if (assign[u] !== d) { const old = assign[u]; dpop[old] -= pop[u]; ddem[old] -= dem[u]; drep[old] -= rep[u]; assign[u] = d; dpop[d] += pop[u]; ddem[d] += dem[u]; drep[d] += rep[u]; } }
      return true;
    }
    return false;
  }

  // ---- annealing loop ----
  const t0 = Date.now(); let cur = score(), best = cur, bestAssign = assign.slice(), steps = 0, accepted = 0, lastPost = 0;
  const backup = new Int16Array(N), bpop = new Float64Array(K), bdem = new Float64Array(K), brep = new Float64Array(K);
  while (!stop && Date.now() - t0 < timeMs) {
    const pairs = districtPairs(); if (!pairs.length) break;
    const [a, b] = pairs[Math.floor(R() * pairs.length)];
    backup.set(assign); bpop.set(dpop); bdem.set(ddem); brep.set(drep);
    if (!recom(a, b)) { steps++; continue; }
    const s = score(); steps++;
    const temp = Math.max(0.02, 2 * (1 - (Date.now() - t0) / timeMs));
    if (s <= cur || R() < Math.exp((cur - s) / temp)) { cur = s; accepted++; if (s < best) { best = s; bestAssign = assign.slice(); } }
    else { assign.set(backup); dpop.set(bpop); ddem.set(bdem); drep.set(brep); }
    if (Date.now() - lastPost > 700) { lastPost = Date.now(); self.postMessage({ type: 'progress', assign: bestAssign, steps, accepted, score: best, maxDev: devOf(bestAssign), elapsed: Date.now() - t0 }); }
  }
  self.postMessage({ type: 'done', assign: bestAssign, steps, accepted, score: best, maxDev: devOf(bestAssign), elapsed: Date.now() - t0 });

  function devOf(A) { const p = new Float64Array(K); for (let u = 0; u < N; u++) p[A[u]] += pop[u]; let m2 = 0; for (let d = 0; d < K; d++) m2 = Math.max(m2, Math.abs(p[d] - ideal) / ideal); return m2; }
}
