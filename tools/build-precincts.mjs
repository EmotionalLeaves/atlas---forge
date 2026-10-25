// Converts an MGGG precinct shapefile into a compact Atlas Forge precinct pack (.afp).
// Usage: node tools/build-precincts.mjs <earcut.js> <dir with .shp/.dbf/.prj> <STATE> <title> <outDir>
// Pack = "AFP1" + u32 json length + JSON header + 8-byte aligned binary blobs (referenced by offset in the header).
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { readDBF, readSHP, makeUnproject } from './lib-shp.mjs';

const [earcutPath, dir, STATE, TITLE, OUT] = process.argv.slice(2);
const earcut = (await import(pathToFileURL(path.resolve(earcutPath)).href)).default;
const files = fs.readdirSync(dir);
const pick = (ext) => { const f = files.filter((x) => x.toLowerCase().endsWith(ext)).sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size)[0]; if (!f) throw new Error('no ' + ext); return path.join(dir, f); };
const shpPath = pick('.shp'), base = shpPath.slice(0, -4);
const dbfPath = fs.existsSync(base + '.dbf') ? base + '.dbf' : pick('.dbf');
const prjPath = fs.existsSync(base + '.prj') ? base + '.prj' : pick('.prj');
const log = (...a) => console.log(STATE, ...a);

// ---------------- load ----------------
const { fields, rows } = readDBF(dbfPath);
const shapes = readSHP(shpPath);
if (shapes.length !== rows.length) throw new Error(`shape/record mismatch ${shapes.length} vs ${rows.length}`);
const unproject0 = makeUnproject(fs.readFileSync(prjPath, 'utf8'));
const unproject = (x, y) => { const r = unproject0(x, y); if (r[0] > 100) r[0] -= 360; return r; }; // Aleutians: keep Alaska in one piece
// numbers stored as text: convert any column that is (almost) all numeric
for (const f of fields) {
  if (f.type !== 'C') continue;
  let num = 0, tot = 0; for (const r of rows) { const v = r[f.name]; if (v === '' || v == null) continue; tot++; if (/^-?\d+(\.\d+)?$/.test(v)) num++; }
  if (tot && num / tot > 0.97) { f.type = 'N'; for (const r of rows) { const v = r[f.name]; r[f.name] = v === '' || v == null ? null : Number(v); } }
}
log('records', rows.length, 'fields', fields.length);

// ---------------- attributes ----------------
const has = (k) => fields.some((f) => f.name === k);
const numField = (k) => fields.find((f) => f.name === k && (f.type === 'N' || f.type === 'F'));
const firstOf = (...ks) => ks.find((k) => numField(k));
const popK = firstOf('TOTPOP', 'TOTPOP10', 'TOTPOP19', 'TOTPOP20', 'POP100', 'TOT_POP', 'POP', 'TOTAL', 'PERSONS');
if (!popK) throw new Error('no population field in ' + fields.map((f) => f.name).join(','));
const vapK = firstOf('VAP', 'VAP10', 'TOTVAP', 'VAP19', 'VAP20', 'TOT_VAP');
const race = [
  ['White', firstOf('NH_WHITE', 'NH_WHITE10', 'WHITE', 'NH_WHT')], ['Black', firstOf('NH_BLACK', 'NH_BLACK10', 'BLACK', 'NH_BLK')],
  ['Hispanic', firstOf('HISP', 'HISP10', 'HISPANIC', 'H_TOTAL')], ['Asian', firstOf('NH_ASIAN', 'NH_ASIAN10', 'ASIAN', 'NH_ASN')],
  ['Native', firstOf('NH_AMIN', 'NH_AMIN10', 'AMIN', 'NH_AIAN')],
].filter((r) => r[1]);
const vrace = [['White', firstOf('WVAP', 'NH_WVAP', 'WHITEVAP')], ['Black', firstOf('BVAP', 'NH_BVAP', 'BLACKVAP')], ['Hispanic', firstOf('HVAP', 'HISPVAP')], ['Asian', firstOf('ASIANVAP', 'AVAP', 'ASNVAP')], ['Native', firstOf('AMINVAP', 'AIANVAP', 'NVAP')]].filter((r) => r[1]);
// elections: columns XXXD + XXXR (also D_XXX/R_XXX)
const nums = fields.filter((f) => f.type === 'N' || f.type === 'F').map((f) => f.name);
const elections = [];
for (const k of nums) {
  let m = k.match(/^(.+?)(D|DEM)$/i); if (m) { const pre = m[1]; const r = nums.find((x) => x.toUpperCase() === (pre + 'R').toUpperCase() || x.toUpperCase() === (pre + 'REP').toUpperCase()); if (r) elections.push({ key: pre, d: k, r }); continue; }
  m = k.match(/^(D|DEM)_?(.+)$/i); if (m) { const pre = m[2]; const r = nums.find((x) => x.toUpperCase() === ('R' + pre).toUpperCase() || x.toUpperCase() === ('R_' + pre).toUpperCase() || x.toUpperCase() === ('REP' + pre).toUpperCase()); if (r) elections.push({ key: pre, d: k, r }); }
}
const total = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
for (const k of nums) { // G18DHOR / G18RHOR  and  G16PREDCLI / G16PRERTRU
  let m = k.match(/^G(\d\d)D([A-Z]{3,4})$/); if (m) { const r = nums.find((x) => x === `G${m[1]}R${m[2]}`); if (r) elections.push({ key: `G${m[1]}${m[2]}`, d: k, r }); continue; }
  m = k.match(/^G(\d\d)([A-Z]{3})D([A-Z]{3,4})$/); if (m) { const r = nums.find((x) => new RegExp(`^G${m[1]}${m[2]}R[A-Z]{3,4}$`).test(x)); if (r) elections.push({ key: `G${m[1]}${m[2]}`, d: k, r }); }
}
const ELEC = elections.map((e) => ({ ...e, tot: total(e.d) + total(e.r) })).filter((e) => e.tot > 1000 && !/^(538|HDIST|SEND|CD|GOV$|TS$)/i.test(e.key));
// label: try to make "PRES16" -> "President 2016"
const OFFICES = [[/^SSEN|STSEN|SPSEN|^SP_SEN|_SL_|^SSN/i, 'State Senate'], [/^SH\d|^STH|SHOU|_SH_|HOD$|^G\d\dHOD/i, 'State House'], [/PRE|_PR_|PRS/i, 'President'], [/USS|SEN/i, 'US Senate'], [/GOV|_GV_/i, 'Governor'], [/^LG|LTG|_LG_/i, 'Lt. Governor'], [/ATG|^AG|_AG_/i, 'Attorney General'], [/SOS|SECST|_SS_/i, 'Secretary of State'], [/COMP/i, 'Comptroller'], [/USH|CONG|^CD|HOR|_USH_|HOU/i, 'US House'], [/AUD/i, 'Auditor'], [/TRE/i, 'Treasurer'], [/REG/i, 'University Regent'], [/^EC\d/i, 'Executive Council'], [/PSC/i, 'Public Service Commission'], [/AGR/i, 'Agriculture Commissioner'], [/INS/i, 'Insurance Commissioner'], [/TAX/i, 'Tax Commissioner']];
const office = (s) => { for (const [re, l] of OFFICES) if (re.test(s)) return l; return s; };
const yearOf = (s) => { const m = s.match(/(\d{2})/); return m ? 2000 + +m[1] : null; };
for (const e of ELEC) { const y = yearOf(e.key); e.label = `${office(e.key)}${y ? ' ' + y : ''}`; }
ELEC.sort((a, b) => (yearOf(b.key) || 0) - (yearOf(a.key) || 0) || b.tot - a.tot);
const seenLabel = new Set(); const elecFinal = ELEC.filter((e) => { const k = e.label; if (seenLabel.has(k)) { e.label = `${e.label} (${e.key})`; } seenLabel.add(e.label); return true; }).slice(0, 12);
// existing district plans: integer columns named like CD/SEN/HDIST with 2..250 distinct values
const planCols = [];
for (const f of fields) {
  if (!/^(CD|CD_?\d+|CD\d*FP|CONG|USCD|REMEDIAL|SEND|SENDIST|SLDU|SLDL|SLDUST|SLDLST|SEN|HDIST|HDIST_\w+|HOUSE|HD|SD|LEG|GOV|TS|538\w+|PLAN\w*|NEWPLAN|OLDPLAN|JUDGE|DISTRICT|DIST)$/i.test(f.name)) continue;
  if (f.type !== 'N' && f.type !== 'F' && f.type !== 'C') continue;
  const vals = rows.map((r) => r[f.name]); const distinct = new Set(vals.filter((v) => v !== null && v !== '' && v !== undefined));
  if (distinct.size < 2 || distinct.size > 250) continue;
  const labels = [...distinct].sort((a, b) => (+a) - (+b)); const map = new Map(labels.map((v, k) => [v, k]));
  const up = f.name.toUpperCase(); let yr = (up.match(/^CD_?(\d{2,4})/) || [])[1];
  if (yr && yr.length === 2) yr = '20' + yr; if (yr && yr.length === 3) yr = null;
  const nice = (yr && /^CD/.test(up) ? `Congress (${yr} map)` : null) || /^CD\d*FP$|^CD$|^CONG|^USCD/.test(up) && 'Congress' || /^SLDU|^SEND|^SENDIST|^SD$/.test(up) && 'State Senate' || /^SLDL|^HDIST$|^HD$/.test(up) && 'State House' || up === 'HDIST_11' && 'State House (2011 map)' || up === 'HDIST_REM' && 'State House (court remedy)' || up === 'JUDGE' && 'Congress (court-drawn)' || up === 'NEWPLAN' && 'Congress (new plan)' || up === 'OLDPLAN' && 'Congress (old plan)' || up === 'DISTRICT' && (distinct.size <= 60 ? 'Congress' : 'District plan') || ({ CD_2011: 'Congress (2011 enacted)', REMEDIAL: 'Congress (2018 court remedy)', GOV: "Congress (Governor's proposal)", TS: 'Congress (Turzai-Scarnati proposal)', SEND: 'State Senate', HDIST: 'State House', '538DEM': '538: Democratic-favouring', '538GOP': '538: Republican-favouring', '538CMPCT': '538: most compact', CD: 'Congress', SLDU: 'State Senate', SLDL: 'State House' })[up] || f.name;
  planCols.push({ key: f.name, label: nice, n: distinct.size, assign: Int16Array.from(vals, (v) => map.has(v) ? map.get(v) : -1) });
}
// county of each precinct
const anyOf = (...ks) => { for (const k of ks) { const f = fields.find((x) => x.name.toUpperCase() === k.toUpperCase()); if (f) return f.name; } return null; };
const cntyK = anyOf('COUNTYNAME', 'county_nam', 'CTYNAME', 'CNTY_NAME', 'COUNTY_NAM', 'County', 'locality', 'PARISH', 'TOWN') || firstOf('COUNTYFP10', 'COUNTYFP', 'COUNTYFP20', 'CNTYFIPS', 'COUNTYFIPS', 'CountyFips', 'FIPS1') || fields.find((f) => /^(COUNTYFP|COUNTY|CNTY)/i.test(f.name))?.name;
const nameK = fields.find((f) => /^(NAME10|NAME|PRECINCT|PREC_NAME|NAMELSAD10|VTDNAME|WARD|LABEL)/i.test(f.name))?.name;
const idK = fields.find((f) => /^(GEOID10|GEOID20|GEOID|VTDST10|PRECINCT|LOC_PREC|PRECODE|ID)$/i.test(f.name))?.name;
const countyNames = [...new Set(rows.map((r) => String(r[cntyK] ?? '')))].sort();
const stFK = fields.find((f) => /^STATEFP/i.test(f.name))?.name, geoK = fields.find((f) => /^GEOID/i.test(f.name))?.name;
const stateFips = String(stFK ? rows[0][stFK] : geoK ? String(rows[0][geoK]).slice(0, 2) : '').padStart(2, '0');
const countyIdx = new Map(countyNames.map((c, k) => [c, k]));

// ---------------- geometry: unproject + quantise ----------------
const merc = (lng, lat) => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]; };
const Q = 2 ** 27; // ~0.3 m quantisation in world units at the equator
const polys = shapes.map((rings) => rings.map((ring) => {
  const out = []; let last = '';
  for (const [x, y] of ring) { const [lng, lat] = unproject(x, y); const [mx, my] = merc(lng, lat); const qx = Math.round(mx * Q), qy = Math.round(my * Q); const k = qx + ',' + qy; if (k !== last) out.push([qx, qy]); last = k; }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}).filter((r) => r.length >= 3));
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
for (const rs of polys) for (const r of rs) for (const [x, y] of r) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
const lngOf = (x) => x / Q * 360 - 180, latOf = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y / Q) * 2 * Math.PI)) - 90;
log('bbox', lngOf(bx0).toFixed(2), latOf(by1).toFixed(2), lngOf(bx1).toFixed(2), latOf(by0).toFixed(2));
if (!(lngOf(bx0) > -200 && lngOf(bx1) < -60 && latOf(by1) > 15 && latOf(by0) < 72)) throw new Error('bbox looks wrong — projection problem');

// ---------------- topology-preserving simplification ----------------
// edge -> which polygons use it; a vertex is a junction where that set changes.
const ek = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) ? `${a[0]},${a[1]},${b[0]},${b[1]}` : `${b[0]},${b[1]},${a[0]},${a[1]}`;
const edgeUsers = new Map();
polys.forEach((rs, u) => rs.forEach((r) => { for (let k = 0; k < r.length; k++) { const key = ek(r[k], r[(k + 1) % r.length]); const v = edgeUsers.get(key); if (v === undefined) edgeUsers.set(key, u); else if (v !== u) edgeUsers.set(key, v * 100000 + u + 1e12); } }));
const sig = (a, b) => { const v = edgeUsers.get(ek(a, b)); return v; };
const TOL = Q * 0.000006; // ~2 px at zoom 13 — fine detail for neighbourhood-level precincts
function dp(pts) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) { const [px, py] = pts[i]; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(px - ax - t * dx, py - ay - t * dy); if (d > md) { md = d; mi = i; } }
    if (md > TOL && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const arcCache = new Map();
function simplifyArc(arc) { // same arc (either direction) -> same result
  const a = arc[0], b = arc[arc.length - 1];
  const fwd = (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && (arc[1][0] < arc[arc.length - 2][0] || (arc[1][0] === arc[arc.length - 2][0] && arc[1][1] <= arc[arc.length - 2][1]))))));
  const norm = fwd ? arc : arc.slice().reverse();
  const key = norm.map((p) => p[0] + ',' + p[1]).join(';');
  let res = arcCache.get(key); if (!res) { res = dp(norm); arcCache.set(key, res); }
  return fwd ? res : res.slice().reverse();
}
let vin = 0, vout = 0;
const simple = polys.map((rs) => rs.map((r) => {
  const n = r.length; vin += n;
  const junction = new Uint8Array(n);
  for (let k = 0; k < n; k++) { const p = r[(k - 1 + n) % n], c = r[k], nx = r[(k + 1) % n]; if (sig(p, c) !== sig(c, nx)) junction[k] = 1; }
  let start = junction.indexOf(1);
  let out;
  if (start < 0) { out = dp([...r, r[0]]).slice(0, -1); if (out.length < 3) out = r.length >= 3 ? [r[0], r[Math.floor(n / 3)], r[Math.floor(2 * n / 3)]] : r; }
  else {
    out = []; let arc = [r[start]];
    for (let s = 1; s <= n; s++) { const k = (start + s) % n; arc.push(r[k]); if (junction[k]) { const sa = simplifyArc(arc); out.push(...sa.slice(0, -1)); arc = [r[k]]; } }
    if (out.length < 3) out = r;
  }
  vout += out.length; return out;
}).filter((r) => r.length >= 3));
log('vertices', vin, '->', vout);

// ---------------- rings: outers and holes ----------------
const area2 = (r) => { let s = 0; for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const inside = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };

// ---------------- write geometry + adjacency ----------------
const ox = bx0, oy = by0; // store coordinates relative to the pack origin for float precision
const pos = [], uid = [], idx = [], lpos = [], luid = [], lnb = [];
const edgeOwner = new Map(); // edge key -> [unit, segIndex]
const adj = new Map(); // "a,b" -> shared length (world units)
const centers = new Float64Array(rows.length * 2), areaW = new Float64Array(rows.length);
simple.forEach((rs, u) => {
  if (!rs.length) return;
  // shapefile: outer rings clockwise (negative area in y-down?) — decide by containment instead of orientation
  const sorted = rs.map((r) => ({ r, A: Math.abs(area2(r)) })).sort((a, b) => b.A - a.A);
  const groups = [];
  for (const it of sorted) { const host = groups.find((g) => inside(it.r[0], g.outer) && !g.holes.some((h) => inside(it.r[0], h))); if (host && it.A < Math.abs(area2(host.outer))) host.holes.push(it.r); else groups.push({ outer: it.r, holes: [] }); }
  let cx = 0, cy = 0, ca = 0;
  for (const g of groups) {
    const flat = [], holes = [];
    for (const [ri, r] of [g.outer, ...g.holes].entries()) { if (ri) holes.push(flat.length / 2); for (const [x, y] of r) flat.push(x - ox, y - oy); }
    const tri = earcut(flat, holes, 2); const base = pos.length / 2;
    for (let k = 0; k < flat.length; k += 2) { pos.push(flat[k] / Q, flat[k + 1] / Q); uid.push(u); }
    for (const t of tri) idx.push(base + t);
    const A = Math.abs(area2(g.outer)) - g.holes.reduce((s, h) => s + Math.abs(area2(h)), 0);
    let sx = 0, sy = 0; for (const [x, y] of g.outer) { sx += x; sy += y; } cx += sx / g.outer.length * A; cy += sy / g.outer.length * A; ca += A;
    for (const r of [g.outer, ...g.holes]) for (let k = 0; k < r.length; k++) {
      const a = r[k], b = r[(k + 1) % r.length], key = ek(a, b), seg = luid.length / 2;
      lpos.push((a[0] - ox) / Q, (a[1] - oy) / Q, (b[0] - ox) / Q, (b[1] - oy) / Q); luid.push(u, u); lnb.push(65535, 65535);
      const other = edgeOwner.get(key);
      if (other && other[0] !== u) {
        lnb[seg * 2] = lnb[seg * 2 + 1] = other[0]; lnb[other[1] * 2] = lnb[other[1] * 2 + 1] = u;
        const len = Math.hypot(a[0] - b[0], a[1] - b[1]) / Q; const kk = Math.min(u, other[0]) + ',' + Math.max(u, other[0]); adj.set(kk, (adj.get(kk) || 0) + len);
      } else if (!other) edgeOwner.set(key, [u, seg]);
    }
  }
  centers[u * 2] = (cx / (ca || 1) - ox) / Q; centers[u * 2 + 1] = (cy / (ca || 1) - oy) / Q; areaW[u] = ca / Q / Q;
});
// extra adjacency: precincts that share a corner, or whose borders come within ~60 m (rivers, slivers)
{
  const pairSet = new Set(adj.keys());
  const addPair = (a, b) => { if (a === b) return; const k = Math.min(a, b) + ',' + Math.max(a, b); if (!pairSet.has(k)) { pairSet.add(k); adj.set(k, 0); } };
  const cell = Math.round(Q * 60 / 40075016 * 1.4); // ~60 m at mid-latitudes, in quantised units
  const grid = new Map();
  polys.forEach((rs, u) => { const seen = new Set(); for (const r of rs) for (const [x, y] of r) { const k = Math.floor(x / cell) + ',' + Math.floor(y / cell); if (seen.has(k)) continue; seen.add(k); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(u); } });
  for (const [k, list] of grid) {
    const [gx, gy] = k.split(',').map(Number);
    const near = [...list]; for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) { const o = grid.get((gx + dx) + ',' + (gy + dy)); if (o) near.push(...o); }
    const uniq = [...new Set(near)]; if (uniq.length > 12) continue; // skip dense junk clusters
    for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) addPair(uniq[i], uniq[j]);
  }
  // islands: connect any precinct still without neighbours to the nearest precinct centre
  const deg = new Int32Array(rows.length); for (const k of adj.keys()) { const [a, b] = k.split(',').map(Number); deg[a]++; deg[b]++; }
  for (let u = 0; u < rows.length; u++) if (!deg[u] && polys[u].length) {
    let best = -1, bd = Infinity; for (let v = 0; v < rows.length; v++) { if (v === u || !polys[v].length) continue; const d = (centers[u * 2] - centers[v * 2]) ** 2 + (centers[u * 2 + 1] - centers[v * 2 + 1]) ** 2; if (d < bd) { bd = d; best = v; } }
    if (best >= 0) addPair(u, best);
  }
}
const adjArr = [], adjLen = [];
const kmAt = (yw) => 40075.016686 * Math.cos(Math.atan(Math.sinh(Math.PI * (1 - 2 * yw)))); // km per world unit at mercator y
for (const [k, len] of adj) { const [a, b] = k.split(',').map(Number); adjArr.push(a, b); adjLen.push(len * kmAt(oy / Q + centers[a * 2 + 1])); }
// perimeter per precinct (km)
const perim = new Float64Array(rows.length);
for (let sgi = 0; sgi < luid.length / 2; sgi++) { const u = luid[sgi * 2]; const x0 = lpos[sgi * 4], y0 = lpos[sgi * 4 + 1], x1 = lpos[sgi * 4 + 2], y1 = lpos[sgi * 4 + 3]; perim[u] += Math.hypot(x1 - x0, y1 - y0) * kmAt(oy / Q + y0); }
log('triangles', idx.length / 3, 'segments', luid.length / 2, 'adjacent pairs', adj.size);

// ---------------- pack ----------------
const blobs = []; let off = 0;
const blob = (ta) => { const pad = (8 - (off % 8)) % 8; if (pad) { blobs.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); blobs.push(b); const ref = { t: ta.constructor.name, o: off, n: ta.length }; off += b.byteLength; return ref; };
const col = (k) => Float32Array.from(rows, (r) => Math.max(0, r[k] || 0));
const kmPerWorld = 40075.016686; // at equator; scaled by cos(lat) in the app
const header = {
  format: 'afp', v: 1, state: STATE, title: TITLE, count: rows.length, origin: [ox / Q, oy / Q],
  bbox: [lngOf(bx0), latOf(by1), lngOf(bx1), latOf(by0)],
  source: 'MGGG States (github.com/mggg-states) — 2010 Census, precinct election results',
  pop: blob(col(popK)), vap: vapK ? blob(col(vapK)) : null,
  race: race.map(([label, k]) => ({ label, data: blob(col(k)) })), vrace: vrace.map(([label, k]) => ({ label, data: blob(col(k)) })),
  elections: elecFinal.map((e) => ({ key: e.key, label: e.label, d: blob(col(e.d)), r: blob(col(e.r)) })),
  plans: planCols.map((p) => ({ key: p.key, label: p.label, n: p.n, assign: blob(p.assign) })),
  county: blob(Uint16Array.from(rows, (r) => countyIdx.get(String(r[cntyK] ?? '')))), countyNames, stateFips,
  names: rows.map((r) => String(nameK ? r[nameK] : '').slice(0, 40)), ids: rows.map((r) => String(idK ? r[idK] : '')),
  center: blob(Float32Array.from(centers)), area: blob(Float32Array.from(areaW, (a, u) => a * kmAt(oy / Q + centers[u * 2 + 1]) ** 2)), perim: blob(Float32Array.from(perim)),
  adj: blob(Uint16Array.from(adjArr)), adjLen: blob(Float32Array.from(adjLen)),
  geom: { pos: blob(Float32Array.from(pos)), uid: blob(Uint16Array.from(uid)), idx: blob(Uint32Array.from(idx)), lpos: blob(Float32Array.from(lpos)), luid: blob(Uint16Array.from(luid)), lnb: blob(Uint16Array.from(lnb)) },
};
if (rows.length > 65000) throw new Error('too many precincts for 16-bit ids');
const hj = Buffer.from(JSON.stringify(header));
const pre = Buffer.alloc(8); pre.write('AFP1', 0); pre.writeUInt32LE(hj.length, 4);
const pad = Buffer.alloc((8 - ((8 + hj.length) % 8)) % 8);
fs.mkdirSync(OUT, { recursive: true });
const outFile = path.join(OUT, STATE + '.afp.gz');
const zlib = await import('zlib');
fs.writeFileSync(outFile, zlib.gzipSync(Buffer.concat([pre, hj, pad, ...blobs]), { level: 9 }));
log('wrote', outFile, (fs.statSync(outFile).size / 1048576).toFixed(2) + ' MB', '| pop', Math.round(total(popK)).toLocaleString(), '| elections', elecFinal.map((e) => e.label).join('; '), '| plans', planCols.map((p) => p.label + ':' + p.n).join('; '));
fs.writeFileSync(path.join(OUT, STATE + '.json'), JSON.stringify({ state: STATE, title: TITLE, count: rows.length, bbox: header.bbox, elections: elecFinal.map((e) => e.label), plans: planCols.map((p) => ({ label: p.label, n: p.n })), bytes: fs.statSync(outFile).size, pop: Math.round(total(popK)) }));
