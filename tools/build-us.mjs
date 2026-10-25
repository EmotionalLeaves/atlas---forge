// Builds US census tracts (USA level 3) and block groups (USA level 4) for every state from the
// Census Bureau 2020 cartographic boundary files + 2020 redistricting (PL 94-171) counts.
// Usage: node --max-old-space-size=8000 tools/build-us.mjs <earcut.js> <tractShpDir> <bgShpDir> <plDir> <outDir> [fpop.bin] [vtdShpDir] [electionCsvDir]
//   vtdShpDir: TIGER 2020 voting districts (tl_2020_XX_vtd20) -> USA level 5; electionCsvDir: county presidential results
//   plDir holds tract_<FIPS>.json / bg_<FIPS>.json straight from api.census.gov (array of rows, header first).
// Output: <outDir>/USA_3_<FIPS>.afp.gz, USA_4_<FIPS>.afp.gz and entries merged into <outDir>/levels.json.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pathToFileURL } from 'url';
import { readDBF, readSHP } from './lib-shp.mjs';

const [earcutPath, TRACT_DIR, BG_DIR, PL_DIR, OUT, FPOP, VTD_DIR, ELEC_DIR] = process.argv.slice(2);
// fallback when census counts are unavailable: the 0.05° population raster from build-data.mjs
const FW = 7200, FH = 3600, FRES = 0.05;
const fPop = FPOP && fs.existsSync(FPOP) ? (() => { const b = fs.readFileSync(FPOP); return new Float32Array(b.buffer, b.byteOffset, FW * FH); })() : null;
function rasterPop(rings) {
  if (!fPop) return 0;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const r of rings) for (const [x, y] of r) { if (x < a) a = x; if (x > b) b = x; if (y < c) c = y; if (y > d) d = y; }
  if (!isFinite(a)) return 0;
  const step = Math.max(0.0005, Math.max(b - a, d - c) / 14); let pop = 0;
  for (let y = c + step / 2; y < d; y += step) for (let x = a + step / 2; x < b; x += step) {
    let ins = false; for (const r of rings) { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } }
    if (!ins) continue;
    const row = Math.min(FH - 1, Math.floor((90 - y) / FRES)), col = Math.min(FW - 1, Math.floor((x + 180) / FRES));
    const cellKm2 = (111.32 * FRES) ** 2 * Math.cos(y * Math.PI / 180), sKm2 = (111.32 * step) ** 2 * Math.cos(y * Math.PI / 180);
    pop += fPop[row * FW + col] * sKm2 / cellKm2;
  }
  return pop;
}
const earcut = (await import(pathToFileURL(path.resolve(earcutPath)).href)).default;
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export const PL_VARS = ['P1_001N', 'P2_002N', 'P2_005N', 'P2_006N', 'P2_007N', 'P2_008N', 'P3_001N', 'P4_002N', 'P4_005N', 'P4_006N', 'P4_007N', 'P4_008N'];
const STATES = { '01': 'Alabama', '02': 'Alaska', '04': 'Arizona', '05': 'Arkansas', '06': 'California', '08': 'Colorado', '09': 'Connecticut', '10': 'Delaware', '11': 'District of Columbia', '12': 'Florida', '13': 'Georgia', '15': 'Hawaii', '16': 'Idaho', '17': 'Illinois', '18': 'Indiana', '19': 'Iowa', '20': 'Kansas', '21': 'Kentucky', '22': 'Louisiana', '23': 'Maine', '24': 'Maryland', '25': 'Massachusetts', '26': 'Michigan', '27': 'Minnesota', '28': 'Mississippi', '29': 'Missouri', '30': 'Montana', '31': 'Nebraska', '32': 'Nevada', '33': 'New Hampshire', '34': 'New Jersey', '35': 'New Mexico', '36': 'New York', '37': 'North Carolina', '38': 'North Dakota', '39': 'Ohio', '40': 'Oklahoma', '41': 'Oregon', '42': 'Pennsylvania', '44': 'Rhode Island', '45': 'South Carolina', '46': 'South Dakota', '47': 'Tennessee', '48': 'Texas', '49': 'Utah', '50': 'Vermont', '51': 'Virginia', '53': 'Washington', '54': 'West Virginia', '55': 'Wisconsin', '56': 'Wyoming', '72': 'Puerto Rico' };

const pickShp = (dir) => { const f = fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.shp')).sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size); return f.map((x) => path.join(dir, x)); };
// all shapefiles in a folder (national file, or one per state) -> [{row, rings}]
function loadDir(dir) {
  const out = [];
  for (const shp of pickShp(dir)) {
    const base = shp.slice(0, -4), { rows } = readDBF(base + '.dbf'), shapes = readSHP(shp);
    if (shapes.length !== rows.length) throw new Error('shape/record mismatch in ' + shp);
    for (let k = 0; k < rows.length; k++) out.push({ row: rows[k], rings: shapes[k] });
  }
  return out;
}
function loadPL(file) {
  if (!fs.existsSync(file)) return null;
  let j; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!Array.isArray(j) || j.length < 2) return null;
  const H = j[0], iS = H.indexOf('state'), iC = H.indexOf('county'), iT = H.indexOf('tract') >= 0 ? H.indexOf('tract') : H.indexOf('voting district'), iB = H.indexOf('block group');
  const vi = PL_VARS.map((v) => H.indexOf(v)); const m = new Map();
  for (let r = 1; r < j.length; r++) { const R = j[r]; const g = R[iS] + R[iC] + R[iT] + (iB >= 0 ? R[iB] : ''); m.set(g, vi.map((i) => i >= 0 ? Math.max(0, +R[i] || 0) : 0)); }
  return m;
}

// ---- geometry (same topology-preserving approach as the precinct builder) ----
const merc = (lng, lat) => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]; };
const Q = 2 ** 27;
const lngOf = (x) => x / Q * 360 - 180, latOf = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y / Q) * 2 * Math.PI)) - 90;
const kmAt = (yw) => 40075.016686 * Math.cos(Math.atan(Math.sinh(Math.PI * (1 - 2 * yw))));
const area2 = (r) => { let s = 0; for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const inside = (pt, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (((yi > pt[1]) !== (yj > pt[1])) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c; } return c; };
const ek = (a, b) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) ? `${a[0]},${a[1]},${b[0]},${b[1]}` : `${b[0]},${b[1]},${a[0]},${a[1]}`;

function buildGeometry(rawPolys, TOL) {
  const n = rawPolys.length;
  const polys = rawPolys.map((rings) => rings.map((ring) => {
    const out = []; let last = '';
    for (const [lng, lat] of ring) { const [mx, my] = merc(lng, lat); const qx = Math.round(mx * Q), qy = Math.round(my * Q); const k = qx + ',' + qy; if (k !== last) out.push([qx, qy]); last = k; }
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out;
  }).filter((r) => r.length >= 3));
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const rs of polys) for (const r of rs) for (const [x, y] of r) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  // edge users -> junctions -> simplify each arc once
  const edgeUsers = new Map();
  polys.forEach((rs, u) => rs.forEach((r) => { for (let k = 0; k < r.length; k++) { const key = ek(r[k], r[(k + 1) % r.length]); const v = edgeUsers.get(key); if (v === undefined) edgeUsers.set(key, u); else if (v !== u && v < 1e12) edgeUsers.set(key, v * 100000 + u + 1e12); } }));
  const sig = (a, b) => edgeUsers.get(ek(a, b));
  const dp = (pts) => {
    if (pts.length <= 2) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) { const [px, py] = pts[i]; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(px - ax - t * dx, py - ay - t * dy); if (d > md) { md = d; mi = i; } }
      if (md > TOL && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const arcCache = new Map();
  const simplifyArc = (arc) => {
    const a = arc[0], b = arc[arc.length - 1];
    const fwd = (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && (arc[1][0] < arc[arc.length - 2][0] || (arc[1][0] === arc[arc.length - 2][0] && arc[1][1] <= arc[arc.length - 2][1]))))));
    const norm = fwd ? arc : arc.slice().reverse(); const key = norm.map((p) => p[0] + ',' + p[1]).join(';');
    let res = arcCache.get(key); if (!res) { res = dp(norm); arcCache.set(key, res); }
    return fwd ? res : res.slice().reverse();
  };
  const simple = polys.map((rs) => rs.map((r) => {
    const m = r.length, junction = new Uint8Array(m);
    for (let k = 0; k < m; k++) { const p = r[(k - 1 + m) % m], c = r[k], nx = r[(k + 1) % m]; if (sig(p, c) !== sig(c, nx)) junction[k] = 1; }
    const start = junction.indexOf(1); let out;
    if (start < 0) { out = dp([...r, r[0]]).slice(0, -1); if (out.length < 3) out = [r[0], r[Math.floor(m / 3)], r[Math.floor(2 * m / 3)]]; }
    else {
      out = []; let arc = [r[start]];
      for (let s = 1; s <= m; s++) { const k = (start + s) % m; arc.push(r[k]); if (junction[k]) { out.push(...simplifyArc(arc).slice(0, -1)); arc = [r[k]]; } }
      if (out.length < 3) out = r;
    }
    return out;
  }).filter((r) => r.length >= 3));
  arcCache.clear(); edgeUsers.clear();
  // triangles, outlines with the neighbour across each segment, adjacency
  const ox = bx0, oy = by0;
  const pos = [], uid = [], idx = [], lpos = [], luid = [], lnb = [];
  const edgeOwner = new Map(), adj = new Map();
  const centers = new Float64Array(n * 2), areaW = new Float64Array(n);
  simple.forEach((rs, u) => {
    if (!rs.length) return;
    const sorted = rs.map((r) => ({ r, A: Math.abs(area2(r)) })).sort((a, b) => b.A - a.A); const groups = [];
    for (const it of sorted) { const host = groups.find((g) => inside(it.r[0], g.outer) && !g.holes.some((h) => inside(it.r[0], h))); if (host && it.A < Math.abs(area2(host.outer))) host.holes.push(it.r); else groups.push({ outer: it.r, holes: [] }); }
    let cx = 0, cy = 0, ca = 0;
    for (const g of groups) {
      const flat = [], holes = [];
      for (const [ri, r] of [g.outer, ...g.holes].entries()) { if (ri) holes.push(flat.length / 2); for (const [x, y] of r) flat.push(x - ox, y - oy); }
      const tri = earcut(flat, holes, 2), base = pos.length / 2;
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
  edgeOwner.clear();
  // corner / near-touch adjacency (~60 m), then link islands to the nearest unit
  {
    const addPair = (a, b) => { if (a === b) return; const k = Math.min(a, b) + ',' + Math.max(a, b); if (!adj.has(k)) adj.set(k, 0); };
    const cell = Math.round(Q * 60 / 40075016 * 1.4), grid = new Map();
    polys.forEach((rs, u) => { const seen = new Set(); for (const r of rs) for (const [x, y] of r) { const k = Math.floor(x / cell) * 4194304 + Math.floor(y / cell); if (seen.has(k)) continue; seen.add(k); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(u); } });
    for (const [k, list] of grid) {
      const near = [...list]; for (const d of [4194304, 1, 4194305, 4194303]) { const o = grid.get(k + d); if (o) near.push(...o); }
      const uniq = [...new Set(near)]; if (uniq.length > 12 || uniq.length < 2) continue;
      for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) addPair(uniq[i], uniq[j]);
    }
    const deg = new Int32Array(n); for (const k of adj.keys()) { const [a, b] = k.split(',').map(Number); deg[a]++; deg[b]++; }
    for (let u = 0; u < n; u++) if (!deg[u] && polys[u].length && n > 1) {
      let best = -1, bd = Infinity; for (let v = 0; v < n; v++) { if (v === u || !polys[v].length) continue; const d = (centers[u * 2] - centers[v * 2]) ** 2 + (centers[u * 2 + 1] - centers[v * 2 + 1]) ** 2; if (d < bd) { bd = d; best = v; } }
      if (best >= 0) addPair(u, best);
    }
  }
  const adjArr = [], adjLen = [];
  for (const [k, len] of adj) { const [a, b] = k.split(',').map(Number); adjArr.push(a, b); adjLen.push(len * kmAt(oy / Q + centers[a * 2 + 1])); }
  const perim = new Float64Array(n);
  for (let s = 0; s < luid.length / 2; s++) { const u = luid[s * 2]; perim[u] += Math.hypot(lpos[s * 4 + 2] - lpos[s * 4], lpos[s * 4 + 3] - lpos[s * 4 + 1]) * kmAt(oy / Q + lpos[s * 4 + 1]); }
  const areaKm = Float32Array.from(areaW, (a, u) => a * kmAt(oy / Q + centers[u * 2 + 1]) ** 2);
  // 10° coverage grid (matches build-levels)
  const cov = new Uint8Array(81);
  for (const rs of polys) for (const r of rs) {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, y] of r) { const L = lngOf(x), T = latOf(y); a = Math.min(a, L); b = Math.max(b, L); c = Math.min(c, T); d = Math.max(d, T); }
    for (let gx = Math.max(0, Math.floor((a + 180) / 10)); gx <= Math.min(35, Math.floor((b + 180) / 10)); gx++) for (let gy = Math.max(0, Math.floor((90 - d) / 10)); gy <= Math.min(17, Math.floor((90 - c) / 10)); gy++) { const k = gy * 36 + gx; cov[k >> 3] |= 1 << (k & 7); }
  }
  return { ox: ox / Q, oy: oy / Q, bbox: [lngOf(bx0), latOf(by1), lngOf(bx1), latOf(by0)], pos, uid, idx, lpos, luid, lnb, centers, areaKm, perim, adjArr, adjLen, cov: Buffer.from(cov).toString('hex') };
}

function writePack(file, G, H) {
  const blobs = []; let off = 0;
  const blob = (ta) => { const pad = (8 - (off % 8)) % 8; if (pad) { blobs.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); blobs.push(b); const ref = { t: ta.constructor.name, o: off, n: ta.length }; off += b.byteLength; return ref; };
  const f32 = (a) => blob(Float32Array.from(a));
  const header = {
    format: 'afp', v: 1, kind: 'admin', state: H.key, title: H.title, iso: 'USA', level: H.level, levelName: H.levelName, count: H.count,
    origin: [G.ox, G.oy], bbox: G.bbox, source: H.source,
    pop: f32(H.pop), vap: H.vap ? f32(H.vap) : null,
    race: H.race.map(([label, a]) => ({ label, data: f32(a) })), vrace: H.vrace.map(([label, a]) => ({ label, data: f32(a) })), elections: (H.elections || []).map((e) => ({ key: e.key, label: e.label, d: f32(e.d), r: f32(e.r) })), plans: [],
    county: blob(Uint16Array.from(H.county)), countyNames: H.countyNames, stateFips: H.fips,
    names: H.names, ids: H.ids,
    center: f32(G.centers), area: blob(H.area || G.areaKm), perim: f32(G.perim),
    adj: blob(Uint16Array.from(G.adjArr)), adjLen: f32(G.adjLen),
    geom: { pos: f32(G.pos), uid: blob(Uint16Array.from(G.uid)), idx: blob(Uint32Array.from(G.idx)), lpos: f32(G.lpos), luid: blob(Uint16Array.from(G.luid)), lnb: blob(Uint16Array.from(G.lnb)) },
  };
  const hj = Buffer.from(JSON.stringify(header)); const pre = Buffer.alloc(8); pre.write('AFP1', 0); pre.writeUInt32LE(hj.length, 4);
  const pad = Buffer.alloc((8 - ((8 + hj.length) % 8)) % 8);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([pre, hj, pad, ...blobs]), { level: 9 }));
  return fs.statSync(file).size;
}

// ---- county presidential results (votes are spread over a county's areas by voting-age population) ----
function loadElections(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}.*\.csv$/i.test(x)).sort().reverse()) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').trim().split(/\r?\n/), H = lines[0].split(',').map((x) => x.replace(/"/g, '').trim().toLowerCase());
    const iD = H.indexOf('votes_dem'), iR = H.indexOf('votes_gop'), iF = H.findIndex((x) => x === 'county_fips' || x === 'combined_fips' || x === 'fips');
    if (iD < 0 || iR < 0 || iF < 0) continue;
    const m = new Map();
    for (const L of lines.slice(1)) { const c = L.split(','); const fp = String(c[iF]).replace(/"/g, '').replace(/\.0$/, '').padStart(5, '0'); const d = +c[iD], r = +c[iR]; if (isFinite(d) && isFinite(r)) m.set(fp, [d, r]); }
    const yr = f.slice(0, 4); out.push({ key: 'PRES' + yr.slice(2), label: `President ${yr} (county result, estimated)`, m });
  }
  return out;
}
const ELECTIONS = loadElections(ELEC_DIR);
log('elections', ELECTIONS.map((e) => `${e.label}: ${e.m.size} counties`).join('; ') || 'none');
// field names differ between cartographic (STATEFP) and TIGER 2020 (STATEFP20) files
const F = (row, k) => row[k] ?? row[k + '20'];

const KINDS = [
  { level: 3, dir: TRACT_DIR, pl: 'tract', levelName: 'Census tract', TOL: Q * 0.000004, name: (r) => String(F(r, 'NAMELSAD') || ('Tract ' + F(r, 'NAME'))) },
  { level: 4, dir: BG_DIR, pl: 'bg', levelName: 'Census block group', TOL: Q * 0.000003, name: (r) => `Block Group ${F(r, 'BLKGRPCE') || String(F(r, 'GEOID')).slice(-1)}, Tract ${F(r, 'TRACTCE') ? (+F(r, 'TRACTCE') / 100).toString() : ''}` },
  { level: 5, dir: VTD_DIR, pl: 'vtd', levelName: 'Voting district', TOL: Q * 0.000003, name: (r) => String(F(r, 'NAMELSAD') || F(r, 'NAME') || ('VTD ' + F(r, 'VTDST'))) },
];
const manifest = [];
for (const K of KINDS) {
  if (!K.dir || !fs.existsSync(K.dir) || !pickShp(K.dir).length) { log('skip level', K.level, '(no shapefiles)'); continue; }
  const parts = [];
  // one shapefile at a time (a national file holds every state; TIGER files are one per state)
  for (const shp of pickShp(K.dir)) {
    const t0 = Date.now(), base = shp.slice(0, -4), { rows } = readDBF(base + '.dbf'), shapes = readSHP(shp);
    if (shapes.length !== rows.length) { log('SKIP', shp, 'shape/record mismatch'); continue; }
    const byState = new Map();
    rows.forEach((row, k) => { const st = String(F(row, 'STATEFP') || String(F(row, 'GEOID')).slice(0, 2)).padStart(2, '0'); if (!STATES[st] || !shapes[k].length) return; if (!byState.has(st)) byState.set(st, []); byState.get(st).push({ row, rings: shapes[k] }); });
    log(K.levelName, path.basename(shp), rows.length, 'shapes', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    for (const [fips, items] of [...byState.entries()].sort()) {
      const t1 = Date.now();
      items.sort((a, b) => String(F(a.row, 'GEOID')).localeCompare(String(F(b.row, 'GEOID'))));
      if (items.length > 65000) { log('SKIP', fips, 'too many units'); continue; }
      const pl = loadPL(path.join(PL_DIR, `${K.pl}_${fips}.json`));
      const raw = items.map((it) => it.rings.map((r) => r.map(([x, y]) => [fips === '02' && x > 100 ? x - 360 : x, y])));
      const G = buildGeometry(raw, K.TOL);
      const cf = (it) => String(F(it.row, 'COUNTYFP')).padStart(3, '0');
      const counties = [...new Set(items.map(cf))].sort();
      const cname = new Map(); for (const it of items) if (!cname.has(cf(it))) cname.set(cf(it), String(F(it.row, 'NAMELSADCO') || ('County ' + cf(it))));
      const v = (it, k) => { const r = pl && pl.get(String(F(it.row, 'GEOID'))); return r ? r[k] : 0; };
      const has = !!pl; const col = (k) => items.map((it) => v(it, k));
      const pop = has ? col(0) : items.map((it) => Math.round(rasterPop(it.rings))), other = (i) => Math.max(0, v(items[i], 0) - v(items[i], 1) - v(items[i], 2) - v(items[i], 3) - v(items[i], 4) - v(items[i], 5));
      const vap = has ? col(6) : null, weight = vap || pop;
      // county votes -> areas, in proportion to voting-age population
      const cTot = new Map(); items.forEach((it, u) => cTot.set(cf(it), (cTot.get(cf(it)) || 0) + weight[u]));
      const elections = [];
      for (const E of ELECTIONS) {
        const d = new Float32Array(items.length), r = new Float32Array(items.length); let hit = 0;
        items.forEach((it, u) => { const res = E.m.get(fips + cf(it)), t = cTot.get(cf(it)); if (!res || !t) return; d[u] = res[0] * weight[u] / t; r[u] = res[1] * weight[u] / t; hit++; });
        if (hit > items.length * 0.8) elections.push({ key: E.key, label: E.label, d, r });
      }
      const H = {
        key: `USA_${K.level}_${fips}`, title: STATES[fips], level: K.level, levelName: K.levelName, count: items.length, fips,
        source: `US Census Bureau — 2020 ${K.level === 5 ? 'TIGER voting districts' : 'cartographic boundaries'}` + (has ? ' and 2020 redistricting data (PL 94-171)' : '; population estimated') + (elections.length ? '; votes: county presidential results spread by voting-age population' : ''),
        pop, vap,
        race: has ? [['White', col(2)], ['Black', col(3)], ['Hispanic', col(1)], ['Asian', col(5)], ['Native', col(4)], ['Other', items.map((_, i) => other(i))]] : [],
        vrace: has ? [['White', col(8)], ['Black', col(9)], ['Hispanic', col(7)], ['Asian', col(11)], ['Native', col(10)]] : [],
        elections,
        county: items.map((it) => counties.indexOf(cf(it))), countyNames: counties.map((c) => cname.get(c)),
        names: items.map((it) => K.name(it.row).slice(0, 60)),
        ids: items.map((it) => String(F(it.row, 'GEOID'))),
        area: Float32Array.from(items, (it, u) => F(it.row, 'ALAND') > 0 ? F(it.row, 'ALAND') / 1e6 : G.areaKm[u]),
      };
      const file = `${H.key}.afp.gz`, bytes = writePack(path.join(OUT, file), G, H);
      parts.push({ file, key: H.key, title: STATES[fips], count: items.length, bbox: G.bbox, bytes, verts: G.pos.length / 2, cov: G.cov, pop: Math.round(pop.reduce((s2, x) => s2 + x, 0)), elections: elections.length });
      log(H.key, STATES[fips], items.length, 'units', (bytes / 1048576).toFixed(2), 'MB', has ? 'with PL data' : 'NO PL DATA', elections.length + ' elections', ((Date.now() - t1) / 1000).toFixed(1) + 's');
    }
  }
  if (parts.length) manifest.push({ iso: 'USA', title: 'United States', level: K.level, levelName: K.levelName, count: parts.reduce((s2, p) => s2 + p.count, 0), source: 'US Census Bureau 2020', byState: true, parts: parts.sort((a, b) => a.key.localeCompare(b.key)),
    bbox: [Math.min(...parts.map((p) => p.bbox[0])), Math.min(...parts.map((p) => p.bbox[1])), Math.max(...parts.map((p) => p.bbox[2])), Math.max(...parts.map((p) => p.bbox[3]))] });
}
const mf = path.join(OUT, 'levels.json');
let old = []; try { old = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
const merged = [...old.filter((m) => !manifest.some((x) => x.iso === m.iso && x.level === m.level)), ...manifest].sort((a, b) => a.title.localeCompare(b.title) || a.level - b.level);
fs.writeFileSync(mf, JSON.stringify(merged));
log('manifest', merged.length, 'levels; US levels added:', manifest.map((m) => m.level + ' (' + m.parts.length + ' states)').join(', '));
