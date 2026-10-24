// Atlas Forge — UI panels.
import { h, fmt, pct, dateOf, esc, hex, parseHex, hsl, clamp, PARTY_COLORS, rampLUT, RAMPS } from './util.js';
import { saveSettings, applyMapStyle } from './app.js';
import { BASEMAPS } from './basemap.js';
import { app, setTheme, refresh, theme, plan, select, undoRedo, scheduleStats, computePlanStats, rebuildCatalog, setWorld, step, autosave, viewHistory, restoreHistory } from './app.js';
import { rel, setRel, computeAggregates, computeAdjacency, newNation, cellLngLat, addNews, GOVS, prodOf, MAXN, warBetween } from './world.js';
import { declareWar, endWar, annex, DISASTERS } from './sim.js';
import { newPlan, setDistrictCount, autoFill, randomPlan, UNIT_TYPES, planStats, unitCenter } from './plans.js';
import { FORMULA_VARS, compileFormula, unitAgg } from './themes.js';
import { listSlots, getSlot, putSlot, delSlot, serialize, deserialize, exportBlob, importBlob } from './store.js';
import { createWorld } from './world.js';
import { mercX, mercY } from './gl.js';
import { cellAt } from './world.js';

const $ = (s) => document.querySelector(s);
let infoOpen = false;

const ICON = {
  explore: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>',
  draw: '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/></svg>',
  sim: '<svg viewBox="0 0 24 24"><path d="M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8s8 3 8 8"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M5 19L15 9M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  home: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 5 4 5M16 6h4c0 3-2 5-4 5M12 13v4M8 20h8"/></svg>',
};
const icon = (k) => h('span', { class: 'ic', html: ICON[k] });

export function init() {
  const tabs = $('#tabs');
  for (const [m, label, ic] of [['explore', 'Explore', 'explore'], ['draw', 'Draw', 'draw'], ['sim', 'Simulate', 'sim'], ['edit', 'God mode', 'edit']]) {
    tabs.append(h('button', { 'data-mode': m, onclick: () => setMode(m) }, icon(ic), h('span', null, label)));
  }
  $('#menuBtn').innerHTML = ICON.menu; $('#menuBtn').onclick = openMenu;
  $('#themeBtn').onclick = openThemeBrowser;
  const fl = $('#floating');
  fl.append(h('button', { class: 'fab', 'aria-label': 'Search places', onclick: openSearch, html: ICON.search }),
    h('button', { class: 'fab', 'aria-label': 'Zoom in', onclick: () => app.R.zoomAt(...app.R.visibleCenter, 2), html: ICON.plus }),
    h('button', { class: 'fab', 'aria-label': 'Zoom out', onclick: () => app.R.zoomAt(...app.R.visibleCenter, 0.5), html: ICON.minus }),
    h('button', { class: 'fab', 'aria-label': 'Whole world', onclick: () => app.R.flyTo(15, 25, 1), html: ICON.home }));
  // keep track of how much of the map the sheet covers so the camera frames the visible part
  const sheet = $('#sheet');
  const updPad = () => {
    const r = sheet.getBoundingClientRect(), wide = window.innerWidth >= 760;
    app.R.pad = wide ? { l: r.right, b: 0 } : { l: 0, b: Math.max(0, window.innerHeight - r.top) };
    $('#attr').style.bottom = (wide ? 6 : app.R.pad.b + 4) + 'px';
  };
  if (window.ResizeObserver) new ResizeObserver(updPad).observe(sheet);
  window.addEventListener('resize', updPad); sheet.addEventListener('transitionend', updPad); updPad();
  requestAnimationFrame(() => { updPad(); app.R.flyTo(15, 25, 1); });
  $('#sheet .grab').onclick = () => $('#sheet').classList.toggle('collapsed');
  window.atlasBack = () => {
    if (!$('#modal').classList.contains('hidden')) { closeModal(); return true; }
    if (infoOpen) { hideInfo(); return true; }
    if (app.running) { app.running = false; refreshPanels(); return true; }
    if (app.mode !== 'explore') { setMode('explore'); return true; }
    autosave(); return false;
  };
  setMode('explore');
}

export function setMode(m) {
  if (m === 'draw' && app.mode !== 'draw') { app.tool = plan() ? 'brush' : 'pan'; }
  else if (m !== 'draw' && m !== 'edit') app.tool = 'pan';
  if (m === 'edit' && app.mode !== 'edit') app.tool = 'pan';
  if (m !== 'sim' && app.histOwner) viewHistory(null);
  app.mode = m;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  document.body.dataset.mode = m;
  $('#sheet').classList.remove('collapsed');
  if (m === 'draw') computePlanStats();
  refresh(); refreshPanels();
}

export const dateLabel = () => app.histOwner ? `Borders of ${app.W.startYear + Math.floor(app.histMonth / 12)}` : dateOf(app.W.month, app.W.startYear);
export function toast(text, ms = 2600) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ render
export function refreshPanels() {
  $('#date').textContent = dateLabel();
  const t = theme(); $('#themeBtn').innerHTML = ''; $('#themeBtn').append(h('span', { class: 'swatch ' + (t.kind === 'cat' ? 'cat' : '') , style: { background: swatchBg(t) } }), h('span', { class: 'tl' }, t.label), h('span', { class: 'caret' }, '▾'));
  const body = $('#sheetBody'); const scroll = body.scrollTop; body.innerHTML = '';
  if (infoOpen && app.sel) body.append(infoCard());
  if (app.mode === 'explore') renderExplore(body);
  else if (app.mode === 'sim') renderSim(body);
  else if (app.mode === 'draw') renderDraw(body);
  else renderEdit(body);
  body.scrollTop = scroll;
}
function swatchBg(t) { const r = RAMPS[t.ramp || 'viridis']; return t.kind === 'cat' ? 'conic-gradient(#e0607e 0 25%,#ecba40 0 50%,#26a096 0 75%,#6a8fd8 0)' : `linear-gradient(90deg, ${r.join(',')})`; }

export function onTick() {
  $('#date').textContent = dateLabel();
  if (app.mode === 'sim') {
    const yr = Math.floor(app.W.month / 12);
    if (yr !== app._shownYear && !document.activeElement?.matches('input,select,textarea')) { app._shownYear = yr; refreshPanels(); return; }
    const ws = $('#worldStats'); if (ws) ws.replaceWith(worldStats());
    const ic = $('#infoCard'); if (ic && app.sel) ic.replaceWith(infoCard());
  }
}
export function onNews(n) {
  const feed = $('#news'); if (!feed || app.mode !== 'sim') return;
  feed.prepend(newsItem(n)); while (feed.children.length > 60) feed.lastChild.remove();
}

const row = (k, v) => h('div', { class: 'kv' }, h('span', null, k), h('b', null, v));
const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, onclick }, label);
const seg = (opts, cur, on) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: v === cur ? 'on' : '', onclick: () => on(v) }, l)));
const toggle = (label, val, on) => h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: !!val, onchange: (e) => on(e.target.checked) }), h('i'), label);
const section = (title, ...kids) => h('div', { class: 'sec' }, title ? h('div', { class: 'sec-t' }, title) : null, ...kids);
const dot = (c) => h('span', { class: 'dot', style: { background: hex(c) } });

function legendEl() {
  const L = app.legend; const t = theme();
  if (t.id === 'nations' || t.id === 'c_country') {
    const W = app.W, alive = W.nations.filter((n) => n && n.alive && n.cells > 0).length;
    return h('div', { class: 'legend nat' }, h('span', null, t.id === 'nations' ? `${alive} nations today${W.wars.length ? ` · ${W.wars.length} at war` : ''}` : `${W.D.units.countries.length} countries as of 2026`), btn('Rankings ›', () => openRankings('pop'), 'sm'));
  }
  if (!L || t.noLegend) return h('div', { class: 'legend muted' }, t.desc || 'Each colour is a different area');
  if (L.type === 'ramp') {
    const c = h('canvas', { width: 256, height: 1, class: 'ramp' }); const x = c.getContext('2d'); const img = x.createImageData(256, 1); const lut = rampLUT(L.ramp);
    for (let i = 0; i < 256; i++) { const k = L.invert ? 255 - i : i; img.data.set([lut[k * 3], lut[k * 3 + 1], lut[k * 3 + 2], 255], i * 4); } x.putImageData(img, 0, 0);
    return h('div', { class: 'legend' }, c, h('div', { class: 'ticks' }, h('span', null, L.fmt(L.min)), h('span', null, L.fmt(L.mid)), h('span', null, L.fmt(L.max))), t.desc ? h('div', { class: 'muted small' }, t.desc) : null);
  }
  return h('div', { class: 'legend cats' }, L.items.map((it) => h('span', { class: 'li' }, dot(it.color), it.label)), L.total > L.items.length ? h('span', { class: 'muted small' }, `+${L.total - L.items.length} more`) : null);
}
function quickThemes(ids) {
  return h('div', { class: 'chips' }, ids.map(([id, l]) => h('button', { class: 'chip-s' + (app.themeId === id ? ' on' : ''), onclick: () => setTheme(id) }, l)));
}

// ------------------------------------------------------------------ explore
export function mapStyleSection() {
  const st = app.settings, online = st.basemap !== 'none';
  const out = h('b', null, Math.round(st.opacity * 100) + '%');
  return section('Base map',
    h('div', { class: 'chips' }, Object.entries(BASEMAPS).map(([k, b]) => h('button', { class: 'chip-s' + (st.basemap === k ? ' on' : ''), onclick: () => { st.basemap = k; saveSettings(); applyMapStyle(); refreshPanels(); } }, b.label))),
    online ? h('label', { class: 'slider' }, 'Overlay', h('input', { type: 'range', min: 0, max: 1, step: 0.02, value: st.opacity, oninput: (e) => { st.opacity = +e.target.value; out.textContent = Math.round(st.opacity * 100) + '%'; app.R.opts.opacity = st.opacity; app.R.dirty(); }, onchange: saveSettings }), out) : null,
    online && BASEMAPS[st.basemap].labels ? toggle('Place names on top', st.mapLabels, (v) => { st.mapLabels = v; saveSettings(); applyMapStyle(); }) : null,
    online ? h('div', { class: 'muted small' }, 'Online map — needs internet. Built-in works offline.') : null);
}
function welcomeCard() {
  let seen = false; try { seen = localStorage.getItem('af_welcome') === '1'; } catch {}
  if (seen) return null;
  const close = () => { try { localStorage.setItem('af_welcome', '1'); } catch {} refreshPanels(); };
  return h('div', { class: 'card welcome' }, h('button', { class: 'x', onclick: close }, '×'),
    h('h3', null, 'Welcome to Atlas Forge'),
    h('div', { class: 'tips' },
      h('p', null, h('b', null, 'Explore'), ' — colour the real world by hundreds of maps. Tap anything for details; 🔍 finds any place.'),
      h('p', null, h('b', null, 'Draw'), ' — paint your own districts from grid cells, provinces or US counties, like Districtr.'),
      h('p', null, h('b', null, 'Simulate'), ' — press ▶ and history unfolds: wars, alliances, rebellions, elections.'),
      h('p', null, h('b', null, 'God mode'), ' — repaint borders, rewrite data, declare wars, drop meteors.')),
    btn('Got it', close, 'primary wide'));
}
function renderExplore(b) {
  const wc = welcomeCard(); if (wc) b.append(wc);
  b.append(section(null, legendEl()));
  b.append(section('Quick maps', quickThemes([['nations', 'Nations'], ['density', 'Density'], ['dev', 'Development'], ['lean', 'Politics'], ['terrain', 'Terrain'], ['c_country', 'Real countries'], ['c_gdppc', 'Wealth'], ['p_name', 'Provinces'], ['k_pop', 'US counties'], ['climate', 'Climate']]),
    btn(`Browse all ${app.catalog.length.toLocaleString()} maps…`, openThemeBrowser, 'wide primary')));
  b.append(mapStyleSection());
  b.append(section('Show', h('div', { class: 'tog-row' },
    toggle('Real borders', app.show.borders, (v) => { app.show.borders = v; refresh(); }),
    toggle('Cities', app.show.cities, (v) => { app.show.cities = v; applyMapStyle(); }),
    toggle('Labels', app.show.labels, (v) => { app.show.labels = v; app.R.dirty(); }),
    toggle('Cell grid', app.show.grid, (v) => { app.show.grid = v; refresh(); }))));
  const W = app.W;
  b.append(h('p', { class: 'muted small' }, `${W.land.length.toLocaleString()} land cells · ${W.D.units.provinces.length.toLocaleString()} provinces · ${W.D.units.counties.length.toLocaleString()} US counties · ${W.D.units.cities.length.toLocaleString()} cities. Tap anything for details; pinch to zoom.`));
}

// ------------------------------------------------------------------ info card
export function showInfo() { infoOpen = true; refreshPanels(); $('#sheet').classList.remove('collapsed'); $('#sheetBody').scrollTop = 0; }
export function hideInfo() { infoOpen = false; select(null); }
function spark(values, color, w = 140, hgt = 34) {
  const c = h('canvas', { width: w * 2, height: hgt * 2, class: 'spark', style: { width: w + 'px', height: hgt + 'px' } });
  if (values.length < 2) return c;
  const x = c.getContext('2d'); const lo = Math.min(...values), hi = Math.max(...values), sp = hi - lo || 1;
  x.strokeStyle = color; x.lineWidth = 3; x.beginPath();
  values.forEach((v, k) => { const px = k / (values.length - 1) * (w * 2 - 4) + 2, py = hgt * 2 - 4 - (v - lo) / sp * (hgt * 2 - 8); k ? x.lineTo(px, py) : x.moveTo(px, py); });
  x.stroke(); return c;
}
function nationBlock(n) {
  const W = app.W;
  if (!n || !n.alive) return h('div', { class: 'muted' }, 'Unclaimed land');
  const wars = W.wars.filter((w) => w.a === n.id || w.b === n.id).map((w) => W.nations[w.a === n.id ? w.b : w.a].name);
  const bloc = n.bloc ? W.blocs[n.bloc] : null;
  const el = h('div', { class: 'nation' },
    row('Government', n.gov), row('Population', fmt(n.pop)), row('GDP', '$' + fmt(n.gdp * 1e6)), row('GDP per person', '$' + fmt(n.pop ? n.gdp * 1e6 / n.pop : 0)),
    row('Military', fmt(n.mil)), h('div', { class: 'kv' }, h('span', null, 'Stability'), h('span', { class: 'bar' }, h('i', { style: { width: pct(n.stab), background: n.stab > 0.5 ? '#5fbf7a' : n.stab > 0.28 ? '#e8b448' : '#e2583c' } }))),
    n.exh > 0.02 ? row('War exhaustion', pct(n.exh)) : null, row('Territory', `${n.cells.toLocaleString()} cells${n.occ > 0.01 ? ` (${pct(n.occ)} occupied)` : ''}`),
    bloc ? row('Alliance', bloc.name) : null,
    wars.length ? h('div', { class: 'kv war' }, h('span', null, 'At war with'), h('b', null, wars.join(', '))) : null,
    n.gov === 'Republic' ? h('div', { class: 'parties' }, n.parties.map((p, k) => h('span', { class: 'party' + (k === n.ruling ? ' rule' : '') }, dot(PARTY_COLORS[k]), p.name, n.votes ? ` ${Math.round(n.votes[k] * 100)}%` : ''))) : null,
  );
  if (n.hist && n.hist.pop.length > 1) el.append(h('div', { class: 'sparks' }, h('div', null, h('small', null, 'Population'), spark(n.hist.pop, '#f1a03a')), h('div', null, h('small', null, 'Territory'), spark(n.hist.cells, '#6ab0e8'))));
  return el;
}
function infoCard() {
  const s = app.sel, W = app.W, U = W.D.units, C = W.D.cells;
  const card = h('div', { class: 'card', id: 'infoCard' });
  const close = h('button', { class: 'x', onclick: hideInfo }, '×');
  if (s.unit != null && s.layer) {
    const p = plan();
    const agg = unitAgg(app, s.layer);
    if (s.layer === 'provinces') {
      const u = U.provinces[s.unit];
      card.append(close, h('h3', null, u.n), h('div', { class: 'sub' }, `${u.t || 'Province'} · ${U.countries[u.c - 1] ? U.countries[u.c - 1].name : ''}`),
        row('Population (2026)', fmt(u.pop)), row('Area', fmt(u.area) + ' km²'), row('Density', u.area ? fmt(u.pop / u.area) + '/km²' : '—'),
        row('Controlled by', W.nations[agg.owner[s.unit]] ? W.nations[agg.owner[s.unit]].name : '—'), row('Development', isFinite(agg.dev[s.unit]) ? agg.dev[s.unit].toFixed(2) : '—'), row('Political lean', isFinite(agg.lean[s.unit]) ? leanText(agg.lean[s.unit]) : '—'));
    } else {
      const u = U.counties[s.unit];
      card.append(close, h('h3', null, u.n), h('div', { class: 'sub' }, u.s + ' · FIPS ' + u.fips),
        row('Population (Census)', fmt(u.pop)), row('Area', fmt(u.area) + ' km²'), row('Density', u.area ? fmt(u.pop / u.area) + '/km²' : '—'),
        u.min != null ? row('Minority', u.min.toFixed(1) + '%') : null, u.blk != null ? row('Black', u.blk.toFixed(1) + '%') : null, u.his != null ? row('Hispanic', u.his.toFixed(1) + '%') : null,
        row('Political lean (sim)', isFinite(agg.lean[s.unit]) ? leanText(agg.lean[s.unit]) : '—'));
    }
    if (p && p.unit === s.layer) card.append(row('District', p.assign[s.unit] >= 0 ? String(p.assign[s.unit] + 1) : 'Unassigned'));
    return card;
  }
  const i = s.cell, n = W.nations[W.owner[i]], [lng, lat] = cellLngLat(W, i);
  const cty = U.countries[C.country[i] - 1], prov = C.admin1[i] ? U.provinces[C.admin1[i] - 1] : null, county = C.county[i] ? U.counties[C.county[i] - 1] : null;
  card.append(close, h('h3', null, n && n.alive ? [dot(n.color), n.name] : 'Unclaimed'),
    h('div', { class: 'sub' }, `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'} · ${U.terrains[W.terrain[i]]}${C.flags[i] & 1 ? ' · river' : ''}`),
    h('div', { class: 'grid2' },
      row('Cell population', fmt(W.pop[i])), row('Density', fmt(W.pop[i] / W.area[(i / W.Wd) | 0]) + '/km²'),
      row('Development', W.dev[i].toFixed(2)), row('Income', '$' + fmt(prodOf(W.dev[i]))),
      row('Political lean', leanText(W.lean[i])), row('Since 2026', W.pop0[i] ? ((W.pop[i] / W.pop0[i] - 1) * 100).toFixed(0) + '%' : '—')),
    h('div', { class: 'sub' }, [prov ? prov.n : null, county ? county.n : null, cty ? (cty.name !== (n && n.name) ? 'historically ' + cty.name : cty.name) : null].filter(Boolean).join(' · ')),
  );
  for (const [k, arr] of Object.entries(W.custom)) card.append(row(k, fmt(arr[i], 2)));
  if (n && n.alive) {
    card.append(nationBlock(n));
    card.append(h('div', { class: 'btns' },
      btn('Relations map', () => setTheme('rel_' + n.id)),
      btn('Zoom to', () => zoomToNation(n)),
      app.mode === 'edit' ? btn('Paint as this', () => { app.paintNation = n.id; app.editTool = 'borders'; app.tool = 'brush'; refreshPanels(); }) : null));
  }
  return card;
}
const leanText = (v) => v < -0.05 ? `Left ${Math.round(-v * 100)}` : v > 0.05 ? `Right ${Math.round(v * 100)}` : 'Centre';
export function zoomToNation(n) {
  const W = app.W; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; const cx = n.cx;
  for (const i of W.land) { if (W.owner[i] !== n.id) continue; let x = i % W.Wd; if (x - cx > W.Wd / 2) x -= W.Wd; if (cx - x > W.Wd / 2) x += W.Wd; const y = (i / W.Wd) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x0 > x1) return;
  const d = 360 / W.Wd; app.R.fitBounds(-180 + x0 * d, 90 - (y1 + 1) * d, -180 + (x1 + 1) * d, 90 - y0 * d);
}

// ------------------------------------------------------------------ simulate
function worldStats() {
  const W = app.W; let pop = 0, alive = 0; for (const n of W.nations) if (n && n.alive) { pop += n.pop; alive++; }
  return h('div', { id: 'worldStats', class: 'stats3' },
    h('button', { onclick: () => openRankings('pop') }, h('b', null, fmt(pop, 2)), h('small', null, 'people ›')),
    h('button', { onclick: () => openRankings('gdp') }, h('b', null, alive), h('small', null, 'nations ›')),
    h('button', { class: W.wars.length ? 'hot' : '', onclick: openWars }, h('b', null, W.wars.length), h('small', null, 'wars ›')));
}
function openWars() {
  const W = app.W;
  const body = h('div', { class: 'tlist' });
  if (!W.wars.length) body.append(h('p', { class: 'muted' }, 'The world is at peace. Nations go to war when relations sour between neighbours — or declare one yourself in God mode → Diplomacy.'));
  for (const w of W.wars) {
    const A = W.nations[w.a], B = W.nations[w.b];
    const lead = w.ga === w.gb ? 'Stalemate' : `${(w.ga > w.gb ? A : B).name} ahead`;
    body.append(h('button', { class: 'titem', onclick: () => { closeModal(); select({ cell: B.capital, nation: B.id }); zoomBoth(A, B); setTheme('n_war'); } },
      dot(A.color), h('span', null, `${A.name} vs ${B.name}`, h('small', { class: 'block' }, `Since ${dateOf(w.start, W.startYear)} · ${lead} · ${w.ga}–${w.gb} cells taken`)), dot(B.color)));
  }
  openModal('Wars', body);
}
function zoomBoth(A, B) {
  const W = app.W; const lp = [A, B].map((n) => cellLngLat(W, n.capital >= 0 ? n.capital : n.topCell));
  let [l1, a1] = lp[0], [l2, a2] = lp[1]; if (Math.abs(l1 - l2) > 180) { if (l1 < l2) l1 += 360; else l2 += 360; }
  app.R.fitBounds(Math.min(l1, l2) - 8, Math.min(a1, a2) - 6, Math.max(l1, l2) + 8, Math.max(a1, a2) + 6);
}
function newsItem(n) {
  const W = app.W;
  return h('div', { class: 'news ' + n.k, onclick: () => { const id = n.n && n.n[0]; const nat = W.nations[id]; if (nat && nat.alive) { select({ cell: nat.capital, nation: id }); zoomToNation(nat); showInfo(); } } },
    h('small', null, dateOf(n.m, W.startYear)), h('span', null, n.t));
}
function renderSim(b) {
  const W = app.W;
  b.append(h('div', { class: 'simbar' },
    h('button', { class: 'play' + (app.running ? ' on' : ''), onclick: () => { if (app.histOwner) viewHistory(null); app.running = !app.running; if (!app.running) autosave(); refreshPanels(); } }, app.running ? '❚❚' : '▶'),
    seg([[1, '1×'], [2, '4×'], [3, '12×'], [4, 'Max']], app.speed, (v) => { app.speed = v; if (!app.running) app.running = true; refreshPanels(); }),
    h('button', { class: 'btn', onclick: () => step(12) }, '+1 yr')));
  b.append(worldStats());
  const T = W.timeline;
  if (T && T.deltas.length) {
    const stops = [T.start, ...T.deltas.map((d) => d.m).filter((m) => m < W.month), W.month];
    const cur = app.histOwner ? Math.max(0, stops.findIndex((m) => m >= app.histMonth)) : stops.length - 1;
    const yr = (m) => W.startYear + Math.floor(m / 12);
    const lab = h('b', null, app.histOwner ? yr(stops[cur]) : 'Now');
    b.append(h('div', { class: 'card slim history' + (app.histOwner ? ' on' : '') },
      h('label', { class: 'slider' }, 'History', h('input', { type: 'range', min: 0, max: stops.length - 1, step: 1, value: cur,
        oninput: (e) => { const k = +e.target.value; lab.textContent = k === stops.length - 1 ? 'Now' : yr(stops[k]); viewHistory(k === stops.length - 1 ? null : stops[k]); $('#date').textContent = dateLabel(); },
        onchange: () => refreshPanels() }), lab),
      app.histOwner ? h('div', { class: 'btns' }, btn('Back to the present', () => { viewHistory(null); refreshPanels(); }),
        btn('Restore these borders', () => { if (confirm(`Reset every border to how it was in ${yr(app.histMonth)}? Populations and the date stay as they are.`)) { restoreHistory(); refreshPanels(); toast('Borders restored'); } }, 'danger')) : null));
  }
  b.append(section(null, quickThemes([['nations', 'Nations'], ['n_war', 'Wars'], ['n_bloc', 'Alliances'], ['n_stab', 'Stability'], ['n_ruling', 'Governing party'], ['n_gov', 'Governments'], ['occupied', 'Occupation'], ['growth', 'Growth'], ['dev', 'Development'], ['lean', 'Politics']])));
  if (!infoOpen) b.append(h('p', { class: 'muted small' }, 'Tap a nation to follow it. Wars, alliances, rebellions, coups and elections happen on their own — or force them in God mode.'));
  const feed = h('div', { id: 'news' }, W.news.slice(0, 40).map(newsItem));
  if (!W.news.length) feed.append(h('div', { class: 'muted small' }, 'No events yet. Press ▶ to start history.'));
  b.append(section('World news', feed));
  const S = W.settings;
  b.append(h('details', { class: 'sec' }, h('summary', null, 'Simulation rules'), h('div', { class: 'tog-row' },
    toggle('Wars', S.wars, (v) => { S.wars = v; }), toggle('Rebellions', S.rebels, (v) => { S.rebels = v; }),
    toggle('Elections', S.elections, (v) => { S.elections = v; }), toggle('Disasters', S.disasters, (v) => { S.disasters = v; })),
    h('label', { class: 'slider' }, 'Aggression', h('input', { type: 'range', min: 0, max: 4, step: 0.25, value: S.aggression, oninput: (e) => { S.aggression = +e.target.value; } }))));
}

// ------------------------------------------------------------------ draw (districts)
function renderDraw(b) {
  const W = app.W, p = plan();
  if (!p) { b.append(newPlanForm()); return; }
  b.append(h('div', { class: 'planbar' },
    h('select', { onchange: (e) => { app.activePlan = +e.target.value; app.district = 0; computePlanStats(); refresh(); refreshPanels(); } }, W.plans.map((x) => h('option', { value: x.id, selected: x.id === p.id }, x.name))),
    btn('＋', () => openModal('New district plan', newPlanForm(true)), 'sq'),
    btn('⋯', () => openPlanMenu(p), 'sq')));
  const tools = [['pan', '✋', 'Move'], ['brush', '🖌', 'Paint'], ['erase', '⌫', 'Erase'], ['fill', '🪣', 'Fill'], ['pick', '💧', 'Pick']];
  b.append(h('div', { class: 'tools' }, tools.map(([t, ic, l]) => h('button', { class: app.tool === t ? 'on' : '', onclick: () => { app.tool = t; refreshPanels(); } }, h('span', null, ic), h('small', null, l))),
    h('button', { onclick: () => undoRedo(false), disabled: !app.undo.length }, h('span', null, '↶'), h('small', null, 'Undo')),
    h('button', { onclick: () => undoRedo(true), disabled: !app.redo.length }, h('span', null, '↷'), h('small', null, 'Redo'))));
  if (p.unit === 'cells' && ['brush', 'erase'].includes(app.tool)) b.append(brushSlider());
  const st = app.stats;
  const chips = h('div', { class: 'districts' });
  for (let d = 0; d < p.n; d++) {
    const ds = st && st.districts[d];
    chips.append(h('button', { class: 'dchip' + (d === app.district ? ' on' : '') + (p.locked[d] ? ' locked' : ''), style: { '--c': hex(p.colors[d]) }, onclick: () => { app.district = d; if (app.tool === 'pan' || app.tool === 'pick') app.tool = 'brush'; refreshPanels(); } },
      h('b', null, d + 1), h('small', { class: ds && Math.abs(ds.dev) > 0.05 ? 'bad' : '' }, ds && ds.units ? (ds.dev >= 0 ? '+' : '') + (ds.dev * 100).toFixed(1) + '%' : '—')));
  }
  b.append(chips);
  if (st) {
    const sel = st.districts[app.district];
    b.append(h('div', { class: 'card slim' },
      h('div', { class: 'kvrow' }, row('District ' + (app.district + 1), fmt(sel.pop) + ' people'), row('Target', fmt(st.ideal))),
      h('div', { class: 'kvrow' }, row('Compactness', sel.units ? sel.pp.toFixed(2) : '—'), row('Contiguous', sel.units ? (sel.pieces <= 1 ? 'Yes' : `No (${sel.pieces} pieces)`) : '—')),
      sel.units ? voteBar(sel.shares, st.parties) : null,
      h('div', { class: 'btns' }, btn(p.locked[app.district] ? '🔓 Unlock' : '🔒 Lock', () => { p.locked[app.district] = !p.locked[app.district]; refreshPanels(); }), btn('Stats table', openStats), btn('Zoom to', () => zoomToDistrict(p, app.district)))));
    b.append(h('div', { class: 'card slim' },
      row('Unassigned', `${fmt(st.unassignedPop)} people (${st.unassignedUnits.toLocaleString()} ${p.unit === 'cells' ? 'cells' : 'units'})`),
      row('Largest deviation', pct(st.maxDev, 1)),
      h('div', { class: 'kv' }, h('span', null, 'Seats'), h('span', { class: 'seats' }, st.seats.map((n, k) => h('b', { style: { color: hex(PARTY_COLORS[k]) } }, `${n} ${['L', 'C', 'R'][k]}`)))),
      st.contested ? fairness(st, true) : null,
      h('div', { class: 'muted small' }, scopeLabel(p))));
  }
}
const scopeLabel = (p) => `${UNIT_TYPES[p.unit]} · ${p.scope ? app.W.D.units.countries[p.scope - 1].name : 'whole world'} · ${p.n} districts${p.electionsUse && p.scope ? ' · used in this country\'s elections' : ''}`;
function egText(eg) { const a = Math.abs(eg); return a < 0.02 ? 'balanced' : `${(a * 100).toFixed(1)}% toward ${eg > 0 ? 'Right' : 'Left'}`; }
function fairness(st, compact) {
  const seatsPct = st.seats.map((v) => v / Math.max(1, st.contested));
  const rows = [
    h('div', { class: 'vs' }, h('small', null, 'Votes'), voteBar(st.voteShare, st.parties)),
    h('div', { class: 'vs' }, h('small', null, 'Seats'), voteBar(seatsPct, st.parties)),
    row('Efficiency gap', egText(st.eg)),
  ];
  if (!compact) rows.push(row('Mean–median (Left share)', (st.meanMedian >= 0 ? '+' : '') + (st.meanMedian * 100).toFixed(1) + ' pts'), row('Competitive districts (<10% margin)', `${st.competitive} of ${st.contested}`));
  return h('div', { class: 'fair' }, rows);
}
function voteBar(shares, parties) {
  return h('div', { class: 'votebar' }, shares.map((s, k) => h('i', { style: { width: (s * 100) + '%', background: hex(PARTY_COLORS[k]) }, title: parties[k].name || '' }, s > 0.12 ? Math.round(s * 100) + '%' : '')));
}
function brushSlider() {
  return h('label', { class: 'slider' }, 'Brush size', h('input', { type: 'range', min: 1, max: 16, value: app.brush, oninput: (e) => { app.brush = +e.target.value; e.target.nextSibling.textContent = app.brush; } }), h('b', null, app.brush));
}
function zoomToDistrict(p, d) {
  const W = app.W; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  if (p.unit === 'cells') { for (const i of W.land) if (p.assign[i] === d) { const x = i % W.Wd, y = (i / W.Wd) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } if (x0 > x1) return; const dd = 360 / W.Wd; app.R.fitBounds(-180 + x0 * dd, 90 - (y1 + 1) * dd, -180 + (x1 + 1) * dd, 90 - y0 * dd); return; }
  const c = app.planCentroids && app.planCentroids[d]; if (!c) return; app.R.cam.x = c[0]; app.R.cam.y = c[1]; app.R.cam.s = Math.max(app.R.cam.s, 3000 * app.R.dpr); app.R.clampCam(); app.R.dirty();
}
function newPlanForm(inModal) {
  const W = app.W, U = W.D.units;
  const st = { name: 'Plan ' + (W.plans.length + 1), unit: 'cells', scope: U.countries.findIndex((c) => c.a3 === 'USA') + 1, n: 10, random: false };
  const scopeSel = h('select', { onchange: (e) => { st.scope = +e.target.value; } },
    h('option', { value: 0 }, 'Whole world'), [...U.countries.map((c, k) => [c.name, k + 1])].sort().map(([n, v]) => h('option', { value: v, selected: v === st.scope }, n)));
  const f = h('div', { class: 'form' },
    !inModal ? h('div', { class: 'hero' }, h('h3', null, 'Draw your own districts'), h('p', { class: 'muted' }, 'Pick what to build districts from, then paint them on the map — like Districtr, for the whole planet. Your districts decide seats when that country holds elections in the simulation.')) : null,
    h('label', null, 'Name', h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } })),
    h('label', null, 'Build districts from', h('select', { onchange: (e) => { st.unit = e.target.value; if (st.unit === 'counties') { st.scope = U.countries.findIndex((c) => c.a3 === 'USA') + 1; scopeSel.value = st.scope; } } }, Object.entries(UNIT_TYPES).map(([k, l]) => h('option', { value: k }, l)))),
    h('label', null, 'Country', scopeSel),
    h('label', null, 'Number of districts', h('input', { type: 'number', min: 2, max: 435, value: st.n, oninput: (e) => { st.n = clamp(+e.target.value || 2, 2, 435); } })),
    toggle('Start with an automatic random plan', false, (v) => { st.random = v; }),
    btn('Create plan', () => {
      const p = newPlan(W, { name: st.name || 'Plan', unit: st.unit, scope: st.unit === 'counties' ? U.countries.findIndex((c) => c.a3 === 'USA') + 1 : st.scope, n: st.n });
      if (st.random) randomPlan(W, p);
      app.activePlan = p.id; app.district = 0; app.tool = 'brush'; rebuildCatalog(); closeModal(); computePlanStats(); refresh(); refreshPanels();
      if (p.scope) { const c = U.countries[p.scope - 1]; const n = W.nations[p.scope]; if (n && n.alive) zoomToNation(n); else app.R.flyTo(c.label[0], c.label[1]); }
    }, 'primary wide'));
  return f;
}
function openPlanMenu(p) {
  const W = app.W;
  const body = h('div', { class: 'form' },
    h('label', null, 'Name', h('input', { value: p.name, onchange: (e) => { p.name = e.target.value; rebuildCatalog(); refreshPanels(); } })),
    h('label', null, 'Number of districts', h('input', { type: 'number', min: 2, max: 435, value: p.n, onchange: (e) => { setDistrictCount(p, clamp(+e.target.value || 2, 2, 435)); app.district = Math.min(app.district, p.n - 1); computePlanStats(); refresh(); refreshPanels(); } })),
    toggle('Use this plan for elections in the simulation', p.electionsUse, (v) => { p.electionsUse = v; }),
    h('div', { class: 'btns' },
      btn('Fill the gaps', () => { const ch = autoFill(W, p); if (ch.size) app.undo.push({ tgt: 'plan', changes: ch, plan: p.id }); closeModal(); computePlanStats(); refresh(); refreshPanels(); toast(`Assigned ${ch.size.toLocaleString()} units`); }),
      btn('Random plan', () => { randomPlan(W, p); app.undo = []; closeModal(); computePlanStats(); refresh(); refreshPanels(); }),
      btn('Clear all', () => { if (confirm('Clear every district in this plan?')) { p.assign.fill(-1); app.undo = []; closeModal(); computePlanStats(); refresh(); refreshPanels(); } }),
      btn('Export CSV', () => exportPlanCSV(p)),
      btn('Show as map', () => { closeModal(); setTheme('plan_' + p.id); }),
      btn('Delete plan', () => { if (confirm('Delete this plan?')) { W.plans = W.plans.filter((x) => x !== p); app.activePlan = W.plans.length ? W.plans[0].id : null; rebuildCatalog(); closeModal(); computePlanStats(); refresh(); refreshPanels(); } }, 'danger')));
  openModal('Plan options', body);
}
function exportPlanCSV(p) {
  const W = app.W, U = W.D.units; const lines = [];
  if (p.unit === 'cells') { lines.push('lat,lng,district'); for (const i of W.land) if (p.assign[i] >= 0) { const [lng, lat] = cellLngLat(W, i); lines.push(`${lat.toFixed(3)},${lng.toFixed(3)},${p.assign[i] + 1}`); } }
  else if (p.unit === 'provinces') { lines.push('province,iso,country,district'); p.assign.forEach((d, u) => { if (d >= 0) { const x = U.provinces[u]; lines.push(`"${x.n}",${x.iso},"${U.countries[x.c - 1] ? U.countries[x.c - 1].name : ''}",${d + 1}`); } }); }
  else { lines.push('GEOID,county,state,district'); p.assign.forEach((d, u) => { if (d >= 0) { const x = U.counties[u]; lines.push(`${x.fips},"${x.n}","${x.s}",${d + 1}`); } }); }
  saveFile(p.name.replace(/\W+/g, '_') + '.csv', new Blob([lines.join('\n')], { type: 'text/csv' }));
}
function openStats() {
  const p = plan(), st = app.stats || planStats(app.W, p);
  const tbl = h('table', { class: 'tbl' }, h('tr', null, ['#', 'Population', 'Dev.', 'Compact', 'Pieces', 'Winner'].map((x) => h('th', null, x))),
    st.districts.map((d) => h('tr', { onclick: () => { app.district = d.k; closeModal(); refreshPanels(); zoomToDistrict(p, d.k); } },
      h('td', null, h('span', { class: 'dot', style: { background: hex(p.colors[d.k]) } }), d.k + 1), h('td', null, fmt(d.pop)), h('td', { class: Math.abs(d.dev) > 0.05 ? 'bad' : '' }, d.units ? (d.dev * 100).toFixed(1) + '%' : '—'),
      h('td', null, d.units ? d.pp.toFixed(2) : '—'), h('td', { class: d.pieces > 1 ? 'bad' : '' }, d.pieces || '—'),
      h('td', null, d.winner >= 0 ? h('b', { style: { color: hex(PARTY_COLORS[d.winner]) } }, ['Left', 'Centre', 'Right'][d.winner] + ' ' + Math.round(d.shares[d.winner] * 100) + '%') : '—'))));
  const help = h('p', { class: 'muted small' }, 'Efficiency gap counts “wasted” votes (votes for losers, plus winners\' votes beyond what they needed); a gap above ~7% is usually considered a sign of gerrymandering. Mean–median compares the Left party\'s median district to its average; a negative number means the map packs or cracks Left voters.');
  openModal('District statistics', h('div', null, st.contested ? fairness(st, false) : null, help, h('div', { class: 'scrollx' }, tbl)), true);
}
export function refreshStats() { if (app.mode === 'draw' && !document.activeElement?.matches('input,select')) refreshPanels(); }

// ------------------------------------------------------------------ god mode
function renderEdit(b) {
  const W = app.W;
  b.append(seg([['borders', 'Borders'], ['data', 'Data'], ['disaster', 'Disasters'], ['nations', 'Nations'], ['diplomacy', 'Diplomacy']], ['release', 'capital'].includes(app.editTool) ? 'nations' : app.editTool, (v) => { app.editTool = v; app.tool = v === 'borders' || v === 'data' ? 'brush' : 'pan'; refreshPanels(); }));
  const et = app.editTool;
  if (et === 'borders') {
    const n = W.nations[app.paintNation];
    b.append(h('div', { class: 'paintwith' }, h('span', null, 'Paint land for'), h('button', { class: 'btn', onclick: () => chooseNation('Paint land for…', (id) => { app.paintNation = id; app.tool = 'brush'; refreshPanels(); }, true, true) }, n ? [dot(n.color), n.name] : [dot([90, 90, 90]), 'Unclaimed'], ' ▾')));
    b.append(editTools([['pan', '✋', 'Move'], ['brush', '🖌', 'Paint'], ['pick', '💧', 'Pick nation']]));
    if (app.tool === 'brush') b.append(brushSlider());
    b.append(h('p', { class: 'muted small' }, 'Paint to move borders. Use “Pick nation” then tap the map to paint as that nation.'));
  } else if (et === 'data') {
    const attrs = [['dev', 'Development'], ['pop', 'Population (multiply)'], ['lean', 'Political lean'], ['terrain', 'Terrain'], ...Object.keys(W.custom).map((k) => [k, k + ' (your layer)'])];
    b.append(h('label', { class: 'field' }, 'Paint', h('select', { onchange: (e) => { app.dataAttr = e.target.value; app.dataValue = defaultValue(app.dataAttr); refreshPanels(); autoTheme(); } }, attrs.map(([v, l]) => h('option', { value: v, selected: v === app.dataAttr }, l)))));
    b.append(valueControl());
    b.append(editTools([['pan', '✋', 'Move'], ['brush', '🖌', 'Paint']]));
    if (app.tool === 'brush') b.append(brushSlider());
    b.append(btn('＋ New data layer', openNewLayer, 'wide'));
  } else if (et === 'disaster') {
    b.append(h('div', { class: 'chips' }, Object.entries(DISASTERS).map(([k, d]) => h('button', { class: 'chip-s' + (app.disaster === k ? ' on' : ''), onclick: () => { app.disaster = k; refreshPanels(); } }, d.label))));
    b.append(h('p', { class: 'muted small' }, 'Tap anywhere on the map to unleash it.'));
  } else if (et === 'nations' || et === 'release' || et === 'capital') renderNationEditor(b);
  else if (et === 'diplomacy') renderDiplomacy(b);
}
function editTools(list) {
  return h('div', { class: 'tools' }, list.map(([t, ic, l]) => h('button', { class: app.tool === t ? 'on' : '', onclick: () => { app.tool = t; refreshPanels(); } }, h('span', null, ic), h('small', null, l))),
    h('button', { onclick: () => undoRedo(false), disabled: !app.undo.length }, h('span', null, '↶'), h('small', null, 'Undo')),
    h('button', { onclick: () => undoRedo(true), disabled: !app.redo.length }, h('span', null, '↷'), h('small', null, 'Redo')));
}
function defaultValue(a) { return a === 'pop' ? 2 : a === 'dev' ? 0.8 : a === 'lean' ? 0 : a === 'terrain' ? 6 : 1; }
function autoTheme() { const m = { dev: 'dev', pop: 'density', lean: 'lean', terrain: 'terrain' }; setTheme(m[app.dataAttr] || 'cu_' + app.dataAttr); }
function valueControl() {
  const a = app.dataAttr, W = app.W;
  if (a === 'terrain') return h('label', { class: 'field' }, 'Terrain', h('select', { onchange: (e) => { app.dataValue = +e.target.value; } }, W.D.units.terrains.map((t, k) => k >= 2 ? h('option', { value: k, selected: k === app.dataValue }, t) : null)));
  const cfg = a === 'pop' ? [0.1, 5, 0.1, (v) => '×' + v] : a === 'dev' ? [0, 1, 0.01, (v) => v.toFixed(2)] : a === 'lean' ? [-1, 1, 0.05, leanText] : [-100, 100, 0.5, (v) => v];
  const out = h('b', null, cfg[3](app.dataValue));
  return h('label', { class: 'slider' }, a === 'pop' ? 'Multiply by' : 'Value', h('input', { type: 'range', min: cfg[0], max: cfg[1], step: cfg[2], value: app.dataValue, oninput: (e) => { app.dataValue = +e.target.value; out.textContent = cfg[3](app.dataValue); } }), out);
}
function renderNationEditor(b) {
  const W = app.W, s = app.sel, n = s && s.nation ? W.nations[s.nation] : null;
  if (app.editTool === 'release') { b.append(h('div', { class: 'card slim' }, 'Tap a province on the map to make it an independent nation.', btn('Cancel', () => { app.editTool = 'nations'; refreshPanels(); }))); return; }
  if (app.editTool === 'capital') { b.append(h('div', { class: 'card slim' }, 'Tap the map where the new capital should be.', btn('Cancel', () => { app.editTool = 'nations'; refreshPanels(); }))); return; }
  b.append(h('div', { class: 'btns' }, btn('＋ New nation', () => {
    const name = prompt('Name of the new nation', 'New Nation'); if (!name) return;
    const nn = newNation(W, { name, color: hsl(W.rng() * 360, 0.55, 0.55) }); if (!nn) return toast('Too many nations');
    nn.alive = false; app.paintNation = nn.id; app.editTool = 'borders'; app.tool = 'brush'; rebuildCatalog(); refreshPanels(); toast('Now paint its land on the map');
  }), btn('Release a province', () => { app.editTool = 'release'; refreshPanels(); })));
  if (!n || !n.alive) { b.append(h('p', { class: 'muted small' }, 'Tap a nation on the map to edit it.')); return; }
  const colors = [[214, 84, 84], [232, 140, 60], [226, 196, 72], [120, 186, 90], [52, 150, 110], [60, 170, 190], [70, 120, 210], [120, 96, 210], [180, 90, 190], [210, 110, 150], [150, 120, 90], [130, 140, 150]];
  b.append(h('div', { class: 'card' },
    h('label', { class: 'field' }, 'Name', h('input', { value: n.name, onchange: (e) => { n.name = e.target.value || n.name; rebuildCatalog(); app.R.dirty(); refreshPanels(); } })),
    h('div', { class: 'swatches' }, colors.map((c) => h('button', { style: { background: hex(c) }, onclick: () => { n.color = c; rebuildCatalog(); refresh(); } })), h('input', { type: 'color', value: hex(n.color), onchange: (e) => { n.color = parseHex(e.target.value); rebuildCatalog(); refresh(); } })),
    h('label', { class: 'field' }, 'Government', h('select', { onchange: (e) => { n.gov = e.target.value; refreshPanels(); } }, GOVS.map((g) => h('option', { selected: g === n.gov }, g)))),
    h('label', { class: 'slider' }, 'Stability', h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: n.stab, onchange: (e) => { n.stab = +e.target.value; refresh(); } })),
    n.gov === 'Republic' ? h('div', { class: 'btns' }, btn('Call an election', () => { import('./sim.js').then((m) => { m.holdElection(W, n); refreshPanels(); toast(W.news[0].t, 4000); }); })) : null,
    h('div', { class: 'btns' },
      btn('Move capital', () => { app.editTool = 'capital'; refreshPanels(); }),
      btn('Annex a nation…', () => chooseNation(`${n.name} annexes…`, (id) => { const t = W.nations[id]; if (id === n.id || !t) return; annex(W, n, t); addNews(W, `${n.name} annexes ${t.name}.`, 'war', [n.id, id]); computeAggregates(W); computeAdjacency(W); app.aggStamp++; rebuildCatalog(); refresh(); refreshPanels(); })),
      btn('Dissolve', () => { if (!confirm(`Dissolve ${n.name}? Its land becomes unclaimed.`)) return; for (const i of W.land) if (W.owner[i] === n.id) W.owner[i] = 0; n.alive = false; W.wars = W.wars.filter((w) => w.a !== n.id && w.b !== n.id); computeAggregates(W); computeAdjacency(W); app.aggStamp++; rebuildCatalog(); select(null); refresh(); refreshPanels(); }, 'danger'))));
}
function renderDiplomacy(b) {
  const W = app.W, s = app.sel, A = s && s.nation ? W.nations[s.nation] : null;
  if (!A || !A.alive) { b.append(h('p', { class: 'muted small' }, 'Tap a nation on the map, then pick a second one to change how they get along.')); return; }
  const B = W.nations[app.diploTarget]; const ok = B && B.alive && B.id !== A.id;
  b.append(h('div', { class: 'diplo' }, h('span', null, dot(A.color), A.name), h('span', { class: 'muted' }, '↔'),
    h('button', { class: 'btn', onclick: () => chooseNation('Second nation', (id) => { app.diploTarget = id; refreshPanels(); }) }, ok ? [dot(B.color), B.name] : 'Choose… (or tap map)')));
  if (!ok) return;
  const r = rel(W, A.id, B.id), war = warBetween(W, A.id, B.id), allied = A.bloc && A.bloc === B.bloc;
  const out = h('b', null, Math.round(r));
  b.append(h('label', { class: 'slider' }, 'Relations', h('input', { type: 'range', min: -100, max: 100, value: r, oninput: (e) => { setRel(W, A.id, B.id, +e.target.value); out.textContent = e.target.value; } }), out));
  b.append(h('div', { class: 'btns' },
    war ? btn('Make peace', () => { endWar(W, war, `${A.name} and ${B.name} make peace.`); after(); }) : btn(`${A.name} declares war`, () => { declareWar(W, A.id, B.id); after(); }, 'danger'),
    allied ? btn('Break alliance', () => { A.bloc = 0; addNews(W, `${A.name} leaves the ${W.blocs[B.bloc].name}.`, 'alliance', [A.id]); after(); })
      : btn('Form alliance', () => {
        if (warBetween(W, A.id, B.id)) return toast('Make peace first');
        if (B.bloc) A.bloc = B.bloc; else if (A.bloc) B.bloc = A.bloc; else { const id = W.blocs.length; W.blocs.push({ id, name: `${A.name}–${B.name} Alliance`, color: hsl(W.rng() * 360, 0.7, 0.55) }); A.bloc = B.bloc = id; }
        setRel(W, A.id, B.id, Math.max(r, 70)); addNews(W, `${A.name} and ${B.name} are now allies (${W.blocs[A.bloc].name}).`, 'alliance', [A.id, B.id]); after();
      }),
    btn('Merge into ' + A.name, () => { annex(W, A, B); addNews(W, `${B.name} unites with ${A.name}.`, 'info', [A.id, B.id]); app.diploTarget = 0; computeAggregates(W); computeAdjacency(W); app.aggStamp++; after(); })));
  const wars = W.wars.filter((w) => w.a === A.id || w.b === A.id);
  if (wars.length) b.append(section(`${A.name}'s wars`, wars.map((w) => { const o = W.nations[w.a === A.id ? w.b : w.a]; return h('div', { class: 'kv' }, h('span', null, o.name), btn('Peace', () => { endWar(W, w, `${A.name} and ${o.name} make peace.`); after(); })); })));
  function after() { rebuildCatalog(); refresh(); refreshPanels(); }
}

// ------------------------------------------------------------------ modals
export function openModal(title, body, wide) {
  const m = $('#modal'); const card = m.querySelector('.modal-card'); card.innerHTML = ''; card.classList.toggle('wide', !!wide);
  card.append(h('div', { class: 'mhead' }, h('h2', null, title), h('button', { class: 'x', onclick: closeModal }, '×')), h('div', { class: 'mbody' }, body));
  m.classList.remove('hidden');
}
export function closeModal() { $('#modal').classList.add('hidden'); }

export function openThemeBrowser() {
  rebuildCatalog();
  const list = h('div', { class: 'tlist' });
  const search = h('input', { class: 'search', placeholder: `Search ${app.catalog.length.toLocaleString()} maps…`, oninput: () => draw(search.value) });
  const layerNames = { cells: '🌐', provinces: '🗺', counties: '🇺🇸' };
  function draw(q) {
    list.innerHTML = ''; q = (q || '').toLowerCase().trim();
    const groups = new Map();
    for (const t of app.catalog) {
      if (q ? !(t.label.toLowerCase().includes(q) || t.group.toLowerCase().includes(q)) : (t.hidden && !(app.expandGroup === t.group))) { if (!q && t.hidden) { groups.set(t.group, groups.get(t.group) || []); groups.get(t.group).hiddenCount = (groups.get(t.group).hiddenCount || 0) + 1; } continue; }
      if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t);
    }
    for (const [g, ts] of groups) {
      list.append(h('div', { class: 'tgroup' }, g));
      for (const t of ts.slice(0, q ? 60 : 400)) list.append(h('button', { class: 'titem' + (t.id === app.themeId ? ' on' : ''), onclick: () => { closeModal(); setTheme(t.id); if (t.layer === 'counties') app.R.fitBounds(-125, 24, -66, 50); } },
        h('span', { class: 'swatch' + (t.kind === 'cat' ? ' cat' : ''), style: { background: swatchBg(t) } }), h('span', null, t.label), h('small', null, layerNames[t.layer])));
      if (ts.hiddenCount) list.append(h('button', { class: 'titem more', onclick: () => { app.expandGroup = g; draw(''); } }, `Show ${ts.hiddenCount} more…`));
    }
    if (!list.children.length) list.append(h('p', { class: 'muted' }, 'No maps match. Make your own with a formula below.'));
  }
  draw('');
  openModal('All maps', h('div', null, search, h('div', { class: 'btns' }, btn('＋ Formula map', openFormula), btn('＋ Paintable data layer', openNewLayer)), list));
  setTimeout(() => search.focus(), 50);
}
function openFormula() {
  const st = { name: 'My map', layer: 'cells', expr: 'pop / area', log: false, diverging: false };
  const err = h('div', { class: 'err' });
  const vars = h('div', { class: 'chips' });
  const ta = h('textarea', { rows: 2, oninput: (e) => { st.expr = e.target.value; check(); } }, st.expr);
  const drawVars = () => { vars.innerHTML = ''; const v = { ...FORMULA_VARS[st.layer] }; if (st.layer === 'cells') for (const k of Object.keys(app.W.custom)) v[k.replace(/\W+/g, '_')] = 'your layer'; for (const [k, d] of Object.entries(v)) vars.append(h('button', { class: 'chip-s', title: d, onclick: () => { ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + k; st.expr = ta.value; check(); } }, k)); };
  const check = () => { try { compileFormula(st.expr, st.layer, Object.keys(app.W.custom)); err.textContent = ''; return true; } catch (e) { err.textContent = e.message; return false; } };
  drawVars();
  openModal('New formula map', h('div', { class: 'form' },
    h('label', null, 'Name', h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } })),
    h('label', null, 'Map', h('select', { onchange: (e) => { st.layer = e.target.value; drawVars(); check(); } }, h('option', { value: 'cells' }, 'World grid cells'), h('option', { value: 'provinces' }, 'Provinces'), h('option', { value: 'counties' }, 'US counties'))),
    h('label', null, 'Formula', ta), vars, err,
    h('p', { class: 'muted small' }, 'Examples: income * pop · dev - stab · max(lean, 0) · log10(density + 1) · pop > 1e6'),
    toggle('Logarithmic colours', false, (v) => { st.log = v; }), toggle('Diverging (centred on zero)', false, (v) => { st.diverging = v; }),
    btn('Create map', () => { if (!check()) return; const f = { id: Date.now() % 1e9, ...st }; app.W.formulas.push(f); rebuildCatalog(); closeModal(); setTheme('f_' + f.id); }, 'primary wide')));
}
function openNewLayer() {
  const st = { name: 'My layer', init: 'zero' };
  openModal('New data layer', h('div', { class: 'form' },
    h('p', { class: 'muted small' }, 'A data layer is a number for every one of the ~345,000 land cells that you paint yourself in God mode → Data. Use it in formulas too.'),
    h('label', null, 'Name', h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } })),
    h('label', null, 'Start from', h('select', { onchange: (e) => { st.init = e.target.value; } }, h('option', { value: 'zero' }, 'All zero'), h('option', { value: 'dev' }, 'Development ×100'), h('option', { value: 'lean' }, 'Political lean ×100'), h('option', { value: 'lat' }, 'Latitude'))),
    btn('Create layer', () => {
      const W = app.W, name = (st.name || 'Layer').trim().slice(0, 40); if (W.custom[name]) return toast('That name is taken');
      const a = new Float32Array(W.N);
      for (const i of W.land) a[i] = st.init === 'dev' ? W.dev[i] * 100 : st.init === 'lean' ? W.lean[i] * 100 : st.init === 'lat' ? 90 - (((i / W.Wd) | 0) + 0.5) * 180 / W.Hd : 0;
      W.custom[name] = a; rebuildCatalog(); closeModal(); app.dataAttr = name; app.dataValue = 50; app.editTool = 'data'; app.tool = 'brush';
      setTheme('cu_' + name); setMode('edit');
    }, 'primary wide')));
}

function chooseNation(title, cb, allowNone, allowNew) {
  const W = app.W; const list = h('div', { class: 'tlist' });
  const draw = (q) => {
    list.innerHTML = ''; q = (q || '').toLowerCase();
    if (allowNone) list.append(h('button', { class: 'titem', onclick: () => { closeModal(); cb(0); } }, dot([90, 90, 90]), 'Unclaimed land'));
    W.nations.filter((n) => n && (n.alive || n.id === app.paintNation || n.cells === 0 && n.founded === W.month) && n.name.toLowerCase().includes(q)).sort((a, b) => b.pop - a.pop).slice(0, 300)
      .forEach((n) => list.append(h('button', { class: 'titem', onclick: () => { closeModal(); cb(n.id); } }, dot(n.color), h('span', null, n.name), h('small', null, n.alive ? fmt(n.pop) : 'no land yet'))));
  };
  const search = h('input', { class: 'search', placeholder: 'Search nations…', oninput: () => draw(search.value) });
  draw('');
  openModal(title, h('div', null, search, list));
}

// ------------------------------------------------------------------ menu, saves, files
function openMenu() {
  const W = app.W;
  const slots = h('div', { class: 'tlist' }, h('p', { class: 'muted small' }, 'Loading saves…'));
  listSlots().then((all) => {
    slots.innerHTML = '';
    if (!all.length) slots.append(h('p', { class: 'muted small' }, 'No saved worlds yet.'));
    for (const s of all) slots.append(h('div', { class: 'slot' }, h('button', { class: 'titem', onclick: async () => { const S = await getSlot(s.key); try { const w = deserialize(app.D, S); setWorld(w); closeModal(); refreshPanels(); toast(`Loaded “${w.name}”`); } catch (e) { toast('Could not load: ' + e.message); } } },
      h('span', null, s.key === 'autosave' ? `Autosave — ${s.name}` : s.name), h('small', null, `${dateOf(s.month, s.startYear)} · ${s.nations} nations`)),
      s.key !== 'autosave' ? h('button', { class: 'x', onclick: async () => { if (confirm('Delete this save?')) { await delSlot(s.key); openMenu(); } } }, '×') : null));
  });
  const fileIn = h('input', { type: 'file', accept: '*/*', style: { display: 'none' }, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return; toast('Importing…');
    try { const w = await importBlob(app.D, f); setWorld(w); closeModal(); refreshPanels(); toast(`Imported “${w.name}”`); } catch (err) { toast('Import failed: ' + err.message, 4000); }
  } });
  openModal('Atlas Forge', h('div', { class: 'form' },
    h('label', null, 'World name', h('input', { value: W.name, onchange: (e) => { W.name = e.target.value || W.name; } })),
    h('div', { class: 'btns' },
      btn('💾 Save', async () => { await putSlot('w_' + Date.now(), serialize(W)); toast('Saved'); openMenu(); }, 'primary'),
      btn('⬇ Export file', async () => { toast('Packing…'); const b = await exportBlob(W); saveFile((W.name || 'world').replace(/\W+/g, '_') + '.atlas', b); }),
      btn('⬆ Import file', () => fileIn.click()), fileIn,
      btn('🌍 New world', () => openNewWorld())),
    h('div', { class: 'sec-t' }, 'Saved worlds'), slots,
    h('details', { class: 'sec' }, h('summary', null, 'About & data'), h('p', { class: 'muted small' }, `Atlas Forge — draw districts and run history on a ${W.Wd}×${W.Hd} grid of the real Earth. Borders, provinces, cities, terrain: Natural Earth (public domain). US counties and populations: US Census Bureau. Country population/GDP: Natural Earth (2019–2021 estimates). Cell populations are modelled from those figures.`))));
}
function openNewWorld() {
  const st = { govs: 'republics', name: 'Earth 2026' };
  openModal('New world', h('div', { class: 'form' },
    h('p', { class: 'muted small' }, 'Starts over from the real world in 2026. Your current world stays in its saves (and the autosave is replaced).'),
    h('label', null, 'Name', h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } })),
    h('label', null, 'Starting governments', h('select', { onchange: (e) => { st.govs = e.target.value; } }, h('option', { value: 'republics' }, 'Every nation a republic'), h('option', { value: 'random' }, 'Random mix'))),
    btn('Create world', () => { app.running = false; const w = createWorld(app.D, { govs: st.govs, name: st.name }); setWorld(w); closeModal(); refreshPanels(); autosave(); toast('A new world begins'); }, 'primary wide')));
}
export async function saveFile(name, blob) {
  if (window.AndroidBridge && AndroidBridge.saveFile) {
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
    const where = AndroidBridge.saveFile(name, data, blob.type || 'application/octet-stream');
    toast(where ? 'Saved to ' + where : 'Could not save file', 4000); return;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
}

// ------------------------------------------------------------------ place search
export function openSearch() {
  const W = app.W, U = W.D.units;
  const list = h('div', { class: 'tlist' });
  const hint = h('p', { class: 'muted small' }, 'Type at least 2 letters. Searches nations, real countries, 4,596 provinces, 3,221 US counties and 7,300 cities.');
  const input = h('input', { class: 'search', placeholder: 'Search places…', oninput: () => draw(input.value) });
  const kinds = { Nation: 0, Country: 1, City: 2, Province: 3, County: 4 };
  function draw(q) {
    list.innerHTML = ''; q = q.trim().toLowerCase();
    if (q.length < 2) { list.append(hint); return; }
    const res = [];
    const sc = (name) => { const n = String(name || '').toLowerCase(); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(' ' + q) ? 2 : n.includes(q) ? 3 : -1; };
    const add = (kind, name, sub, score, weight, go, color) => { if (score >= 0) res.push({ kind, name, sub, score, weight, go, color }); };
    const aliveNames = new Set();
    for (const n of W.nations) if (n && n.alive) { aliveNames.add(n.name); add('Nation', n.name, `${n.gov} · ${fmt(n.pop)} people`, sc(n.name), n.pop, () => { select({ cell: n.capital, nation: n.id }); zoomToNation(n); showInfo(); }, n.color); }
    U.countries.forEach((c, k) => { if (aliveNames.has(c.name)) return; add('Country', c.name, `2026 · ${c.continent}`, sc(c.name), c.pop, () => { app.R.flyTo(c.label[0], c.label[1], 2400); const i = cellAt(W, c.label[0], c.label[1]); select({ cell: i, nation: W.owner[i] }); showInfo(); }); });
    U.cities.forEach((c) => add('City', c.name, `${U.countries[c.country - 1] ? U.countries[c.country - 1].name : ''} · ${fmt(c.pop)}`, sc(c.name), c.pop, () => { app.R.flyTo(c.lng, c.lat, 9000); const i = cellAt(W, c.lng, c.lat); select({ cell: i, nation: W.owner[i] }); showInfo(); }));
    U.provinces.forEach((p, u) => add('Province', p.n, `${p.t || 'Province'} · ${U.countries[p.c - 1] ? U.countries[p.c - 1].name : ''}`, sc(p.n), p.pop, () => goUnit('provinces', u, 4000)));
    U.counties.forEach((c, u) => add('County', `${c.n}, ${c.s}`, `US county · ${fmt(c.pop)}`, sc(`${c.n}, ${c.s}`), c.pop, () => goUnit('counties', u, 6000)));
    res.sort((a, b) => a.score - b.score || kinds[a.kind] - kinds[b.kind] || b.weight - a.weight);
    for (const r of res.slice(0, 60)) list.append(h('button', { class: 'titem', onclick: () => { closeModal(); r.go(); } },
      r.color ? dot(r.color) : h('span', { class: 'kind' }, r.kind[0]), h('span', null, r.name, h('small', { class: 'block' }, r.sub)), h('small', null, r.kind)));
    if (!res.length) list.append(h('p', { class: 'muted' }, 'Nothing found.'));
  }
  draw('');
  openModal('Find a place', h('div', null, input, list));
  setTimeout(() => input.focus(), 60);
}
function goUnit(layer, u, zoom) {
  const W = app.W, [lng, lat] = unitCenter(W, layer, u);
  app.R.flyTo(lng, lat, zoom);
  const i = cellAt(W, lng, lat);
  select({ unit: u, layer, cell: i, nation: W.owner[i] }); showInfo();
}

// ------------------------------------------------------------------ rankings
const RANKS = [
  ['pop', 'Population', (n) => n.pop, (v) => fmt(v)],
  ['gdp', 'GDP', (n) => n.gdp * 1e6, (v) => '$' + fmt(v)],
  ['gdppc', 'Income', (n) => n.pop ? n.gdp * 1e6 / n.pop : 0, (v) => '$' + fmt(v)],
  ['cells', 'Territory', (n) => n.cells, (v) => fmt(v) + ' cells'],
  ['mil', 'Military', (n) => n.mil, (v) => fmt(v)],
  ['stab', 'Stability', (n) => n.stab, (v) => pct(v)],
  ['growth', 'Growth', (n) => n.hist && n.hist.pop[0] ? n.pop / n.hist.pop[0] - 1 : 0, (v) => (v >= 0 ? '+' : '') + pct(v)],
];
export function openRankings(key = 'pop') {
  const W = app.W, R = RANKS.find((r) => r[0] === key) || RANKS[0];
  const alive = W.nations.filter((n) => n && n.alive && n.cells > 0).map((n) => [n, R[2](n)]).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...alive.map((a) => Math.abs(a[1]))) || 1;
  const body = h('div', null,
    h('div', { class: 'chips' }, RANKS.map(([k, l]) => h('button', { class: 'chip-s' + (k === R[0] ? ' on' : ''), onclick: () => openRankings(k) }, l))),
    h('div', { class: 'tlist' }, alive.slice(0, 200).map(([n, v], k) => h('button', { class: 'titem rank', onclick: () => { closeModal(); select({ cell: n.capital, nation: n.id }); zoomToNation(n); showInfo(); } },
      h('b', { class: 'rk' }, k + 1), dot(n.color), h('span', null, n.name, h('i', { class: 'rbar', style: { width: Math.max(2, Math.abs(v) / max * 100) + '%', background: hex(n.color) } })), h('small', null, R[3](v))))));
  openModal(`Rankings · ${dateLabel()}`, body);
}
