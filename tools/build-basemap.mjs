// Offline reference map for the built-in style: roads, railways, rivers and urban areas from Natural Earth 10m.
// Usage: node tools/build-basemap.mjs <earcut.js> <dir with ne_10m_*.geojson> <out .bin.gz>
// Format "AFB1" + u32 header length + JSON header + 8-byte aligned blobs (gzip). Lines are strips of mercator
// float32 points (start offsets in a Uint32 blob), bucketed by class, minimum zoom and 15° grid cell.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { pathToFileURL } from 'url';

const [earcutPath, DIR, OUTF] = process.argv.slice(2);
const earcut = (await import(pathToFileURL(path.resolve(earcutPath)).href)).default;
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f + '.geojson'), 'utf8')).features;
const merc = (lng, lat) => { const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]; };
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
const lines = (g) => !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
const polys = (g) => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

// bucket -> strips
const buckets = new Map();
const CELL = 15;
function add(cls, z, coords, tol) {
  const pts = dp(coords, tol); if (pts.length < 2) return;
  const cell = z <= 4 ? -1 : Math.floor((pts[0][0] + 180) / CELL) + 24 * Math.floor((90 - pts[0][1]) / CELL);
  const key = cls + '|' + z + '|' + cell;
  let B = buckets.get(key); if (!B) buckets.set(key, B = { cls, z, cell, strips: [], bb: [180, 90, -180, -90] });
  B.strips.push(pts);
  for (const [x, y] of pts) { B.bb[0] = Math.min(B.bb[0], x); B.bb[1] = Math.min(B.bb[1], y); B.bb[2] = Math.max(B.bb[2], x); B.bb[3] = Math.max(B.bb[3], y); }
}
const zc = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
let n = 0;
for (const f of rd('ne_10m_roads')) {
  const p = f.properties, t = p.type || '';
  const cls = /Ferry/.test(t) ? 'ferry' : (t === 'Major Highway' || t === 'Beltway' || t === 'Bypass' || p.expressway === 1) ? 'motorway' : t === 'Secondary Highway' ? 'primary' : 'road';
  const z = zc(p.min_zoom ?? p.scalerank ?? 7, 3, 8);
  for (const c of lines(f.geometry)) { add(cls, z, c, 0.0004); n++; }
}
for (const f of rd('ne_10m_railroads')) {
  const p = f.properties; if (/ferry/i.test(p.featurecla || '')) continue;
  const z = zc((p.scalerank ?? 8) - 1.5, 3, 9);
  for (const c of lines(f.geometry)) { add('rail', z, c, 0.0005); n++; }
}
for (const f of rd('ne_10m_rivers_lake_centerlines')) {
  const p = f.properties; const z = zc(p.min_zoom ?? p.scalerank ?? 5, 2, 8);
  for (const c of lines(f.geometry)) { add((p.scalerank ?? 6) <= 4 ? 'river1' : 'river2', z, c, 0.0004); n++; }
}
console.log('lines', n, 'buckets', buckets.size);

// urban areas: one triangulated layer per minimum zoom
const urban = new Map();
for (const f of rd('ne_10m_urban_areas')) {
  const z = zc(f.properties.min_zoom ?? 6, 3, 7);
  for (const pl of polys(f.geometry)) {
    const rings = pl.map((r) => dp(r, 0.0006)).filter((r) => r.length >= 4); if (!rings.length) continue;
    let U = urban.get(z); if (!U) urban.set(z, U = { pos: [], idx: [] });
    const flat = [], holes = []; rings.forEach((r, k) => { if (k) holes.push(flat.length / 2); for (const [x, y] of r) { const m = merc(x, y); flat.push(m[0], m[1]); } });
    const base = U.pos.length / 2, tri = earcut(flat, holes, 2);
    for (const v of flat) U.pos.push(v); for (const t of tri) U.idx.push(base + t);
  }
}

// ---- write ----
const blobs = []; let off = 0;
const blob = (ta) => { const pad = (8 - (off % 8)) % 8; if (pad) { blobs.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); blobs.push(b); const ref = { t: ta.constructor.name, o: off, n: ta.length }; off += b.byteLength; return ref; };
const layers = [];
for (const B of [...buckets.values()].sort((a, b) => a.z - b.z)) {
  const pos = [], start = [];
  for (const s of B.strips) { start.push(pos.length / 2); for (const [x, y] of s) { const m = merc(x, y); pos.push(m[0], m[1]); } }
  start.push(pos.length / 2);
  layers.push({ kind: 'line', cls: B.cls, z: B.z, cell: B.cell, bbox: B.bb, pos: blob(Float32Array.from(pos)), start: blob(Uint32Array.from(start)) });
}
for (const [z, U] of [...urban.entries()].sort((a, b) => a[0] - b[0])) layers.push({ kind: 'poly', cls: 'urban', z, cell: -1, bbox: [-180, -90, 180, 90], pos: blob(Float32Array.from(U.pos)), idx: blob(Uint32Array.from(U.idx)) });
const header = { format: 'afb', v: 1, source: 'Natural Earth 10m (public domain)', layers };
const hj = Buffer.from(JSON.stringify(header)); const pre = Buffer.alloc(8); pre.write('AFB1', 0); pre.writeUInt32LE(hj.length, 4);
const pad = Buffer.alloc((8 - ((8 + hj.length) % 8)) % 8);
fs.writeFileSync(OUTF, zlib.gzipSync(Buffer.concat([pre, hj, pad, ...blobs]), { level: 9 }));
const tot = layers.reduce((s, L) => s + L.pos.n / 2, 0);
console.log('layers', layers.length, 'points', tot, 'bytes', fs.statSync(OUTF).size);
