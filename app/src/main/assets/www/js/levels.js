// Map levels in Explore: shows the real administrative areas of every country at the chosen level
// (1 = states/regions … 5 = municipalities/villages), loading only the countries in view.
import { levelList, readPack } from './precincts.js';
import { rampLUT, catColor, fmt, pct, clamp, hsl } from './util.js';
import { unMercX, unMercY, mercX, mercY } from './gl.js';
import { cellAt, prodOf } from './world.js';

const MAX_PACKS = 48;          // GPU layers kept at once
const VERT_BUDGET = 2.5e6;     // vertices in view before we stop loading more
export const LV = { level: 0, loaded: new Map(), loading: new Set(), want: [], mf: null, stamp: 0, note: '' };

export const LEVEL_THEMES = [
  { id: 'lv_name', label: 'Each area', kind: 'cat' },
  { id: 'lv_parent', label: 'Grouped by parent region', kind: 'cat' },
  { id: 'lv_pop', label: 'Population (estimated)', kind: 'num', ramp: 'inferno', log: true, fmt: (v) => fmt(v) },
  { id: 'lv_dens', label: 'Population density (estimated)', kind: 'num', ramp: 'inferno', log: true, fmt: (v) => fmt(v) + '/km²' },
  { id: 'lv_area', label: 'Area', kind: 'num', ramp: 'viridis', log: true, fmt: (v) => fmt(v) + ' km²' },
  // real data where a pack has it (US census tracts / block groups / precincts)
  { id: 'lv_vote', label: 'Real election result', kind: 'num', ramp: 'partisan', domain: [0.2, 0.8], fmt: (v) => v >= 0.5 ? 'D +' + Math.round((v * 2 - 1) * 100) : 'R +' + Math.round((1 - v * 2) * 100), needs: 'votes' },
  { id: 'lv_r_White', label: 'Share White (census)', kind: 'num', ramp: 'blues', domain: [0, 1], fmt: pct, needs: 'race' },
  { id: 'lv_r_Black', label: 'Share Black (census)', kind: 'num', ramp: 'purples', domain: [0, 1], fmt: pct, needs: 'race' },
  { id: 'lv_r_Hispanic', label: 'Share Hispanic (census)', kind: 'num', ramp: 'ember', domain: [0, 1], fmt: pct, needs: 'race' },
  { id: 'lv_r_Asian', label: 'Share Asian (census)', kind: 'num', ramp: 'greens', domain: [0, 1], fmt: pct, needs: 'race' },
];
// themes worth offering for what is loaded right now
export function levelThemesNow() {
  const P = [...LV.loaded.values()], race = P.some((x) => x.race && x.race.length), votes = P.some((x) => x.elections && x.elections.length);
  return LEVEL_THEMES.filter((t) => !t.needs || (t.needs === 'race' ? race : votes));
}

export async function levelsAvailable() { if (!LV.mf) LV.mf = await levelList(); return LV.mf; }
// countries that have each level
export async function levelCoverage() {
  const mf = await levelsAvailable(), c = [0, 0, 0, 0, 0, 0];
  for (const m of mf) c[m.level]++; return c;
}

// Which pack parts should be visible for the current camera.
function wanted(app) {
  const R = app.R, mf = LV.mf || [];
  const padB = (R.pad && R.pad.b) || 0, padL = (R.pad && R.pad.l) || 0;
  const [lw, ln] = R.screenToLngLat(padL, 0), [le, ls] = R.screenToLngLat(R.vw / R.dpr, R.vh / R.dpr - padB);
  let west = lw, east = le; const wrap = R.vw / R.cam.s >= 1; if (wrap) { west = -180; east = 180; }
  const hit = (b) => wrap || (b[2] >= west && b[0] <= east) || (east < west && (b[2] >= west || b[0] <= east));
  const byIso = new Map(); for (const m of mf) { if (!byIso.has(m.iso)) byIso.set(m.iso, []); byIso.get(m.iso).push(m); }
  const out = [];
  const [cxl, cyl] = R.screenToLngLat(...R.visibleCenter);
  for (const [iso, list] of byIso) {
    // the chosen level, or the deepest level this country has below it
    const m = list.filter((x) => x.level <= LV.level).sort((a, b) => b.level - a.level)[0]; if (!m) continue;
    for (const p of m.parts) {
      const b = p.bbox; if (!(b[3] >= ls && b[1] <= ln) || !hit(b)) continue; // bbox = [west, south, east, north]
      if (p.cov && !wrap && !covHit(p.cov, west, ls, east, ln)) continue; // bbox overlaps but the land itself is elsewhere
      const dx = cxl < b[0] ? b[0] - cxl : cxl > b[2] ? cxl - b[2] : 0, dy = cyl < b[1] ? b[1] - cyl : cyl > b[3] ? cyl - b[3] : 0;
      const d = Math.hypot(dx * Math.cos(cyl * Math.PI / 180), dy);
      out.push({ key: p.pk || 'L:' + p.key, verts: p.verts || 1e5, dist: d, iso, level: m.level, levelName: m.levelName, title: p.title || m.title });
    }
  }
  out.sort((a, b) => a.dist - b.dist);
  let v = 0; const keep = [];
  for (const w of out) { if (keep.length >= MAX_PACKS) break; if (keep.length && v + w.verts > VERT_BUDGET) continue; v += w.verts; keep.push(w); }
  LV.note = keep.length < out.length ? `Showing ${keep.length} of ${out.length} areas in view — zoom in for the rest` : '';
  return keep;
}

// does a pack's 10° coverage grid touch the view?
function covHit(hex, w, s, e, n) {
  const gy0 = Math.max(0, Math.floor((90 - n) / 10)), gy1 = Math.min(17, Math.floor((90 - s) / 10));
  const cols = []; const add = (a, b) => { for (let gx = Math.max(0, Math.floor((a + 180) / 10)); gx <= Math.min(35, Math.floor((b + 180) / 10)); gx++) cols.push(gx); };
  if (e >= w) add(w, e); else { add(w, 180); add(-180, e); }
  for (let gy = gy0; gy <= gy1; gy++) for (const gx of cols) { const k = gy * 36 + gx; if (parseInt(hex[(k >> 3) * 2] + hex[(k >> 3) * 2 + 1], 16) & (1 << (k & 7))) return true; }
  return false;
}

let timer = 0;
export function scheduleLevelUpdate(app) { clearTimeout(timer); timer = setTimeout(() => updateLevels(app), 220); }
export async function setLevel(app, level) {
  LV.level = level; await levelsAvailable();
  for (const k of [...LV.loaded.keys()]) dropPack(app, k);
  if (!level) { LV.note = ''; app.R.polyOrder = app.R.polyOrder.filter((k) => !k.startsWith('lv:')); app.R.opts.hideBase = false; return; }
  if (!app.themeId.startsWith('lv_')) app.themeId = 'lv_name';
  updateLevels(app);
}
function dropPack(app, key) { app.R.removePolyLayer('lv:' + key); LV.loaded.delete(key); app.hitReset && app.hitReset('lv:' + key); }

export async function updateLevels(app) {
  if (!LV.level || app.mode === 'draw') return;
  const want = wanted(app), keys = new Set(want.map((w) => w.key));
  // drop far-away packs when over budget
  // keep only what is wanted now (plus a few recent ones) so memory and drawing stay light
  let extra = [...LV.loaded.keys()].filter((k) => !keys.has(k)); while (extra.length > 6) dropPack(app, extra.shift());
  const missing = want.filter((w) => !LV.loaded.has(w.key) && !LV.loading.has(w.key));
  app.onLevelStatus && app.onLevelStatus(missing.length ? `Loading ${missing.length} area file${missing.length > 1 ? 's' : ''}…` : LV.note);
  for (const w of missing) {
    LV.loading.add(w.key);
    readPack(w.key).then((P) => {
      LV.loading.delete(w.key); if (!LV.level || w.level > LV.level) return;
      if (P.kind !== 'admin') { P.levelName = w.levelName; P.level = w.level; P.iso = w.iso; } // precinct packs shown as a level
      LV.loaded.set(w.key, P);
      const L = app.R.addPolyLayer('lv:' + w.key, P.geom); L.lineColor = [0.06, 0.07, 0.1, w.level >= 4 ? 0.35 : 0.55];
      if (!app.R.polyOrder.includes('lv:' + w.key)) app.R.polyOrder.push('lv:' + w.key);
      colorLevels(app); app.R.dirty(); app.onLegend && app.onLegend();
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
    case 'lv_vote': return (P, u) => { const e = P.elections && P.elections[0]; if (!e) return NaN; const t = e.d[u] + e.r[u]; return t > 0 ? e.d[u] / t : NaN; };
    default:
      if (id.startsWith('lv_r_')) { const lab = id.slice(5); return (P, u) => { const r = P.race && P.race.find((x) => x.label === lab); return r && P.pop[u] > 0 ? r.data[u] / P.pop[u] : NaN; }; }
      return null;
  }
}
export function colorLevels(app) {
  if (!LV.level || app.mode === 'draw') return;
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
    const [w, s, e, n] = P.bbox;
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
