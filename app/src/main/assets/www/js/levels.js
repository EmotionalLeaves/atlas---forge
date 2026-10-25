// Map levels in Explore: shows the real administrative areas of every country at the chosen level
// (1 = states/regions … 5 = municipalities/villages), loading only the countries in view.
import { levelList, readPack } from './precincts.js';
import { rampLUT, catColor, fmt, pct, clamp, hsl } from './util.js';
import { unMercX, unMercY, mercX, mercY } from './gl.js';
import { cellAt, prodOf } from './world.js';

const MAX_PACKS = 48;          // GPU layers kept at once
const VERT_BUDGET = 3.5e6;     // vertices in view before we stop loading more
export const LV = { level: 0, loaded: new Map(), loading: new Set(), want: [], mf: null, stamp: 0, note: '' };

export const LEVEL_THEMES = [
  { id: 'lv_name', label: 'Each area', kind: 'cat' },
  { id: 'lv_parent', label: 'Grouped by parent region', kind: 'cat' },
  { id: 'lv_pop', label: 'Population (estimated)', kind: 'num', ramp: 'inferno', log: true, fmt: (v) => fmt(v) },
  { id: 'lv_dens', label: 'Population density (estimated)', kind: 'num', ramp: 'inferno', log: true, fmt: (v) => fmt(v) + '/km²' },
  { id: 'lv_area', label: 'Area', kind: 'num', ramp: 'viridis', log: true, fmt: (v) => fmt(v) + ' km²' },
  { id: 'lv_nation', label: 'Nation in the simulation', kind: 'cat' },
  { id: 'lv_dev', label: 'Development (simulation)', kind: 'num', ramp: 'greens', domain: [0, 1], fmt: (v) => v.toFixed(2) },
  { id: 'lv_lean', label: 'Political lean (simulation)', kind: 'num', ramp: 'diverge', domain: [-0.8, 0.8], fmt: (v) => v.toFixed(2) },
];

export async function levelsAvailable() { if (!LV.mf) LV.mf = await levelList(); return LV.mf; }
// countries that have each level
export async function levelCoverage() {
  const mf = await levelsAvailable(), c = [0, 0, 0, 0, 0, 0];
  for (const m of mf) c[m.level]++; return c;
}

// Which pack parts should be visible for the current camera.
function wanted(app) {
  const R = app.R, mf = LV.mf || [];
  const [lw, ln] = R.screenToLngLat(0, 0), [le, ls] = R.screenToLngLat(R.vw / R.dpr, R.vh / R.dpr);
  let west = lw, east = le; const wrap = R.vw / R.cam.s >= 1; if (wrap) { west = -180; east = 180; }
  const hit = (b) => wrap || (b[2] >= west && b[0] <= east) || (east < west && (b[2] >= west || b[0] <= east));
  const byIso = new Map(); for (const m of mf) { if (!byIso.has(m.iso)) byIso.set(m.iso, []); byIso.get(m.iso).push(m); }
  const out = [];
  const [cxl, cyl] = R.screenToLngLat(R.vw / R.dpr / 2, R.vh / R.dpr / 2);
  for (const [iso, list] of byIso) {
    // the chosen level, or the deepest level this country has below it
    const m = list.filter((x) => x.level <= LV.level).sort((a, b) => b.level - a.level)[0]; if (!m) continue;
    for (const p of m.parts) {
      const b = p.bbox; if (!(b[3] <= ln && b[1] >= ls) || !hit(b)) continue;
      const d = Math.hypot((b[0] + b[2]) / 2 - cxl, (b[1] + b[3]) / 2 - cyl);
      out.push({ key: 'L:' + p.key, verts: p.verts || 1e5, dist: d, iso, level: m.level, levelName: m.levelName, title: m.title });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  let v = 0; const keep = [];
  for (const w of out) { if (keep.length >= MAX_PACKS || v + w.verts > VERT_BUDGET) break; v += w.verts; keep.push(w); }
  LV.note = keep.length < out.length ? `Showing ${keep.length} of ${out.length} areas in view — zoom in for the rest` : '';
  return keep;
}

let timer = 0;
export function scheduleLevelUpdate(app) { clearTimeout(timer); timer = setTimeout(() => updateLevels(app), 220); }
export async function setLevel(app, level) {
  LV.level = level; await levelsAvailable();
  if (!level) { for (const k of [...LV.loaded.keys()]) dropPack(app, k); app.R.polyOrder = app.R.polyOrder.filter((k) => !k.startsWith('lv:')); app.R.opts.hideBase = false; return; }
  if (!app.themeId.startsWith('lv_')) app.themeId = 'lv_name';
  updateLevels(app);
}
function dropPack(app, key) { app.R.removePolyLayer('lv:' + key); LV.loaded.delete(key); app.hitReset && app.hitReset('lv:' + key); }

export async function updateLevels(app) {
  if (!LV.level) return;
  const want = wanted(app), keys = new Set(want.map((w) => w.key));
  // drop far-away packs when over budget
  if (LV.loaded.size > MAX_PACKS * 0.75) for (const k of [...LV.loaded.keys()]) if (!keys.has(k) && LV.loaded.size > MAX_PACKS * 0.5) dropPack(app, k);
  const missing = want.filter((w) => !LV.loaded.has(w.key) && !LV.loading.has(w.key));
  app.onLevelStatus && app.onLevelStatus(missing.length ? `Loading ${missing.length} area file${missing.length > 1 ? 's' : ''}…` : LV.note);
  for (const w of missing) {
    LV.loading.add(w.key);
    readPack(w.key).then((P) => {
      LV.loading.delete(w.key); if (!LV.level) return;
      LV.loaded.set(w.key, P);
      const L = app.R.addPolyLayer('lv:' + w.key, P.geom); L.lineColor = [0.06, 0.07, 0.1, w.level >= 4 ? 0.35 : 0.55];
      if (!app.R.polyOrder.includes('lv:' + w.key)) app.R.polyOrder.push('lv:' + w.key);
      colorLevels(app); app.R.dirty();
      if (!LV.loading.size) app.onLevelStatus && app.onLevelStatus(LV.note);
    }).catch((e) => { LV.loading.delete(w.key); console.warn(e); });
  }
  colorLevels(app);
}

// value of the current theme for unit u of pack P
function valueFn(app, id) {
  const W = app.W;
  const cellOf = (P, u) => cellAt(W, unMercX(P.cx[u]), unMercY(P.cy[u]));
  switch (id) {
    case 'lv_pop': return (P, u) => P.pop[u];
    case 'lv_dens': return (P, u) => P.area[u] > 0 ? P.pop[u] / P.area[u] : NaN;
    case 'lv_area': return (P, u) => P.area[u];
    case 'lv_dev': return (P, u) => { const i = cellOf(P, u); return W.D.cells.country[i] ? W.dev[i] : NaN; };
    case 'lv_lean': return (P, u) => { const i = cellOf(P, u); return W.D.cells.country[i] ? W.lean[i] : NaN; };
    default: return null;
  }
}
export function colorLevels(app) {
  if (!LV.level) return;
  const t = LEVEL_THEMES.find((x) => x.id === app.themeId) || LEVEL_THEMES[0], W = app.W;
  const packs = [...LV.loaded.values()];
  let legend = null;
  if (t.kind === 'num') {
    const f = valueFn(app, t.id), tf = (v) => t.log ? Math.log10(Math.max(0, v) + 1) : v;
    let lo = Infinity, hi = -Infinity;
    if (t.domain) { lo = tf(t.domain[0]); hi = tf(t.domain[1]); }
    else { const s = []; for (const P of packs) for (let u = 0; u < P.count; u += Math.max(1, P.count >> 10)) { const v = tf(f(P, u)); if (isFinite(v)) s.push(v); } s.sort((a, b) => a - b); if (s.length) { lo = s[Math.floor(s.length * 0.02)]; hi = s[Math.floor(s.length * 0.98)]; } if (!(hi > lo)) { lo = 0; hi = 1; } }
    const lut = rampLUT(t.ramp);
    for (const P of packs) {
      const arr = new Uint8Array(P.count * 4);
      for (let u = 0; u < P.count; u++) { const v = tf(f(P, u)), o = u * 4; if (!isFinite(v)) { arr[o] = 74; arr[o + 1] = 76; arr[o + 2] = 82; arr[o + 3] = 230; continue; } const k = Math.round(clamp((v - lo) / (hi - lo), 0, 1) * 255); arr[o] = lut[k * 3]; arr[o + 1] = lut[k * 3 + 1]; arr[o + 2] = lut[k * 3 + 2]; arr[o + 3] = 240; }
      app.R.setPolyColors('lv:' + P.key, arr);
    }
    const un = (v) => t.log ? Math.pow(10, v) - 1 : v;
    legend = { type: 'ramp', ramp: t.ramp, min: un(lo), max: un(hi), mid: un((lo + hi) / 2), fmt: t.fmt };
  } else {
    for (const P of packs) {
      const arr = new Uint8Array(P.count * 4);
      for (let u = 0; u < P.count; u++) {
        let c;
        if (t.id === 'lv_nation') { const i = cellAt(W, unMercX(P.cx[u]), unMercY(P.cy[u])), n = W.nations[W.owner[i]]; c = n && n.alive ? n.color : [92, 100, 112]; }
        else if (t.id === 'lv_parent') { const pr = P.county[u]; c = pr === 65535 ? [110, 114, 122] : catColor((pr + 1) * 7 + (P.iso ? P.iso.charCodeAt(0) : 0)); }
        else c = catColor(u * 3 + 11 + (P.iso ? P.iso.charCodeAt(1) * 5 : 0));
        const o = u * 4; arr[o] = c[0]; arr[o + 1] = c[1]; arr[o + 2] = c[2]; arr[o + 3] = 235;
      }
      app.R.setPolyColors('lv:' + P.key, arr);
    }
    legend = { type: 'cat', items: [], total: 0 };
  }
  for (const P of packs) { const L = app.R.polys['lv:' + P.key]; if (L) { L.visible = true; L.alpha = 0.92; } }
  app.legend = legend; app.legend.levelTheme = t;
  app.R.dirty();
}

// Find the admin area under a world point (searches loaded packs).
export function pickLevel(app, wx, wy) {
  for (const P of LV.loaded.values()) {
    const [w, n, e, s] = [P.bbox[0], P.bbox[1], P.bbox[2], P.bbox[3]];
    const lng = unMercX(((wx % 1) + 1) % 1), lat = unMercY(wy);
    if (lng < w - 0.1 || lng > e + 0.1 || lat > n + 0.1 || lat < s - 0.1) continue;
    const u = app.pickUnitIn('lv:' + P.key, P.geom, wx, wy); if (u >= 0) return { P, u };
  }
  return null;
}
// names for the label layer: biggest areas first
export function levelLabels(app) {
  const out = []; for (const P of LV.loaded.values()) for (let u = 0; u < P.count; u++) out.push([P, u]);
  out.sort((a, b) => b[0].area[b[1]] - a[0].area[a[1]]);
  return out;
}
