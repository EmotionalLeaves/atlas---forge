// Builds admin-level packs (ADM1–ADM5 for every country with open data) from geoBoundaries TopoJSON.
// Usage: node --max-old-space-size=12000 tools/build-levels.mjs <earcut.js> <topoDir> <metaDir> <fpop.bin> <outDir> [ISO filter]
// Output: <outDir>/<ISO>_<L>[_<part>].afp.gz (same container as precinct packs) + <outDir>/levels.json manifest.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pathToFileURL } from 'url';

const [earcutPath, TOPO, META, FPOP, OUT, ONLY] = process.argv.slice(2);
const earcut = (await import(pathToFileURL(path.resolve(earcutPath)).href)).default;
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- population raster (0.05°) ----
const FW = 7200, FH = 3600, FRES = 0.05;
const fpopBuf = fs.readFileSync(FPOP); const fPop = new Float32Array(fpopBuf.buffer, fpopBuf.byteOffset, FW * FH);
const cellKm2 = (row) => (111.32 * FRES) ** 2 * Math.cos((90 - (row + 0.5) * FRES) * Math.PI / 180);

// ---- geometry helpers ----
const Q = 2 ** 27;
const merc = (lng, lat) => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]; };
const kmAt = (yw) => 40075.016686 * Math.cos(Math.atan(Math.sinh(Math.PI * (1 - 2 * yw))));
function dp(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) { const [px, py] = pts[i]; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(px - ax - t * dx, py - ay - t * dy); if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area2 = (r) => { let s = 0; for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; };
const inside = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };

const TOL = { ADM1: 0.0025, ADM2: 0.0012, ADM3: 0.0006, ADM4: 0.0004, ADM5: 0.00025 }; // degrees

// ---- read one TopoJSON into polygons (lng/lat), with arc topology preserved ----
function readTopo(file, tol) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const obj = Object.values(j.objects)[0];
  const T = j.transform;
  // decode + simplify each arc once (arcs are shared, so neighbours stay identical)
  const arcs = j.arcs.map((arc) => {
    let x = 0, y = 0; const pts = [];
    for (const p of arc) { if (T) { x += p[0]; y += p[1]; pts.push([x * T.scale[0] + T.translate[0], y * T.scale[1] + T.translate[1]]); } else pts.push([p[0], p[1]]); }
    return dp(pts, tol);
  });
  const ringOf = (idxs) => { const out = []; for (const a of idxs) { let pts = a >= 0 ? arcs[a] : arcs[~a].slice().reverse(); if (out.length) pts = pts.slice(1); for (const p of pts) out.push(p); } if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop(); return out; };
  const geoms = obj.geometries.map((g) => {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    return { props: g.properties || {}, polys, rings: polys.map((pl) => pl.map((r) => ({ arcs: r, pts: ringOf(r) })).filter((r) => r.pts.length >= 3)).filter((pl) => pl.length) };
  });
  return { arcs, geoms };
}

// ---- population estimate: scanline-rasterise each polygon at an adaptive step and sum raster density ----
function popOf(geom) {
  let pop = 0, bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const pl of geom.rings) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pl[0].pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    bx0 = Math.min(bx0, x0); bx1 = Math.max(bx1, x1); by0 = Math.min(by0, y0); by1 = Math.max(by1, y1);
    const s = Math.min(FRES, Math.max(Math.max(x1 - x0, y1 - y0) / 14, 0.002));
    for (let y = y0 + s / 2; y < y1; y += s) {
      const xs = [];
      for (const r of pl) { const P = r.pts, n = P.length; for (let i = 0, j = n - 1; i < n; j = i++) { const yi = P[i][1], yj = P[j][1]; if ((yi > y) !== (yj > y)) xs.push(P[i][0] + (y - yi) * (P[j][0] - P[i][0]) / (yj - yi)); } }
      xs.sort((a, b) => a - b);
      const row = Math.floor((90 - y) / FRES); if (row < 0 || row >= FH) continue;
      const dens = 1 / cellKm2(row), w = (111.32 * s) ** 2 * Math.cos(y * Math.PI / 180);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil((xs[k] - x0) / s - 0.5) * s + x0 + s / 2; x < xs[k + 1]; x += s) {
          const c = Math.floor(((x + 180) % 360 + 360) % 360 / FRES); pop += fPop[row * FW + c] * dens * w;
        }
      }
    }
  }
  if (pop === 0 && isFinite(bx0)) { // tiny unit: its share of the cell it sits in
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, c = Math.floor(((cx + 180) % 360 + 360) % 360 / FRES), r = Math.floor((90 - cy) / FRES);
    if (r >= 0 && r < FH) pop = fPop[r * FW + c] * Math.min(1, ((bx1 - bx0) * (by1 - by0)) / (FRES * FRES));
  }
  return pop;
}

// split a big list of units into spatial chunks of at most `max` units (k-d style on unit centres)
function chunk(units, max) {
  if (units.length <= max) return [units];
  const cs = units.map((U) => { const r = U.mpolys[0][0]; let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of cs) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const ax = (x1 - x0) * Math.cos(((y0 + y1) / 2) * Math.PI / 180) > (y1 - y0) ? 0 : 1;
  const order = units.map((_, i) => i).sort((a, b) => cs[a][ax] - cs[b][ax]); const mid = order.length >> 1;
  return [...chunk(order.slice(0, mid).map((i) => units[i]), max), ...chunk(order.slice(mid).map((i) => units[i]), max)];
}

// ---- write a pack (AFP1 container, gzip) ----
function writePack(file, meta, units) {
  const pos = [], uid = [], idx = [], lpos = [], luid = [], lnb = [];
  const n = units.length; const centers = new Float64Array(n * 2), areaKm = new Float32Array(n), perim = new Float32Array(n);
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  units.forEach((U) => U.mpolys.forEach((pl) => pl.forEach((r) => r.forEach((p) => { const m = merc(p[0], p[1]); p.m = m; bx0 = Math.min(bx0, m[0]); bx1 = Math.max(bx1, m[0]); by0 = Math.min(by0, m[1]); by1 = Math.max(by1, m[1]); }))));
  const ox = bx0, oy = by0;
  // arc -> units using it (for neighbours)
  const arcUsers = new Map();
  units.forEach((U, u) => { for (const pl of U.arcPolys) for (const r of pl) for (const a of r) { const k = a >= 0 ? a : ~a; let s = arcUsers.get(k); if (!s) arcUsers.set(k, s = []); if (!s.includes(u)) s.push(u); } });
  const adj = new Map();
  units.forEach((U, u) => {
    let cx = 0, cy = 0, ca = 0;
    U.mpolys.forEach((pl, pi) => {
      const flat = [], holes = [];
      pl.forEach((r, ri) => { if (ri) holes.push(flat.length / 2); for (const p of r) flat.push(p.m[0] - ox, p.m[1] - oy); });
      const tri = earcut(flat, holes, 2), base = pos.length / 2;
      for (let k = 0; k < flat.length; k += 2) { pos.push(flat[k], flat[k + 1]); uid.push(u); }
      for (const t of tri) idx.push(base + t);
      const A = Math.abs(area2(pl[0].map((p) => p.m))) / 2 - pl.slice(1).reduce((s, h) => s + Math.abs(area2(h.map((p) => p.m))) / 2, 0);
      let sx = 0, sy = 0; for (const p of pl[0]) { sx += p.m[0]; sy += p.m[1]; } cx += sx / pl[0].length * A; cy += sy / pl[0].length * A; ca += A;
    });
    // outline segments: walk each ring's arcs so we know who is across each segment
    for (const pl of U.arcPolys) for (const r of pl) for (const a of r) {
      const k = a >= 0 ? a : ~a, users = arcUsers.get(k), other = users.find((v) => v !== u);
      const pts = U.arcPts(a); let len = 0;
      for (let q = 0; q + 1 < pts.length; q++) {
        const A1 = merc(pts[q][0], pts[q][1]), B1 = merc(pts[q + 1][0], pts[q + 1][1]);
        lpos.push(A1[0] - ox, A1[1] - oy, B1[0] - ox, B1[1] - oy); luid.push(u, u); const nb = other == null ? 65535 : other; lnb.push(nb, nb);
        len += Math.hypot(B1[0] - A1[0], B1[1] - A1[1]) * kmAt(A1[1]);
      }
      perim[u] += len;
      if (other != null && u < other) { const kk = u + ',' + other; adj.set(kk, (adj.get(kk) || 0) + len); }
    }
    centers[u * 2] = ca ? cx / ca : 0.5; centers[u * 2 + 1] = ca ? cy / ca : 0.5;
    areaKm[u] = ca * kmAt(centers[u * 2 + 1]) ** 2;
  });
  // units with no neighbours (islands): link to nearest centre so districts can still be built
  const deg = new Int32Array(n); for (const k of adj.keys()) { const [a, b] = k.split(',').map(Number); deg[a]++; deg[b]++; }
  for (let u = 0; u < n; u++) if (!deg[u] && n > 1) { let best = -1, bd = Infinity; for (let v = 0; v < n; v++) { if (v === u) continue; const d = (centers[u * 2] - centers[v * 2]) ** 2 + (centers[u * 2 + 1] - centers[v * 2 + 1]) ** 2; if (d < bd) { bd = d; best = v; } } if (best >= 0) { const kk = Math.min(u, best) + ',' + Math.max(u, best); if (!adj.has(kk)) adj.set(kk, 0); } }
  const adjArr = [], adjLen = []; for (const [k, L] of adj) { const [a, b] = k.split(',').map(Number); adjArr.push(a, b); adjLen.push(L); }
  // blobs
  const blobs = []; let off = 0;
  const blob = (ta) => { const pad = (8 - (off % 8)) % 8; if (pad) { blobs.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); blobs.push(b); const ref = { t: ta.constructor.name, o: off, n: ta.length }; off += b.byteLength; return ref; };
  const lng = (x) => x * 360 - 180, lat = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
  const header = {
    format: 'afp', v: 1, kind: 'admin', state: meta.key, title: meta.title, iso: meta.iso, level: meta.level, levelName: meta.levelName, count: n, origin: [ox, oy],
    bbox: [lng(bx0), lat(by1), lng(bx1), lat(by0)], source: meta.source,
    pop: blob(Float32Array.from(units, (U) => U.pop)), vap: null, race: [], vrace: [], elections: [], plans: [],
    county: blob(Uint16Array.from(units, (U) => U.parent < 0 ? 65535 : U.parent)), countyNames: meta.parentNames || [], stateFips: '',
    names: units.map((U) => U.name), ids: units.map((U) => U.id),
    center: blob(Float32Array.from(Array.from(centers, (v, k) => v - (k % 2 ? oy : ox)))), area: blob(areaKm), perim: blob(perim),
    adj: blob(Uint16Array.from(adjArr)), adjLen: blob(Float32Array.from(adjLen)),
    geom: { pos: blob(Float32Array.from(pos)), uid: blob(Uint16Array.from(uid)), idx: blob(Uint32Array.from(idx)), lpos: blob(Float32Array.from(lpos)), luid: blob(Uint16Array.from(luid)), lnb: blob(Uint16Array.from(lnb)) },
  };
  const hj = Buffer.from(JSON.stringify(header)); const pre = Buffer.alloc(8); pre.write('AFP1', 0); pre.writeUInt32LE(hj.length, 4);
  const pad = Buffer.alloc((8 - ((8 + hj.length) % 8)) % 8);
  fs.writeFileSync(file, zlib.gzipSync(Buffer.concat([pre, hj, pad, ...blobs]), { level: 9 }));
  return { bbox: header.bbox, verts: pos.length / 2 };
}

// ---- main ----
const files = fs.readdirSync(TOPO).filter((f) => /_ADM[1-5]_/.test(f));
const byIso = new Map();
for (const f of files) { const m = f.match(/^([A-Z]{3})_ADM(\d)_/); if (!m) continue; if (ONLY && !ONLY.split(',').includes(m[1])) continue; if (!byIso.has(m[1])) byIso.set(m[1], []); byIso.get(m[1]).push([+m[2], f]); }
const manifest = [];
const metaOf = (iso, L) => { try { return JSON.parse(fs.readFileSync(path.join(META, `${iso}_ADM${L}_geoBoundaries-${iso}-ADM${L}-metaData.json`), 'utf8')); } catch { return {}; } };
const countryName = (iso) => { const m = metaOf(iso, 0); return m.boundaryName || iso; };
for (const [iso, list] of [...byIso.entries()].sort()) {
  list.sort((a, b) => a[0] - b[0]);
  let prev = null; // previous level's units (for parent lookup)
  for (const [L, f] of list) {
    const key = `${iso}_${L}`, md = metaOf(iso, L), t0 = Date.now();
    const stat = fs.statSync(path.join(TOPO, f));
    const tolMul = stat.size > 60e6 ? 2.2 : stat.size > 15e6 ? 1.4 : 1;
    let topo;
    try { topo = readTopo(path.join(TOPO, f), TOL['ADM' + L] * tolMul); } catch (e) { log('SKIP', key, e.message); continue; }
    const units = topo.geoms.map((g, k) => {
      const props = g.props;
      return { name: String(props.shapeName || props.name || `Area ${k + 1}`).slice(0, 60), id: String(props.shapeID || props.shapeISO || k), g, mpolys: g.rings.map((pl) => pl.map((r) => r.pts.map((p) => [p[0], p[1]]))), arcPolys: g.polys, arcPts: (a) => (a >= 0 ? topo.arcs[a] : topo.arcs[~a].slice().reverse()), pop: popOf(g), parent: -1 };
    }).filter((U) => U.mpolys.length);
    // parents
    if (prev) {
      for (const U of units) {
        // a point inside the unit: centroid of its largest ring (fall back to first vertex)
        const r0 = U.mpolys.map((pl) => pl[0]).sort((a, b) => Math.abs(area2(b)) - Math.abs(area2(a)))[0];
        let px = 0, py = 0; for (const p of r0) { px += p[0]; py += p[1]; } px /= r0.length; py /= r0.length; if (!inside(px, py, r0)) { px = r0[0][0]; py = r0[0][1]; }
        for (let q = 0; q < prev.length; q++) { const P = prev[q]; if (px < P.bb[0] || px > P.bb[2] || py < P.bb[1] || py > P.bb[3]) continue; if (P.mpolys.some((pl) => inside(px, py, pl[0]))) { U.parent = q; break; } }
      }
    }
    // rescale population so a country's areas add up to the same total at every level
    const tot = units.reduce((s, U) => s + U.pop, 0); if (prev && prev.total > 0 && tot > 0) { const f2 = prev.total / tot; for (const U of units) U.pop *= f2; }
    const meta = { key, iso, level: L, title: countryName(iso), levelName: (md.boundaryCanonical || `Level ${L}`).split(',')[0].trim() || `Level ${L}`, source: `geoBoundaries — ${md.boundarySource || 'various'} (${md.boundaryLicense || 'open license'})`, parentNames: prev ? prev.names : [] };
    // very large levels are split by parent region
    const parts = chunk(units, 12000);
    const partInfo = [];
    parts.forEach((pu, pi) => {
      const file = parts.length > 1 ? `${key}_${pi}.afp.gz` : `${key}.afp.gz`;
      const mk = parts.length > 1 ? { ...meta, key: `${key}_${pi}`, parentNames: meta.parentNames } : meta;
      // parent index stays the index into the previous level (names list shared)
      const r = writePack(path.join(OUT, file), mk, pu);
      partInfo.push({ file, key: mk.key, count: pu.length, bbox: r.bbox, bytes: fs.statSync(path.join(OUT, file)).size, verts: r.verts });
    });
    manifest.push({ iso, title: meta.title, level: L, levelName: meta.levelName, count: units.length, source: meta.source, parts: partInfo, bbox: [Math.min(...partInfo.map((p) => p.bbox[0])), Math.max(...partInfo.map((p) => p.bbox[1])), Math.max(...partInfo.map((p) => p.bbox[2])), Math.min(...partInfo.map((p) => p.bbox[3]))] });
    log(key, meta.levelName, units.length, 'units', partInfo.length, 'part(s)', (partInfo.reduce((s, p) => s + p.bytes, 0) / 1048576).toFixed(2), 'MB', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    // keep this level for the next one's parent lookup
    prev = units.map((U) => { let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const pl of U.mpolys) for (const p of pl[0]) { bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]); bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]); } return { mpolys: U.mpolys, bb }; });
    prev.names = units.map((U) => U.name); prev.total = units.reduce((s, U) => s + U.pop, 0);
  }
}
const mf = path.join(OUT, 'levels.json');
let old = []; try { old = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
const merged = [...old.filter((m) => !manifest.some((x) => x.iso === m.iso && x.level === m.level)), ...manifest].sort((a, b) => a.title.localeCompare(b.title) || a.level - b.level);
fs.writeFileSync(mf, JSON.stringify(merged));
log('manifest', merged.length, 'levels');
