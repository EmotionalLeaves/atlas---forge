// Map themes: every attribute of every layer can colour the map. Plus user formulas and painted data layers.
import { rampLUT, catColor, TERRAIN_COLORS, PARTY_COLORS, strHash, fmt, pct, clamp, hsl, districtColor } from './util.js';
import { rel, prodOf, prodFast } from './world.js';
import { cellVote } from './sim.js';

const cellLat = (W, i) => 90 - (((i / W.Wd) | 0) + 0.5) * 180 / W.Hd;
const cellLng = (W, i) => -180 + ((i % W.Wd) + 0.5) * 360 / W.Wd;

export function buildCatalog(app) {
  const W = app.W, D = W.D, U = D.units, C = D.cells, nat = W.nations;
  const T = [];
  const add = (t) => { if (t.groupBy === 'country' && !t.by) t.by = 'country'; if (t.group === 'Real world (2026 data)' || ['p_name','p_pop','p_area','p_dens','p_country','p_type','p_region','k_name','k_pop','k_dens','k_area','k_state','k_min','k_blk','k_his','terrain','climate','rivers','lat','lng'].includes(t.id)) t.static = true; T.push(t); return t; };
  const nationCat = { kind: 'cat', catColor: (c) => nat[c] ? nat[c].color : [58, 68, 80], catLabel: (c) => nat[c] ? nat[c].name : 'Unclaimed' };
  const cc = (i) => U.countries[C.country[i] - 1];
  const strCat = (getter) => { const map = new Map(), labels = []; return { kind: 'cat', value: (i) => { const s = getter(i); if (s == null || s === '') return 0; let k = map.get(s); if (!k) { k = labels.length + 1; map.set(s, k); labels.push(s); } return k; }, catLabel: (k) => labels[k - 1] || '—', catColor: (k) => catColor(k * 3 + 1) }; };

  // ---------- grid cells: simulation ----------
  const G = 'Simulation';
  add({ id: 'nations', layer: 'cells', group: G, label: 'Nations', by: 'owner', value: (i) => W.owner[i], ...nationCat, desc: 'Who controls each cell right now' });
  add({ id: 'pop', layer: 'cells', group: G, label: 'Population', kind: 'num', ramp: 'inferno', log: true, value: (i) => W.pop[i], fmt });
  add({ id: 'density', layer: 'cells', group: G, label: 'Population density (/km²)', kind: 'num', ramp: 'inferno', log: true, value: (i) => W.pop[i] / W.area[(i / W.Wd) | 0], fmt });
  add({ id: 'growth', layer: 'cells', group: G, label: 'Population change since 2026', kind: 'div', ramp: 'diverge', value: (i) => W.pop0[i] > 0 ? Math.log2(W.pop[i] / W.pop0[i]) : 0, fmt: (v) => (v >= 0 ? '+' : '') + Math.round((Math.pow(2, v) - 1) * 100) + '%', symmetric: true });
  add({ id: 'dev', layer: 'cells', group: G, label: 'Development', kind: 'num', ramp: 'greens', value: (i) => W.dev[i], fmt: (v) => v.toFixed(2), domain: [0, 1] });
  add({ id: 'income', layer: 'cells', group: G, label: 'Income per person', kind: 'num', ramp: 'ember', log: true, value: (i) => prodFast(W.dev[i]), fmt: (v) => '$' + fmt(v) });
  add({ id: 'lean', layer: 'cells', group: G, label: 'Political lean', kind: 'div', ramp: 'diverge', value: (i) => W.lean[i], fmt: (v) => v < -0.05 ? 'Left ' + Math.round(-v * 100) : v > 0.05 ? 'Right ' + Math.round(v * 100) : 'Centre', domain: [-0.8, 0.8], desc: 'Rose = left, teal = right' });
  add({ id: 'party', layer: 'cells', group: G, label: 'Leading party (local)', kind: 'cat', value: (i) => { const n = nat[W.owner[i]]; if (!n) return 0; const v = [0, 0, 0]; cellVote(W.lean[i], n.parties, n.ruling, n.stab, v, 1); return 1 + v.indexOf(Math.max(...v)); }, catColor: (c) => PARTY_COLORS[c - 1] || [80, 80, 80], catLabel: (c) => ['—', 'Left party', 'Centre party', 'Right party'][c] });
  add({ id: 'occupied', layer: 'cells', group: G, label: 'Occupied territory', kind: 'cat', value: (i) => !W.owner[i] ? 0 : (!nat[W.owner[i]].orig || nat[W.owner[i]].orig === C.country[i]) ? 1 : 2, catColor: (c) => [[80, 80, 80], [70, 110, 90], [220, 70, 60]][c], catLabel: (c) => ['Unclaimed', 'Home territory', 'Occupied / annexed'][c] });
  add({ id: 'terrain', layer: 'cells', group: G, label: 'Terrain', kind: 'cat', value: (i) => W.terrain[i], catColor: (c) => TERRAIN_COLORS[c], catLabel: (c) => U.terrains[c] });
  add({ id: 'climate', layer: 'cells', group: G, label: 'Climate band', kind: 'cat', value: (i) => { const a = Math.abs(cellLat(W, i)); return a < 23.5 ? 1 : a < 35 ? 2 : a < 50 ? 3 : a < 66.5 ? 4 : 5; }, catColor: (c) => [[0, 0, 0], [214, 92, 64], [230, 170, 80], [120, 180, 90], [70, 130, 160], [200, 215, 235]][c], catLabel: (c) => ['', 'Tropical', 'Subtropical', 'Temperate', 'Subarctic', 'Polar'][c] });
  add({ id: 'rivers', layer: 'cells', group: G, label: 'Rivers & lakes', kind: 'cat', value: (i) => (C.flags[i] & 1) ? 2 : 1, catColor: (c) => c === 2 ? [70, 150, 230] : [200, 196, 180], catLabel: (c) => c === 2 ? 'Major river' : 'Land' });

  // ---------- grid cells: nation-level ----------
  const N = 'Nations';
  const nv = (f) => (i) => { const n = nat[W.owner[i]]; return n ? f(n) : NaN; };
  add({ id: 'n_pop', by: 'owner', layer: 'cells', group: N, label: 'Nation population', kind: 'num', ramp: 'inferno', log: true, value: nv((n) => n.pop), fmt });
  add({ id: 'n_gdp', by: 'owner', layer: 'cells', group: N, label: 'Nation GDP', kind: 'num', ramp: 'ember', log: true, value: nv((n) => n.gdp * 1e6), fmt: (v) => '$' + fmt(v) });
  add({ id: 'n_gdppc', by: 'owner', layer: 'cells', group: N, label: 'GDP per capita', kind: 'num', ramp: 'ember', log: true, value: nv((n) => n.pop ? n.gdp * 1e6 / n.pop : NaN), fmt: (v) => '$' + fmt(v) });
  add({ id: 'n_mil', by: 'owner', layer: 'cells', group: N, label: 'Military strength', kind: 'num', ramp: 'blues', log: true, value: nv((n) => n.mil), fmt });
  add({ id: 'n_stab', by: 'owner', layer: 'cells', group: N, label: 'Stability', kind: 'num', ramp: 'stability', value: nv((n) => n.stab), fmt: (v) => pct(v), domain: [0, 1] });
  add({ id: 'n_exh', by: 'owner', layer: 'cells', group: N, label: 'War exhaustion', kind: 'num', ramp: 'inferno', value: nv((n) => n.exh), fmt: (v) => pct(v), domain: [0, 1] });
  add({ id: 'n_gov', by: 'owner', layer: 'cells', group: N, label: 'Government', kind: 'cat', value: nv((n) => 1 + ['Republic', 'Monarchy', 'Autocracy', 'Junta', 'Provisional'].indexOf(n.gov)), catColor: (c) => [[0, 0, 0], [80, 150, 220], [200, 160, 60], [170, 60, 70], [90, 100, 60], [200, 120, 200]][c] || [60, 60, 60], catLabel: (c) => ['', 'Republic', 'Monarchy', 'Autocracy', 'Military junta', 'Provisional government'][c] });
  add({ id: 'n_war', by: 'owner', layer: 'cells', group: N, label: 'At war', kind: 'cat', value: (i) => { const o = W.owner[i]; if (!o) return 0; return W.wars.some((w) => w.a === o || w.b === o) ? 2 : 1; }, catColor: (c) => [[60, 60, 60], [90, 120, 100], [225, 60, 50]][c], catLabel: (c) => ['Unclaimed', 'At peace', 'At war'][c] });
  add({ id: 'n_bloc', by: 'owner', layer: 'cells', group: N, label: 'Alliances', kind: 'cat', value: nv((n) => n.bloc || 0), catColor: (c) => c && W.blocs[c] ? W.blocs[c].color : [95, 98, 104], catLabel: (c) => c && W.blocs[c] ? W.blocs[c].name : 'Unaligned' });
  add({ id: 'n_ruling', by: 'owner', layer: 'cells', group: N, label: 'Ruling party', kind: 'cat', value: nv((n) => n.gov === 'Republic' ? n.ruling + 1 : 4), catColor: (c) => PARTY_COLORS[c - 1] || [90, 90, 96], catLabel: (c) => ['', 'Left party governs', 'Centre party governs', 'Right party governs', 'No elections'][c] });
  add({ id: 'n_size', by: 'owner', layer: 'cells', group: N, label: 'Territory size', kind: 'num', ramp: 'viridis', log: true, value: nv((n) => n.cells), fmt: (v) => fmt(v) + ' cells' });
  add({ id: 'n_age', by: 'owner', layer: 'cells', group: N, label: 'Nation age', kind: 'num', ramp: 'viridis', value: nv((n) => (W.month - n.founded) / 12), fmt: (v) => v.toFixed(0) + ' yr' });
  add({ id: 'n_capdist', layer: 'cells', group: N, label: 'Distance to capital', kind: 'num', ramp: 'viridis', value: (i) => { const n = nat[W.owner[i]]; if (!n || n.capital < 0) return NaN; const a = n.capital; const dx = Math.abs((a % W.Wd) - (i % W.Wd)); return Math.hypot(Math.min(dx, W.Wd - dx) * Math.cos(cellLat(W, i) * Math.PI / 180), ((a / W.Wd) | 0) - ((i / W.Wd) | 0)) * 27.8; }, fmt: (v) => fmt(v) + ' km' });
  // relations with each living nation
  for (const n of nat) {
    if (!n || !n.alive) continue;
    add({ id: 'rel_' + n.id, by: 'owner', layer: 'cells', group: 'Relations', label: `Relations with ${n.name}`, kind: 'div', ramp: 'diverge', domain: [-100, 100], value: (i) => { const o = W.owner[i]; return !o ? NaN : o === n.id ? 100 : rel(W, n.id, o); }, fmt: (v) => Math.round(v), hidden: true, search: n.name });
  }

  // ---------- grid cells: real-world 2026 data ----------
  const R = 'Real world (2026 data)';
  const cnum = (k) => (i) => { const c = cc(i); return c && c[k] > 0 ? c[k] : NaN; };
  add({ id: 'c_country', layer: 'cells', group: R, label: 'Countries (real borders)', kind: 'cat', value: (i) => C.country[i], catColor: (c) => nat[c] ? nat[c].color : [60, 60, 60], catLabel: (c) => U.countries[c - 1] ? U.countries[c - 1].name : '' , groupBy: 'country' });
  add({ id: 'c_pop', layer: 'cells', group: R, label: 'Country population', kind: 'num', ramp: 'inferno', log: true, value: cnum('pop'), fmt, groupBy: 'country' });
  add({ id: 'c_gdp', layer: 'cells', group: R, label: 'Country GDP', kind: 'num', ramp: 'ember', log: true, value: (i) => { const c = cc(i); return c && c.gdp > 0 ? c.gdp * 1e6 : NaN; }, fmt: (v) => '$' + fmt(v), groupBy: 'country' });
  add({ id: 'c_gdppc', layer: 'cells', group: R, label: 'Country GDP per capita', kind: 'num', ramp: 'ember', log: true, value: (i) => { const c = cc(i); return c && c.gdp > 0 && c.pop > 0 ? c.gdp * 1e6 / c.pop : NaN; }, fmt: (v) => '$' + fmt(v), groupBy: 'country' });
  for (const [k, label] of [['economy', 'Economy type'], ['income', 'Income group'], ['continent', 'Continent'], ['region', 'UN region'], ['subregion', 'Subregion'], ['regionWB', 'World Bank region'], ['type', 'Sovereignty status'], ['sov', 'Sovereign state']]) {
    add({ id: 'c_' + k, layer: 'cells', group: R, label, ...strCat((i) => cc(i) && cc(i)[k]), groupBy: 'country' });
  }
  add({ id: 'c_prov', layer: 'cells', group: R, label: 'Provinces (on grid)', kind: 'cat', value: (i) => C.admin1[i], catColor: (c) => catColor(c), catLabel: (c) => U.provinces[c - 1] ? U.provinces[c - 1].n : '', groupBy: 'admin1' });
  add({ id: 'c_cprov', layer: 'cells', group: R, label: 'Province type', ...strCat((i) => C.admin1[i] ? U.provinces[C.admin1[i] - 1].t : ''), groupBy: 'admin1' });
  add({ id: 'lat', layer: 'cells', group: R, label: 'Latitude', kind: 'div', ramp: 'diverge', value: (i) => cellLat(W, i), fmt: (v) => Math.abs(v).toFixed(0) + '°' + (v >= 0 ? 'N' : 'S'), domain: [-80, 80] });
  add({ id: 'lng', layer: 'cells', group: R, label: 'Longitude', kind: 'num', ramp: 'viridis', value: (i) => cellLng(W, i), fmt: (v) => Math.abs(v).toFixed(0) + '°' + (v >= 0 ? 'E' : 'W'), domain: [-180, 180] });

  // ---------- custom data layers & formulas ----------
  for (const [name, arr] of Object.entries(W.custom)) add({ id: 'cu_' + name, layer: 'cells', group: 'Your data layers', label: name, kind: 'num', ramp: 'viridis', value: (i) => arr[i], fmt: (v) => fmt(v), custom: name });
  for (const f of W.formulas) { const t = formulaTheme(app, f); if (t) add(t); }

  // ---------- district plans ----------
  for (const p of W.plans) {
    const layer = p.unit;
    if (layer === 'precincts' && p.pack !== app.activePack) continue;
    add({ id: 'plan_' + p.id, layer, group: 'District plans', label: `Districts: ${p.name}`, kind: 'cat', value: (u) => p.assign[u] + 1, catColor: (c) => c ? p.colors[c - 1] : [70, 72, 78], catLabel: (c) => c ? 'District ' + c : 'Unassigned', plan: p.id });
  }

  // ---------- real US precincts (active pack) ----------
  const PK = app.activePack && D.packs && D.packs[app.activePack];
  if (PK) {
    const G2 = `Precincts — ${PK.title}`, pc = (k) => ({ layer: 'precincts', group: G2, ...k });
    add(pc({ id: 'pc_name', label: 'Precincts', kind: 'cat', value: (u) => u + 1, catColor: (c) => catColor(c), catLabel: (c) => PK.units[c - 1].n, noLegend: true, static: true }));
    add(pc({ id: 'pc_pop', label: 'Population (2010 Census)', kind: 'num', ramp: 'inferno', log: true, value: (u) => PK.pop[u] || NaN, fmt, static: true }));
    add(pc({ id: 'pc_dens', label: 'Population density', kind: 'num', ramp: 'inferno', log: true, value: (u) => PK.area[u] > 0 ? PK.pop[u] / PK.area[u] : NaN, fmt: (v) => fmt(v) + '/km²', static: true }));
    PK.race.forEach((r, k) => add(pc({ id: 'pc_r' + k, label: `${r.label} share of population`, kind: 'num', ramp: 'purples', domain: [0, 1], value: (u) => PK.pop[u] > 0 ? r.data[u] / PK.pop[u] : NaN, fmt: (v) => pct(v), static: true })));
    PK.vrace.forEach((r, k) => add(pc({ id: 'pc_v' + k, label: `${r.label} share of voting-age pop.`, kind: 'num', ramp: 'purples', domain: [0, 1], value: (u) => PK.vap && PK.vap[u] > 0 ? r.data[u] / PK.vap[u] : NaN, fmt: (v) => pct(v), static: true, hidden: true })));
    PK.elections.forEach((e, k) => {
      add(pc({ id: 'pc_e' + k, label: `${e.label}: Dem vs Rep`, kind: 'div', ramp: 'partisan', domain: [0.2, 0.8], value: (u) => { const t = e.d[u] + e.r[u]; return t > 0 ? e.d[u] / t : NaN; }, fmt: (v) => v >= 0.5 ? `D +${Math.round((2 * v - 1) * 100)}` : `R +${Math.round((1 - 2 * v) * 100)}`, static: true, desc: 'Blue = Democratic, red = Republican (two-party share)' }));
      if (PK.vap) add(pc({ id: 'pc_t' + k, label: `${e.label}: turnout (votes ÷ voting-age pop.)`, kind: 'num', ramp: 'viridis', domain: [0, 1], value: (u) => PK.vap[u] > 0 ? Math.min(1, (e.d[u] + e.r[u]) / PK.vap[u]) : NaN, fmt: (v) => pct(v), static: true, hidden: true }));
    });
    PK.plans.forEach((pl, k) => add(pc({ id: 'pc_p' + k, label: `Real map: ${pl.label}`, kind: 'cat', value: (u) => pl.assign[u] + 1, catColor: (c) => c ? districtColor(c - 1) : [70, 72, 78], catLabel: (c) => c ? 'District ' + c : '—', static: true, noLegend: pl.n > 14 })));
    add(pc({ id: 'pc_county', label: 'County', kind: 'cat', value: (u) => PK.county[u] + 1, catColor: (c) => catColor(c * 3), catLabel: (c) => (PK.countyLabels || PK.countyNames)[c - 1] || '', noLegend: true, static: true }));
  }

  // ---------- provinces ----------
  const P = 'Provinces & states';
  const PV = U.provinces;
  add({ id: 'p_name', layer: 'provinces', group: P, label: 'Provinces', kind: 'cat', value: (u) => u + 1, catColor: (c) => { const p = PV[c - 1]; return nat[p.c] ? shade(nat[p.c].color, (c * 37) % 9) : catColor(c); }, catLabel: (c) => PV[c - 1].n, noLegend: true });
  add({ id: 'p_pop', layer: 'provinces', group: P, label: 'Province population', kind: 'num', ramp: 'inferno', log: true, value: (u) => PV[u].pop || NaN, fmt });
  add({ id: 'p_area', layer: 'provinces', group: P, label: 'Province area', kind: 'num', ramp: 'viridis', log: true, value: (u) => PV[u].area || NaN, fmt: (v) => fmt(v) + ' km²' });
  add({ id: 'p_dens', layer: 'provinces', group: P, label: 'Province density', kind: 'num', ramp: 'inferno', log: true, value: (u) => PV[u].area ? PV[u].pop / PV[u].area : NaN, fmt: (v) => fmt(v) + '/km²' });
  add({ id: 'p_country', layer: 'provinces', group: P, label: 'Country', kind: 'cat', value: (u) => PV[u].c, catColor: (c) => nat[c] ? nat[c].color : [70, 70, 70], catLabel: (c) => U.countries[c - 1] ? U.countries[c - 1].name : '' });
  add({ id: 'p_type', layer: 'provinces', group: P, label: 'Kind of province', ...strCat((u) => PV[u].t) });
  add({ id: 'p_region', layer: 'provinces', group: P, label: 'Region grouping', ...strCat((u) => PV[u].r || PV[u].n) , noLegend: true });
  add({ id: 'p_owner', layer: 'provinces', group: P, label: 'Controlled by (sim)', kind: 'cat', value: (u) => unitAgg(app, 'provinces').owner[u], ...nationCat });
  add({ id: 'p_lean', layer: 'provinces', group: P, label: 'Political lean', kind: 'div', ramp: 'diverge', domain: [-0.8, 0.8], value: (u) => unitAgg(app, 'provinces').lean[u], fmt: (v) => v.toFixed(2) });
  add({ id: 'p_dev', layer: 'provinces', group: P, label: 'Development', kind: 'num', ramp: 'greens', domain: [0, 1], value: (u) => unitAgg(app, 'provinces').dev[u], fmt: (v) => v.toFixed(2) });
  add({ id: 'p_simpop', layer: 'provinces', group: P, label: 'Population (sim, now)', kind: 'num', ramp: 'inferno', log: true, value: (u) => unitAgg(app, 'provinces').pop[u] || NaN, fmt });

  // ---------- US counties ----------
  const K = 'US counties';
  const CT = U.counties;
  add({ id: 'k_name', layer: 'counties', group: K, label: 'Counties', kind: 'cat', value: (u) => u + 1, catColor: (c) => catColor(c), catLabel: (c) => CT[c - 1].n + ', ' + CT[c - 1].s, noLegend: true });
  add({ id: 'k_pop', layer: 'counties', group: K, label: 'County population (Census)', kind: 'num', ramp: 'inferno', log: true, value: (u) => CT[u].pop || NaN, fmt });
  add({ id: 'k_dens', layer: 'counties', group: K, label: 'County density', kind: 'num', ramp: 'inferno', log: true, value: (u) => CT[u].area ? CT[u].pop / CT[u].area : NaN, fmt: (v) => fmt(v) + '/km²' });
  add({ id: 'k_area', layer: 'counties', group: K, label: 'County area', kind: 'num', ramp: 'viridis', log: true, value: (u) => CT[u].area || NaN, fmt: (v) => fmt(v) + ' km²' });
  add({ id: 'k_state', layer: 'counties', group: K, label: 'State', ...strCat((u) => CT[u].s), noLegend: true });
  add({ id: 'k_min', layer: 'counties', group: K, label: 'Minority population %', kind: 'num', ramp: 'viridis', domain: [0, 100], value: (u) => CT[u].min ?? NaN, fmt: (v) => v.toFixed(0) + '%' });
  add({ id: 'k_blk', layer: 'counties', group: K, label: 'Black population %', kind: 'num', ramp: 'viridis', domain: [0, 60], value: (u) => CT[u].blk ?? NaN, fmt: (v) => v.toFixed(0) + '%' });
  add({ id: 'k_his', layer: 'counties', group: K, label: 'Hispanic population %', kind: 'num', ramp: 'viridis', domain: [0, 80], value: (u) => CT[u].his ?? NaN, fmt: (v) => v.toFixed(0) + '%' });
  add({ id: 'k_lean', layer: 'counties', group: K, label: 'Political lean (sim)', kind: 'div', ramp: 'diverge', domain: [-0.8, 0.8], value: (u) => unitAgg(app, 'counties').lean[u], fmt: (v) => v.toFixed(2) });
  add({ id: 'k_dev', layer: 'counties', group: K, label: 'Development (sim)', kind: 'num', ramp: 'greens', domain: [0, 1], value: (u) => unitAgg(app, 'counties').dev[u], fmt: (v) => v.toFixed(2) });
  return T;
}
const shade = (c, k) => c.map((v) => clamp(Math.round(v * (0.8 + k * 0.05)), 0, 255));

// Per-unit aggregates of cell data (cached per sim month).
export function unitAgg(app, layer) {
  const W = app.W, key = layer + ':' + W.month + ':' + (app.aggStamp || 0);
  app._agg = app._agg || {};
  if (app._agg[layer] && app._agg[layer].key === key) return app._agg[layer];
  const ids = layer === 'provinces' ? W.D.cells.admin1 : W.D.cells.county;
  const n = layer === 'provinces' ? W.D.units.provinces.length : W.D.units.counties.length;
  const pop = new Float64Array(n), lean = new Float64Array(n), dev = new Float64Array(n), w = new Float64Array(n);
  const own = new Map(); const owner = new Uint16Array(n), ownerBest = new Float64Array(n);
  for (const i of W.land) {
    const u = ids[i] - 1; if (u < 0) continue; const p = W.pop[i] + 1;
    pop[u] += W.pop[i]; lean[u] += W.lean[i] * p; dev[u] += W.dev[i] * p; w[u] += p;
    const k = u * 1024 + W.owner[i]; const v = (own.get(k) || 0) + p; own.set(k, v);
    if (v > ownerBest[u]) { ownerBest[u] = v; owner[u] = W.owner[i]; }
  }
  const units = layer === 'provinces' ? W.D.units.provinces : null;
  for (let u = 0; u < n; u++) {
    if (w[u]) { lean[u] /= w[u]; dev[u] /= w[u]; }
    else { lean[u] = NaN; dev[u] = NaN; if (units) owner[u] = units[u].c; }
  }
  return (app._agg[layer] = { key, pop, lean, dev, owner });
}

// ---------- formulas ----------
export const FORMULA_VARS = {
  cells: { pop: 'people in the cell', density: 'people per km²', dev: 'development 0–1', lean: 'political lean −1…1', area: 'km²', lat: 'latitude', lng: 'longitude', growth: 'pop ÷ 2026 pop', income: 'income per person $', npop: 'nation population', ngdp: 'nation GDP ($M)', stab: 'nation stability 0–1', mil: 'nation military', cpop: 'real country population', cgdp: 'real country GDP ($M)' },
  provinces: { pop: 'population', area: 'km²', density: 'per km²', lean: 'political lean', dev: 'development' },
  counties: { pop: 'population', area: 'km²', density: 'per km²', minority: 'minority %', black: 'Black %', hispanic: 'Hispanic %', lean: 'political lean', dev: 'development' },
};
const MATH = ['abs', 'log', 'log10', 'log2', 'sqrt', 'min', 'max', 'pow', 'exp', 'floor', 'ceil', 'round', 'sin', 'cos', 'PI', 'E'];
export function compileFormula(expr, layer, customNames = []) {
  const vars = Object.keys(FORMULA_VARS[layer]).concat(layer === 'cells' ? customNames.map(safeName) : []);
  if (/[^\w\s+\-*/%().,<>=!?:&|^]/.test(expr)) throw new Error('Only numbers, variables and + − × ÷ ( ) are allowed');
  const ids = expr.replace(/(?:\b\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\b/g, ' ').match(/[A-Za-z_]\w*/g) || [];
  for (const id of ids) if (!vars.includes(id) && !MATH.includes(id)) throw new Error(`Unknown name “${id}”`);
  const used = vars.filter((v) => ids.includes(v));
  const fn = new Function(...used, ...MATH, `"use strict"; return (${expr});`);
  const mathArgs = MATH.map((m) => Math[m]);
  return { used, fn: (vals) => fn(...vals, ...mathArgs) };
}
export const safeName = (s) => s.replace(/\W+/g, '_').replace(/^(\d)/, '_$1');
function formulaTheme(app, f) {
  const W = app.W; let c;
  try { c = compileFormula(f.expr, f.layer, Object.keys(W.custom)); } catch { return null; }
  const getters = c.used.map((v) => varGetter(app, f.layer, v));
  const vals = new Array(getters.length);
  return { id: 'f_' + f.id, layer: f.layer, group: 'Your formulas', label: f.name, kind: f.diverging ? 'div' : 'num', ramp: f.diverging ? 'diverge' : (f.ramp || 'viridis'), log: !!f.log, formula: f.id, fmt: (v) => fmt(v, 2),
    value: (i) => { for (let k = 0; k < getters.length; k++) vals[k] = getters[k](i); const v = c.fn(vals); return typeof v === 'boolean' ? +v : v; } };
}
function varGetter(app, layer, v) {
  const W = app.W, U = W.D.units, C = W.D.cells;
  if (layer === 'cells') {
    const n = (i) => W.nations[W.owner[i]];
    const custom = Object.keys(W.custom).find((k) => safeName(k) === v); if (custom) return (i) => W.custom[custom][i];
    return {
      pop: (i) => W.pop[i], density: (i) => W.pop[i] / W.area[(i / W.Wd) | 0], dev: (i) => W.dev[i], lean: (i) => W.lean[i], area: (i) => W.area[(i / W.Wd) | 0],
      lat: (i) => cellLat(W, i), lng: (i) => cellLng(W, i), growth: (i) => W.pop0[i] ? W.pop[i] / W.pop0[i] : 1, income: (i) => prodOf(W.dev[i]),
      npop: (i) => n(i) ? n(i).pop : NaN, ngdp: (i) => n(i) ? n(i).gdp : NaN, stab: (i) => n(i) ? n(i).stab : NaN, mil: (i) => n(i) ? n(i).mil : NaN,
      cpop: (i) => U.countries[C.country[i] - 1].pop, cgdp: (i) => U.countries[C.country[i] - 1].gdp,
    }[v];
  }
  const A = () => unitAgg(app, layer);
  const L = layer === 'provinces' ? U.provinces : U.counties;
  return {
    pop: (u) => L[u].pop, area: (u) => L[u].area, density: (u) => L[u].area ? L[u].pop / L[u].area : NaN, lean: (u) => A().lean[u], dev: (u) => A().dev[u],
    minority: (u) => L[u].min, black: (u) => L[u].blk, hispanic: (u) => L[u].his,
  }[v];
}

// ---------- colouring ----------
function domainOf(t, values) {
  if (t.domain) return t.domain;
  const s = []; for (let k = 0; k < values.length; k += Math.max(1, Math.floor(values.length / 40000))) { const v = values[k]; if (isFinite(v)) s.push(v); }
  if (!s.length) return [0, 1];
  s.sort((a, b) => a - b);
  let lo = s[Math.floor(s.length * 0.01)], hi = s[Math.min(s.length - 1, Math.floor(s.length * 0.995))];
  if (t.kind === 'div' && t.symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
  if (lo === hi) { hi = lo + 1; }
  return [lo, hi];
}
const tf = (t, v) => t.log ? Math.log10(Math.max(0, v) + 1) : v;

// Colour items into an RGBA array (4 bytes each). idx: list of items to colour (or null for 0..count-1).
// Returns legend info plus colorOne(i, out) for cheap partial updates while painting.
export function colorize(t, idx, count, valueAt, out) {
  const n = idx ? idx.length : count; const at = idx ? (k) => idx[k] : (k) => k;
  if (t.kind === 'cat') {
    const counts = new Map(); const cache = new Map();
    const colOf = (c) => { let col = cache.get(c); if (!col) { col = (c ? t.catColor(c) : t.catColor(0)) || [70, 72, 78]; cache.set(c, col); } return col; };
    for (let k = 0; k < n; k++) {
      const i = at(k), o = i * 4, c = valueAt(i), col = colOf(c);
      out[o] = col[0]; out[o + 1] = col[1]; out[o + 2] = col[2]; out[o + 3] = 255;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const items = [...counts.entries()].filter(([c]) => c || t.catLabel(0)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([c, k]) => ({ color: colOf(c), label: t.catLabel(c), count: k }));
    return { type: 'cat', items, total: counts.size, colorOne: (i, o2) => { const col = colOf(valueAt(i)); const o = i * 4; o2[o] = col[0]; o2[o + 1] = col[1]; o2[o + 2] = col[2]; o2[o + 3] = 255; } };
  }
  const vals = new Float32Array(n);
  for (let k = 0; k < n; k++) vals[k] = tf(t, valueAt(at(k)));
  let [lo, hi] = domainOf(t, vals);
  if (t.domain && t.log) { lo = tf(t, lo); hi = tf(t, hi); }
  const lut = rampLUT(t.ramp || 'viridis'); const span = hi - lo || 1;
  const put = (i, v, o2) => {
    const o = i * 4;
    if (!isFinite(v)) { o2[o] = 74; o2[o + 1] = 76; o2[o + 2] = 82; o2[o + 3] = 255; return; }
    let k = Math.round(clamp((v - lo) / span, 0, 1) * 255); if (t.invert) k = 255 - k;
    o2[o] = lut[k * 3]; o2[o + 1] = lut[k * 3 + 1]; o2[o + 2] = lut[k * 3 + 2]; o2[o + 3] = 255;
  };
  for (let k = 0; k < n; k++) put(at(k), vals[k], out);
  const un = (v) => t.log ? Math.pow(10, v) - 1 : v;
  return { type: 'ramp', ramp: t.ramp || 'viridis', min: un(lo), max: un(hi), mid: un((lo + hi) / 2), fmt: t.fmt || fmt, invert: t.invert, colorOne: (i, o2) => put(i, tf(t, valueAt(i)), o2) };
}
