// Atlas Forge — core: rendering pipeline, input, painting, labels.
import { MapRenderer, mercX, mercY, unMercX, unMercY } from './gl.js';
import { loadData } from './data.js';
import { createWorld, computeAggregates, computeAdjacency, cellAt, cellLngLat, addNews, newNation } from './world.js';
import { tick, applyDisaster } from './sim.js';
import { buildCatalog, colorize, unitAgg } from './themes.js';
import { planStats, paintUnits, brushCells, floodUnits, eligible, districtVotes } from './plans.js';
import { getSlot, putSlot, serialize, deserialize } from './store.js';
import { TERRAIN_COLORS, clamp, h, hsl } from './util.js';
import * as UI from './panels.js';

export const app = {
  mode: 'explore', themeId: 'nations', running: false, speed: 1, show: { borders: true, cities: true, labels: true, grid: true },
  tool: 'pan', district: 0, brush: 2, paintNation: 0, dataAttr: 'dev', dataValue: 0.5, disaster: 'quake', editTool: 'borders',
  sel: null, undo: [], redo: [], aggStamp: 0,
};
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
    app.unitRGBA = { provinces: new Uint8Array(D.units.provinces.length * 4), counties: new Uint8Array(D.units.counties.length * 4) };
    app.R.addLineLayer('countries', D.geom.country.lpos, [0.92, 0.94, 1, 0.22], 0);
    setupCities();
    progress('Building the world…', 0.85);
    let W = null;
    try { const s = await getSlot('autosave'); if (s) { W = deserialize(D, s); app.resumed = true; } } catch (e) { console.warn('autosave load failed', e); }
    if (!W) W = createWorld(D, {});
    setWorld(W);
    app.R.onLabels = drawLabels;
    window.addEventListener('resize', () => app.R.resize());
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

function polyLayerShown() {
  const t = theme(), p = plan();
  if (app.mode === 'draw' && p && p.unit !== 'cells') return p.unit;
  return t.layer !== 'cells' ? t.layer : null;
}

// Recolour everything for the current mode / theme / plan.
export function refresh() {
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
  composeCells(land);
  // ---- polygon layers
  for (const L of ['provinces', 'counties']) app.R.polys[L].visible = poly === L;
  if (poly) {
    const units = poly === 'provinces' ? D.units.provinces : D.units.counties, arr = app.unitRGBA[poly];
    const tt = t.layer === poly ? t : app.catalog.find((x) => x.layer === poly);
    const lg = colorize(tt, null, units.length, tt.value, arr);
    if (t.layer === poly) app.legend = lg;
    if (p && p.unit === poly) overlayPlanUnits(p, arr);
    app.R.setPolyColors(poly, arr);
    app.R.polys[poly].alpha = 0.93;
  }
  app.R.opts.grid = app.show.grid;
  app.R.lines.countries.visible = app.show.borders;
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
      const d = cellPlan.assign[i];
      if (d >= 0) { const c = cellPlan.colors[d]; r = c[0]; g = c[1]; b = c[2]; }
      else if (eligible(W, cellPlan, i)) { r = r * 0.35 + 150; g = g * 0.35 + 152; b = b * 0.35 + 158; }
      else { r *= 0.45; g *= 0.45; b *= 0.5; }
      grp[o + 2] = (d + 1) & 255; grp[o + 3] = (d + 1) >> 8;
    } else { grp[o + 2] = 0; grp[o + 3] = 0; }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    const gv = gkey[i]; grp[o] = gv & 255; grp[o + 1] = gv >> 8;
  }
}
function overlayPlanUnits(p, arr) {
  const W = app.W;
  for (let u = 0; u < p.assign.length; u++) {
    const o = u * 4, d = p.assign[u];
    if (d >= 0) { const c = p.colors[d]; arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; arr[o + 3] = 255; }
    else if (eligible(W, p, u)) { arr[o] = arr[o] * 0.3 + 160; arr[o + 1] = arr[o + 1] * 0.3 + 162; arr[o + 2] = arr[o + 2] * 0.3 + 168; arr[o + 3] = 235; }
    else { arr[o] *= 0.4; arr[o + 1] *= 0.4; arr[o + 2] *= 0.45; arr[o + 3] = 150; }
  }
}
// Cheap update for a handful of cells (painting).
export function refreshCells(list) {
  if (app.cellColorOne) for (const i of list) app.cellColorOne(i, app.baseRGBA);
  composeCells(list);
  app.R.setCellColors(app.cellRGBA); app.R.setCellGroups(app.groupRGBA);
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
  if (p && app.planCentroids) for (const c of app.planCentroids) { if (!c) continue; const [x, y] = R.worldToScreen(c[0], c[1]); label(String(c[2] + 1), x, y, 15, '#fff', 800); }
  if (!app.show.labels) return;
  // nations
  if (theme().layer === 'cells' && app.mode !== 'draw') {
    const list = W.nations.filter((n) => n && n.alive && n.cells > 0).sort((a, b) => b.cells - a.cells);
    const pos = labelPositions();
    for (const n of list) {
      const span = Math.sqrt(n.cells) * cellPx; if (span < 26) continue;
      const size = clamp(span / 7, 10, 26);
      const lp = pos[n.id] || [n.cx, n.cy];
      const lat = 90 - (lp[1] + 0.5) * 180 / W.Hd, wx = (lp[0] + 0.5) / W.Wd, wy = mercY(lat);
      const [x, y] = R.worldToScreen(wx, wy);
      label(n.name.length > 22 && size < 14 ? (n.a3 || n.name.slice(0, 12)) : n.name, x, y, size, n.id === (app.sel && app.sel.nation) ? '#ffd65a' : '#f4f1ea', 700);
    }
  }
  // cities
  if (app.show.cities && scale > 900) {
    const lim = scale > 20000 ? 7000 : scale > 6000 ? 1500 : scale > 2500 ? 400 : 90;
    const C = app.D.units.cities;
    for (let k = 0; k < Math.min(lim, C.length); k++) {
      const c = C[k]; const [x, y] = R.worldToScreen(mercX(c.lng), mercY(c.lat));
      if (x < -50 || x > vw + 50 || y < -20 || y > vh + 20) continue;
      label(c.name, x + 0, y - 11, c.cap ? 12 : 11, c.cap ? '#ffe7a6' : '#e8ecf3', c.cap ? 700 : 500);
    }
  }
}

// Label anchor per nation: centroid of its land near the capital (ignores far-flung islands/colonies).
let lpCache = null, lpStamp = -1;
function labelPositions() {
  const W = app.W; if (lpCache && lpStamp === app.aggStamp) return lpCache;
  const nn = W.nations.length, sx = new Float64Array(nn), sy = new Float64Array(nn), c = new Float64Array(nn), R2 = new Float64Array(nn), cx = new Float64Array(nn), cy = new Float64Array(nn);
  for (let o = 1; o < nn; o++) { const n = W.nations[o]; if (!n.alive || n.capital < 0) continue; cx[o] = n.capital % W.Wd; cy[o] = (n.capital / W.Wd) | 0; const r = 2.2 * Math.sqrt(n.cells) + 4; R2[o] = r * r; }
  for (const i of W.land) {
    const o = W.owner[i]; if (!o || !R2[o]) continue;
    const y = (i / W.Wd) | 0; let dx = (i - y * W.Wd) - cx[o]; if (dx > W.Wd / 2) dx -= W.Wd; else if (dx < -W.Wd / 2) dx += W.Wd;
    const dy = y - cy[o]; if (dx * dx + dy * dy > R2[o]) continue;
    sx[o] += dx; sy[o] += dy; c[o]++;
  }
  lpCache = []; for (let o = 1; o < nn; o++) if (c[o]) lpCache[o] = [(cx[o] + sx[o] / c[o] + W.Wd) % W.Wd, cy[o] + sy[o] / c[o]];
  lpStamp = app.aggStamp; return lpCache;
}

// ---------------------------------------------------------------- selection
export function select(sel) { app.sel = sel; updateHighlight(); UI.refreshPanels(); app.R.dirty(); }
function updateHighlight() {
  const s = app.sel, R = app.R;
  if (!s) { R.setHighlight(null); return; }
  if (s.unit != null && s.layer) {
    const g = s.layer === 'provinces' ? app.D.geom.prov : app.D.geom.county; const out = [];
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
export function pickUnit(layer, wx, wy) {
  const g = layer === 'provinces' ? app.D.geom.prov : app.D.geom.county, B = 256;
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
    paintUnits(W, p, list, app.tool === 'erase' ? -1 : app.district, stroke.changes);
    const arr = app.unitRGBA[p.unit]; overlayPlanUnitsFor(p, arr, list); app.R.setPolyColors(p.unit, arr); scheduleStats();
    return;
  }
  const cells = new Set();
  for (const [x, y] of pts) { const i = cellAtScreen(x, y); if (i < 0) continue; for (const c of brushCells(W, i % W.Wd, (i / W.Wd) | 0, app.brush - 1)) cells.add(c); }
  const list = [...cells].filter((i) => W.D.cells.country[i]);
  if (!list.length) return;
  if (stroke.tgt === 'plan') { paintUnits(W, p, list, app.tool === 'erase' ? -1 : app.district, stroke.changes); scheduleStats(); }
  else if (stroke.tgt === 'borders') {
    for (const i of list) { if (W.owner[i] === app.paintNation) continue; if (!stroke.changes.has(i)) stroke.changes.set(i, W.owner[i]); W.owner[i] = app.paintNation; }
    if (app.paintNation && !W.nations[app.paintNation].alive) W.nations[app.paintNation].alive = true;
    stroke.dirtyNations = true;
  } else if (stroke.tgt === 'data') paintData(list);
  refreshCells(list);
}
function overlayPlanUnitsFor(p, arr, list) {
  for (const u of list) { const o = u * 4, d = p.assign[u]; if (d >= 0) { const c = p.colors[d]; arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; arr[o + 3] = 255; } else { arr[o] = 175; arr[o + 1] = 178; arr[o + 2] = 186; arr[o + 3] = 235; } }
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
      const ch = new Map(); paintUnits(W, p, floodUnits(W, p, u), app.district, ch);
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
  for (let q = 0; q < 640; q++) W.rel[n.id * 640 + q] = W.rel[o * 640 + q];
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
    const L = p.unit === 'provinces' ? W.D.units.provinces : null;
    const g = p.unit === 'provinces' ? app.D.geom.prov : app.D.geom.county;
    // use vertex means per unit (cached)
    const key = '_uc_' + p.unit; if (!app[key]) { const n = p.assign.length, x = new Float64Array(n), y = new Float64Array(n), c = new Float64Array(n); for (let v = 0; v < g.uid.length; v++) { const u = g.uid[v]; x[u] += g.pos[v * 2]; y[u] += g.pos[v * 2 + 1]; c[u]++; } app[key] = { x, y, c }; }
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
    } else if (ptrs.size === 2) { if (mode === 'paint') strokeEnd(); mode = 'pinch'; lastPinch = null; }
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
let acc = 0, lastT = 0, recolorAt = 0;
function simLoop(t) {
  requestAnimationFrame(simLoop);
  const dt = Math.min(0.25, (t - lastT) / 1000 || 0); lastT = t;
  if (!app.running) return;
  acc += dt * SPEEDS[app.speed];
  let n = 0, owner = false; const t0 = performance.now();
  while (acc >= 1 && performance.now() - t0 < 28) { acc -= 1; const ev = tick(app.W); owner = owner || ev.owner; n++; }
  if (acc > 3) acc = 0; // can't keep up: drop backlog
  if (!n) return;
  app.aggStamp++;
  if (owner) rebuildCatalogLite();
  if (t - recolorAt > 180 || owner) { recolorAt = t; refresh(); }
  UI.onTick && UI.onTick();
}
export function step(months = 1) { for (let k = 0; k < months; k++) tick(app.W); app.aggStamp++; rebuildCatalogLite(); refresh(); UI.onTick && UI.onTick(); }
let lastCatalogN = 0;
function rebuildCatalogLite() { const n = app.W.nations.filter((x) => x && x.alive).length + app.W.nations.length * 1000; if (n !== lastCatalogN) { lastCatalogN = n; rebuildCatalog(); } }

boot();
