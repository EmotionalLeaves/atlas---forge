// The world simulation: one tick = one month.
import { LEAN_BINS, MAXN, HAB, GOVS, rel, setRel, pairKey, computeAggregates, computeAdjacency, snapshot, addNews, warBetween, newNation, cellLngLat } from './world.js';
import { clamp, vnoise, hsl, rebelName, blocName } from './util.js';

const GROW = Float32Array.from({ length: 1025 }, (_, k) => 0.019 * Math.pow(1 - k / 1024, 1.5) + 0.002);
const GOV_STAB = { Republic: 0.04, Monarchy: 0.05, Autocracy: 0.02, Junta: -0.06, Provisional: -0.12 };

export function tick(W) {
  const r = W.rng, { land, owner, pop, dev, lean, Wd, Hd } = W, terr = W.terrain, flags = W.D.cells.flags;
  const nations = W.nations, nn = nations.length;
  const ev = { owner: false };
  W.month++;
  const warOf = new Uint8Array(nn); for (const w of W.wars) { warOf[w.a] = 1; warOf[w.b] = 1; }
  const stab = new Float32Array(nn), devAvg = new Float32Array(nn);
  for (let o = 1; o < nn; o++) { stab[o] = nations[o].stab; devAvg[o] = nations[o].devAvg; }

  // ---- cells: population and development ----
  for (let k = 0; k < land.length; k++) {
    const i = land[k], p = pop[i]; if (p <= 0) continue;
    const o = owner[i], d = dev[i], row = (i / Wd) | 0;
    const hab = HAB[terr[i]] + ((flags[i] & 1) ? 0.4 : 0);
    const cap = W.area[row] * hab * (40 + 900 * d) + 50;
    let g = GROW[(d * 1024 + 0.5) | 0];
    g *= 1 - Math.min(1, 0.5 * p / cap);
    if (p > cap) g -= Math.min(0.03, 0.01 * (p / cap - 1));
    if (o && warOf[o]) g -= 0.004;
    pop[i] = p * (1 + g / 12);
    if (o) {
      const s = stab[o];
      dev[i] = clamp(d + ((0.009 * s - 0.0025 - (warOf[o] ? 0.006 : 0)) * (1 - d) + (devAvg[o] - d) * 0.01) / 12, 0.005, 1);
    }
  }
  // yearly regional political waves keep the lean map spatially coherent
  if (W.month % 12 === 0) {
    const t = W.month / 120;
    for (let k = 0; k < land.length; k++) {
      const i = land[k], o = owner[i]; if (!o) continue;
      const x = (i % Wd) / Wd * 360, y = ((i / Wd) | 0) / Hd * 180;
      const wave = vnoise(x / 9 + t, y / 9, 31) - 0.5;
      lean[i] = clamp(lean[i] + 0.06 * wave + 0.05 * W.mood[o] + 0.1 * (W.lean0[i] - lean[i]), -1, 1);
    }
  }
  computeAggregates(W);

  // ---- wars ----
  if (W.wars.length && W.settings.wars) { if (fightWars(W)) { ev.owner = true; computeAggregates(W); } }
  // ---- nations: stability, government, rebellion ----
  for (let o = 1; o < nn; o++) {
    const n = nations[o]; if (!n.alive) continue;
    const size = Math.log10(1 + n.cells) / 4;
    const target = 0.38 + 0.35 * n.devAvg + (GOV_STAB[n.gov] || 0) - 0.4 * n.exh - 0.35 * n.occ - 0.08 * size + (n.bonus || 0);
    n.stab = clamp(n.stab + (target - n.stab) * 0.04 + (r() - 0.5) * 0.012, 0, 1);
    if (n.bonus) n.bonus *= 0.9;
    if (!warOf[o]) n.exh *= 0.97;
    if (n.gov === 'Republic' && n.stab < 0.22 && r() < 0.004) { n.gov = 'Junta'; addNews(W, `Military coup in ${n.name}; a junta takes power.`, 'coup', [o]); }
    else if (n.gov === 'Junta' && n.stab > 0.5 && r() < 0.008) { n.gov = 'Republic'; n.lastElection = -999; addNews(W, `${n.name} returns to civilian rule.`, 'coup', [o]); }
    else if (n.gov === 'Junta' && r() < 0.0015) { n.gov = 'Autocracy'; }
    else if (n.gov === 'Provisional' && W.month - n.founded > 24 && n.stab > 0.35 && r() < 0.03) { n.gov = 'Republic'; n.lastElection = -999; addNews(W, `${n.name} adopts a constitution.`, 'info', [o]); }
    else if (n.gov === 'Autocracy' && n.stab < 0.18 && r() < 0.003) { n.gov = 'Provisional'; n.founded = W.month; addNews(W, `Revolution in ${n.name}! The regime falls.`, 'coup', [o]); }
    if (W.settings.rebels && n.stab < 0.2 && n.cells > 25 && r() < 0.012) { if (rebellion(W, n)) ev.owner = true; }
    // elections
    if (W.settings.elections && n.gov === 'Republic' && (W.month - n.lastElection >= 48) && ((W.month + o) % 12 === 0)) holdElection(W, n);
  }
  if (ev.owner) computeAggregates(W);
  // ---- diplomacy ----
  diplomacy(W, warOf);
  // ---- disasters ----
  if (W.settings.disasters && r() < 0.03) randomDisaster(W);
  // ---- yearly bookkeeping ----
  if (W.month % 12 === 0) {
    computeAdjacency(W);
    for (let o = 1; o < nn; o++) if (nations[o].alive) snapshot(W, nations[o]);
    for (const [k, until] of Object.entries(W.truce)) if (until < W.month) delete W.truce[k];
  } else if (ev.owner && W.month % 3 === 0) computeAdjacency(W);
  return ev;
}

function strength(W, o) {
  const n = W.nations[o]; let s = n.mil;
  for (const w of W.wars) if (w.a === o || w.b === o) s *= 1; // placeholder for future modifiers
  return Math.max(0.01, s);
}

function fightWars(W) {
  const r = W.rng, { owner, pop, Wd, Hd, land } = W, terr = W.terrain;
  const warPairs = new Set(W.wars.map((w) => pairKey(w.a, w.b)));
  const nn = W.nations.length; const fronts = new Int32Array(nn);
  // count how many wars each nation splits its army across
  for (const w of W.wars) { fronts[w.a]++; fronts[w.b]++; }
  const str = new Float32Array(nn);
  for (let o = 1; o < nn; o++) if (W.nations[o].alive) str[o] = strength(W, o) / Math.max(1, fronts[o]);
  const caps = []; const lost = new Int32Array(nn), gained = new Int32Array(nn);
  const inWar = new Uint8Array(nn); for (const w of W.wars) { inWar[w.a] = 1; inWar[w.b] = 1; }
  for (let k = 0; k < land.length; k++) {
    const i = land[k], o = owner[i]; if (!o || !inWar[o]) continue;
    const x = i % Wd, y = (i / Wd) | 0;
    const nb = [y * Wd + ((x + 1) % Wd), y * Wd + ((x - 1 + Wd) % Wd), y > 0 ? i - Wd : -1, y < Hd - 1 ? i + Wd : -1];
    for (const j of nb) {
      if (j < 0) continue; const q = owner[j]; if (!q || q === o || !warPairs.has(pairKey(o, q))) continue;
      const ratio = str[q] / (str[q] + str[o]);
      let p = 0.45 * ratio * ratio * ratio;
      if (terr[i] === 9) p *= 0.45; else if (terr[i] === 10) p *= 0.75; else if (terr[i] === 2 || terr[i] === 3) p *= 0.5;
      if (W.nations[o].capital === i) p *= 0.35;
      pop[i] *= 0.9985;
      if (r() < p * 0.5) { caps.push(i, q); break; }
    }
  }
  for (let k = 0; k < caps.length; k += 2) {
    const i = caps[k], q = caps[k + 1], o = owner[i]; if (o === q) continue;
    owner[i] = q; pop[i] *= 0.97; lost[o]++; gained[q]++;
  }
  // exhaustion, war scores, peace
  for (const w of [...W.wars]) {
    const A = W.nations[w.a], B = W.nations[w.b];
    w.ga += gained[w.a]; w.gb += gained[w.b];
    A.exh = clamp(A.exh + 0.008 + 0.5 * lost[w.a] / Math.max(1, A.cells), 0, 1);
    B.exh = clamp(B.exh + 0.008 + 0.5 * lost[w.b] / Math.max(1, B.cells), 0, 1);
    setRel(W, w.a, w.b, clamp(rel(W, w.a, w.b) - 1, -100, 100));
    const capFallen = (n, other) => n.capital >= 0 && owner[n.capital] === other.id;
    if (!A.alive || !B.alive || A.cells === 0 || B.cells === 0) { endWar(W, w, null); continue; }
    if (capFallen(B, A) || capFallen(A, B)) {
      const [win, lose] = capFallen(B, A) ? [A, B] : [B, A];
      if (lose.cells < win.cells * 0.6 && r() < 0.6) { annex(W, win, lose); endWar(W, w, `${win.name} conquers ${lose.name}.`); }
      else endWar(W, w, `${lose.name} capitulates to ${win.name} after its capital falls.`);
      continue;
    }
    const age = W.month - w.start;
    if ((A.exh > 0.65 || B.exh > 0.65) && r() < 0.08) {
      const winner = w.ga > w.gb ? A : w.gb > w.ga ? B : null;
      endWar(W, w, winner ? `${A.name} and ${B.name} sign a peace treaty; ${winner.name} keeps its gains.` : `${A.name} and ${B.name} agree to a ceasefire.`);
    } else if (age > 18 && r() < 0.01) endWar(W, w, `${A.name} and ${B.name} make peace.`);
  }
  return caps.length > 0;
}

export function declareWar(W, a, b, reason) {
  if (a === b || warBetween(W, a, b)) return null;
  const A = W.nations[a], B = W.nations[b];
  const w = { a, b, start: W.month, ga: 0, gb: 0 }; W.wars.push(w);
  setRel(W, a, b, Math.min(rel(W, a, b), -60));
  addNews(W, reason || `${A.name} declares war on ${B.name}!`, 'war', [a, b]);
  // allies of the defender may join
  if (B.bloc) for (const n of W.nations) {
    if (!n || !n.alive || n.id === b || n.id === a || n.bloc !== B.bloc) continue;
    if (rel(W, n.id, a) < 30 && W.rng() < 0.75 && !warBetween(W, n.id, a)) {
      W.wars.push({ a: n.id, b: a, start: W.month, ga: 0, gb: 0 }); setRel(W, n.id, a, -60);
      addNews(W, `${n.name} honours the ${W.blocs[B.bloc].name} and joins the war against ${A.name}.`, 'war', [n.id, a]);
    }
  }
  return w;
}

export function endWar(W, w, text) {
  W.wars = W.wars.filter((x) => x !== w);
  W.truce[pairKey(w.a, w.b)] = W.month + 120;
  if (W.nations[w.a].alive && W.nations[w.b].alive) setRel(W, w.a, w.b, -25);
  if (text) addNews(W, text, 'peace', [w.a, w.b]);
}

export function annex(W, win, lose) {
  const { owner, land } = W; for (const i of land) if (owner[i] === lose.id) owner[i] = win.id;
  lose.alive = false; lose.cells = 0;
  for (const w of [...W.wars]) if (w.a === lose.id || w.b === lose.id) W.wars = W.wars.filter((x) => x !== w);
}

function rebellion(W, n) {
  const r = W.rng, { owner, land, pop } = W, country = W.D.cells.country, admin = W.D.cells.admin1;
  // occupied land rises up first: the old country returns
  const occ = new Map();
  for (const i of land) if (owner[i] === n.id && country[i] !== n.orig && country[i]) occ.set(country[i], (occ.get(country[i]) || 0) + 1);
  let best = 0, bestC = 0; for (const [c, k] of occ) if (k > best) { best = k; bestC = c; }
  let target, cellsList = [];
  if (best >= 3) {
    for (const i of land) if (owner[i] === n.id && country[i] === bestC) cellsList.push(i);
    target = W.nations[bestC];
    if (target.alive) {
      for (const i of cellsList) owner[i] = target.id;
      addNews(W, `Uprising: ${cellsList.length > 30 ? 'large parts' : 'parts'} of occupied ${W.D.units.countries[bestC - 1].name} break away from ${n.name} and rejoin ${target.name}.`, 'rebel', [n.id, target.id]);
      n.bonus = 0.12; return true;
    }
    target.alive = true; target.gov = 'Provisional'; target.founded = W.month; target.stab = 0.45; target.exh = 0; target.bloc = 0;
    for (const i of cellsList) owner[i] = target.id;
    addNews(W, `${target.name} is reborn! It declares independence from ${n.name}.`, 'rebel', [n.id, target.id]);
  } else {
    // a province breaks away
    const provPop = new Map();
    let capProv = n.capital >= 0 ? admin[n.capital] : -1;
    for (const i of land) if (owner[i] === n.id && admin[i] && admin[i] !== capProv) provPop.set(admin[i], (provPop.get(admin[i]) || 0) + pop[i] + 1);
    if (!provPop.size) return false;
    const provs = [...provPop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const [pid] = provs[Math.floor(r() * provs.length)];
    // grow the region: the province plus neighbouring provinces with probability
    const pset = new Set([pid]);
    const pname = W.D.units.provinces[pid - 1].n;
    const adjP = W.D.adj.prov[pid - 1] || [];
    for (let k = 0; k < adjP.length; k += 2) if (r() < 0.35) pset.add(adjP[k] + 1);
    for (const i of land) if (owner[i] === n.id && pset.has(admin[i])) cellsList.push(i);
    if (cellsList.length < 2 || cellsList.length > n.cells * 0.6) return false;
    target = newNation(W, { name: rebelName(pname, r), color: hsl(r() * 360, 0.5, 0.55), gov: 'Provisional' });
    if (!target) return false;
    target.stab = 0.45;
    for (const i of cellsList) owner[i] = target.id;
    addNews(W, `${target.name} declares independence from ${n.name}!`, 'rebel', [n.id, target.id]);
  }
  for (let k = 0; k < MAXN; k++) W.rel[target.id * MAXN + k] = W.rel[n.id * MAXN + k] * 0.5;
  setRel(W, n.id, target.id, -70);
  n.bonus = 0.1;
  if (W.settings.wars && r() < 0.45) declareWar(W, n.id, target.id, `Civil war: ${n.name} moves to crush ${target.name}.`);
  return true;
}

export function partyShares(W, n, cellsFilter) {
  const { owner, pop, lean, land } = W; const P = n.parties; const v = [0, 0, 0];
  if (!cellsFilter && W.leanHist && n.id * LEAN_BINS < W.leanHist.length) {
    for (let b = 0; b < LEAN_BINS; b++) { const w = W.leanHist[n.id * LEAN_BINS + b]; if (w > 0) cellVote((b + 0.5) / LEAN_BINS * 2 - 1, P, n.ruling, n.stab, v, w); }
    return v;
  }
  for (const i of land) {
    if (owner[i] !== n.id || (cellsFilter && !cellsFilter(i))) continue;
    cellVote(lean[i], P, n.ruling, n.stab, v, pop[i]);
  }
  return v;
}
// adds pop-weighted votes for 3 parties at a given lean into out[]
export function cellVote(l, P, ruling, stab, out, weight) {
  let s = 0; const e = [0, 0, 0];
  for (let k = 0; k < 3; k++) { const d = l - P[k].pos; e[k] = (0.22 + Math.exp(-d * d / 0.08)) * (k === 1 ? 0.6 : 1) * (k === ruling ? 0.7 + 0.45 * stab : 1); s += e[k]; }
  for (let k = 0; k < 3; k++) out[k] += weight * e[k] / s;
}

export function holdElection(W, n) {
  n.lastElection = W.month;
  const plan = W.plans.find((p) => p.scope === n.orig && p.electionsUse !== false && p.assign);
  let seats = [0, 0, 0], total = 0, label = '';
  const votes = partyShares(W, n);
  const tv = votes[0] + votes[1] + votes[2];
  if (!(tv > 0)) return;
  if (plan && W.planDistrictVotes) {
    const dv = W.planDistrictVotes(plan, n);
    for (const v of dv) { if (v[0] + v[1] + v[2] <= 0) continue; const w = v.indexOf(Math.max(...v)); seats[w]++; total++; }
    label = `${total} districts`;
  }
  if (!total) { // proportional, 100 seats, largest remainder
    const q = votes.map((v) => v / tv * 100); seats = q.map(Math.floor); let left = 100 - seats.reduce((a, b) => a + b, 0);
    const rem = q.map((v, k) => [v - Math.floor(v), k]).sort((a, b) => b[0] - a[0]); for (let k = 0; k < left; k++) seats[rem[k % 3][1]]++;
    total = 100; label = '100 seats';
  }
  const win = seats.indexOf(Math.max(...seats));
  const prev = n.ruling; n.ruling = win; n.seats = seats; n.votes = votes.map((v) => v / tv);
  n.bonus = (n.bonus || 0) + 0.04;
  // thermostatic mood: the public drifts away from whoever governs
  W.mood[n.id] = clamp(W.mood[n.id] * 0.5 - n.parties[win].pos * 0.12, -0.5, 0.5);
  const flip = prev !== win ? ' (change of government)' : '';
  if (n.pop > 2e7 || (prev !== win && n.pop > 3e6)) addNews(W, `Election in ${n.name}: ${n.parties[win].name} wins ${seats[win]} of ${total} (${Math.round(votes[win] / tv * 100)}% of the vote)${flip}.`, 'election', [n.id]);
}

function diplomacy(W, warOf) {
  const r = W.rng, nations = W.nations, nn = nations.length, aggr = W.settings.aggression;
  // border friction and drift between neighbours
  for (let o = 1; o < nn; o++) {
    const n = nations[o]; if (!n.alive) continue;
    const nb = W.neighbors[o] || [];
    for (const q of nb) {
      if (q < o) continue; const Q = nations[q]; if (!Q.alive) continue;
      let d = (r() - 0.5) * 4 - 0.14 + (-8 - rel(W, o, q)) * 0.008;
      if (n.bloc && n.bloc === Q.bloc) d += 0.6;
      if (Math.abs(n.devAvg - Q.devAvg) < 0.1) d += 0.12;
      if (n.gov !== 'Republic' || Q.gov !== 'Republic') d -= 0.1;
      setRel(W, o, q, clamp(rel(W, o, q) + d, -100, 100));
    }
  }
  // war declarations
  if (W.settings.wars) for (let o = 1; o < nn; o++) {
    const A = nations[o]; if (!A.alive || A.stab < 0.35 || A.exh > 0.25) continue;
    const nb = W.neighbors[o]; if (!nb || !nb.length) continue;
    const q = nb[Math.floor(r() * nb.length)], B = nations[q]; if (!B.alive) continue;
    if (rel(W, o, q) > -30 || W.truce[pairKey(o, q)] > W.month || (A.bloc && A.bloc === B.bloc) || warBetween(W, o, q)) continue;
    let defense = B.mil; if (B.bloc) for (const n of nations) if (n && n.alive && n.bloc === B.bloc && n.id !== q) defense += n.mil * 0.5;
    if (A.mil < defense * 1.15) continue;
    const govBias = A.gov === 'Republic' ? 0.6 : A.gov === 'Junta' || A.gov === 'Autocracy' ? 1.6 : 1;
    if (r() < 0.025 * aggr * govBias) declareWar(W, o, q);
  }
  // alliances (yearly)
  if (W.month % 12 === 6) {
    for (let k = 0; k < 40; k++) {
      const a = 1 + Math.floor(r() * (nn - 1)), A = nations[a]; if (!A.alive) continue;
      const nb = W.neighbors[a]; if (!nb || !nb.length) continue;
      const b = nb[Math.floor(r() * nb.length)], B = nations[b]; if (!B.alive || rel(W, a, b) < 22 || (A.bloc && A.bloc === B.bloc)) continue;
      if (A.bloc && !B.bloc) { B.bloc = A.bloc; addNews(W, `${B.name} joins the ${W.blocs[A.bloc].name}.`, 'alliance', [a, b]); }
      else if (B.bloc && !A.bloc) { A.bloc = B.bloc; addNews(W, `${A.name} joins the ${W.blocs[B.bloc].name}.`, 'alliance', [a, b]); }
      else if (!A.bloc && !B.bloc) {
        const bloc = { id: W.blocs.length, name: blocName(A.name, r), color: hsl(r() * 360, 0.7, 0.55) }; W.blocs.push(bloc);
        A.bloc = B.bloc = bloc.id; addNews(W, `${A.name} and ${B.name} found the ${bloc.name}.`, 'alliance', [a, b]);
      }
    }
    // members that fall out leave
    for (let o = 1; o < nn; o++) {
      const A = nations[o]; if (!A.alive || !A.bloc) continue;
      let worst = 100; for (const n of nations) if (n && n.alive && n.bloc === A.bloc && n.id !== o) worst = Math.min(worst, rel(W, o, n.id));
      if (worst < -45 && r() < 0.3) { addNews(W, `${A.name} leaves the ${W.blocs[A.bloc].name}.`, 'alliance', [o]); A.bloc = 0; }
    }
  }
}

export const DISASTERS = {
  quake: { label: 'Earthquake', radius: 3, pop: 0.12, dev: 0.04 },
  flood: { label: 'Flood', radius: 5, pop: 0.04, dev: 0.03 },
  plague: { label: 'Plague', radius: 14, pop: 0.18, dev: 0.02 },
  famine: { label: 'Famine', radius: 10, pop: 0.08, dev: 0.02 },
  meteor: { label: 'Meteor strike', radius: 7, pop: 0.95, dev: 0.5 },
  boom: { label: 'Economic boom', radius: 8, pop: -0.02, dev: -0.08 },
};
export function applyDisaster(W, kind, center, silent) {
  const D = DISASTERS[kind]; const { Wd, Hd, owner, pop, dev } = W;
  const cx = center % Wd, cy = (center / Wd) | 0; let killed = 0;
  for (let dy = -D.radius; dy <= D.radius; dy++) for (let dx = -D.radius; dx <= D.radius; dx++) {
    const d2 = dx * dx + dy * dy; if (d2 > D.radius * D.radius) continue;
    const y = cy + dy; if (y < 0 || y >= Hd) continue; const i = y * Wd + ((cx + dx + Wd) % Wd);
    if (!W.D.cells.country[i]) continue;
    const f = 1 - d2 / (D.radius * D.radius + 1);
    const loss = pop[i] * D.pop * f; pop[i] -= loss; killed += loss;
    dev[i] = clamp(dev[i] - D.dev * f, 0.005, 1);
    if (kind === 'meteor' && d2 <= 2) W.terrain[i] = 8;
  }
  const o = owner[center]; const n = W.nations[o];
  const [lng, lat] = cellLngLat(W, center);
  const where = n && n.alive ? n.name : `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(0)}°${lng >= 0 ? 'E' : 'W'}`;
  if (n && kind !== 'boom') n.stab = clamp(n.stab - (kind === 'meteor' ? 0.2 : 0.05), 0, 1);
  if (n && kind === 'boom') n.bonus = (n.bonus || 0) + 0.05;
  if (!silent) addNews(W, kind === 'boom' ? `Economic boom in ${where}.` : `${D.label} in ${where}${killed > 1000 ? ` — ${Math.round(killed).toLocaleString()} lives lost` : ''}.`, 'disaster', o ? [o] : []);
  return killed;
}
function randomDisaster(W) {
  const r = W.rng; const i = W.land[Math.floor(r() * W.land.length)];
  if (W.pop[i] < 1000) return;
  const kinds = ['quake', 'quake', 'flood', 'flood', 'famine', 'boom', 'boom', 'boom', 'plague'];
  applyDisaster(W, kinds[Math.floor(r() * kinds.length)], i);
}
