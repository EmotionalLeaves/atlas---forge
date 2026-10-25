// Choose a place — continent › country › state/province › county — and show only that place, like
// Districtr's state view: everything outside is dimmed, the camera frames it, and painting stays inside.
import { h, fmt } from './util.js';
import { mercX, mercY } from './gl.js';

export const FOCUS = { cur: null };
let app = null, UI = null;
export function initPlaces(a, ui) { app = a; UI = ui; }

const continentsOf = (U) => {
  const m = new Map();
  U.countries.forEach((c, k) => { const ct = c.continent; if (!ct || /Antarctica|Seven seas/i.test(ct)) return; if (!m.has(ct)) m.set(ct, []); m.get(ct).push(k + 1); });
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};
const provsOf = (U, ci) => { const out = []; U.provinces.forEach((p, k) => { if (p.c === ci) out.push(k); }); return out.sort((a, b) => U.provinces[a].n.localeCompare(U.provinces[b].n)); };
const countiesOf = (U, state) => { const out = []; U.counties.forEach((c, k) => { if (c.s === state) out.push(k); }); return out.sort((a, b) => U.counties[a].n.localeCompare(U.counties[b].n)); };
const typeWord = (U, ids) => { const t = new Map(); for (const k of ids) { const x = U.provinces[k].t || 'Region'; t.set(x, (t.get(x) || 0) + 1); } const top = [...t.entries()].sort((a, b) => b[1] - a[1])[0]; const w = top ? top[0] : 'Region'; return /y$/.test(w) ? w.slice(0, -1) + 'ies' : /s$/.test(w) ? w : w + 's'; };
const isUSA = (U, ci) => U.countries[ci - 1] && U.countries[ci - 1].a3 === 'USA';

// ---- building a focus ----
function make(kind, name, sub, layer, ids, extra = {}) {
  return { kind, name, sub, layer, ids: new Set(ids), ...extra };
}
export function focusContinent(name) { const U = app.D.units, C = continentsOf(U).find((x) => x[0] === name); if (!C) return; const cs = new Set(C[1]); const ids = []; U.provinces.forEach((p, k) => { if (cs.has(p.c)) ids.push(k); }); setFocus(make('continent', name, 'Continent', 'provinces', ids, { countries: cs })); }
export function focusCountry(ci) { const U = app.D.units, c = U.countries[ci - 1]; setFocus(make('country', c.name, c.continent, 'provinces', provsOf(U, ci), { country: ci, a3: c.a3 })); }
export function focusProvince(pk) { const U = app.D.units, p = U.provinces[pk], c = U.countries[p.c - 1]; setFocus(make('province', p.n, `${p.t || 'Region'} · ${c ? c.name : ''}`, 'provinces', [pk], { country: p.c, a3: c && c.a3, province: pk })); }
export function focusCounty(k) { const U = app.D.units, c = U.counties[k]; setFocus(make('county', c.n, `${c.s} · United States`, 'counties', [k], { county: k, state: c.s, a3: 'USA', country: U.countries.findIndex((x) => x.a3 === 'USA') + 1 })); }
export function clearFocus() { setFocus(null); }

function setFocus(f) {
  FOCUS.cur = f; app.focus = f;
  if (UI.hideInfo && app.sel) UI.hideInfo(); // a card about somewhere else would be confusing
  const R = app.R;
  if (!f) { R.setFocus(null); R.setThickLines('focusEdge', null); UI.refreshPanels(); R.dirty(); return; }
  const g = f.layer === 'counties' ? app.D.geom.county : app.D.geom.prov;
  R.setFocus(f.layer, f.ids);
  // brass outline around the place; frame it
  const lines = [], noNb = g.noNb || 65535, bb = new Map();
  const grow = (u, a, b, c, d) => { let r = bb.get(u); if (!r) bb.set(u, r = [1, 1, 0, 0]); r[0] = Math.min(r[0], a, c); r[1] = Math.min(r[1], b, d); r[2] = Math.max(r[2], a, c); r[3] = Math.max(r[3], b, d); };
  for (let k = 0; k < g.luid.length; k += 2) {
    const u = g.luid[k], v = g.lnb[k], inU = f.ids.has(u), inV = v !== noNb && f.ids.has(v); if (!inU && !inV) continue;
    const a = g.lpos[k * 2], b = g.lpos[k * 2 + 1], c = g.lpos[k * 2 + 2], d = g.lpos[k * 2 + 3];
    if (inU) grow(u, a, b, c, d); if (inV) grow(v, a, b, c, d);
    if (inU && inV) continue;
    lines.push(a, b, c, d);
  }
  R.setThickLines('focusEdge', new Float32Array(lines), [0.95, 0.77, 0.42, 0.95], (s) => s < 800 ? 1.4 : 2.2, 9);
  f.bbox = mainland(f, bb);
  // in Edit, paint for whoever holds the middle of the place
  const C = app.D.cells, W = app.W, mid = [];
  for (let i = 0; i < C.admin1.length && mid.length < 1; i++) if (C.country[i] && cellInFocus(i)) mid.push(i);
  if (mid.length && W.owner[mid[0]]) app.paintNation = W.owner[mid[0]];
  frameFocus();
  UI.refreshPanels(); R.dirty();
}
// The part of a place worth framing: the cluster of areas around its most populous one, so France frames
// metropolitan France rather than the Atlantic between it and French Guiana, and the US the lower 48.
function mainland(f, bb) {
  const U = app.D.units, popOf = (u) => (f.layer === 'counties' ? U.counties[u] : U.provinces[u]) ? (f.layer === 'counties' ? U.counties[u] : U.provinces[u]).pop || 0 : 0;
  const unitOf = (u) => f.layer === 'counties' ? U.counties[u] : U.provinces[u];
  // leave out areas whose pieces are scattered (across the date line, or overseas parts lumped into one area):
  // their box is far bigger than the land they cover
  const spread = (u, r) => { const a = unitOf(u) && unitOf(u).area; if (!a) return false; const lat = (360 / Math.PI) * Math.atan(Math.exp((0.5 - (r[1] + r[3]) / 2) * 2 * Math.PI)) - 90, k = 40075 * Math.cos(lat * Math.PI / 180); return (r[2] - r[0]) * (r[3] - r[1]) * k * k > a * 40; };
  const all = [...bb.entries()].filter(([, r]) => r[2] - r[0] < 0.4 && r[2] >= r[0]);
  const items = all.filter(([u, r]) => !spread(u, r)).length ? all.filter(([u, r]) => !spread(u, r)) : all;
  if (!items.length) return null;
  // group the areas into clusters of near neighbours and frame the most populous cluster
  const gap = 0.013, left = new Set(items.map((x) => x[0])), boxOf = new Map(items);
  let best = null, total = 0;
  for (const [u] of items) total += popOf(u);
  for (const [seed] of items) {
    if (!left.has(seed)) continue; left.delete(seed);
    const box = boxOf.get(seed).slice(); let pop = popOf(seed), grew = true;
    while (grew) {
      grew = false;
      for (const u of left) {
        const r = boxOf.get(u);
        if (r[0] > box[2] + gap || r[2] < box[0] - gap || r[1] > box[3] + gap || r[3] < box[1] - gap) continue;
        left.delete(u); pop += popOf(u); box[0] = Math.min(box[0], r[0]); box[1] = Math.min(box[1], r[1]); box[2] = Math.max(box[2], r[2]); box[3] = Math.max(box[3], r[3]); grew = true;
      }
    }
    if (!best || pop > best.pop) best = { box, pop };
  }
  const box = best.box;
  if (total > 0 && best.pop < total * 0.4) { // scattered islands with no main part: frame them all
    for (const [, r] of items) { box[0] = Math.min(box[0], r[0]); box[1] = Math.min(box[1], r[1]); box[2] = Math.max(box[2], r[2]); box[3] = Math.max(box[3], r[3]); }
  }
  return box;
}
// Fit the camera to the chosen place (call again when panels open or close).
export function frameFocus() {
  const f = FOCUS.cur, R = app.R; if (!f || !f.bbox) return;
  const [x0, y0, x1, y1] = f.bbox; if (!(x1 > x0)) return;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  const lng = (x) => x * 360 - 180, lat = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
  R.fitBounds(lng(Math.max(0, x0 - pad)), lat(Math.min(1, y1 + pad)), lng(Math.min(1, x1 + pad)), lat(Math.max(0, y0 - pad)));
}
// Is a land cell inside the chosen place? (painting stays inside it)
export function cellInFocus(i) {
  const f = FOCUS.cur; if (!f) return true;
  const C = app.D.cells;
  if (f.layer === 'counties') return C.county[i] - 1 === f.county;
  return f.ids.has(C.admin1[i] - 1) || (f.kind !== 'province' && (f.countries ? f.countries.has(C.country[i]) : C.country[i] === f.country));
}
// Is a world point roughly inside the place? (for map labels)
export function pointInFocus(wx, wy) { const f = FOCUS.cur; if (!f || !f.bbox) return true; const b = f.bbox, m = Math.max(b[2] - b[0], b[3] - b[1]) * 0.05; wx = ((wx % 1) + 1) % 1; return wx >= b[0] - m && wx <= b[2] + m && wy >= b[1] - m && wy <= b[3] + m; }

// ---- the picker ----
export function openPlacePicker() {
  const U = app.D.units, body = h('div', { class: 'places' });
  const path = []; // [{kind, label, id}]
  const draw = () => {
    body.innerHTML = '';
    const crumbs = h('div', { class: 'crumbs' }, h('button', { onclick: () => { path.length = 0; draw(); } }, 'Earth'),
      ...path.map((p, i) => [h('span', null, '›'), h('button', { onclick: () => { path.length = i + 1; draw(); } }, p.label)]));
    body.append(crumbs);
    if (FOCUS.cur) body.append(h('button', { class: 'linkbtn', onclick: () => { clearFocus(); UI.closeModal(); } }, `Showing ${FOCUS.cur.name}. Show the whole world instead`));
    const top = path[path.length - 1];
    const show = (label, fn) => h('button', { class: 'btn primary wide', onclick: () => { fn(); UI.closeModal(); } }, `Show only ${label}`);
    const list = h('div', { class: 'tlist' });
    const rowBtn = (title, sub, onclick) => h('button', { class: 'titem', onclick }, h('span', null, title, sub ? h('small', { class: 'block' }, sub) : null), h('span', { class: 'chev' }, '›'));
    const search = h('input', { class: 'search', placeholder: 'Search…', oninput: () => { const q = search.value.toLowerCase(); list.querySelectorAll('.titem').forEach((e) => { e.style.display = e.textContent.toLowerCase().includes(q) ? '' : 'none'; }); } });
    if (!top) {
      body.append(h('p', { class: 'muted small' }, 'Pick a place to work on. Everything else is dimmed and painting stays inside it.'));
      for (const [ct, cs] of continentsOf(U)) list.append(rowBtn(ct, `${cs.length} countries`, () => { path.push({ kind: 'continent', label: ct, id: ct }); draw(); }));
    } else if (top.kind === 'continent') {
      body.append(show(top.label, () => focusContinent(top.id)), search);
      const cs = continentsOf(U).find((x) => x[0] === top.id)[1].slice().sort((a, b) => U.countries[a - 1].name.localeCompare(U.countries[b - 1].name));
      for (const ci of cs) { const c = U.countries[ci - 1], n = provsOf(U, ci).length; list.append(rowBtn(c.name, n > 1 ? `${n} ${typeWord(U, provsOf(U, ci)).toLowerCase()}` : fmt(c.pop) + ' people', () => { if (n > 1) { path.push({ kind: 'country', label: c.name, id: ci }); draw(); } else { focusCountry(ci); UI.closeModal(); } })); }
    } else if (top.kind === 'country') {
      const ids = provsOf(U, top.id);
      body.append(show(top.label, () => focusCountry(top.id)), h('div', { class: 'sec-t' }, typeWord(U, ids)), search);
      for (const k of ids) { const p = U.provinces[k], cn = isUSA(U, top.id) ? countiesOf(U, p.n).length : 0; list.append(rowBtn(p.n, cn ? `${cn} counties` : p.t, () => { if (cn > 1) { path.push({ kind: 'province', label: p.n, id: k }); draw(); } else { focusProvince(k); UI.closeModal(); } })); }
    } else if (top.kind === 'province') {
      const p = U.provinces[top.id];
      body.append(show(top.label, () => focusProvince(top.id)), h('div', { class: 'sec-t' }, 'Counties'), search);
      for (const k of countiesOf(U, p.n)) { const c = U.counties[k]; list.append(h('button', { class: 'titem', onclick: () => { focusCounty(k); UI.closeModal(); } }, h('span', null, c.n, h('small', { class: 'block' }, fmt(c.pop) + ' people')))); }
    }
    body.append(list);
  };
  // open where the current focus is
  const f = FOCUS.cur;
  if (f) {
    const ci = f.country, c = ci && U.countries[ci - 1];
    if (c) { path.push({ kind: 'continent', label: c.continent, id: c.continent }); if (f.kind !== 'country' && provsOf(U, ci).length > 1) path.push({ kind: 'country', label: c.name, id: ci }); }
    if (f.kind === 'county') { const pk = U.provinces.findIndex((p) => p.n === f.state && isUSA(U, p.c)); if (pk >= 0) path.push({ kind: 'province', label: f.state, id: pk }); }
    if (f.kind === 'country' || f.kind === 'continent') path.length = f.kind === 'continent' ? 0 : 1;
  }
  draw();
  UI.openModal('Choose a place', body);
}
