// Atlas Forge — core: rendering pipeline, input, painting, labels.
import { MapRenderer, mercX, mercY, unMercX, unMercY } from './gl.js';
import { loadData } from './data.js';
import { createWorld, computeAggregates, computeAdjacency, cellAt, cellLngLat, addNews, newNation, ownerAt, rel, setRel } from './world.js';
import { tick, applyDisaster } from './sim.js';
import { buildCatalog, colorize, unitAgg } from './themes.js';
import { planStats, paintUnits, brushCells, floodUnits, eligible, districtVotes, parentUnits, unitLayer, planLayer } from './plans.js';
import { loadPack, getLoaded } from './precincts.js';
import { getSlot, putSlot, serialize, deserialize } from './store.js';
import { TERRAIN_COLORS, clamp, h, hsl } from './util.js';
import * as UI from './panels.js';
import { Basemap, BASEMAPS } from './basemap.js';

export const app = {
  mode: 'explore', themeId: 'nations', running: false, speed: 1, show: { borders: true, cities: true, labels: true, grid: true },
  tool: 'pan', district: 0, brush: 2, paintNation: 0, dataAttr: 'dev', dataValue: 0.5, disaster: 'quake', editTool: 'borders',
  sel: null, undo: [], redo: [], aggStamp: 0,
  settings: { basemap: 'streets', opacity: 0.72, mapLabels: true },
  drawOpts: { parent: false, noOverwrite: false, showData: false, hideDistricts: false, highlightUnassigned: true, boundaries: true }, drawTab: 'paint',
};
try { Object.assign(app.settings, JSON.parse(localStorage.getItem('af_settings') || '{}')); } catch {}
export function saveSettings() { try { localStorage.setItem('af_settings', JSON.stringify(app.settings)); } catch {} }
// Apply the basemap choice: real map tiles below (and place names above) the data overlay.
export function applyMapStyle() {
  const B = app.basemap, st = app.settings; if (!B) return;
  B.setStyle(st.basemap); B.showLabels = st.mapLabels;
  app.R.opts.opacity = B.online ? st.opacity : 1;
  app.R.opts.grid = app.show.grid && !B.online;
  if (app.R.points) app.R.points.visible = app.show.cities && !B.hasLabels;
  app.R.dirty();
}
window.app = app;

// ---------------------------------------------------------------- boot
export async function boot() {
  const loading = document.getElementById('loading'), bar = loading.querySelector('.bar i'), msg = loading.querySelector('.msg');
  const progress = (m, f) => { msg.textContent = m; bar.style.width = Math.round(f * 100) + '%'; };
  try {
    app.D = await loadData(progress);
    progress('Starting the map…', 0.75);
    const D = app.D, W0 = D.units.grid.W, H0 = D.units.grid.H;
    app.R = new MapRenderer(document.getElementById('gl'), document.getElementById('labels'), W0, H0);
    app.cellRGBA = new Uint8Array(W0 * H0 * 4); app.groupRGBA = new Uint8Array(W0 * H0 * 4); app.baseRGBA = new Uint8Array(W0 * H0 * 4);
    app.R.addPolyLayer('provinces', D.geom.prov); app.R.addPolyLayer('counties', D.geom.county);
    app.R.addPolyLayer('nationProv', D.geom.prov, { share: 'provinces', lineColors: true });
    const under = app.R.addPolyLayer('nationUnder', D.geom.prov, { share: 'provinces' }); under.under = true;
    app.R.polyOrder = ['nationProv', 'provinces', 'counties', 'precincts'];
    D.packs = {};
    app.R.setLandMask('provinces', D.geom.lakes);
    app.unitRGBA = { provinces: new Uint8Array(D.units.provinces.length * 4), counties: new Uint8Array(D.units.counties.length * 4) };
    prepareSmooth(D, W0, H0);
    // real (2026) country borders = province edges between different countries
    { const g = D.geom.prov, P = D.units.provinces, out = [];
      for (let k = 0; k < g.luid.length; k += 2) { const u = g.luid[k], v = g.lnb[k]; if (v === 65535 || u > v || P[u].c === P[v].c) continue; out.push(g.lpos[k * 2], g.lpos[k * 2 + 1], g.lpos[k * 2 + 2], g.lpos[k * 2 + 3]); }
      app.R.setThickLines('realBorders', new Float32Array(out), [0.95, 0.96, 1, 0.55], (s) => s < 600 ? 0.8 : s < 3000 ? 1.2 : 1.8, 1); }
    app.R.addLineLayer('provLines', D.geom.prov.lpos, [0.04, 0.05, 0.08, 0.55], 0); app.R.lines.provLines.visible = false;
    app.R.addLineLayer('countyLines', D.geom.county.lpos, [0.03, 0.04, 0.06, 0.7], 0); app.R.lines.countyLines.visible = false;
    setupCities();
    progress('Building the world…', 0.85);
    let W = null;
    try { const s = await getSlot('autosave'); if (s) { W = deserialize(D, s); app.resumed = true; } } catch (e) { console.warn('autosave load failed', e); }
    if (!W) W = createWorld(D, {});
    setWorld(W);
    app.R.onLabels = drawLabels;
    app.basemap = new Basemap(document.getElementById('tilesBase'), document.getElementById('tilesLabels'), document.getElementById('attr'));
    app.basemap.onOffline = () => { UI.toast("Can't reach the online map right now — showing the built-in map", 4000); app.basemap.setStyle('none'); app.R.opts.opacity = 1; app.R.opts.grid = app.show.grid; if (app.R.points) app.R.points.visible = app.show.cities; app.R.dirty(); };
    app.R.onFrame = (R) => app.basemap.update(R);
    applyMapStyle();
    window.addEventListener('resize', () => app.R.resize());
    // Android may drop the GPU context while the app is in the background: save, then reload from the autosave
    const glc = document.getElementById('gl');
    glc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); app.running = false; autosave(); });
    glc.addEventListener('webglcontextrestored', () => { Promise.resolve(autosave()).finally(() => location.reload()); });
    setupInput(document.getElementById('map'));
    UI.init(app);
    loading.classList.add('done'); setTimeout(() => loading.remove(), 500);
    if (app.resumed) UI.toast(`Resumed “${W.name}” — ${UI.dateLabel()}`);
    requestAnimationFrame(simLoop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
    setInterval(() => { if (app.running) autosave(); }, 120000);
  } catch (e) {
    console.error(e); msg.textContent = 'Could not start: ' + e.message; loading.classList.add('error');
  }
}

export function setWorld(W) {
  app.W = W; app.sel = null; app.undo = []; app.redo = []; app.aggStamp++;
  app.paintNation = 0; app.diploTarget = 0; app.district = 0; app.histOwner = null; app.histMonth = null; app.stats = null; app.planCentroids = null;
  W.planDistrictVotes = (p, n) => districtVotes(W, p, n);
  W.onNews = (n) => UI.onNews && UI.onNews(n);
  app.catalog = buildCatalog(app);
  if (!app.catalog.find((t) => t.id === app.themeId)) app.themeId = 'nations';
  app.activePlan = W.plans.length ? W.plans[W.plans.length - 1].id : null;
  refresh();
}
export function autosave() { try { return putSlot('autosave', serialize(app.W)); } catch (e) { console.warn(e); } }

// ---------------------------------------------------------------- themes & colours
export const theme = () => app.catalog.find((t) => t.id === app.themeId) || app.catalog[0];
export const plan = () => app.W.plans.find((p) => p.id === app.activePlan) || null;
export function rebuildCatalog() { app.catalog = buildCatalog(app); }
export function setTheme(id) { app.themeId = id; refresh(); UI.refreshPanels(); }

// Unit layer (provinces / counties / the active precinct pack) for a layer name used by the renderer.
export function layerFor(name) {
  if (name === 'precincts') return app.activePack ? unitLayer(app.W, 'precincts', app.activePack) : null;
  return unitLayer(app.W, name);
}
// Load a state's precinct pack (download once), make it the active precinct layer.
export async function usePack(state, progress) {
  if (app.activePack === state && app.D.packs[state]) return app.D.packs[state];
  const P = await loadPack(state, progress);
  if (!P.countyLabels) { // FIPS codes -> county names from the bundled US county list
    const byFips = new Map(app.D.units.counties.map((c) => [String(c.fips).padStart(5, '0'), c.n]));
    P.countyLabels = P.countyNames.map((c) => { const t = String(c).trim(); const f = /^\d{1,3}$/.test(t) ? P.stateFips + t.padStart(3, '0') : /^\d{5}$/.test(t) ? t : null; return (f && byFips.get(f)) || t; });
  }
  app.D.packs = { [state]: P }; // keep one in memory at a time
  app.activePack = state;
  if (app.R.polys.precincts) app.R.removePolyLayer('precincts');
  app.R.addPolyLayer('precincts', P.geom);
  app.unitRGBA.precincts = new Uint8Array(P.count * 4);
  app.hitReset && app.hitReset('precincts'); delete ucCache.precincts; app._uc_precincts = null;
  rebuildCatalog();
  return P;
}
// Make sure the active plan's precinct pack is loaded before showing it.
export async function ensurePlanPack() {
  const p = plan(); if (!p || p.unit !== 'precincts' || (app.activePack === p.pack && app.D.packs[p.pack])) return true;
  UI.toast(`Loading ${p.pack} precincts…`);
  try { await usePack(p.pack, (f, t) => UI.toast(t)); computePlanStats(); refresh(); UI.refreshPanels(); return true; }
  catch (e) { UI.toast(e.message, 5000); return false; }
}
function polyLayerShown() {
  const t = theme(), p = plan();
  if (app.mode === 'draw' && p && p.unit !== 'cells') return p.unit === 'precincts' && !(app.activePack === p.pack && app.D.packs[p.pack]) ? null : p.unit;
  if (t.layer === 'precincts' && !app.activePack) return null;
  return t.layer !== 'cells' ? t.layer : null;
}

// Recolour everything for the current mode / theme / plan.
export function refresh() {
  const W = app.W;
  if (!app.histOwner) return refreshInner();
  const real = W.owner; W.owner = app.histOwner;
  try { refreshInner(); } finally { W.owner = real; }
}
// Show the borders as they were at month m (null = the present).
export function viewHistory(m) {
  const W = app.W;
  if (m == null || m >= W.month || !W.timeline) { app.histOwner = null; app.histMonth = null; }
  else { app.histOwner = ownerAt(W, m); app.histMonth = m; app.running = false; }
  refresh();
}
// Make the borders shown in the history view the real, current borders.
export function restoreHistory() {
  const W = app.W; if (!app.histOwner) return;
  W.owner.set(app.histOwner);
  for (const n of W.nations) if (n) n.alive = false;
  app.histOwner = null; app.histMonth = null;
  computeAggregates(W); computeAdjacency(W);
  W.wars = W.wars.filter((w) => W.nations[w.a].alive && W.nations[w.b].alive);
  app.aggStamp++; rebuildCatalog(); refresh();
}
function refreshInner() {
  const W = app.W, D = app.D, t = theme(), land = W.land, N = W.N;
  const poly = polyLayerShown(), p = app.mode === 'draw' ? plan() : null;
  const base = app.baseRGBA, out = app.cellRGBA, grp = app.groupRGBA;
  // ---- cell base colours
  if (t.layer === 'cells' && !poly) app.legend = colorize(t, land, N, t.value, base);
  else {
    for (const i of land) { const c = TERRAIN_COLORS[W.terrain[i]], o = i * 4; base[o] = c[0] * 0.45 + 30; base[o + 1] = c[1] * 0.45 + 32; base[o + 2] = c[2] * 0.45 + 38; base[o + 3] = 255; }
    app.cellLegend = null;
  }
  app.cellColorOne = t.layer === 'cells' && !poly ? app.legend.colorOne : null;
  app.smooth = !poly && !(p && p.unit === 'cells') && t.layer === 'cells' ? (t.by || null) : null;
  composeCells(land);
  applySmooth();
  // ---- polygon layers
  for (const L of ['provinces', 'counties', 'precincts']) if (app.R.polys[L]) app.R.polys[L].visible = poly === L;
  if (poly) {
    const units = layerFor(poly).units, arr = app.unitRGBA[poly];
    const tt = t.layer === poly ? t : app.catalog.find((x) => x.layer === poly);
    const lg = colorize(tt, null, units.length, tt.value, arr);
    if (t.layer === poly) app.legend = lg;
    if (p && p.unit === poly) { app._unitBase = arr.slice(); overlayPlanUnits(p, arr); }
    districtOutlines(p && p.unit === poly ? p : null);
    app.R.setPolyColors(poly, arr);
    app.R.polys[poly].alpha = 0.93;
  }
  app.R.opts.grid = app.show.grid && !app.smooth && !(app.basemap && app.basemap.online);
  app.R.thick.realBorders.visible = (app.show.borders && app.smooth !== 'owner') || (!!p && p.unit === 'provinces' && app.drawOpts.boundaries);
  app.R.lines.provLines.visible = !!p && (p.unit === 'cells' || p.unit === 'counties') && app.drawOpts.boundaries;
  app.R.lines.countyLines.visible = (!!p && p.unit === 'precincts' && app.drawOpts.boundaries) || (poly === 'precincts' && !p);
  if (!poly) districtOutlines(null);
  app.R.setCellColors(out); app.R.setCellGroups(grp);
  updateHighlight();
  app.R.dirty();
}

// Combine base colours with the active plan / selection into the textures.
function composeCells(list) {
  const W = app.W, base = app.baseRGBA, out = app.cellRGBA, grp = app.groupRGBA, t = theme();
  const p = app.mode === 'draw' ? plan() : null, cellPlan = p && p.unit === 'cells' ? p : null;
  const gkey = t.groupBy === 'country' ? W.D.cells.country : t.groupBy === 'admin1' ? W.D.cells.admin1 : W.owner;
  for (let k = 0; k < list.length; k++) {
    const i = list[k], o = i * 4;
    let r = base[o], g = base[o + 1], b = base[o + 2];
    if (cellPlan) {
      const d = cellPlan.assign[i], O = app.drawOpts;
      if (d >= 0 && !O.hideDistricts) { const c = cellPlan.colors[d]; if (O.showData) { r = r * 0.45 + c[0] * 0.55; g = g * 0.45 + c[1] * 0.55; b = b * 0.45 + c[2] * 0.55; } else { r = c[0]; g = c[1]; b = c[2]; } }
      else if (eligible(W, cellPlan, i)) { if (d < 0 && O.highlightUnassigned && !O.showData) { r = r * 0.3 + 175; g = g * 0.3 + 160; b = b * 0.3 + 95; } else if (!O.showData) { r = r * 0.35 + 150; g = g * 0.35 + 152; b = b * 0.35 + 158; } }
      else { r *= 0.45; g *= 0.45; b *= 0.5; }
      grp[o + 2] = (d + 1) & 255; grp[o + 3] = (d + 1) >> 8;
    } else { grp[o + 2] = 0; grp[o + 3] = 0; }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    const gv = gkey[i]; grp[o] = gv & 255; grp[o + 1] = gv >> 8;
  }
  // coastal water cells take a land neighbour's colour so the coastline-clipped grid has no gaps
  const F = app.fringe;
  if (F) {
    if (list.length === W.land.length) { for (let k = 0; k < F.cell.length; k++) copyCell(F.src[k], F.cell[k]); }
    else for (const i of list) { const fl = F.bySrc.get(i); if (fl) for (const f of fl) copyCell(i, f); }
  }
}
function copyCell(from, to) {
  const a = from * 4, b = to * 4, out = app.cellRGBA, grp = app.groupRGBA;
  out[b] = out[a]; out[b + 1] = out[a + 1]; out[b + 2] = out[a + 2]; out[b + 3] = out[a + 3];
  grp[b] = grp[a]; grp[b + 1] = grp[a + 1]; grp[b + 2] = grp[a + 2]; grp[b + 3] = grp[a + 3];
}

// ---- real-shape rendering: nation themes drawn as province polygons, country themes as country polygons
function prepareSmooth(D, Wd, Hd) {
  const country = D.cells.country, N = Wd * Hd;
  // coastal fringe: water cells within 2 cells of land, each linked to its nearest land cell
  const src = new Int32Array(N).fill(-1); let frontier = [];
  for (let i = 0; i < N; i++) if (country[i]) src[i] = i;
  for (let i = 0; i < N; i++) if (country[i]) frontier.push(i);
  const cells = [], srcs = [];
  for (let ring = 0; ring < 2; ring++) {
    const next = [];
    for (const i of frontier) {
      const x = i % Wd, y = (i / Wd) | 0;
      for (const j of [y * Wd + (x + 1) % Wd, y * Wd + (x - 1 + Wd) % Wd, y > 0 ? i - Wd : -1, y < Hd - 1 ? i + Wd : -1]) {
        if (j < 0 || src[j] >= 0) continue; src[j] = src[i]; cells.push(j); srcs.push(src[i]); next.push(j);
      }
    }
    frontier = next;
  }
  const bySrc = new Map(); cells.forEach((c, k) => { const s0 = srcs[k]; let a = bySrc.get(s0); if (!a) bySrc.set(s0, a = []); a.push(c); });
  app.fringe = { cell: Int32Array.from(cells), src: Int32Array.from(srcs), bySrc };
  // cells of each province (CSR) for quick purity checks
  const nP = D.units.provinces.length + 1, admin = D.cells.admin1, cnt = new Int32Array(nP + 1);
  for (let i = 0; i < N; i++) if (country[i] && admin[i]) cnt[admin[i] + 1]++;
  for (let k = 1; k <= nP; k++) cnt[k] += cnt[k - 1];
  const items = new Int32Array(cnt[nP]), fill = cnt.slice();
  for (let i = 0; i < N; i++) if (country[i] && admin[i]) items[fill[admin[i]]++] = i;
  app.provCells = { start: cnt, items };
  app.provPure = new Uint8Array(nP);
  app.polyRGBA = { nationProv: new Uint8Array(D.units.provinces.length * 4), nationProvLine: new Uint8Array(D.units.provinces.length * 4) };
  // a land cell inside each tiny province / country that has no cells of its own
  app.provProbe = D.units.provinces.map((p) => cellAt({ Wd, Hd }, p.l[0] ?? 0, p.l[1] ?? 0));
}
const darken = (a, o, src, f) => { a[o] = src[0] * f; a[o + 1] = src[1] * f; a[o + 2] = src[2] * f; };
function applySmooth() {
  const W = app.W, R = app.R, out = app.cellRGBA, mode = app.smooth;
  R.polys.nationProv.visible = !!mode; R.polys.nationUnder.visible = mode === 'owner';
  R.opts.grid = app.show.grid && !mode && !(app.basemap && app.basemap.online);
  if (mode !== 'owner') R.setThickLines('nationBorders', null);
  if (!mode) return;
  const D = W.D, base = app.baseRGBA;
  if (mode === 'owner') {
    const { start, items } = app.provCells, nP = D.units.provinces.length, fillA = app.polyRGBA.nationProv, lineA = app.polyRGBA.nationProvLine;
    const ownerColor = new Map(), underA = app.polyRGBA.under || (app.polyRGBA.under = new Uint8Array(nP * 4));
    for (let p = 1; p <= nP; p++) {
      const o4 = (p - 1) * 4; let pure = 1, own = -1, first = -1;
      for (let k = start[p]; k < start[p + 1]; k++) { const i = items[k], ow = W.owner[i]; if (own < 0) { own = ow; first = i; } else if (ow !== own) { pure = 0; break; } }
      if (first < 0) { // tiny province without cells: colour by whoever holds the land it sits on
        const pr = app.provProbe[p - 1], ow = pr >= 0 && D.cells.country[pr] ? W.owner[pr] : D.units.provinces[p - 1].c;
        const col = ownerColor.get(ow); if (!col || !ow || !W.nations[ow] || !W.nations[ow].alive) { fillA[o4 + 3] = 0; lineA[o4 + 3] = 0; app.provPure[p] = 0; continue; }
        fillA[o4] = col[0]; fillA[o4 + 1] = col[1]; fillA[o4 + 2] = col[2]; fillA[o4 + 3] = 255; darken(lineA, o4, col, 0.62); lineA[o4 + 3] = 70; app.provPure[p] = 1; continue;
      }
      app.provPure[p] = pure;
      const b = first * 4, col = [base[b], base[b + 1], base[b + 2]];
      if (!ownerColor.has(own)) ownerColor.set(own, col);
      if (pure) {
        fillA[o4] = col[0]; fillA[o4 + 1] = col[1]; fillA[o4 + 2] = col[2]; fillA[o4 + 3] = 255; darken(lineA, o4, col, 0.62); lineA[o4 + 3] = 70;
        for (let k = start[p]; k < start[p + 1]; k++) out[items[k] * 4 + 3] = 0;
      } else {
        fillA[o4 + 3] = 0; lineA[o4] = lineA[o4 + 1] = lineA[o4 + 2] = 20; lineA[o4 + 3] = 70;
        // underneath: the colour of whoever holds most of the province (fills gaps between cells and real borders)
        const cnt = new Map(); let bo = -1, bn = 0, bi = first;
        for (let k = start[p]; k < start[p + 1]; k++) { const i = items[k], ow = W.owner[i], c = (cnt.get(ow) || 0) + 1; cnt.set(ow, c); if (c > bn) { bn = c; bo = ow; bi = i; } }
        const ub = bi * 4; underA[o4] = base[ub]; underA[o4 + 1] = base[ub + 1]; underA[o4 + 2] = base[ub + 2]; underA[o4 + 3] = 255;
      }
      if (pure) underA[o4 + 3] = 0;
    }
    // second pass for cell-less provinces that came before their owner's first province
    for (let p = 1; p <= nP; p++) {
      if (start[p] !== start[p + 1]) continue; const o4 = (p - 1) * 4; if (fillA[o4 + 3]) continue;
      const pr = app.provProbe[p - 1], ow = pr >= 0 && D.cells.country[pr] ? W.owner[pr] : D.units.provinces[p - 1].c, col = ownerColor.get(ow);
      if (col && ow && W.nations[ow] && W.nations[ow].alive) { fillA[o4] = col[0]; fillA[o4 + 1] = col[1]; fillA[o4 + 2] = col[2]; fillA[o4 + 3] = 255; darken(lineA, o4, col, 0.62); lineA[o4 + 3] = 70; }
    }
    // pure-province cells in the coastal fringe must hide too
    const F = app.fringe; for (let k = 0; k < F.cell.length; k++) if (out[F.src[k] * 4 + 3] === 0) out[F.cell[k] * 4 + 3] = 0;
    R.setPolyColors('nationProv', fillA, lineA); R.polys.nationProv.alpha = 1; R.polys.nationProv.lineAlpha = 1;
    R.setPolyColors('nationUnder', underA); R.polys.nationUnder.alpha = 1; R.polys.nationUnder.lineColor = [0, 0, 0, 0];
    nationBorderLines(ownerColor);
  } else {
    // country themes: every province takes its (real) country's colour
    const P = D.units.provinces, nP = P.length, fillA = app.polyRGBA.nationProv, lineA = app.polyRGBA.nationProvLine, colOf = new Map();
    for (const i of W.land) { const c = D.cells.country[i]; if (c && !colOf.has(c)) { const b = i * 4; colOf.set(c, [base[b], base[b + 1], base[b + 2]]); } }
    for (let u = 0; u < nP; u++) {
      const o4 = u * 4, col = colOf.get(P[u].c);
      if (!col) { fillA[o4 + 3] = 0; lineA[o4 + 3] = 0; continue; }
      fillA[o4] = col[0]; fillA[o4 + 1] = col[1]; fillA[o4 + 2] = col[2]; fillA[o4 + 3] = 255; darken(lineA, o4, col, 0.62); lineA[o4 + 3] = 55;
    }
    for (const i of W.land) out[i * 4 + 3] = 0;
    const F = app.fringe; for (let k = 0; k < F.cell.length; k++) out[F.cell[k] * 4 + 3] = 0;
    R.setPolyColors('nationProv', fillA, lineA); R.polys.nationProv.alpha = 1; R.polys.nationProv.lineAlpha = 1;
  }
}
// Dark border line wherever two whole provinces belong to different nations.
function nationBorderLines() {
  const W = app.W, D = W.D, g = D.geom.prov, { start, items } = app.provCells, nP = D.units.provinces.length;
  const own = new Int32Array(nP).fill(-1);
  for (let p = 1; p <= nP; p++) if (app.provPure[p] && start[p] < start[p + 1]) own[p - 1] = W.owner[items[start[p]]];
  const out = [];
  for (let k = 0; k < g.luid.length; k += 2) {
    const u = g.luid[k], v = g.lnb[k]; if (v === 65535 || u > v) continue;
    const a = own[u], b = own[v]; if (a < 0 || b < 0 || a === b) continue;
    out.push(g.lpos[k * 2], g.lpos[k * 2 + 1], g.lpos[k * 2 + 2], g.lpos[k * 2 + 3]);
  }
  app.R.setThickLines('nationBorders', new Float32Array(out), [0.07, 0.08, 0.11, 0.9], (s) => s < 600 ? 0.9 : s < 3000 ? 1.4 : 2.2, 2);
}
// Painting inside a smooth province breaks it back into cells so the change is visible immediately.
function unsmoothFor(list) {
  if (app.smooth !== 'owner') return list;
  const W = app.W, admin = W.D.cells.admin1, { start, items } = app.provCells, broke = [];
  for (const i of list) { const p = admin[i]; if (p && app.provPure[p]) { app.provPure[p] = 0; broke.push(p); } }
  if (!broke.length) return list;
  const fillA = app.polyRGBA.nationProv;
  const more = [...list];
  for (const p of broke) { fillA[(p - 1) * 4 + 3] = 0; for (let k = start[p]; k < start[p + 1]; k++) more.push(items[k]); }
  app.R.setPolyColors('nationProv', fillA, app.polyRGBA.nationProvLine);
  return more;
}
// White outline around every district of a province / county plan.
function districtOutlines(p) {
  if (!p || app.drawOpts.hideDistricts) { app.R.setOverlayLines('districts', null); return; }
  const LY = planLayer(app.W, p); if (!LY) return; const g = LY.geom; if (!g.lnb) return;
  const A = p.assign, out = [];
  for (let k = 0; k < g.luid.length; k += 2) {
    const d = A[g.luid[k]]; if (d < 0) continue;
    const nb = g.lnb[k], e = nb === 65535 ? -2 : A[nb];
    if (e !== d) out.push(g.lpos[k * 2], g.lpos[k * 2 + 1], g.lpos[k * 2 + 2], g.lpos[k * 2 + 3]);
  }
  app.R.setOverlayLines('districts', new Float32Array(out));
}
let outlineTimer = 0;
function scheduleOutlines(p) { clearTimeout(outlineTimer); outlineTimer = setTimeout(() => districtOutlines(p), 60); }
function overlayPlanUnits(p, arr, list) {
  const W = app.W, O = app.drawOpts, base = app._unitBase && app._unitBase.length === arr.length ? app._unitBase : null;
  const one = (u) => {
    const o = u * 4, d = p.assign[u];
    const br = base ? base[o] : arr[o], bg = base ? base[o + 1] : arr[o + 1], bb = base ? base[o + 2] : arr[o + 2];
    if (d >= 0 && !O.hideDistricts) { const c = p.colors[d]; if (O.showData) { arr[o] = br * 0.45 + c[0] * 0.55; arr[o + 1] = bg * 0.45 + c[1] * 0.55; arr[o + 2] = bb * 0.45 + c[2] * 0.55; } else { arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; } arr[o + 3] = 255; }
    else if (eligible(W, p, u)) {
      if (O.showData || (d >= 0 && O.hideDistricts)) { arr[o] = br; arr[o + 1] = bg; arr[o + 2] = bb; arr[o + 3] = 235; }
      else if (O.highlightUnassigned) { arr[o] = br * 0.3 + 175; arr[o + 1] = bg * 0.3 + 160; arr[o + 2] = bb * 0.3 + 95; arr[o + 3] = 235; }
      else { arr[o] = br * 0.3 + 160; arr[o + 1] = bg * 0.3 + 162; arr[o + 2] = bb * 0.3 + 168; arr[o + 3] = 235; }
    } else { arr[o] = br * 0.4; arr[o + 1] = bg * 0.4; arr[o + 2] = bb * 0.45; arr[o + 3] = 150; }
  };
  if (list) for (const u of list) one(u); else for (let u = 0; u < p.assign.length; u++) one(u);
}
// Cheap update for a handful of cells (painting).
export function refreshCells(list) {
  list = unsmoothFor(list);
  if (app.cellColorOne) for (const i of list) app.cellColorOne(i, app.baseRGBA);
  composeCells(list);
  // neighbours' border pixels depend on these cells too, so widen by one row
  let y0 = Infinity, y1 = -1; for (const i of list) { const y = (i / app.W.Wd) | 0; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (y1 < 0) return;
  app.R.setCellRows(app.cellRGBA, app.groupRGBA, Math.max(0, y0 - 1), Math.min(app.W.Hd - 1, y1 + 1));
}

// ---------------------------------------------------------------- cities & labels
function setupCities() {
  const C = app.D.units.cities, n = C.length;
  const pos = new Float32Array(n * 2), size = new Float32Array(n), col = new Uint8Array(n * 4);
  C.forEach((c, k) => {
    pos[k * 2] = mercX(c.lng); pos[k * 2 + 1] = mercY(c.lat);
    size[k] = c.cap ? 7 : clamp(2 + Math.log10(Math.max(c.pop, 1e4)) - 4, 2.5, 6.5);
    const v = c.cap ? [255, 214, 90] : [245, 246, 250]; col.set([...v, 255], k * 4);
  });
  app.R.setPoints(pos, size, col);
  app.R.pointCount = (s) => s < 700 ? 60 : s < 1500 ? 250 : s < 4000 ? 900 : s < 12000 ? 3000 : n;
}
function drawLabels(ctx, R) {
  const W = app.W, scale = R.cssScale, cellPx = scale / W.Wd, vw = R.vw / R.dpr, vh = R.vh / R.dpr;
  const boxes = [];
  const free = (x, y, w, hh) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + hh > b[1]) return false; boxes.push([x, y, w, hh]); return true; };
  const label = (text, x, y, size, color, weight = 600, stroke = 'rgba(8,10,16,.75)') => {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`; const w = ctx.measureText(text).width;
    if (x + w / 2 < 0 || x - w / 2 > vw || y < -size || y > vh + size) return false;
    if (!free(x - w / 2 - 2, y - size / 2 - 1, w + 4, size + 2)) return false;
    ctx.lineWidth = Math.max(2.5, size / 5); ctx.strokeStyle = stroke; ctx.strokeText(text, x - w / 2, y + size * 0.35);
    ctx.fillStyle = color; ctx.fillText(text, x - w / 2, y + size * 0.35); return true;
  };
  ctx.lineJoin = 'round';
  // district numbers
  const p = app.mode === 'draw' ? plan() : null;
  // keep labels out from under the header and the bottom sheet
  const padB = (R.pad && R.pad.b) || 0; boxes.push([0, 0, vw, 62], [0, vh - padB, vw, padB + 40]);
  if (p && app.planCentroids) for (const c of app.planCentroids) { if (!c) continue; const [x, y] = R.worldToScreen(c[0], c[1]); label(String(c[2] + 1), x, y, 15, '#fff', 800); }
  if (!app.show.labels) return;
  // province / county names when zoomed in
  const poly = polyLayerShown();
  if (poly) {
    const C = unitCenters(poly), units = layerFor(poly).units;
    let drawn = 0;
    for (const u of C.order) {
      const lat = unMercY(C.y[u]), pxKm = scale / (40075 * Math.cos(lat * Math.PI / 180));
      const span = Math.sqrt(units[u].area || 0) * pxKm; if (span < 40) continue;
      const [x, y] = R.worldToScreen(C.x[u], C.y[u]);
      if (x < -60 || x > vw + 60 || y < -20 || y > vh + 20) continue;
      if (label(units[u].n, x, y, clamp(span / 9, 10, 15), '#f7f3ea', 600)) drawn++;
      if (drawn > 160) break;
    }
  }
  // nations
  if (theme().layer === 'cells' && app.mode !== 'draw') {
    const { pos, cnt } = labelPositions();
    const list = W.nations.filter((n) => n && cnt[n.id] > 0).sort((a, b) => cnt[b.id] - cnt[a.id]);
    for (const n of list) {
      const span = Math.sqrt(cnt[n.id]) * cellPx; if (span < 26) continue;
      const size = clamp(span / 7, 10, 26);
      const lp = pos[n.id]; if (!lp) continue;
      const lat = 90 - (lp[1] + 0.5) * 180 / W.Hd, wx = (lp[0] + 0.5) / W.Wd, wy = mercY(lat);
      const [x, y] = R.worldToScreen(wx, wy);
      label(n.name.length > 22 && size < 14 ? (n.a3 || n.name.slice(0, 12)) : n.name, x, y, size, n.id === (app.sel && app.sel.nation) ? '#ffd65a' : '#f4f1ea', 700);
    }
  }
  // cities
  if (app.show.cities && scale > 900 && !(app.basemap && app.basemap.hasLabels)) {
    const lim = scale > 20000 ? 7000 : scale > 6000 ? 1500 : scale > 2500 ? 400 : 90;
    const C = app.D.units.cities;
    for (let k = 0; k < Math.min(lim, C.length); k++) {
      const c = C[k]; const [x, y] = R.worldToScreen(mercX(c.lng), mercY(c.lat));
      if (x < -50 || x > vw + 50 || y < -20 || y > vh + 20) continue;
      label(c.name, x + 0, y - 11, c.cap ? 12 : 11, c.cap ? '#ffe7a6' : '#e8ecf3', c.cap ? 700 : 500);
    }
  }
}

// Mercator centre of every province / county (vertex mean), largest first.
const ucCache = {};
function unitCenters(layer) {
  if (ucCache[layer]) return ucCache[layer];
  const LY = layerFor(layer), g = LY.geom, units = LY.units;
  const n = units.length, x = new Float64Array(n), y = new Float64Array(n), c = new Float64Array(n);
  for (let v = 0; v < g.uid.length; v++) { const u = g.uid[v]; x[u] += g.pos[v * 2]; y[u] += g.pos[v * 2 + 1]; c[u]++; }
  for (let u = 0; u < n; u++) if (c[u]) { x[u] /= c[u]; y[u] /= c[u]; }
  const order = [...units.keys()].filter((u) => c[u]).sort((a, b) => (units[b].area || 0) - (units[a].area || 0));
  return (ucCache[layer] = { x, y, order });
}

// Label anchor per nation: centroid of its land near the capital (ignores far-flung islands/colonies).
let lpCache = null, lpStamp = -1;
function labelPositions() {
  const W = app.W, stamp = app.aggStamp + ':' + app.histMonth; if (lpCache && lpStamp === stamp) return lpCache;
  const owner = app.histOwner || W.owner;
  const nn = W.nations.length, sx = new Float64Array(nn), sy = new Float64Array(nn), c = new Float64Array(nn), R2 = new Float64Array(nn), cx = new Float64Array(nn), cy = new Float64Array(nn);
  const cnt = new Int32Array(nn), anyCell = new Int32Array(nn).fill(-1);
  for (const i of W.land) { const o = owner[i]; if (o) { cnt[o]++; if (anyCell[o] < 0 || W.pop[i] > W.pop[anyCell[o]]) anyCell[o] = i; } }
  for (let o = 1; o < nn; o++) {
    const n = W.nations[o]; if (!cnt[o]) continue;
    const capOk = n.capital >= 0 && owner[n.capital] === o, cc = capOk ? n.capital : anyCell[o];
    cx[o] = cc % W.Wd; cy[o] = (cc / W.Wd) | 0; const r = 2.2 * Math.sqrt(cnt[o]) + 4; R2[o] = r * r;
  }
  for (const i of W.land) {
    const o = owner[i]; if (!o || !R2[o]) continue;
    const y = (i / W.Wd) | 0; let dx = (i - y * W.Wd) - cx[o]; if (dx > W.Wd / 2) dx -= W.Wd; else if (dx < -W.Wd / 2) dx += W.Wd;
    const dy = y - cy[o]; if (dx * dx + dy * dy > R2[o]) continue;
    sx[o] += dx; sy[o] += dy; c[o]++;
  }
  const pos = []; for (let o = 1; o < nn; o++) if (c[o]) pos[o] = [(cx[o] + sx[o] / c[o] + W.Wd) % W.Wd, cy[o] + sy[o] / c[o]];
  lpCache = { pos, cnt }; lpStamp = stamp; return lpCache;
}

// ---------------------------------------------------------------- selection
export function select(sel) { app.sel = sel; updateHighlight(); UI.refreshPanels(); app.R.dirty(); }
function updateHighlight() {
  const s = app.sel, R = app.R;
  if (!s) { R.setHighlight(null); return; }
  if (s.unit != null && s.layer) {
    const LY = layerFor(s.layer); if (!LY) { R.setHighlight(null); return; } const g = LY.geom; const out = [];
    for (let k = 0; k < g.luid.length; k += 2) if (g.luid[k] === s.unit) out.push(g.lpos[k * 2], g.lpos[k * 2 + 1], g.lpos[k * 2 + 2], g.lpos[k * 2 + 3]);
    R.setHighlight(new Float32Array(out)); return;
  }
  if (s.cell != null) {
    const W = app.W, [lng, lat] = cellLngLat(W, s.cell), d = 180 / W.Hd / 2;
    const x0 = mercX(lng - d), x1 = mercX(lng + d), y0 = mercY(lat + d), y1 = mercY(lat - d);
    R.setHighlight(new Float32Array([x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0]), [1, 0.85, 0.25, 1]);
  }
}

// polygon hit testing with a bucket grid of triangles
const hitIndex = {};
app.hitReset = (layer) => { delete hitIndex[layer]; };
export function pickUnit(layer, wx, wy) {
  const LY = layerFor(layer); if (!LY) return -1;
  const g = LY.geom, B = 256;
  let ix = hitIndex[layer];
  if (!ix) {
    const counts = new Int32Array(B * B + 1), P = g.pos, I = g.idx, nt = I.length / 3;
    const range = (t) => { let x0 = 1, x1 = 0, y0 = 1, y1 = 0; for (let k = 0; k < 3; k++) { const v = I[t * 3 + k]; x0 = Math.min(x0, P[v * 2]); x1 = Math.max(x1, P[v * 2]); y0 = Math.min(y0, P[v * 2 + 1]); y1 = Math.max(y1, P[v * 2 + 1]); } return [clamp(Math.floor(x0 * B), 0, B - 1), clamp(Math.floor(x1 * B), 0, B - 1), clamp(Math.floor(y0 * B), 0, B - 1), clamp(Math.floor(y1 * B), 0, B - 1)]; };
    const rs = []; for (let t = 0; t < nt; t++) { const r = range(t); rs.push(r); for (let y = r[2]; y <= r[3]; y++) for (let x = r[0]; x <= r[1]; x++) counts[y * B + x + 1]++; }
    for (let k = 1; k <= B * B; k++) counts[k] += counts[k - 1];
    const items = new Int32Array(counts[B * B]), fill = counts.slice();
    rs.forEach((r, t) => { for (let y = r[2]; y <= r[3]; y++) for (let x = r[0]; x <= r[1]; x++) items[fill[y * B + x]++] = t; });
    ix = hitIndex[layer] = { counts, items };
  }
  wx = ((wx % 1) + 1) % 1;
  const bx = clamp(Math.floor(wx * B), 0, B - 1), by = clamp(Math.floor(wy * B), 0, B - 1), b = by * B + bx;
  const P = g.pos, I = g.idx;
  for (let k = ix.counts[b]; k < ix.counts[b + 1]; k++) {
    const t = ix.items[k], a = I[t * 3], c = I[t * 3 + 1], d = I[t * 3 + 2];
    const ax = P[a * 2], ay = P[a * 2 + 1], cx = P[c * 2], cy = P[c * 2 + 1], dx = P[d * 2], dy = P[d * 2 + 1];
    const s1 = (cx - ax) * (wy - ay) - (cy - ay) * (wx - ax), s2 = (dx - cx) * (wy - cy) - (dy - cy) * (wx - cx), s3 = (ax - dx) * (wy - dy) - (ay - dy) * (wx - dx);
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return g.uid[a];
  }
  return -1;
}
export function cellAtScreen(px, py) { const [lng, lat] = app.R.screenToLngLat(px, py); if (Math.abs(lat) > 85.05) return -1; return cellAt(app.W, lng, lat); }

// ---------------------------------------------------------------- tools & painting
export function paintTarget() {
  if (app.mode === 'draw' && plan() && ['brush', 'erase'].includes(app.tool)) return 'plan';
  if (app.mode === 'edit' && app.tool === 'brush' && ['borders', 'data'].includes(app.editTool)) return app.editTool;
  return null;
}
let stroke = null;
function strokeStart(px, py) {
  const tgt = paintTarget(); if (!tgt) return false;
  stroke = { tgt, changes: new Map(), last: null, touched: new Set() };
  strokeMove(px, py); return true;
}
function strokeMove(px, py) {
  if (!stroke) return;
  const W = app.W, p = plan();
  const pts = []; const cur = [px, py];
  if (stroke.last) { const d = Math.hypot(px - stroke.last[0], py - stroke.last[1]); const n = Math.max(1, Math.ceil(d / 6)); for (let k = 1; k <= n; k++) pts.push([stroke.last[0] + (px - stroke.last[0]) * k / n, stroke.last[1] + (py - stroke.last[1]) * k / n]); }
  else pts.push(cur);
  stroke.last = cur;
  const unitMode = stroke.tgt === 'plan' && p.unit !== 'cells';
  if (unitMode) {
    const list = [];
    for (const [x, y] of pts) { const [wx, wy] = app.R.screenToWorld(x, y); const u = pickUnit(p.unit, wx, wy); if (u >= 0) list.push(u); }
    if (!list.length) return;
    const all = app.drawOpts.parent && app.tool !== 'erase' ? [...new Set(list.flatMap((u) => parentUnits(W, p, u)))] : list;
    paintUnits(W, p, all, app.tool === 'erase' ? -1 : app.district, stroke.changes, app.drawOpts.noOverwrite);
    const arr = app.unitRGBA[p.unit]; overlayPlanUnits(p, arr, all); app.R.setPolyColors(p.unit, arr); scheduleOutlines(p); scheduleStats();
    return;
  }
  const cells = new Set();
  for (const [x, y] of pts) { const i = cellAtScreen(x, y); if (i < 0) continue; for (const c of brushCells(W, i % W.Wd, (i / W.Wd) | 0, app.brush - 1)) cells.add(c); }
  let list = [...cells].filter((i) => W.D.cells.country[i]);
  if (!list.length) return;
  if (stroke.tgt === 'plan') {
    if (app.drawOpts.parent && app.tool !== 'erase') { const done = stroke.parents || (stroke.parents = new Set()); const more = []; for (const i of list) { const pr = W.D.cells.admin1[i]; if (pr && !done.has(pr)) { done.add(pr); more.push(...parentUnits(W, p, i, app.provCells)); } } list = list.concat(more); }
    paintUnits(W, p, list, app.tool === 'erase' ? -1 : app.district, stroke.changes, app.drawOpts.noOverwrite); scheduleStats();
  }
  else if (stroke.tgt === 'borders') {
    if (!W.nations[app.paintNation]) app.paintNation = 0;
    for (const i of list) { if (W.owner[i] === app.paintNation) continue; if (!stroke.changes.has(i)) stroke.changes.set(i, W.owner[i]); W.owner[i] = app.paintNation; }
    if (app.paintNation && !W.nations[app.paintNation].alive) W.nations[app.paintNation].alive = true;
    stroke.dirtyNations = true;
  } else if (stroke.tgt === 'data') paintData(list);
  refreshCells(list);
}
function paintData(list) {
  const W = app.W, a = app.dataAttr, v = app.dataValue;
  const target = a === 'pop' ? W.pop : a === 'dev' ? W.dev : a === 'lean' ? W.lean : a === 'terrain' ? W.terrain : W.custom[a];
  if (!target) return;
  for (const i of list) {
    if (stroke.touched.has(i)) continue; stroke.touched.add(i);
    if (!stroke.changes.has(i)) stroke.changes.set(i, target[i]);
    if (a === 'pop') target[i] = Math.max(0, target[i] * v); else target[i] = v;
  }
  stroke.dataTarget = target;
}
// A second finger landed: this was the start of a pinch, not a paint stroke — put everything back.
function strokeCancel() {
  if (!stroke) return; const s = stroke; stroke = null; if (!s.changes.size) return;
  const arr = undoArray({ tgt: s.tgt, plan: app.activePlan, arr: s.dataTarget });
  if (arr) for (const [i, v] of s.changes) arr[i] = v;
  if (s.tgt === 'borders' || s.tgt === 'data') { computeAggregates(app.W); computeAdjacency(app.W); app.aggStamp++; }
  refresh(); scheduleStats();
}
function strokeEnd() {
  if (!stroke) return;
  const s = stroke; stroke = null;
  if (!s.changes.size) return;
  const W = app.W;
  const entry = { tgt: s.tgt, changes: s.changes, plan: app.activePlan, arr: s.tgt === 'data' ? s.dataTarget : null };
  app.undo.push(entry); if (app.undo.length > 60) app.undo.shift(); app.redo = [];
  if (s.tgt === 'borders') { computeAggregates(W); computeAdjacency(W); app.aggStamp++; }
  if (s.tgt === 'data') { computeAggregates(W); app.aggStamp++; }
  if (s.tgt !== 'plan') refresh();
  UI.refreshPanels();
}
function undoArray(entry) {
  const W = app.W;
  if (entry.tgt === 'plan') { const p = W.plans.find((x) => x.id === entry.plan); return p && p.assign; }
  if (entry.tgt === 'borders') return W.owner;
  return entry.arr;
}
export function undoRedo(isRedo) {
  const from = isRedo ? app.redo : app.undo, to = isRedo ? app.undo : app.redo;
  const e = from.pop(); if (!e) return;
  const arr = undoArray(e); if (!arr) return;
  const back = new Map(); for (const [i, v] of e.changes) { back.set(i, arr[i]); arr[i] = v; }
  to.push({ ...e, changes: back });
  computeAggregates(app.W); computeAdjacency(app.W); app.aggStamp++;
  refresh(); scheduleStats(); UI.refreshPanels();
}

// taps
function onTap(px, py) {
  const W = app.W, [wx, wy] = app.R.screenToWorld(px, py), i = cellAtScreen(px, py);
  const p = plan();
  if (app.mode === 'draw' && p) {
    const u = p.unit === 'cells' ? i : pickUnit(p.unit, wx, wy);
    if (u < 0) return;
    if (app.tool === 'fill') {
      const ch = new Map(); paintUnits(W, p, floodUnits(W, p, u), app.district, ch, app.drawOpts.noOverwrite);
      if (ch.size) { app.undo.push({ tgt: 'plan', changes: ch, plan: p.id }); app.redo = []; refresh(); scheduleStats(); }
      return;
    }
    if (app.tool === 'pick') { if (p.assign[u] >= 0) { app.district = p.assign[u]; UI.refreshPanels(); } return; }
    if (app.tool === 'pan') { select(p.unit === 'cells' ? { cell: i, nation: W.owner[i] } : { unit: u, layer: p.unit, cell: i }); UI.showInfo(); }
    return;
  }
  if (app.mode === 'edit') {
    if (app.editTool === 'disaster' && i >= 0 && W.D.cells.country[i]) { applyDisaster(W, app.disaster, i); computeAggregates(W); app.aggStamp++; refresh(); UI.refreshPanels(); UI.toast(W.news[0].t); return; }
    if (app.editTool === 'release' && i >= 0 && W.owner[i]) { releaseProvince(i); return; }
    if (app.editTool === 'capital' && i >= 0 && W.owner[i]) { const n = W.nations[W.owner[i]]; n.capital = i; UI.toast(`New capital of ${n.name}`); UI.refreshPanels(); return; }
    if (app.editTool === 'diplomacy' && i >= 0 && W.owner[i] && app.sel && app.sel.nation && W.owner[i] !== app.sel.nation) { app.diploTarget = W.owner[i]; UI.refreshPanels(); return; }
  }
  if (i < 0 || !W.D.cells.country[i]) { const poly = polyLayerShown(); if (!poly) { select(null); UI.hideInfo(); return; } }
  const poly = polyLayerShown();
  if (poly) { const u = pickUnit(poly, wx, wy); if (u >= 0) { select({ unit: u, layer: poly, cell: i, nation: i >= 0 ? W.owner[i] : 0 }); UI.showInfo(); return; } }
  if (i >= 0 && W.D.cells.country[i]) {
    if (app.mode === 'edit' && app.editTool === 'borders' && app.tool === 'pick') { app.paintNation = W.owner[i]; app.tool = 'brush'; UI.refreshPanels(); return; }
    select({ cell: i, nation: W.owner[i] }); UI.showInfo();
  }
}
function releaseProvince(i) {
  const W = app.W, o = W.owner[i], prov = W.D.cells.admin1[i]; if (!prov) return;
  const pname = W.D.units.provinces[prov - 1].n;
  const n = newNation(W, { name: pname, color: hsl(W.rng() * 360, 0.5, 0.56) }); if (!n) { UI.toast('Too many nations'); return; }
  let k = 0; for (const c of W.land) if (W.owner[c] === o && W.D.cells.admin1[c] === prov) { W.owner[c] = n.id; k++; }
  for (let q = 1; q < W.nations.length; q++) if (q !== n.id) setRel(W, n.id, q, rel(W, o, q));
  computeAggregates(W); computeAdjacency(W); app.aggStamp++; rebuildCatalog();
  addNews(W, `${n.name} becomes independent from ${W.nations[o].name}.`, 'rebel', [o, n.id]);
  select({ cell: i, nation: n.id }); refresh(); UI.toast(`${n.name} released (${k} cells)`);
}

// ---------------------------------------------------------------- district stats (debounced)
let statsTimer = 0;
export function scheduleStats() { clearTimeout(statsTimer); statsTimer = setTimeout(computePlanStats, 120); }
export function computePlanStats() {
  const p = plan(); if (!p) { app.stats = null; app.planCentroids = null; return; }
  app.stats = planStats(app.W, p);
  // centroids for labels
  const W = app.W, sx = new Float64Array(p.n), sy = new Float64Array(p.n), sc = new Float64Array(p.n), cs = new Float64Array(p.n), sn = new Float64Array(p.n);
  if (p.unit === 'cells') {
    for (const i of W.land) { const d = p.assign[i]; if (d < 0) continue; const a = (i % W.Wd) / W.Wd * 2 * Math.PI; cs[d] += Math.cos(a); sn[d] += Math.sin(a); sy[d] += (i / W.Wd) | 0; sc[d]++; }
    app.planCentroids = Array.from({ length: p.n }, (_, d) => { if (!sc[d]) return null; let a = Math.atan2(sn[d], cs[d]); if (a < 0) a += 2 * Math.PI; const lat = 90 - (sy[d] / sc[d] + 0.5) * 180 / W.Hd; return [a / (2 * Math.PI) + 0.5 / W.Wd, mercY(lat), d]; });
  } else {
    const LY = planLayer(W, p); if (!LY) { app.planCentroids = null; return; }
    const g = LY.geom;
    // use vertex means per unit (cached)
    const key = '_uc_' + p.unit; if (!app[key] || app[key].x.length !== p.assign.length) { const n = p.assign.length, x = new Float64Array(n), y = new Float64Array(n), c = new Float64Array(n); for (let v = 0; v < g.uid.length; v++) { const u = g.uid[v]; x[u] += g.pos[v * 2]; y[u] += g.pos[v * 2 + 1]; c[u]++; } app[key] = { x, y, c }; }
    const U = app[key];
    for (let u = 0; u < p.assign.length; u++) { const d = p.assign[u]; if (d < 0 || !U.c[u]) continue; sx[d] += U.x[u] / U.c[u]; sy[d] += U.y[u] / U.c[u]; sc[d]++; }
    app.planCentroids = Array.from({ length: p.n }, (_, d) => sc[d] ? [sx[d] / sc[d], sy[d] / sc[d], d] : null);
  }
  UI.refreshStats && UI.refreshStats();
  app.R.dirty();
}

// ---------------------------------------------------------------- input
function setupInput(el) {
  const ptrs = new Map(); let mode = null, start = null, lastPinch = null, lastTap = 0;
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 1) {
      start = { x: e.offsetX, y: e.offsetY, t: performance.now() }; mode = 'maybe';
      if (paintTarget()) { if (strokeStart(e.offsetX, e.offsetY)) mode = 'paint'; }
    } else if (ptrs.size === 2) { if (mode === 'paint') strokeCancel(); mode = 'pinch'; lastPinch = null; }
  });
  el.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (mode === 'paint') { strokeMove(e.offsetX, e.offsetY); return; }
    if (mode === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()]; const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (lastPinch) { app.R.panBy(cx - lastPinch.cx, cy - lastPinch.cy); app.R.zoomAt(cx, cy, d / Math.max(1, lastPinch.d)); }
      lastPinch = { cx, cy, d }; return;
    }
    if (mode === 'maybe' && Math.hypot(e.offsetX - start.x, e.offsetY - start.y) > 7) mode = 'pan';
    if (mode === 'pan') app.R.panBy(e.offsetX - prev[0], e.offsetY - prev[1]);
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return; ptrs.delete(e.pointerId);
    if (mode === 'paint') { strokeEnd(); }
    else if (mode === 'maybe' && ptrs.size === 0) {
      const now = performance.now();
      if (now - lastTap < 300 && !paintTarget() && app.tool === 'pan' && app.mode === 'explore') app.R.zoomAt(start.x, start.y, 2);
      else onTap(start.x, start.y);
      lastTap = now;
    }
    if (ptrs.size === 0) mode = null; else if (ptrs.size === 1) { mode = 'pan'; lastPinch = null; }
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { e.preventDefault(); app.R.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
}

// ---------------------------------------------------------------- simulation loop
const SPEEDS = [0, 1, 4, 12, 48];
let acc = 0, lastT = 0, recolorAt = 0, refreshCost = 30, pendingOwner = false;
function simLoop(t) {
  requestAnimationFrame(simLoop);
  const dt = Math.min(0.25, (t - lastT) / 1000 || 0); lastT = t;
  if (!app.running) return;
  acc += dt * SPEEDS[app.speed];
  let n = 0, owner = false; const t0 = performance.now();
  while (acc >= 1 && performance.now() - t0 < 28) { acc -= 1; const ev = tick(app.W); owner = owner || ev.owner; n++; }
  if (acc > 3) acc = 0; // can't keep up: drop backlog
  if (!n) return;
  app.aggStamp++; dropWorldUndo();
  if (owner) { rebuildCatalogLite(); pendingOwner = true; }
  // recolour at a pace the device can afford; maps that the sim can't change only need it when borders move
  const th = theme(), gap = Math.max(250, refreshCost * 8);
  if (t - recolorAt > gap && (pendingOwner || !th.static)) {
    recolorAt = t; pendingOwner = false;
    const r0 = performance.now(); refresh(); refreshCost = refreshCost * 0.7 + (performance.now() - r0) * 0.3;
  }
  UI.onTick && UI.onTick();
}
// Once time moves on, undoing an old border/data stroke would resurrect stale state: keep only plan edits.
function dropWorldUndo() { if (app.undo.some((e) => e.tgt !== 'plan')) app.undo = app.undo.filter((e) => e.tgt === 'plan'); if (app.redo.length) app.redo = app.redo.filter((e) => e.tgt === 'plan'); }
export function step(months = 1) { for (let k = 0; k < months; k++) tick(app.W); app.aggStamp++; dropWorldUndo(); rebuildCatalogLite(); refresh(); UI.onTick && UI.onTick(); }
let lastCatalogN = 0;
function rebuildCatalogLite() { const n = app.W.nations.filter((x) => x && x.alive).length + app.W.nations.length * 1000; if (n !== lastCatalogN) { lastCatalogN = n; rebuildCatalog(); } }

boot();
