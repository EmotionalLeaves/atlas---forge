// Atlas Forge — UI panels.
import { h, fmt, pct, dateOf, esc, hex, parseHex, hsl, clamp, PARTY_COLORS, rampLUT, RAMPS } from './util.js';
import { saveSettings, applyMapStyle, chooseLevel } from './app.js';
import { BASEMAPS } from './basemap.js';
import { app, setTheme, refresh, theme, plan, select, undoRedo, scheduleStats, computePlanStats, rebuildCatalog, setWorld, step, autosave, viewHistory, restoreHistory, usePack, ensurePlanPack, cellAtScreen } from './app.js';
import { packList, levelList } from './precincts.js';
import { LV, LEVEL_THEMES, levelCoverage, levelThemesNow } from './levels.js';
import { startGame, resolveEvent, endGame, POLICIES, rankOf } from './game.js';
import { rel, setRel, computeAggregates, computeAdjacency, newNation, cellLngLat, addNews, GOVS, prodOf, MAXN, warBetween } from './world.js';
import { declareWar, endWar, annex, DISASTERS } from './sim.js';
import { encodePlan, decodePlan, applyDecoded, coiReport, ensureCoi, COI_COLORS, recomInput, newPlan, setDistrictCount, autoFill, randomPlan, UNIT_TYPES, planStats, unitCenter, PARENT_NAME, PARENT_PLURAL, parentWord, planSplits, importCSV, applyRealPlan, planLayer, PRECINCT_COLORS, defaultElection } from './plans.js';
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
  hand: '<svg viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V12M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.5 15.5a1.5 1.5 0 0 1 2.3-2l1.2 1.4"/></svg>',
  brush: '<svg viewBox="0 0 24 24"><path d="M18.5 3.5l2 2L11 15l-2-2zM9 13c-2.5 0-4 1.6-4 4 0 1.5-1 2.5-2 3 3.5.5 8-.5 8-5"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="M15 4l5 5-9 9H6l-3-3zM9 8l7 7M6 18h14"/></svg>',
  bucket: '<svg viewBox="0 0 24 24"><path d="M4 11l7-7 8 8-7 7a2 2 0 0 1-2.8 0L4 13.8A2 2 0 0 1 4 11zM4 12h15M20 15s2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5z"/></svg>',
  dropper: '<svg viewBox="0 0 24 24"><path d="M14 4l6 6-2 2-6-6zM12 8l-7.5 7.5L4 20l4.5-.5L16 12"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3.2"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4c0 3 2 5 4 5M16 6h4c0 3-2 5-4 5M12 13v4M8 20h8"/></svg>',
};
const icon = (k) => h('span', { class: 'ic', html: ICON[k] });

export function init() {
  if (document.fonts) document.fonts.load("600 13px 'Barlow SC'").then(() => app.R && app.R.dirty()).catch(() => {});
  app.onLevelStatus = levelStatusHook;
  let lg = 0; app.onLegend = () => { clearTimeout(lg); lg = setTimeout(() => { if (app.mode === 'explore') refreshPanels(); else mapLegend(); }, 300); };
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
    h('button', { class: 'fab', 'aria-label': 'Whole world', onclick: worldView, html: ICON.home }),
    h('button', { class: 'fab', id: 'layersFab', 'aria-label': 'Map layers', onclick: openLayers, html: ICON.layers }));
  // keep track of how much of the map the sheet covers so the camera frames the visible part
  const sheet = $('#sheet');
  const updPad = () => {
    const r = sheet.getBoundingClientRect(), wide = window.innerWidth >= 760;
    app.R.pad = wide ? { l: r.right, b: 0 } : { l: 0, b: Math.max(0, window.innerHeight - r.top) };
    $('#attr').style.bottom = (wide ? 6 : app.R.pad.b + 4) + 'px';
    const ml = $('#mapLegend'), dk = $('#dock'), dockH = dk && !dk.hidden ? dk.getBoundingClientRect().height + 10 : 0;
    if (dk) { dk.style.bottom = (wide ? 14 : app.R.pad.b + 10) + 'px'; dk.style.left = (wide ? r.right + 14 : 10) + 'px'; dk.classList.toggle('tucked', !wide && app.R.pad.b > window.innerHeight * 0.66); }
    if (ml) { ml.style.bottom = (wide ? 14 + dockH : app.R.pad.b + 10 + dockH) + 'px'; ml.style.left = (wide ? r.right + 12 : 10) + 'px'; }
    app.updPad = updPad;
  };
  if (window.ResizeObserver) new ResizeObserver(updPad).observe(sheet);
  window.addEventListener('resize', updPad); sheet.addEventListener('transitionend', updPad); updPad();
  requestAnimationFrame(() => { updPad(); worldView(); setTimeout(() => { updPad(); worldView(); }, 300); });
  setupSheet();
  window.atlasBack = () => {
    if (!$('#modal').classList.contains('hidden')) { closeModal(); return true; }
    if (infoOpen) { hideInfo(); return true; }
    if (app.running) { setRunning(false); return true; }
    if (app.mode !== 'explore') { setMode('explore'); return true; }
    autosave(); return false;
  };
  setMode('explore');
}

export function worldView() {
  const R = app.R, p = R.pad || { l: 0, b: 0 }, w = R.vw / R.dpr - p.l, hh = R.vh / R.dpr - p.b;
  const y0 = mercY(78), y1 = mercY(-56), sH = hh / (y1 - y0), sW = w; // css px per world unit
  R.cam.s = Math.min(sH, sW * 2.1) * R.dpr * 0.98; R.clampCam(); R._centerOn(mercX(20), (y0 + y1) / 2); R.clampCam(); R.dirty();
}
// Bottom sheet with three heights: peek (just the essentials), half, and nearly full screen. Drag or tap the handle.
const SHEET_H = { peek: () => 148, half: () => Math.round(window.innerHeight * 0.42), full: () => Math.round(window.innerHeight * 0.86) };
export function setSheet(state) {
  const sh = $('#sheet'); if (!sh) return;
  app.sheet = state; sh.dataset.state = state; sh.style.height = SHEET_H[state]() + 'px';
}
function setupSheet() {
  const sh = $('#sheet'), grab = sh.querySelector('.grab'); let y0 = 0, h0 = 0, moved = false, dragging = false;
  grab.addEventListener('pointerdown', (e) => { dragging = true; moved = false; y0 = e.clientY; h0 = sh.getBoundingClientRect().height; grab.setPointerCapture(e.pointerId); sh.classList.add('dragging'); });
  grab.addEventListener('pointermove', (e) => { if (!dragging) return; const dy = y0 - e.clientY; if (Math.abs(dy) > 4) moved = true; sh.style.height = Math.max(60, Math.min(window.innerHeight * 0.9, h0 + dy)) + 'px'; });
  const end = () => {
    if (!dragging) return; dragging = false; sh.classList.remove('dragging');
    if (!moved) { setSheet(app.sheet === 'peek' ? 'half' : app.sheet === 'half' ? 'full' : 'peek'); return; }
    const hNow = sh.getBoundingClientRect().height; let best = 'half', bd = Infinity;
    for (const k of ['peek', 'half', 'full']) { const d = Math.abs(SHEET_H[k]() - hNow); if (d < bd) { bd = d; best = k; } }
    setSheet(best);
  };
  grab.addEventListener('pointerup', end); grab.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => setSheet(app.sheet || 'peek'));
  setSheet('peek');
}
export function setMode(m) {
  if (m === 'draw' && app.mode !== 'draw') { app.tool = plan() ? 'brush' : 'pan'; }
  else if (m !== 'draw' && m !== 'edit') app.tool = 'pan';
  if (m === 'edit' && app.mode !== 'edit') app.tool = 'pan';
  if (m !== 'sim' && app.histOwner) viewHistory(null);
  if (m !== app.mode) { infoOpen = false; app.sel = null; }
  app.mode = m;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  document.body.dataset.mode = m;
  if (app.sheet === 'peek' && (m === 'draw' || m === 'edit')) setSheet('half');
  if (m === 'draw') { computePlanStats(); ensurePlanPack(); }
  refresh(); refreshPanels();
}

export const dateLabel = () => app.histOwner ? `Borders of ${app.W.startYear + Math.floor(app.histMonth / 12)}` : dateOf(app.W.month, app.W.startYear);
export function toast(text, ms = 2600) {
  const t = $('#toast'); t.textContent = text; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ the dock
// One floating instrument bar above the sheet: drawing tools in Draw / God mode, the clock in Simulate.
function renderDock() {
  const dk = $('#dock'); if (!dk) return;
  dk.innerHTML = ''; let content = null;
  if (app.mode === 'draw' && plan() && !(plan().unit === 'precincts' && !planLayer(app.W, plan())) && ['paint', 'coi'].includes(app.drawTab)) content = drawDock(plan());
  else if (app.mode === 'sim') content = simDock();
  else if (app.mode === 'edit' && ['borders', 'data'].includes(app.editTool) && (app.editTool === 'data' || app.paintChosen)) content = editDock();
  dk.hidden = !content; if (content) dk.append(...[].concat(content));
  dk.dataset.mode = app.mode;
  if (app.updPad) app.updPad();
}
const toolBtn = (t, ic, label, after) => h('button', { class: 'tool' + (app.tool === t ? ' on' : ''), 'aria-label': label, 'aria-pressed': String(app.tool === t), onclick: () => { app.tool = t; if (after) after(t); refreshPanels(); } }, h('span', { class: 'ti', html: ICON[ic] }), h('small', null, label));
const undoBtns = () => [h('div', { class: 'undo2' },
  h('button', { 'aria-label': 'Undo', disabled: !app.undo.length, onclick: () => undoRedo(false), html: ICON.undo }),
  h('button', { 'aria-label': 'Redo', disabled: !app.redo.length, onclick: () => undoRedo(true), html: ICON.redo }))];
function brushStepper() {
  if (!['brush', 'erase'].includes(app.tool)) return null;
  const set = (v) => { app.brush = clamp(v, 1, 16); refreshPanels(); };
  return h('div', { class: 'stepper', title: 'Brush size' }, h('button', { 'aria-label': 'Smaller brush', onclick: () => set(app.brush - 1) }, '−'), h('b', null, app.brush), h('button', { 'aria-label': 'Bigger brush', onclick: () => set(app.brush + 1) }, '+'));
}
// painting needs the map, so tools that paint fold the sheet down
const foldSheet = (t) => { if (['brush', 'erase', 'fill'].includes(t) && app.sheet !== 'peek' && window.innerWidth < 760) setSheet('peek'); };
function drawDock(p) {
  const st = app.stats, coi = app.drawTab === 'coi';
  const tools = coi ? [['pan', 'hand', 'Move'], ['brush', 'brush', 'Paint'], ['erase', 'eraser', 'Erase']] : [['pan', 'hand', 'Move'], ['brush', 'brush', 'Paint'], ['erase', 'eraser', 'Erase'], ['fill', 'bucket', 'Fill'], ['pick', 'dropper', 'Pick']];
  // the seal: current district (or place), its colour, and how full it is against the ideal population
  let seal;
  if (coi) { const c = p.cois && p.cois[app.coi]; seal = h('button', { class: 'seal', style: { '--c': hex(COI_COLORS[(app.coi || 0) % COI_COLORS.length]), '--f': '1turn' }, onclick: () => setSheet('half'), 'aria-label': 'Current place' }, h('b', null, c ? c.name.slice(0, 2) : '—')); }
  else {
    const d = st && st.districts[app.district], fill = d && st.ideal ? clamp(d.pop / st.ideal, 0, 1.5) : 0;
    seal = h('button', { class: 'seal' + (d && Math.abs(d.dev) > 0.05 && d.units ? ' off' : ''), style: { '--c': hex(p.colors[app.district]), '--f': Math.min(1, fill) + 'turn' }, 'aria-label': `District ${app.district + 1}, tap to choose another`, onclick: () => openDistrictPicker(p) },
      h('b', null, app.district + 1), h('small', null, d && d.units ? (d.dev >= 0 ? '+' : '') + (d.dev * 100).toFixed(1) + '%' : 'empty'));
  }
  return [h('div', { class: 'toolrow' }, ...tools.map(([t, ic, l]) => toolBtn(t, ic, l, foldSheet))), ...undoBtns(), brushStepper(), seal].filter(Boolean);
}
function openDistrictPicker(p) {
  const st = app.stats, grid = h('div', { class: 'dpick' });
  for (let d = 0; d < p.n; d++) {
    const ds = st && st.districts[d];
    grid.append(h('button', { class: 'dchip' + (d === app.district ? ' on' : '') + (p.locked[d] ? ' locked' : ''), style: { '--c': hex(p.colors[d]) }, onclick: () => { app.district = d; if (app.tool === 'pan' || app.tool === 'pick') app.tool = 'brush'; closeModal(); refreshPanels(); } },
      h('b', null, d + 1), h('small', { class: ds && Math.abs(ds.dev) > 0.05 && ds.units ? 'bad' : '' }, ds && ds.units ? (ds.dev >= 0 ? '+' : '') + (ds.dev * 100).toFixed(1) + '%' : 'empty')));
  }
  openModal('Paint which district?', h('div', null, grid, st ? h('p', { class: 'muted small' }, `Each district should hold about ${fmt(st.ideal)} people. The number under each is how far it is from that.`) : null));
}
function simDock() {
  const W = app.W;
  return [
    h('button', { class: 'play' + (app.running ? ' on' : ''), 'aria-label': app.running ? 'Pause' : 'Play', html: app.running ? ICON.pause : ICON.play, onclick: () => { if (app.histOwner) viewHistory(null); setRunning(!app.running); } }),
    h('div', { class: 'clock' }, h('b', { id: 'dockDate' }, dateLabel()), h('small', null, app.running ? ['', 'Running', 'Running fast', 'Running faster', 'Flat out'][app.speed] : W.month ? 'Paused' : 'Press play to start history')),
    h('div', { class: 'speeds', role: 'group', 'aria-label': 'Speed' }, [[1, '1×'], [2, '4×'], [3, '12×'], [4, 'Max']].map(([v, l]) => h('button', { class: app.speed === v ? 'on' : '', onclick: () => { app.speed = v; if (!app.running) setRunning(true); else refreshPanels(); } }, l))),
    h('button', { class: 'tool yr', 'aria-label': 'Advance one year', onclick: () => step(12) }, h('b', null, '+1'), h('small', null, 'year'))];
}
function editDock() {
  const W = app.W, borders = app.editTool === 'borders';
  const tools = borders ? [['pan', 'hand', 'Move'], ['brush', 'brush', 'Paint'], ['pick', 'dropper', 'Pick']] : [['pan', 'hand', 'Move'], ['brush', 'brush', 'Paint']];
  const n = W.nations[app.paintNation];
  const seal = borders ? h('button', { class: 'seal', style: { '--c': n ? hex(n.color) : '#5a5f68', '--f': '1turn' }, 'aria-label': 'Nation being painted', onclick: () => chooseNation('Paint land for…', (id) => { app.paintNation = id; app.paintChosen = true; app.tool = 'brush'; refreshPanels(); }, true, true) }, h('b', null, n ? (n.a3 || n.name).slice(0, 3) : '∅')) : null;
  return [h('div', { class: 'toolrow' }, ...tools.map(([t, ic, l]) => toolBtn(t, ic, l, foldSheet))), ...undoBtns(), brushStepper(), seal].filter(Boolean);
}

// ------------------------------------------------------------------ render
// Small floating legend on the map for maps that colour by value.
function mapLegend() {
  const el = $('#mapLegend'); if (!el) return; const L = app.legend, t = theme();
  if (!L || L.type !== 'ramp' || app.mode === 'draw' || t.noLegend) { el.hidden = true; return; }
  el.hidden = false; el.innerHTML = '';
  const c = h('canvas', { width: 128, height: 1 }); const x = c.getContext('2d'); const img = x.createImageData(128, 1); const lut = rampLUT(L.ramp);
  for (let i = 0; i < 128; i++) { const k = Math.round((L.invert ? 127 - i : i) * 255 / 127); img.data.set([lut[k * 3], lut[k * 3 + 1], lut[k * 3 + 2], 255], i * 4); } x.putImageData(img, 0, 0);
  el.append(h('div', { class: 'ml-t' }, t.label), c, h('div', { class: 'ml-v' }, h('span', null, L.fmt(L.min)), h('span', null, L.fmt(L.max))));
}
export function refreshPanels() {
  renderDock(); mapLegend();
  $('#date').textContent = app.mode === 'draw' && plan() ? plan().name : dateLabel();
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
  $('#date').textContent = dateLabel(); const dd = $('#dockDate'); if (dd) dd.textContent = dateLabel();
  if (app.mode === 'sim') {
    const yr = Math.floor(app.W.month / 12);
    if (yr !== app._shownYear && !document.activeElement?.matches('input,select,textarea')) { app._shownYear = yr; refreshPanels(); return; }
    const ws = $('#worldStats'); if (ws) ws.replaceWith(worldStats());
    const ic = $('#infoCard'); if (ic && app.sel) ic.replaceWith(infoCard());
  }
}
export function onNews(n) {
  const feed = $('#news'); if (!feed || app.mode !== 'sim' || !newsPass(n, app.newsFilter || 'major')) return;
  if (feed.firstChild && feed.firstChild.classList && feed.firstChild.classList.contains('muted')) feed.innerHTML = '';
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
    return h('div', { class: 'legend nat' }, h('span', null, t.id === 'nations' ? `${alive} nations · ${W.wars.length} ${W.wars.length === 1 ? 'war' : 'wars'}` : `${W.D.units.countries.length} countries as of 2026`), btn('Rankings ›', () => openRankings('pop'), 'sm'));
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
export function mapStyleSection(redraw) {
  const st = app.settings, online = st.basemap !== 'none'; const again = () => { refreshPanels(); if (redraw) redraw(); };
  const out = h('b', null, Math.round(st.opacity * 100) + '%');
  return section('Base map',
    h('div', { class: 'chips' }, Object.entries(BASEMAPS).map(([k, b]) => h('button', { class: 'chip-s' + (st.basemap === k ? ' on' : ''), onclick: () => { st.basemap = k; app.basemapOffline = false; saveSettings(); applyMapStyle(); again(); } }, b.label))),
    online && !app.basemapOffline ? h('label', { class: 'slider' }, 'Overlay', h('input', { type: 'range', min: 0, max: 1, step: 0.02, value: st.opacity, oninput: (e) => { st.opacity = +e.target.value; out.textContent = Math.round(st.opacity * 100) + '%'; app.R.opts.opacity = st.opacity; app.R.dirty(); }, onchange: saveSettings }), out) : null,
    online && BASEMAPS[st.basemap].labels ? toggle('Place names on top', st.mapLabels, (v) => { st.mapLabels = v; saveSettings(); applyMapStyle(); }) : null,
    app.basemapOffline && st.basemap !== 'none' ? h('div', { class: 'offline' }, 'Offline — showing the built-in map. ', h('button', { class: 'linkbtn', onclick: () => { app.basemapOffline = false; applyMapStyle(); refreshPanels(); } }, 'Try again')) : online ? h('div', { class: 'muted small' }, 'Online map. Every area you look at is saved on your phone, so it still shows without internet.') : h('div', { class: 'muted small' }, 'Built-in map: works fully offline, with roads, railways, rivers and towns as you zoom in.'),
    online ? tileCacheRow() : null);
}
let tileInfoMemo = null;
function tileCacheRow() {
  const B = window.AndroidBridge; if (!B || !B.tileCacheInfo) return null;
  let info = tileInfoMemo && Date.now() - tileInfoMemo.t < 30000 ? tileInfoMemo.v : null;
  if (!info) { try { info = JSON.parse(B.tileCacheInfo()); tileInfoMemo = { t: Date.now(), v: info }; } catch { return null; } }
  const el = h('div', { class: 'kv small' }, h('span', null, `Saved for offline: ${info.files.toLocaleString()} map tiles · ${(info.bytes / 1048576).toFixed(0)} MB`),
    h('button', { class: 'linkbtn', onclick: () => { B.clearTileCache(); tileInfoMemo = null; toast('Saved map tiles cleared'); el.replaceWith(tileCacheRow() || h('span')); } }, 'Clear'));
  return el;
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
const LEVEL_NAMES = ['Nations', 'States', 'Districts', 'Sub-districts', 'Localities', 'Villages'];
let coverage = null;
function levelSection() {
  if (!coverage) levelCoverage().then((c) => { coverage = c; refreshPanels(); });
  const c = coverage || [];
  const names = localLevelNames();
  const el = section('Map level', h('div', { class: 'seg levels' }, LEVEL_NAMES.map((l, k) => h('button', { class: (LV.level || 0) === k ? 'on' : '', onclick: () => chooseLevel(k) }, h('b', null, k ? k : '🌐'), h('small', { 'data-lv': k }, names[k] || l)))),
    h('div', { class: 'muted small', id: 'levelStatus' }, (LV.level ? `${c[LV.level] || 0} countries have level ${LV.level}; others show their deepest level. ` : 'Real administrative areas for every country — tap a level. ') + (LV.note || '')));
  return el;
}
// what each level is called in the country at the middle of the map (Counties, Départements, Census tracts…)
function localLevelNames() {
  const out = [], mf = LV.mf; if (!mf || !app.R) return out;
  const i = cellAtScreen(...app.R.visibleCenter), c = i >= 0 ? app.W.D.cells.country[i] : 0, a3 = c ? app.W.D.units.countries[c - 1].a3 : null;
  if (!a3) return out;
  for (const m of mf) if (m.iso === a3 && !/^Level \d/.test(m.levelName)) { const n = m.levelName[0].toUpperCase() + m.levelName.slice(1); out[m.level] = n.length > 13 ? n.slice(0, 12) + '…' : n; }
  return out;
}
export function updateLevelLabels() {
  if (app.mode !== 'explore') return; const names = localLevelNames();
  document.querySelectorAll('.seg.levels small[data-lv]').forEach((e) => { const k = +e.dataset.lv; if (k) e.textContent = names[k] || LEVEL_NAMES[k]; });
}
function levelStatusHook(t) { const e = document.getElementById('levelStatus'); if (e && LV.level) e.textContent = `${(coverage || [])[LV.level] || 0} countries have level ${LV.level}. ${t || ''}`; }
function renderExplore(b) {
  const wc = welcomeCard(); if (wc) b.append(wc);
  b.append(section(null, legendEl()));
  b.append(levelSection());
  if (LV.level) {
    b.append(section('Colour areas by', quickThemes(levelThemesNow().map((t) => [t.id, t.label]))));
    return;
  }
  b.append(section('Quick maps', quickThemes([['nations', 'Nations'], ['density', 'Density'], ['dev', 'Development'], ['lean', 'Politics'], ['terrain', 'Terrain'], ['c_country', 'Real countries'], ['c_gdppc', 'Wealth'], ['p_name', 'Provinces'], ['k_pop', 'US counties'], ['climate', 'Climate']]),
    h('div', { class: 'btns' }, btn(`All ${app.catalog.length.toLocaleString()} maps`, openThemeBrowser, 'primary'), btn('US election results', openPrecinctPicker), btn('Base map & layers', openLayers))));
  const W = app.W;
  b.append(h('p', { class: 'muted small' }, `${W.land.length.toLocaleString()} land cells, ${W.D.units.provinces.length.toLocaleString()} provinces, ${W.D.units.counties.length.toLocaleString()} US counties and ${W.D.units.cities.length.toLocaleString()} cities. Tap anything for details.`));
}
// Base map, overlays and what is drawn on top — one panel from the layers button.
export function openLayers() {
  const body = h('div', null);
  const draw = () => {
    body.innerHTML = '';
    body.append(mapStyleSection(() => draw()));
    body.append(section('On the map', h('div', { class: 'tog-row col' },
      toggle('Real borders', app.show.borders, (v) => { app.show.borders = v; refresh(); }),
      toggle('Cities', app.show.cities, (v) => { app.show.cities = v; applyMapStyle(); }),
      toggle('Labels', app.show.labels, (v) => { app.show.labels = v; app.R.dirty(); }),
      toggle('Roads, railways and rivers (built-in map)', app.show.roads !== false, (v) => { app.show.roads = v; applyMapStyle(); }),
      toggle('Cell grid when zoomed in', app.show.grid, (v) => { app.show.grid = v; refresh(); }))));
  };
  draw(); openModal('Map layers', body);
}

// ------------------------------------------------------------------ info card
export function showInfo() { infoOpen = true; if (app.sheet === 'peek') setSheet('half'); refreshPanels(); $('#sheetBody').scrollTop = 0; }
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
    row('Military strength', `#${1 + app.W.nations.filter((x) => x && x.alive && x.mil > n.mil).length} in the world`), h('div', { class: 'kv' }, h('span', null, 'Stability'), h('span', { class: 'bar' }, h('i', { style: { width: pct(n.stab), background: n.stab > 0.5 ? '#5fbf7a' : n.stab > 0.28 ? '#e8b448' : '#e2583c' } }))),
    n.exh > 0.02 ? row('War exhaustion', pct(n.exh)) : null, row('Territory', `${n.cells.toLocaleString()} cells${n.occ > 0.01 ? ` (${pct(n.occ)} occupied)` : ''}`),
    bloc ? row('Alliance', bloc.name) : null,
    wars.length ? h('div', { class: 'kv war' }, h('span', null, 'At war with'), h('b', null, wars.join(', '))) : null,
    n.gov === 'Republic' ? h('div', { class: 'parties' }, n.parties.map((p, k) => h('span', { class: 'party' + (k === n.ruling ? ' rule' : '') }, dot(PARTY_COLORS[k]), p.name, n.votes ? ` ${Math.round(n.votes[k] * 100)}%` : ''))) : null,
  );
  const lab = (arr, f) => { const a = arr[0], z = arr[arr.length - 1]; return `${f(a)} → ${f(z)} (${z >= a ? '+' : ''}${a ? Math.round((z / a - 1) * 100) : 0}%)`; };
  const y0 = app.W.startYear + Math.floor((n.hist.m[0] || 0) / 12);
  if (n.hist && n.hist.pop.length > 1) el.append(h('div', { class: 'sparks' },
    h('div', null, h('small', null, `Population since ${y0}`), spark(n.hist.pop, '#f1a03a'), h('small', { class: 'block' }, lab(n.hist.pop, fmt))),
    h('div', null, h('small', null, `Territory since ${y0}`), spark(n.hist.cells, '#6ab0e8'), h('small', { class: 'block' }, lab(n.hist.cells, (v) => fmt(v) + ' cells')))));
  return el;
}
function infoCard() {
  const s = app.sel, W = app.W, U = W.D.units, C = W.D.cells;
  const card = h('div', { class: 'card', id: 'infoCard' });
  const close = h('button', { class: 'x', onclick: hideInfo }, '×');
  if (s.lv) {
    const { P, u } = s.lv, W2 = app.W, n = W2.nations[W2.owner[s.cell]];
    const parent = P.county[u] !== 65535 && P.countyNames[P.county[u]];
    const census = P.race && P.race.length, RC = ['#9aa5b5', '#c98a3d', '#d6577a', '#5aa6c8', '#7cc27a', '#b48ad6'];
    card.append(close, h('h3', null, P.names[u] || P.units[u].n), h('div', { class: 'sub' }, [P.levelName, parent, P.title].filter(Boolean).join(' · ')),
      h('div', { class: 'grid2' }, row(census ? 'Population' : 'Population (est.)', fmt(P.pop[u])), row('Area', fmt(P.area[u]) + ' km²'), row('Density', P.area[u] ? fmt(P.pop[u] / P.area[u]) + '/km²' : '—'), P.vap ? row('Voting age', fmt(P.vap[u])) : row('Neighbours', String(P.adj[u].length / 2))),
      census ? h('div', { class: 'racebar' }, P.race.map((r, k) => { const v = P.pop[u] ? r.data[u] / P.pop[u] : 0; return v > 0.005 ? h('i', { style: { width: v * 100 + '%', background: RC[k % 6] }, title: r.label }) : null; })) : null,
      census ? h('div', { class: 'legend cats' }, P.race.map((r, k) => h('span', { class: 'li' }, dot(parseHex(RC[k % 6])), `${r.label} ${pct(P.pop[u] ? r.data[u] / P.pop[u] : 0)}`))) : null,
      ...(P.elections || []).slice(0, 3).map((e) => { const t = e.d[u] + e.r[u]; return t > 0 ? h('div', { class: 'vs wide' }, h('small', null, e.label), voteBar([e.d[u] / t, 0, e.r[u] / t], [{ name: 'Dem' }, {}, { name: 'Rep' }], { partyColors: PRECINCT_COLORS })) : null; }),
      n && n.alive ? row('Nation now (sim)', n.name) : null,
      h('div', { class: 'muted small' }, P.source),
      h('div', { class: 'btns' }, btn(`Draw districts from ${P.kind === 'admin' ? 'these' : 'precincts'}`, () => startLevelPlan(P.iso, P.level, P.key))));
    return card;
  }
  if (s.unit != null && s.layer) {
    const p = plan();
    const agg = unitAgg(app, s.layer);
    if (s.layer === 'precincts') {
      const P = W.D.packs[app.activePack], u = s.unit; if (!P) return card;
      card.append(close, h('h3', null, P.units[u].n), h('div', { class: 'sub' }, `${P.countyLabels && P.countyLabels[P.county[u]] ? P.countyLabels[P.county[u]] + ' · ' : ''}${P.title} · precinct ${P.ids[u] || u + 1}`),
        h('div', { class: 'grid2' }, row('Population (2010)', fmt(P.pop[u])), P.vap ? row('Voting age', fmt(P.vap[u])) : row('Area', fmt(P.area[u]) + ' km²')),
        P.race.length ? h('div', { class: 'racebar' }, P.race.map((r, k) => { const v = P.pop[u] ? r.data[u] / P.pop[u] : 0; return v > 0.005 ? h('i', { style: { width: v * 100 + '%', background: ['#9aa5b5', '#c98a3d', '#d6577a', '#5aa6c8', '#7cc27a'][k] }, title: r.label }) : null; })) : null,
        P.race.length ? h('div', { class: 'legend cats' }, P.race.map((r, k) => h('span', { class: 'li' }, dot(parseHex(['#9aa5b5', '#c98a3d', '#d6577a', '#5aa6c8', '#7cc27a'][k])), `${r.label} ${pct(P.pop[u] ? r.data[u] / P.pop[u] : 0)}`))) : null,
        ...P.elections.slice(0, 4).map((e) => { const t = e.d[u] + e.r[u]; return t > 0 ? h('div', { class: 'vs wide' }, h('small', null, e.label), voteBar([e.d[u] / t, 0, e.r[u] / t], [{ name: 'Dem' }, {}, { name: 'Rep' }], { partyColors: PRECINCT_COLORS })) : null; }));
    } else if (s.layer === 'provinces') {
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
  const place = [prov ? prov.n : null, county ? county.n : null].filter(Boolean).join(', ') || (cty ? cty.name : 'This spot');
  card.append(close, h('h3', null, n && n.alive ? [dot(n.color), n.name] : 'Unclaimed land'));
  if (n && n.alive) {
    card.append(nationBlock(n));
    card.append(h('div', { class: 'btns' },
      btn('Relations map', () => setTheme('rel_' + n.id)),
      btn('Zoom to', () => zoomToNation(n)),
      app.mode === 'edit' ? btn('Paint as this', () => { app.paintNation = n.id; app.paintChosen = true; app.editTool = 'borders'; app.tool = 'brush'; refreshPanels(); }) : null));
  }
  card.append(h('div', { class: 'sec-t' }, `This spot · ${place}`),
    h('div', { class: 'sub' }, `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'} · ${U.terrains[W.terrain[i]]}${C.flags[i] & 1 ? ' · river' : ''}${cty && n && cty.name !== n.name ? ' · historically ' + cty.name : ''}`),
    h('div', { class: 'grid2' },
      row('People here', fmt(W.pop[i])), row('Density', fmt(W.pop[i] / W.area[(i / W.Wd) | 0]) + '/km²'),
      row('Development', W.dev[i].toFixed(2)), row('Income', '$' + fmt(prodOf(W.dev[i]))),
      row('Political lean', leanText(W.lean[i])), row('Since 2026', W.pop0[i] ? ((W.pop[i] / W.pop0[i] - 1) * 100).toFixed(0) + '%' : '—')));
  for (const [k, arr] of Object.entries(W.custom)) card.append(row(k, fmt(arr[i], 2)));
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
    h('small', null, h('b', { style: { color: (NEWS_KIND[n.k] || NEWS_KIND.info)[1] } }, (NEWS_KIND[n.k] || NEWS_KIND.info)[0]), ' · ', dateOf(n.m, W.startYear)), h('span', null, n.t));
}
const NEWS_KIND = { war: ['War', '#e2583c'], peace: ['Peace', '#5fbf7a'], election: ['Election', '#6ab0e8'], rebel: ['Uprising', '#c77dff'], coup: ['Coup', '#f2b544'], disaster: ['Disaster', '#ff8f3a'], alliance: ['Alliance', '#4fd1c5'], info: ['News', '#8a94a6'] };
function newsPass(n, f) {
  if (f === 'all') return true;
  if (f === 'war') return n.k === 'war' || n.k === 'peace' || n.k === 'rebel';
  if (f === 'politics') return n.k === 'election' || n.k === 'coup' || n.k === 'alliance' || n.k === 'info';
  if (f === 'disaster') return n.k === 'disaster';
  return n.k !== 'election' || /change of government/.test(n.t); // headlines: skip routine re-elections
}
// Play / pause; pausing shows what changed since play was pressed.
export function setRunning(on) {
  const W = app.W;
  if (on && !app.running) {
    const cells = new Map(); for (const n of W.nations) if (n && n.alive) cells.set(n.id, n.cells);
    app.playSnap = { month: W.month, cells, newsLen: W.news.length, pop: W.nations.reduce((s2, n) => s2 + (n && n.alive ? n.pop : 0), 0) };
    app.summary = null;
  }
  if (!on && app.running) { app.summary = makeSummary(); autosave(); }
  app.running = on; refreshPanels();
}
function makeSummary() {
  const W = app.W, S = app.playSnap; if (!S || W.month - S.month < 6) return null;
  const newNews = W.news.slice(0, Math.max(0, W.news.length - S.newsLen + (W.news.length >= 400 ? 999 : 0))).filter((n) => n.m >= S.month);
  const fallen = [...S.cells.keys()].filter((id) => !W.nations[id].alive).map((id) => W.nations[id]);
  const born = W.nations.filter((n) => n && n.alive && !S.cells.has(n.id));
  const deltas = W.nations.filter((n) => n && n.alive && S.cells.has(n.id)).map((n) => [n, n.cells - S.cells.get(n.id)]).sort((a, b) => b[1] - a[1]);
  const pop = W.nations.reduce((s2, n) => s2 + (n && n.alive ? n.pop : 0), 0);
  return { years: (W.month - S.month) / 12, wars: newNews.filter((n) => n.k === 'war').length, peace: newNews.filter((n) => n.k === 'peace').length, coups: newNews.filter((n) => n.k === 'coup').length,
    fallen, born, gainers: deltas.filter((d) => d[1] > 0).slice(0, 3), losers: deltas.filter((d) => d[1] < 0).slice(-3).reverse(), popChange: pop / (S.pop || 1) - 1 };
}
function summaryCard(S) {
  const yrs = S.years >= 1 ? `${S.years.toFixed(S.years < 10 ? 1 : 0)} years` : `${Math.round(S.years * 12)} months`;
  const list = (arr) => arr.map(([n, d]) => h('span', { class: 'chg', onclick: () => { select({ cell: n.capital, nation: n.id }); zoomToNation(n); showInfo(); } }, dot(n.color), `${n.name} ${d > 0 ? '+' : ''}${d.toLocaleString()}`));
  return h('div', { class: 'card slim summary' }, h('button', { class: 'x', onclick: () => { app.summary = null; refreshPanels(); } }, '×'),
    h('h3', null, `What changed in ${yrs}`),
    h('div', { class: 'kvrow' }, row('Wars started', S.wars), row('Peace deals', S.peace)),
    h('div', { class: 'kvrow' }, row('Coups', S.coups), row('Population', (S.popChange >= 0 ? '+' : '') + pct(S.popChange, 1))),
    S.fallen.length ? h('p', { class: 'small' }, h('b', null, 'Gone: '), S.fallen.slice(0, 8).map((n) => n.name).join(', '), S.fallen.length > 8 ? ` +${S.fallen.length - 8}` : '') : null,
    S.born.length ? h('p', { class: 'small' }, h('b', null, 'New nations: '), S.born.slice(0, 8).map((n) => n.name).join(', '), S.born.length > 8 ? ` +${S.born.length - 8}` : '') : null,
    S.gainers.length ? h('div', { class: 'chgs' }, h('small', null, 'Grew (cells)'), list(S.gainers)) : null,
    S.losers.length ? h('div', { class: 'chgs' }, h('small', null, 'Shrank (cells)'), list(S.losers)) : null);
}
// ---- play-as-a-nation ----
function gameCard() {
  const W = app.W, G = W.game, n = W.nations[G.nation];
  if (G.ended) return h('div', { class: 'card slim game ' + (G.ended.won ? 'won' : 'lost') },
    h('h3', null, G.ended.won ? '🏆 Victory' : 'Game over'), h('p', null, G.ended.text), row('Final score', G.score.toLocaleString()),
    h('div', { class: 'btns' }, btn('Keep watching history', () => { endGame(W); refreshPanels(); }), btn('Play again', () => { endGame(W); openStartGame(); }, 'primary')));
  const card = h('div', { class: 'card slim game' },
    h('div', { class: 'gh' }, dot(n.color), h('b', null, n.name), h('span', { class: 'muted small' }, `${n.gov} · score ${G.score.toLocaleString()}`),
      h('button', { class: 'linkbtn', onclick: () => { select({ cell: n.capital, nation: n.id }); zoomToNation(n); showInfo(); } }, 'View')),
    h('div', { class: 'kvrow' },
      h('div', { class: 'kv' }, h('span', null, 'Approval'), h('span', { class: 'bar' }, h('i', { style: { width: pct(G.approval), background: G.approval > 0.5 ? '#5fbf7a' : G.approval > 0.3 ? '#e8b448' : '#e2583c' } }))),
      h('div', { class: 'kv' }, h('span', null, 'Stability'), h('span', { class: 'bar' }, h('i', { style: { width: pct(n.stab), background: n.stab > 0.5 ? '#5fbf7a' : n.stab > 0.28 ? '#e8b448' : '#e2583c' } })))),
    h('div', { class: 'kvrow' }, row('Economy rank', '#' + rankOf(W, n, 'gdp')), row('Military rank', '#' + rankOf(W, n, 'mil'))));
  if (G.events.length) {
    const e = G.events[0];
    card.append(h('div', { class: 'event' }, h('small', null, dateOf(e.m, W.startYear)), h('h4', null, e.title), h('p', null, e.text),
      h('div', { class: 'btns' }, e.options.map((o) => btn(o.label, () => { const out = resolveEvent(W, o.act); app.aggStamp++; rebuildCatalog(); refresh(); toast(out, 4000); refreshPanels(); }, o.act === 'war' ? 'danger' : '')))));
  }
  // budget
  const B = G.budget, sliders = h('div', { class: 'budget' });
  const draw = () => { sliders.innerHTML = ''; for (const [k, P] of Object.entries(POLICIES)) sliders.append(h('label', { class: 'slider' }, P.label, h('input', { type: 'range', min: 0, max: 100, step: 5, value: B[k], title: P.desc, oninput: (e) => setBudget(k, +e.target.value) }), h('b', null, B[k] + '%'))); };
  const setBudget = (k, v) => { // keep the total at 100%
    const others = Object.keys(B).filter((x) => x !== k), rest = 100 - v, cur = others.reduce((a, x) => a + B[x], 0) || 1;
    B[k] = v; let acc = 0; others.forEach((x, i) => { B[x] = i === others.length - 1 ? rest - acc : Math.round(B[x] / cur * rest / 5) * 5; acc += B[x]; });
    for (const x of others) if (B[x] < 0) { B[k] += B[x]; B[x] = 0; }
    [...sliders.querySelectorAll('input')].forEach((inp, i) => { const key = Object.keys(POLICIES)[i]; if (key !== k) inp.value = B[key]; inp.nextSibling.textContent = B[key] + '%'; });
  };
  draw();
  card.append(h('details', { class: 'sec', open: !G.events.length }, h('summary', null, 'Budget priorities'), sliders));
  card.append(h('details', { class: 'sec' }, h('summary', null, `Goals (${G.goals.filter((g) => g.done).length}/${G.goals.length})`),
    G.goals.map((g) => h('div', { class: 'check ' + (g.done ? 'ok' : 'no') }, h('b', null, g.done ? '✓' : '○'), h('span', null, g.text), h('small', null, g.done ? dateOf(g.done, W.startYear) : '')))));
  if (G.log.length) card.append(h('details', { class: 'sec' }, h('summary', null, 'Your decisions'), G.log.slice(0, 12).map((l) => h('div', { class: 'small' }, h('b', null, l.title), ' — ', l.out))));
  card.append(h('button', { class: 'linkbtn', onclick: () => { if (confirm('Stop playing as this nation? History keeps running.')) { endGame(W); refreshPanels(); } } }, 'Stop playing'));
  return card;
}
export function openStartGame() {
  const W = app.W; let pick = 0; const list = h('div', { class: 'tlist' });
  const draw = (q = '') => {
    list.innerHTML = ''; q = q.toLowerCase();
    W.nations.filter((n) => n && n.alive && n.cells > 3 && n.name.toLowerCase().includes(q)).sort((a, b) => b.pop - a.pop).slice(0, 150).forEach((n) => list.append(
      h('button', { class: 'titem', onclick: () => { closeModal(); startGame(W, n.id); app.mode !== 'sim' && setMode('sim'); select({ cell: n.capital, nation: n.id }); zoomToNation(n); app.sel = null; refreshPanels(); toast(`You lead ${n.name}. Press ▶ — decisions will come to you.`, 5000); } },
        dot(n.color), h('span', null, n.name, h('small', { class: 'block' }, `${n.gov} · economy #${rankOf(W, n, 'gdp')} · ${fmt(n.pop)} people`)), h('small', null, rankOf(W, n, 'gdp') <= 10 ? 'Easy' : rankOf(W, n, 'gdp') <= 50 ? 'Medium' : 'Hard'))));
  };
  const search = h('input', { class: 'search', placeholder: 'Search nations…', oninput: () => draw(search.value) });
  draw();
  openModal('Choose your nation', h('div', null, h('p', { class: 'muted small' }, 'Lead one nation through history. Set budget priorities, answer crises, make or break alliances, and reach your goals before you lose power.'), search, list));
}
function renderSim(b) {
  const W = app.W;
  if (W.game) b.append(gameCard());
  else b.append(btn('👑 Play as a nation…', openStartGame, 'wide'));
  if (app.summary && !app.running) b.append(summaryCard(app.summary));
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
  const F = app.newsFilter || 'major';
  const items = W.news.filter((n) => newsPass(n, F)).slice(0, 50);
  const feed = h('div', { id: 'news' }, items.map(newsItem));
  if (!items.length) feed.append(h('div', { class: 'muted small' }, W.news.length ? 'Nothing of this kind yet.' : 'No events yet. Press ▶ to start history.'));
  b.append(section('World news', h('div', { class: 'chips' }, [['major', 'Headlines'], ['war', 'Wars'], ['politics', 'Politics'], ['disaster', 'Disasters'], ['all', 'Everything']].map(([k, l]) => h('button', { class: 'chip-s' + (F === k ? ' on' : ''), onclick: () => { app.newsFilter = k; refreshPanels(); } }, l))), feed));
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
  if (app.district >= p.n || app.district < 0) app.district = 0;
  if (p.unit === 'precincts' && !planLayer(W, p)) {
    b.append(h('div', { class: 'card slim' }, h('p', null, `This plan uses ${p.pack.startsWith('L:') ? 'local areas (' + p.pack.slice(2) + ')' : p.pack + ' precincts'}.`), btn('Load map', () => ensurePlanPack(), 'primary wide')));
    return;
  }
  b.append(h('div', { class: 'planbar' },
    h('select', { onchange: async (e) => { app.activePlan = +e.target.value; app.district = 0; await ensurePlanPack(); computePlanStats(); refresh(); refreshPanels(); } }, W.plans.map((x) => h('option', { value: x.id, selected: x.id === p.id }, x.name + (x.status && x.status !== 'Scratch work' ? ` · ${x.status}` : '')))),
    btn('＋', () => openModal('New district plan', newPlanForm(true)), 'sq'),
    btn('⋯', () => openPlanMenu(p), 'sq')));
  if (app.stats) b.append(districtStrip(p, app.stats));
  b.append(seg([['paint', 'Paint'], ['pop', 'People'], ['coi', 'Places'], ['layers', 'Layers'], ['eval', 'Evaluate']], app.drawTab, (v) => { const was = app.drawTab; app.drawTab = v; if (was === 'coi' || v === 'coi') refresh(); refreshPanels(); }));
  const st = app.stats;
  if (app.drawTab === 'pop') return renderPopTab(b, p, st);
  if (app.drawTab === 'layers') return renderLayersTab(b, p);
  if (app.drawTab === 'coi') return renderCoiTab(b, p);
  if (app.drawTab === 'eval') return renderEvalTab(b, p, st);
  const O = app.drawOpts;
  b.append(h('div', { class: 'tog-row' },
    toggle(`Paint whole ${parentWord(app.W, p)}`, O.parent, (v) => { O.parent = v; }),
    toggle("Don't paint over other districts", O.noOverwrite, (v) => { O.noOverwrite = v; })));
  b.append(btn('✨ Auto-draw fair districts…', () => openAutoDraw(p), 'wide'));
  b.append(districtChips(p, st));
  if (p.unit === 'precincts' && planLayer(W, p).pack.elections.length) b.append(electionPicker(p));
  if (st) {
    const sel = st.districts[app.district];
    b.append(h('div', { class: 'card slim' },
      h('div', { class: 'kvrow' }, row('District ' + (app.district + 1), fmt(sel.pop) + ' people'), row('Target', fmt(st.ideal))),
      h('div', { class: 'kvrow' }, row('Compactness', sel.units ? sel.pp.toFixed(2) : '—'), row('Contiguous', sel.units ? (sel.pieces <= 1 ? 'Yes' : `No (${sel.pieces} pieces)`) : '—')),
      sel.units ? voteBar(sel.shares, st.parties) : null,
      h('div', { class: 'btns' }, btn(p.locked[app.district] ? '🔓 Unlock' : '🔒 Lock', () => { p.locked[app.district] = !p.locked[app.district]; refreshPanels(); }), btn('Zoom to', () => zoomToDistrict(p, app.district)))));
    b.append(h('div', { class: 'muted small' }, `${fmt(st.unassignedPop)} people unassigned · largest deviation ${pct(st.maxDev, 1)} · ${scopeLabel(p)}`));
  }
}
// Districtr-style balance strip: one bar per district, the line is the ideal population.
function districtStrip(p, st) {
  const el = h('div', { class: 'dstrip', role: 'group', 'aria-label': 'District populations' });
  for (const d of st.districts) {
    const f = st.ideal ? d.pop / st.ideal : 0, bad = d.units && Math.abs(d.dev) > 0.05;
    el.append(h('button', { class: 'db' + (d.k === app.district ? ' on' : '') + (bad ? ' bad' : ''), style: { '--c': hex(p.colors[d.k]) }, title: `District ${d.k + 1}: ${fmt(d.pop)} (${(d.dev * 100).toFixed(1)}%)`,
      onclick: () => { app.district = d.k; if (app.tool === 'pan' || app.tool === 'pick') app.tool = 'brush'; refreshPanels(); } }, h('i', { style: { height: Math.min(100, f / 1.25 * 100) + '%' } })));
  }
  return h('div', { class: 'dstripw' }, el, h('small', { class: 'muted' }, `${fmt(st.unassignedPop)} people unassigned · largest deviation ${pct(st.maxDev, 1)}`));
}
function electionPicker(p) {
  const P = planLayer(app.W, p).pack;
  if (!P.elections.length) return h('div', { class: 'muted small' }, 'No election results in this state\'s data.');
  return h('label', { class: 'field' }, 'Votes from', h('select', { onchange: (e) => { p.election = +e.target.value; computePlanStats(); refreshPanels(); } }, P.elections.map((e, k) => h('option', { value: k, selected: k === (p.election || 0) }, e.label))));
}
function districtChips(p, st) {
  const chips = h('div', { class: 'districts' });
  for (let d = 0; d < p.n; d++) {
    const ds = st && st.districts[d];
    let lp = 0, longed = false;
    chips.append(h('button', { class: 'dchip' + (d === app.district ? ' on' : '') + (p.locked[d] ? ' locked' : ''), style: { '--c': hex(p.colors[d]) }, title: 'Long-press to lock',
      onpointerdown: () => { longed = false; clearTimeout(lp); lp = setTimeout(() => { longed = true; p.locked[d] = !p.locked[d]; toast(`District ${d + 1} ${p.locked[d] ? 'locked' : 'unlocked'}`); refreshPanels(); }, 480); },
      onpointerup: () => clearTimeout(lp), onpointerleave: () => clearTimeout(lp), oncontextmenu: (e) => e.preventDefault(),
      onclick: () => { if (longed) return; app.district = d; if (app.tool === 'pan' || app.tool === 'pick') app.tool = 'brush'; refreshPanels(); } },
      h('b', null, d + 1), h('small', { class: ds && Math.abs(ds.dev) > 0.05 ? 'bad' : '' }, ds && ds.units ? (ds.dev >= 0 ? '+' : '') + (ds.dev * 100).toFixed(1) + '%' : '—')));
  }
  return chips;
}
// Districtr's population tab: one balance bar per district against the ideal size.
// Districtr-style communities of interest: name a place that should stay together and paint it.
function renderCoiTab(b, p) {
  ensureCoi(p); const W = app.W; if (app.coi == null || app.coi >= p.cois.length) app.coi = 0;
  b.append(h('p', { class: 'muted small' }, 'Mark places that belong together — a neighbourhood, a school area, a farming region — then check whether your districts split them.'));
  const rep = coiReport(W, p);
  for (const R of rep) {
    const c = p.cois[R.k], col = COI_COLORS[R.k % COI_COLORS.length];
    b.append(h('div', { class: 'card slim coi' + (app.coi === R.k ? ' on' : ''), onclick: (e) => { if (e.target.closest('button,input,textarea')) return; app.coi = R.k; if (app.tool === 'pan') app.tool = 'brush'; refreshPanels(); } },
      h('div', { class: 'coih' }, h('span', { class: 'dot', style: { background: hex(col), width: '14px', height: '14px' } }), h('input', { value: c.name, onchange: (e) => { c.name = e.target.value || c.name; } }),
        h('button', { class: 'x', style: { position: 'static' }, onclick: () => { if (!confirm(`Delete “${c.name}”?`)) return; for (let u = 0; u < p.coiAssign.length; u++) { if (p.coiAssign[u] === R.k) p.coiAssign[u] = -1; else if (p.coiAssign[u] > R.k) p.coiAssign[u]--; } p.cois.splice(R.k, 1); app.coi = 0; refresh(); refreshPanels(); } }, '×')),
      h('textarea', { rows: 2, placeholder: 'Why does this place belong together?', oninput: (e) => { c.note = e.target.value; } }, c.note || ''),
      R.units ? h('div', { class: 'small' }, R.whole ? h('b', { style: { color: 'var(--good)' } }, `✓ Kept whole in district ${R.parts[0] ? R.parts[0][0] + 1 : '—'}`) : h('b', { style: { color: '#ff9b85' } }, `Split between ${R.parts.length} districts${R.by.has(-1) ? ' (+ unassigned)' : ''}`), ` · ${fmt(R.pop)} people`,
        !R.whole ? h('div', { class: 'chips' }, R.parts.map(([d, v]) => h('span', { class: 'chip-s' }, h('span', { class: 'dot', style: { background: hex(p.colors[d]) } }), `${d + 1}: ${pct(v / (R.pop || 1))}`))) : null)
        : h('div', { class: 'muted small' }, app.coi === R.k ? 'Paint it on the map.' : 'Tap to select, then paint it on the map.')));
  }
  b.append(btn('＋ New place', () => { const k = p.cois.length; p.cois.push({ name: `Place ${k + 1}`, note: '' }); app.coi = k; app.tool = 'brush'; refreshPanels(); }, 'wide' + (p.cois.length ? '' : ' primary')));
}
function renderPopTab(b, p, st) {
  if (!st) return;
  const maxPop = Math.max(st.ideal * 1.25, ...st.districts.map((d) => d.pop)) || 1;
  b.append(h('div', { class: 'kvrow' }, row('Ideal', fmt(st.ideal)), row('Unassigned', fmt(st.unassignedPop))));
  const list = h('div', { class: 'popbars' });
  for (const d of st.districts) {
    const ok = Math.abs(d.dev) <= 0.05;
    list.append(h('button', { class: 'popbar' + (d.k === app.district ? ' on' : ''), onclick: () => { app.district = d.k; app.drawTab = 'paint'; if (app.tool === 'pan') app.tool = 'brush'; refreshPanels(); } },
      h('span', { class: 'num', style: { background: hex(p.colors[d.k]) } }, d.k + 1),
      h('span', { class: 'track' }, h('i', { style: { width: (d.pop / maxPop * 100) + '%', background: hex(p.colors[d.k]) } }), h('em', { style: { left: (st.ideal / maxPop * 100) + '%' } })),
      h('small', { class: ok ? '' : 'bad' }, d.units ? `${fmt(d.pop)} · ${(d.dev >= 0 ? '+' : '') + (d.dev * 100).toFixed(1)}%` : 'empty'),
      h('span', { class: 'lock', onclick: (e) => { e.stopPropagation(); p.locked[d.k] = !p.locked[d.k]; refreshPanels(); } }, p.locked[d.k] ? '🔒' : '🔓')));
  }
  b.append(list, h('p', { class: 'muted small' }, 'The white tick is the ideal population. Tap a district to paint it; tap the lock to protect it from painting.'));
}
function renderLayersTab(b, p) {
  const O = app.drawOpts, redraw = () => { refresh(); refreshPanels(); };
  b.append(section('Districts',
    h('div', { class: 'tog-row col' },
      toggle('Show data underneath (mix colours)', O.showData, (v) => { O.showData = v; redraw(); }),
      toggle('Hide districts', O.hideDistricts, (v) => { O.hideDistricts = v; redraw(); }),
      toggle('Highlight unassigned areas', O.highlightUnassigned, (v) => { O.highlightUnassigned = v; redraw(); }),
      toggle('Colour districts by vote (blue ↔ red)', O.byVote, (v) => { O.byVote = v; redraw(); }),
      toggle(`Show ${p.unit === 'provinces' ? 'country' : 'province / state'} boundaries`, O.boundaries, (v) => { O.boundaries = v; redraw(); }))));
  const t = theme();
  b.append(section('Data layer', h('div', { class: 'paintwith' }, h('span', null, t.layer === (p.unit === 'cells' ? 'cells' : p.unit) ? t.label : 'Pick a map for these units'), btn('Choose ›', openThemeBrowser, 'sm')),
    h('p', { class: 'muted small' }, p.unit === 'counties' ? 'Try Hispanic %, Black %, Minority % or density under your districts.' : 'Any map for this kind of unit can sit under your districts.')));
  b.append(mapStyleSection());
}
// ---- automatic map drawing (ReCom optimiser in a background worker) ----
export function openAutoDraw(p) {
  const W = app.W;
  const goals = app.autoGoals || (app.autoGoals = { compact: true, counties: true, competitive: false, proportional: false, seconds: 20, start: 'current' });
  const status = h('div', { class: 'muted small' }, 'Ready.');
  const bar = h('div', { class: 'pbar' }, h('i'));
  let worker = null;
  const run = h('button', { class: 'btn primary wide', onclick: () => {
    if (worker) { worker.postMessage({ type: 'stop' }); return; }
    const before = p.assign.slice();
    if (goals.start === 'fresh' || p.assign.some((d, u) => d < 0 && u < p.assign.length && (p.unit !== 'cells' || W.D.cells.country[u]))) randomPlan(W, p);
    const G = recomInput(W, p);
    const local = Int16Array.from(G.elig, (u) => Math.max(0, p.assign[u]));
    try { worker = new Worker('js/recom-worker.js'); } catch (e) { toast('This device cannot run the optimiser: ' + e.message, 5000); return; }
    run.textContent = 'Stop'; status.textContent = 'Searching…';
    const apply = (A) => { for (let i = 0; i < G.n; i++) p.assign[G.elig[i]] = A[i]; computePlanStats(); refresh(); };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress' || m.type === 'done') {
        apply(m.assign); bar.firstChild.style.width = Math.min(100, m.elapsed / (goals.seconds * 10)) + '%';
        status.textContent = `${m.steps.toLocaleString()} maps tried · ${m.accepted.toLocaleString()} kept · largest deviation ${pct(m.maxDev, 1)}`;
      }
      if (m.type === 'done' || m.type === 'error') {
        worker.terminate(); worker = null; run.textContent = 'Run again';
        if (m.type === 'error') { status.textContent = 'Error: ' + m.message; return; }
        const ch = new Map(); before.forEach((v, u) => { if (v !== p.assign[u]) ch.set(u, v); });
        if (ch.size) { app.undo.push({ tgt: 'plan', changes: ch, plan: p.id }); app.redo = []; }
        status.textContent += ' · done (Undo restores your map)'; refreshPanels();
      }
    };
    worker.onerror = (e) => { status.textContent = 'Error: ' + e.message; run.textContent = 'Run again'; worker = null; };
    worker.postMessage({ type: 'run', n: G.n, k: p.n, off: G.off, nb: G.nb, pop: G.pop, dem: G.dem, rep: G.rep, parent: goals.counties ? G.parent : null, assign: local, timeMs: goals.seconds * 1000, tol: 0.01, goals, seed: (Math.random() * 1e9) | 0 });
  } }, 'Draw it');
  const body = h('div', { class: 'form' },
    h('p', { class: 'muted small' }, 'Uses ReCom — the method MGGG (the makers of Districtr) use to study fair maps: it repeatedly merges two neighbouring districts and splits them again along a random tree, keeping changes that score better. Districts always stay in one piece and within 1% population.'),
    h('div', { class: 'sec-t' }, 'Goals'),
    h('div', { class: 'tog-row col' },
      toggle('Compact shapes', goals.compact, (v) => { goals.compact = v; }),
      toggle(`Keep ${parentWord(app.W, p)} whole`, goals.counties, (v) => { goals.counties = v; }),
      toggle('More competitive districts', goals.competitive, (v) => { goals.competitive = v; }),
      toggle('Seats proportional to votes', goals.proportional, (v) => { goals.proportional = v; })),
    h('label', null, 'Start from', h('select', { onchange: (e) => { goals.start = e.target.value; } }, h('option', { value: 'current', selected: goals.start === 'current' }, 'My current map'), h('option', { value: 'fresh', selected: goals.start === 'fresh' }, 'A fresh random map'))),
    h('label', { class: 'slider' }, 'Time', h('input', { type: 'range', min: 5, max: 120, step: 5, value: goals.seconds, oninput: (e) => { goals.seconds = +e.target.value; e.target.nextSibling.textContent = goals.seconds + 's'; } }), h('b', null, goals.seconds + 's')),
    run, bar, status);
  openModal('Auto-draw districts', body);
  const mo = $('#modal'); const obs = new MutationObserver(() => { if (mo.classList.contains('hidden') && worker) worker.postMessage({ type: 'stop' }); }); obs.observe(mo, { attributes: true });
}
function renderEvalTab(b, p, st) {
  if (!st) return;
  const sp = planSplits(app.W, p, app.provCells);
  const complete = st.unassignedUnits === 0, contiguous = st.districts.every((d) => d.pieces <= 1), balanced = st.maxDev <= 0.05;
  const pps = st.districts.filter((d) => d.units).map((d) => d.pp);
  const check = (ok, label, detail) => h('div', { class: 'check ' + (ok ? 'ok' : 'no') }, h('b', null, ok ? '✓' : '✗'), h('span', null, label), h('small', null, detail));
  b.append(h('div', { class: 'card slim' },
    check(complete, 'Complete', complete ? 'every area is assigned' : `${st.unassignedUnits.toLocaleString()} units / ${fmt(st.unassignedPop)} people left`),
    check(contiguous, 'Contiguous', contiguous ? 'every district is one piece' : `${st.districts.filter((d) => d.pieces > 1).length} districts in pieces`),
    check(balanced, 'Population balance', `largest deviation ${pct(st.maxDev, 1)} (aim for ≤5%)`),
    check(sp.split <= p.n, `${(w => w[0].toUpperCase() + w.slice(1))(parentWord(app.W, p, false))} splits`, `${sp.split} of ${sp.parents} split`),
    row('Compactness (Polsby-Popper)', pps.length ? `avg ${(pps.reduce((a, c) => a + c, 0) / pps.length).toFixed(2)} · min ${Math.min(...pps).toFixed(2)}` : '—')));
  if (p.cois && p.cois.length) { const R = coiReport(app.W, p).filter((x) => x.units); if (R.length) b.append(h('div', { class: 'card slim' }, check(R.every((x) => x.whole), 'Places kept whole', `${R.filter((x) => x.whole).length} of ${R.length}`))); }
  if (p.unit === 'precincts') b.append(electionPicker(p));
  if (st.raceLabels) {
    const tot = st.districts.reduce((a, d) => a + d.pop, 0) || 1;
    b.append(section('Demographics (2010 Census)', h('div', { class: 'scrollx' }, h('table', { class: 'tbl' },
      h('tr', null, h('th', null, '#'), ...st.raceLabels.map((l) => h('th', null, l))),
      st.districts.filter((d) => d.units).map((d) => h('tr', null, h('td', null, h('span', { class: 'dot', style: { background: hex(p.colors[d.k]) } }), d.k + 1),
        ...st.raceLabels.map((_, k) => { const v = d.pop ? d.race[k] / d.pop : 0; return h('td', { class: v >= 0.5 && k > 0 ? 'maj' : '' }, pct(v)); })))))));
  }
  if (st.contested) {
    const N = st.partyNames, rowsV = st.districts.filter((d) => d.units).map((d) => { const t = d.votes[0] + d.votes[1] + d.votes[2] || 1; return { k: d.k, a: d.votes[0] / t, b: d.votes[2] / t }; });
    b.append(section(`Votes by district${st.election ? ' · ' + st.election : ''}`, h('div', { class: 'scrollx' }, h('table', { class: 'tbl' },
      h('tr', null, h('th', null, '#'), h('th', null, N[0] + ' %'), h('th', null, N[2] + ' %'), h('th', null, 'Margin')),
      rowsV.sort((x, y) => (y.a - y.b) - (x.a - x.b)).map((r) => h('tr', { onclick: () => { app.district = r.k; zoomToDistrict(p, r.k); } }, h('td', null, h('span', { class: 'dot', style: { background: hex(p.colors[r.k]) } }), r.k + 1),
        h('td', null, pct(r.a, 1)), h('td', null, pct(r.b, 1)), h('td', null, h('b', { style: { color: hex(pcol(st, r.a >= r.b ? 0 : 2)) } }, `${r.a >= r.b ? st.partyShort[0] : st.partyShort[2]} +${Math.round(Math.abs(r.a - r.b) * 100)}`))))))));
  }
  if (st.contested) b.append(h('div', { class: 'card slim' }, h('div', { class: 'kv' }, h('span', null, 'Seats'), h('span', { class: 'seats' }, st.seats.map((n, k) => (n || k !== 1) ? h('b', { style: { color: hex(pcol(st, k)) } }, `${n} ${st.partyShort[k]}`) : null))), fairness(st, false)));
  b.append(h('div', { class: 'btns' }, btn('Full table', openStats), btn('Export CSV', () => exportPlanCSV(p)), btn('Export report', () => exportReport(p, st, sp))));
}
function exportReport(p, st, sp) {
  const rep = { plan: p.name, status: p.status || 'Scratch work', notes: p.notes || '', units: p.unit, area: p.scope ? app.W.D.units.countries[p.scope - 1].name : 'World', districts: p.n, date: dateLabel(),
    complete: st.unassignedUnits === 0, unassignedPopulation: Math.round(st.unassignedPop), idealPopulation: Math.round(st.ideal), maxDeviation: st.maxDev,
    splits: sp, efficiencyGap: st.eg, meanMedian: st.meanMedian, voteShare: st.voteShare, seats: st.seats,
    perDistrict: st.districts.map((d) => ({ district: d.k + 1, population: Math.round(d.pop), deviation: d.dev, pieces: d.pieces, polsbyPopper: d.pp, areaKm2: Math.round(d.area), votes: d.shares, winner: ['Left', 'Centre', 'Right'][d.winner] || null })) };
  saveFile(p.name.replace(/\W+/g, '_') + '_report.json', new Blob([JSON.stringify(rep, null, 2)], { type: 'application/json' }));
}
function importPlanCSV(p) {
  const inp = h('input', { type: 'file', accept: '.csv,text/csv,text/plain,*/*', style: { display: 'none' }, onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = importCSV(app.W, p, await f.text()); app.undo = []; app.redo = []; computePlanStats(); refresh(); refreshPanels();
    toast(`Imported ${r.ok.toLocaleString()} assignments${r.bad ? `, skipped ${r.bad}` : ''}`, 4000);
  } });
  document.body.append(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
}
const packWhat = (P) => !P ? 'areas' : P.kind === 'admin' ? (P.levelName || 'areas') : 'precincts';
const scopeLabel = (p) => p.unit === 'precincts' ? `${planLayer(app.W, p) ? planLayer(app.W, p).pack.title : p.pack} ${packWhat(planLayer(app.W, p) && planLayer(app.W, p).pack)} · ${p.n} districts` : `${UNIT_TYPES[p.unit]} · ${p.scope ? app.W.D.units.countries[p.scope - 1].name : 'whole world'} · ${p.n} districts${p.electionsUse && p.scope ? ' · used in this country\'s elections' : ''}`;
function egText(eg, st = app.stats) { const a = Math.abs(eg), N = st ? st.partyNames : ['Left', '', 'Right']; return a < 0.02 ? 'balanced' : `${(a * 100).toFixed(1)}% toward ${eg > 0 ? N[2] : N[0]}`; }
function fairness(st, compact) {
  const seatsPct = st.seats.map((v) => v / Math.max(1, st.contested));
  const rows = [
    h('div', { class: 'vs' }, h('small', null, 'Votes'), voteBar(st.voteShare, st.parties)),
    h('div', { class: 'vs' }, h('small', null, 'Seats'), voteBar(seatsPct, st.parties)),
    row('Efficiency gap', egText(st.eg, st)),
  ];
  if (!compact) rows.push(row(`Mean–median (${st.partyNames[0]} share)`, (st.meanMedian >= 0 ? '+' : '') + (st.meanMedian * 100).toFixed(1) + ' pts'), row('Competitive districts (<10% margin)', `${st.competitive} of ${st.contested}`));
  return h('div', { class: 'fair' }, rows);
}
const pcol = (st, k) => (st && st.partyColors ? st.partyColors : PARTY_COLORS)[k];
function voteBar(shares, parties, st = app.stats) {
  return h('div', { class: 'votebar' }, shares.map((s, k) => s > 0.001 ? h('i', { style: { width: (s * 100) + '%', background: hex(pcol(st, k)) }, title: parties[k].name || '' }, s > 0.12 ? Math.round(s * 100) + '%' : '') : null));
}
function zoomToDistrict(p, d) {
  const W = app.W; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  if (p.unit === 'cells') { for (const i of W.land) if (p.assign[i] === d) { const x = i % W.Wd, y = (i / W.Wd) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } if (x0 > x1) return; const dd = 360 / W.Wd; app.R.fitBounds(-180 + x0 * dd, 90 - (y1 + 1) * dd, -180 + (x1 + 1) * dd, 90 - y0 * dd); return; }
  const c = app.planCentroids && app.planCentroids[d]; if (!c) return; app.R.cam.x = c[0]; app.R.cam.y = c[1]; app.R.cam.s = Math.max(app.R.cam.s, 3000 * app.R.dpr); app.R.clampCam(); app.R.dirty();
}
function newPlanForm(inModal) {
  const W = app.W, U = W.D.units;
  const st = { name: 'Plan ' + (W.plans.length + 1), unit: 'precincts', scope: U.countries.findIndex((c) => c.a3 === 'USA') + 1, n: 10, random: false, pack: app.precinctPreset || 'PA', real: -1 }; app.precinctPreset = null;
  const scopeSel = h('select', { onchange: (e) => { st.scope = +e.target.value; } },
    h('option', { value: 0 }, 'Whole world'), [...U.countries.map((c, k) => [c.name, k + 1])].sort().map(([n, v]) => h('option', { value: v, selected: v === st.scope }, n)));
  const packSel = h('select', { onchange: (e) => { st.pack = e.target.value; showPack(); } });
  const packInfo = h('div', { class: 'muted small' });
  const realSel = h('select', { onchange: (e) => { st.real = +e.target.value; } });
  const nInput = h('input', { type: 'number', min: 2, max: 435, value: st.n, oninput: (e) => { st.n = clamp(+e.target.value || 2, 2, 435); } });
  let packs = [];
  const showPack = () => {
    const m = packs.find((x) => x.state === st.pack); if (!m) return;
    packInfo.textContent = `${m.count.toLocaleString()} precincts · ${fmt(m.pop)} people (2010) · ${m.elections.length} elections · ${(m.bytes / 1048576).toFixed(1)} MB download (once)`;
    realSel.innerHTML = ''; realSel.append(h('option', { value: -1 }, 'Blank — draw it yourself'), ...m.plans.map((pl, k) => h('option', { value: k }, `${pl.label} (${pl.n} districts)`)));
    st.real = -1;
    const cong = m.plans.find((pl) => /^Congress/.test(pl.label)); if (cong) { st.n = cong.n; nInput.value = cong.n; }
    st.name = `${m.title} plan`; nameIn.value = st.name;
  };
  packList().then((list) => { packs = list; packSel.append(...list.map((m) => h('option', { value: m.state, selected: m.state === st.pack }, m.title))); showPack(); });
  const nameIn = h('input', { value: st.name, oninput: (e) => { st.name = e.target.value; } });
  const pctRows = h('div', null, h('label', null, 'State', packSel), packInfo, h('label', null, 'Start from', realSel));
  // admin areas of any country, any level
  // levels split by state (US tracts / block groups) draw one state at a time
  const admCountry = h('select', { onchange: () => fillLevels() }), admLevel = h('select', { onchange: () => fillParts() }), admPart = h('select', { onchange: () => { st.adm = admPart.value; admInfo(); } }), admNote = h('div', { class: 'muted small' });
  const partRow = h('label', { style: { display: 'none' } }, 'State', admPart);
  let lvls = [];
  const curLevel = () => lvls.find((x) => `${x.iso}_${x.level}` === admLevel.value);
  const admInfo = () => {
    const m = curLevel(); if (!m) { admNote.textContent = ''; return; }
    const part = m.byState ? m.parts.find((p) => 'L:' + p.key === st.adm) : null, count = part ? part.count : m.count;
    admNote.textContent = `${count.toLocaleString()} areas · ${m.source}` + (count > 60000 ? ' — too many to draw on a phone; pick a higher level' : '');
    if (st.unit === 'admin') { st.name = `${part ? part.title : m.title} ${m.levelName} plan`; nameIn.value = st.name; }
  };
  const fillParts = () => {
    const m = curLevel(); admPart.innerHTML = '';
    if (m && m.byState && !m.precincts) { m.parts.slice().sort((a, b) => a.title.localeCompare(b.title)).forEach((p) => admPart.append(h('option', { value: 'L:' + p.key }, `${p.title} (${p.count.toLocaleString()})`))); partRow.style.display = ''; st.adm = admPart.value; }
    else { partRow.style.display = 'none'; st.adm = m ? `L:${m.iso}_${m.level}` : null; }
    admInfo();
  };
  const fillLevels = () => { const iso = admCountry.value; admLevel.innerHTML = ''; lvls.filter((m) => m.iso === iso && !m.precincts).forEach((m) => admLevel.append(h('option', { value: `${m.iso}_${m.level}` }, `Level ${m.level} · ${m.levelName} (${m.count.toLocaleString()})`))); fillParts(); };
  levelList().then((L) => {
    lvls = L; const seen = new Map(); for (const m of L) if (!seen.has(m.iso)) seen.set(m.iso, m.title);
    admCountry.append(...[...seen.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([iso, t]) => h('option', { value: iso, selected: iso === (app.admPreset || 'FRA') }, t))); fillLevels();
    if (app.admPresetLevel) { admLevel.value = `${app.admPreset}_${app.admPresetLevel}`; fillParts(); if (app.admPresetPart && /^L:\w+_\d+_/.test(app.admPresetPart)) { admPart.value = app.admPresetPart; st.adm = admPart.value; admInfo(); } }
  });
  const admRows = h('div', { style: { display: 'none' } }, h('label', null, 'Country', admCountry), h('label', null, 'Level', admLevel), partRow, admNote);
  const worldRows = h('div', { style: { display: 'none' } }, h('label', null, 'Country', scopeSel));
  const randRow = toggle('Start with an automatic random plan', false, (v) => { st.random = v; });
  const status = h('div', { class: 'muted small' });
  const f = h('div', { class: 'form' },
    !inModal ? h('div', { class: 'hero' }, h('h3', null, 'Draw your own districts'), h('p', { class: 'muted' }, 'Use real US precincts with real election results — like Districtr — or draw districts anywhere on Earth from grid cells, provinces or counties. World plans decide seats when that country votes in the simulation.')) : null,
    h('label', null, 'Build districts from', (() => { const sel = h('select', { onchange: (e) => { st.unit = e.target.value; pctRows.style.display = st.unit === 'precincts' ? '' : 'none'; admRows.style.display = st.unit === 'admin' ? '' : 'none'; if (st.unit === 'admin') admInfo(); worldRows.style.display = ['precincts', 'counties', 'admin'].includes(st.unit) ? 'none' : ''; } }, [['precincts', UNIT_TYPES.precincts], ['admin', 'Real local areas — any country, levels 1–5'], ['cells', UNIT_TYPES.cells], ['provinces', UNIT_TYPES.provinces], ['counties', UNIT_TYPES.counties]].map(([k, l]) => h('option', { value: k, selected: k === st.unit }, l)));
      if (app.admPreset) setTimeout(() => { sel.value = 'admin'; sel.dispatchEvent(new Event('change')); }, 0); return sel; })()),
    pctRows, admRows, worldRows,
    h('label', null, 'Name', nameIn),
    h('label', null, 'Number of districts', nInput),
    randRow, status,
    h('details', { class: 'sec' }, h('summary', null, 'Have a plan code?'), (() => {
      const ta = h('textarea', { rows: 3, placeholder: 'Paste a code that starts with AF1:' });
      return h('div', null, ta, h('div', { class: 'btns' },
        window.AndroidBridge && AndroidBridge.clipboardText ? btn('Paste', () => { ta.value = AndroidBridge.clipboardText(); }) : null,
        btn('Open plan', async () => {
          try {
            const D2 = await decodePlan(ta.value); if (D2.H.unit === 'precincts') await usePack(D2.H.pack, (fr, t2) => { status.textContent = t2; });
            const p = applyDecoded(W, D2); app.activePlan = p.id; app.district = 0; rebuildCatalog(); closeModal(); computePlanStats(); refresh(); refreshPanels();
            if (p.unit === 'precincts') { const bb = W.D.packs[p.pack].bbox; app.R.fitBounds(bb[0], bb[1], bb[2], bb[3]); }
            toast(`Opened “${p.name}”`);
          } catch (err) { toast(err.message, 5000); }
        }, 'primary')));
    })()),
    btn('Create plan', async (e) => {
      const button = e.currentTarget; button.disabled = true;
      try {
        if (st.unit === 'admin') { const m = curLevel(); if (!m || !st.adm) throw new Error('Pick a country and level'); const part = m.byState ? m.parts.find((p) => 'L:' + p.key === st.adm) : null; if ((part ? part.count : m.count) > 60000) throw new Error('That level has too many areas for a phone — pick a higher level'); st.unit = 'precincts'; st.pack = st.adm; }
        if (st.unit === 'precincts') { status.textContent = 'Loading…'; await usePack(st.pack, (fr, t) => { status.textContent = t; }); }
        const p = newPlan(W, { name: st.name || 'Plan', unit: st.unit, scope: st.unit === 'counties' ? U.countries.findIndex((c) => c.a3 === 'USA') + 1 : st.scope, n: st.n, pack: st.pack });
        app.admPreset = null; app.admPresetLevel = null; app.admPresetPart = null;
        if (st.unit === 'precincts' && st.real >= 0) applyRealPlan(W, p, st.real); else if (st.random) randomPlan(W, p);
        app.activePlan = p.id; app.district = 0; app.tool = 'brush'; rebuildCatalog(); closeModal(); computePlanStats(); refresh(); refreshPanels();
        if (st.unit === 'precincts') { const b = W.D.packs[st.pack].bbox; app.R.fitBounds(b[0], b[1], b[2], b[3]); }
        else if (p.scope) { const c = U.countries[p.scope - 1]; const n = W.nations[p.scope]; if (n && n.alive) zoomToNation(n); else app.R.flyTo(c.label[0], c.label[1]); }
      } catch (err) { status.textContent = err.message; toast(err.message, 5000); button.disabled = false; }
    }, 'primary wide'));
  return f;
}
export function startLevelPlan(iso, level, key) {
  if (key && !key.includes(':')) { app.precinctPreset = key; setMode('draw'); openModal('New district plan', newPlanForm(true)); return; } // a precinct pack
  app.admPreset = iso; app.admPresetLevel = level; app.admPresetPart = key; setMode('draw'); openModal('New district plan', newPlanForm(true));
}
// Explore: pick a state and colour its precincts.
export function openPrecinctPicker() {
  const list = h('div', { class: 'tlist' }, h('p', { class: 'muted small' }, 'Loading…'));
  packList().then((packs) => {
    list.innerHTML = '';
    for (const m of packs) list.append(h('button', { class: 'titem', onclick: async () => {
      closeModal(); toast(`Getting ${m.title} precincts…`, 8000);
      try {
        const P = await usePack(m.state, (fr, t) => toast(t, 8000));
        setTheme(P.elections.length ? 'pc_e' + defaultElection(P) : 'pc_pop'); app.R.fitBounds(P.bbox[0], P.bbox[1], P.bbox[2], P.bbox[3]); toast(`${m.title}: ${m.count.toLocaleString()} precincts`);
      } catch (err) { toast(err.message, 5000); }
    } }, h('span', { class: 'kind' }, m.state), h('span', null, m.title, h('small', { class: 'block' }, `${m.count.toLocaleString()} precincts · ${m.elections.length} elections · ${m.plans.length} real maps`)), h('small', null, (m.bytes / 1048576).toFixed(1) + ' MB')));
  });
  openModal('US precinct maps', h('div', null, h('p', { class: 'muted small' }, 'Real precinct boundaries with 2010 Census population and race, precinct-level election results and real district maps, from MGGG States. Each state downloads once (needs internet), then works offline.'), list));
}
function openPlanMenu(p) {
  const W = app.W;
  const body = h('div', { class: 'form' },
    h('label', null, 'Name', h('input', { value: p.name, onchange: (e) => { p.name = e.target.value; rebuildCatalog(); refreshPanels(); } })),
    h('label', null, 'Number of districts', h('input', { type: 'number', min: 2, max: 435, value: p.n, onchange: (e) => { setDistrictCount(p, clamp(+e.target.value || 2, 2, 435)); app.undo = []; app.redo = []; app.district = Math.min(app.district, p.n - 1); computePlanStats(); refresh(); refreshPanels(); } })),
    h('label', null, 'Status', h('select', { onchange: (e) => { p.status = e.target.value; refreshPanels(); } }, ['Scratch work', 'In progress', 'Ready to share'].map((x) => h('option', { selected: (p.status || 'Scratch work') === x }, x)))),
    h('label', null, 'Notes', h('textarea', { rows: 3, placeholder: 'What is this map for?', oninput: (e) => { p.notes = e.target.value; } }, p.notes || '')),
    p.unit !== 'precincts' ? toggle('Use this plan for elections in the simulation', p.electionsUse, (v) => { p.electionsUse = v; }) : null,
    p.unit === 'precincts' && planLayer(W, p) && planLayer(W, p).pack.plans.length ? h('div', null, h('div', { class: 'sec-t' }, 'Start from a real map'),
      h('div', { class: 'chips' }, planLayer(W, p).pack.plans.map((rp, k) => h('button', { class: 'chip-s', onclick: () => { if (!confirm(`Replace this plan with “${rp.label}” (${rp.n} districts)?`)) return; applyRealPlan(W, p, k); app.undo = []; app.redo = []; app.district = 0; closeModal(); computePlanStats(); refresh(); refreshPanels(); toast(`Loaded ${rp.label}`); } }, `${rp.label} (${rp.n})`)))) : null,
    h('div', { class: 'btns' },
      btn('Fill the gaps', () => { const ch = autoFill(W, p); if (ch.size) app.undo.push({ tgt: 'plan', changes: ch, plan: p.id }); closeModal(); computePlanStats(); refresh(); refreshPanels(); toast(`Assigned ${ch.size.toLocaleString()} units`); }),
      btn('Random plan', () => { randomPlan(W, p); app.undo = []; app.redo = []; closeModal(); computePlanStats(); refresh(); refreshPanels(); }),
      btn('Clear all', () => { if (confirm('Clear every district in this plan?')) { p.assign.fill(-1); app.undo = []; app.redo = []; closeModal(); computePlanStats(); refresh(); refreshPanels(); } }),
      btn('Export CSV', () => exportPlanCSV(p)),
      btn('Import CSV', () => { closeModal(); importPlanCSV(p); }),
      btn('Share as code', async () => { try { const code = await encodePlan(W, p); shareText(`Atlas Forge plan: ${p.name}`, `${p.name} — open Atlas Forge → Draw → ＋ → Paste a plan code\n\n${code}`); } catch (e) { toast('Could not share: ' + e.message, 4000); } }),
      btn('Show as map', () => { closeModal(); setTheme('plan_' + p.id); }),
      btn('Delete plan', () => { if (confirm('Delete this plan?')) { W.plans = W.plans.filter((x) => x !== p); app.activePlan = W.plans.length ? W.plans[0].id : null; rebuildCatalog(); closeModal(); computePlanStats(); refresh(); refreshPanels(); } }, 'danger')));
  openModal('Plan options', body);
}
function exportPlanCSV(p) {
  const W = app.W, U = W.D.units; const lines = [];
  if (p.unit === 'cells') { lines.push('lat,lng,district'); for (const i of W.land) if (p.assign[i] >= 0) { const [lng, lat] = cellLngLat(W, i); lines.push(`${lat.toFixed(3)},${lng.toFixed(3)},${p.assign[i] + 1}`); } }
  else if (p.unit === 'provinces') { lines.push('province,iso,country,district'); p.assign.forEach((d, u) => { if (d >= 0) { const x = U.provinces[u]; lines.push(`"${x.n}",${x.iso},"${U.countries[x.c - 1] ? U.countries[x.c - 1].name : ''}",${d + 1}`); } }); }
  else if (p.unit === 'precincts') { const P = planLayer(W, p).pack; lines.push('GEOID,precinct,district'); p.assign.forEach((d, u) => { if (d >= 0) lines.push(`${P.ids[u]},"${String(P.units[u].n).replace(/"/g, "'")}",${d + 1}`); }); }
  else { lines.push('GEOID,county,state,district'); p.assign.forEach((d, u) => { if (d >= 0) { const x = U.counties[u]; lines.push(`${x.fips},"${x.n}","${x.s}",${d + 1}`); } }); }
  saveFile(p.name.replace(/\W+/g, '_') + '.csv', new Blob([lines.join('\n')], { type: 'text/csv' }));
}
function openStats() {
  const p = plan(), st = app.stats || planStats(app.W, p);
  const tbl = h('table', { class: 'tbl' }, h('tr', null, ['#', 'Population', 'Dev.', 'Compact', 'Pieces', 'Winner', ...(st.raceLabels || []).map((l) => '% ' + l)].map((x) => h('th', null, x))),
    st.districts.map((d) => h('tr', { onclick: () => { app.district = d.k; closeModal(); refreshPanels(); zoomToDistrict(p, d.k); } },
      h('td', null, h('span', { class: 'dot', style: { background: hex(p.colors[d.k]) } }), d.k + 1), h('td', null, fmt(d.pop)), h('td', { class: Math.abs(d.dev) > 0.05 ? 'bad' : '' }, d.units ? (d.dev * 100).toFixed(1) + '%' : '—'),
      h('td', null, d.units ? d.pp.toFixed(2) : '—'), h('td', { class: d.pieces > 1 ? 'bad' : '' }, d.pieces || '—'),
      h('td', null, d.winner >= 0 ? h('b', { style: { color: hex(pcol(st, d.winner)) } }, st.partyNames[d.winner] + ' ' + Math.round(d.shares[d.winner] * 100) + '%') : '—'),
      ...(st.raceLabels ? st.raceLabels.map((_, k) => h('td', null, d.pop ? pct(d.race[k] / d.pop) : '—')) : []))));
  const help = h('p', { class: 'muted small' }, (st.election ? `Votes: ${st.election} (real precinct results). ` : '') + 'Efficiency gap counts “wasted” votes (votes for losers, plus winners\' votes beyond what they needed); a gap above ~7% is usually considered a sign of gerrymandering. Mean–median compares the Left party\'s median district to its average; a negative number means the map packs or cracks Left voters.');
  openModal('District statistics', h('div', null, st.contested ? fairness(st, false) : null, help, h('div', { class: 'scrollx' }, tbl)), true);
}
export function refreshStats() { if (app.mode === 'draw' && !document.activeElement?.matches('input,select')) refreshPanels(); }

// ------------------------------------------------------------------ god mode
function renderEdit(b) {
  const W = app.W;
  b.append(seg([['borders', 'Borders'], ['data', 'Data'], ['disaster', 'Disaster'], ['nations', 'Nations'], ['diplomacy', 'Diplo']], ['release', 'capital'].includes(app.editTool) ? 'nations' : app.editTool, (v) => {
    app.editTool = v; app.tool = (v === 'borders' && app.paintChosen) || v === 'data' ? 'brush' : 'pan';
    if (v === 'data') autoTheme(); refreshPanels(); }));
  const et = app.editTool;
  if (et === 'borders') {
    const n = W.nations[app.paintNation];
    b.append(h('div', { class: 'paintwith' }, h('span', null, 'Paint land for'), h('button', { class: 'btn' + (app.paintChosen ? '' : ' primary'), onclick: () => chooseNation('Paint land for…', (id) => { app.paintNation = id; app.paintChosen = true; app.tool = 'brush'; refreshPanels(); }, true, true) }, !app.paintChosen ? 'Choose a nation' : n ? [dot(n.color), n.name] : [dot([90, 90, 90]), 'Unclaimed (erase)'], ' ▾')));
    b.append(h('p', { class: 'muted small' }, app.paintChosen ? 'Paint on the map to move borders. With Pick, tap a nation to paint as it.' : 'Choose who gets the land, then paint on the map.'));
  } else if (et === 'data') {
    const attrs = [['dev', 'Development'], ['pop', 'Population (multiply)'], ['lean', 'Political lean'], ['terrain', 'Terrain'], ...Object.keys(W.custom).map((k) => [k, k + ' (your layer)'])];
    b.append(h('label', { class: 'field' }, 'Paint', h('select', { onchange: (e) => { app.dataAttr = e.target.value; app.dataValue = defaultValue(app.dataAttr); refreshPanels(); autoTheme(); } }, attrs.map(([v, l]) => h('option', { value: v, selected: v === app.dataAttr }, l)))));
    b.append(valueControl());
    b.append(btn('＋ New data layer', openNewLayer, 'wide'));
  } else if (et === 'disaster') {
    b.append(h('div', { class: 'chips' }, Object.entries(DISASTERS).map(([k, d]) => h('button', { class: 'chip-s' + (app.disaster === k ? ' on' : ''), onclick: () => { app.disaster = k; refreshPanels(); } }, d.label))));
    b.append(h('p', { class: 'muted small' }, 'Tap anywhere on the map to unleash it.'));
  } else if (et === 'nations' || et === 'release' || et === 'capital') renderNationEditor(b);
  else if (et === 'diplomacy') renderDiplomacy(b);
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
  const ago = app.lastAutosave ? Math.round((Date.now() - app.lastAutosave) / 60000) : null;
  openModal('Atlas Forge', h('div', { class: 'form' },
    h('div', { class: 'muted small' }, ago == null ? 'Autosaves while you play.' : `Autosaved ${ago < 1 ? 'just now' : ago + ' min ago'}.`),
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
export function shareText(subject, text) {
  if (window.AndroidBridge && AndroidBridge.shareText) { AndroidBridge.shareText(subject, text); return; }
  if (navigator.share) { navigator.share({ title: subject, text }).catch(() => {}); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Plan code copied'), () => openModal('Plan code', h('textarea', { rows: 8, readonly: true }, text)));
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
    const per = {}, capK = { Nation: 8, Country: 6, City: 15, Province: 10, County: 6 }, shown = [];
    for (const r of res) { per[r.kind] = (per[r.kind] || 0) + 1; if (per[r.kind] <= capK[r.kind]) shown.push(r); }
    const extra = Object.entries(per).filter(([k, c]) => c > capK[k]).map(([k, c]) => `+${c - capK[k]} more ${k.toLowerCase()}${c - capK[k] > 1 ? 's' : ''}`).join(' · ');
    for (const r of shown) list.append(h('button', { class: 'titem', onclick: () => { closeModal(); r.go(); } },
      r.color ? dot(r.color) : h('span', { class: 'kind k-' + r.kind.toLowerCase() }, { City: 'CITY', Country: 'LAND', Province: 'PROV', County: 'CNTY' }[r.kind] || r.kind[0]), h('span', null, r.name, h('small', { class: 'block' }, r.sub)), h('small', null, r.kind)));
    if (!res.length) list.append(h('p', { class: 'muted' }, 'Nothing found.'));
    else if (extra) list.append(h('p', { class: 'muted small' }, extra + ' — type more to narrow it down.'));
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
