// Builds Atlas Forge's bundled world data from Natural Earth + US Census county data.
// Usage: node --max-old-space-size=6000 tools/build-data.mjs <rawDir> <outDir>
//   rawDir must contain: ne/geojson/*.geojson (Natural Earth), plotly/geojson-counties-fips.json,
//   plotly/minoritymajority.csv, earcut/src/earcut.js
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const RAW = process.argv[2];
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const earcut = (await import(pathToFileURL(path.join(RAW, 'earcut/src/earcut.js')).href)).default;
const rd = (p) => JSON.parse(fs.readFileSync(path.join(RAW, p), 'utf8'));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- grids ----------
const FRES = 0.05, FW = 7200, FH = 3600;        // fine analysis grid
const CRES = 0.25, CW = 1440, CH = 720, K = 5;   // coarse game grid (5x5 fine cells)

const polysOf = (g) => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

function rasterPoly(rings, fill) {
  const rows = new Map();
  for (const ring of rings) {
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      const x1 = (a[0] + 180) / FRES, y1 = (90 - a[1]) / FRES, x2 = (b[0] + 180) / FRES, y2 = (90 - b[1]) / FRES;
      if (y1 === y2) continue;
      const ymin = Math.min(y1, y2), ymax = Math.max(y1, y2);
      const r0 = Math.max(0, Math.ceil(ymin - 0.5)), r1 = Math.min(FH - 1, Math.ceil(ymax - 0.5) - 1);
      for (let r = r0; r <= r1; r++) {
        const x = x1 + (r + 0.5 - y1) * (x2 - x1) / (y2 - y1);
        let arr = rows.get(r); if (!arr) rows.set(r, arr = []); arr.push(x);
      }
    }
  }
  for (const [r, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil(xs[i] - 0.5)), c1 = Math.min(FW - 1, Math.ceil(xs[i + 1] - 0.5) - 1);
      if (c1 >= c0) fill(r * FW, c0, c1);
    }
  }
}
function rasterFeatures(features, arr, valueOf) {
  features.forEach((f, i) => {
    const v = valueOf(f, i); if (!v) return;
    for (const p of polysOf(f.geometry)) rasterPoly(p, (row, c0, c1) => arr.fill(v, row + c0, row + c1 + 1));
  });
}

// ---------- load sources ----------
log('loading');
const countriesG = rd('ne/geojson/ne_50m_admin_0_countries.geojson').features;
const admin1G = rd('ne/geojson/ne_10m_admin_1_states_provinces.geojson').features;
const placesG = rd('ne/geojson/ne_10m_populated_places_simple.geojson').features;
const lakesG = rd('ne/geojson/ne_50m_lakes.geojson').features;
const glacierG = rd('ne/geojson/ne_50m_glaciated_areas.geojson').features;
const regionsG = rd('ne/geojson/ne_10m_geography_regions_polys.geojson').features;
const riversG = rd('ne/geojson/ne_50m_rivers_lake_centerlines.geojson').features;
const countiesG = rd('plotly/geojson-counties-fips.json').features;
const csv = fs.readFileSync(path.join(RAW, 'plotly/minoritymajority.csv'), 'utf8').trim().split(/\r?\n/);
const head = csv[0].split(',');
const countyCensus = new Map();
for (const line of csv.slice(1)) {
  // fields have no embedded commas except none; CTYNAME may contain none
  const f = line.split(',');
  const o = {}; head.forEach((h, i) => o[h] = f[i]);
  countyCensus.set(parseInt(o.FIPS, 10), o);
}

// ---------- unit tables ----------
const num = (v) => (typeof v === 'number' && isFinite(v) && v > -90) ? v : null;
const countries = countriesG.map((f) => {
  const p = f.properties;
  return {
    name: p.NAME, long: p.NAME_LONG, a3: p.ADM0_A3, iso: p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3,
    sov: p.SOVEREIGNT, type: p.TYPE, pop: num(p.POP_EST) ?? 0, gdp: num(p.GDP_MD) ?? 0, gdpYear: p.GDP_YEAR,
    economy: (p.ECONOMY || '').replace(/^\d\.\s*/, ''), income: (p.INCOME_GRP || '').replace(/^\d\.\s*/, ''),
    continent: p.CONTINENT, region: p.REGION_UN, subregion: p.SUBREGION, regionWB: p.REGION_WB,
    mapcolor: p.MAPCOLOR9, label: [p.LABEL_X, p.LABEL_Y],
  };
});
const countryByA3 = new Map(countries.map((c, i) => [c.a3, i + 1]));
const admin1 = admin1G.map((f) => {
  const p = f.properties;
  return {
    name: p.name || p.name_en || p.gn_name || '?', country: countryByA3.get(p.adm0_a3) || 0, type: p.type_en || p.type || '',
    region: p.region || '', iso: p.iso_3166_2 || '', label: [p.longitude, p.latitude], pop: 0, area: 0,
  };
});
const stateNames = new Map();
for (const o of countyCensus.values()) stateNames.set(o.FIPS.padStart(5, '0').slice(0, 2), o.STNAME);
const counties = countiesG.map((f) => {
  const p = f.properties; const fips = parseInt(f.id, 10); const c = countyCensus.get(fips);
  const pct = (s) => s ? parseFloat(s) : null;
  return {
    name: `${p.NAME} ${p.LSAD === 'County' ? 'County' : (p.LSAD || '')}`.trim(), state: stateNames.get(p.STATE) || (p.STATE === '72' ? 'Puerto Rico' : p.STATE),
    fips: f.id, censusPop: c ? parseInt(c.TOT_POP, 10) : null, minority: c ? pct(c.MinorityPCT) : null,
    black: c ? pct(c.BlackPCT) : null, hispanic: c ? pct(c.HispanicPCT) : null, sqmi: p.CENSUSAREA, pop: 0, area: 0,
  };
});
log('units', countries.length, admin1.length, counties.length);

// ---------- fine rasters ----------
log('raster countries');
const fCountry = new Uint16Array(FW * FH);
rasterFeatures(countriesG, fCountry, (f, i) => i + 1);
const fWater = new Uint8Array(FW * FH);
rasterFeatures(lakesG, fWater, () => 1);
log('raster admin1');
const fAdmin = new Uint16Array(FW * FH);
rasterFeatures(admin1G, fAdmin, (f, i) => i + 1);
log('raster counties');
const fCounty = new Uint16Array(FW * FH);
rasterFeatures(countiesG, fCounty, (f, i) => i + 1);
log('raster terrain');
const T = { WATER: 0, LAKE: 1, ICE: 2, POLAR: 3, TUNDRA: 4, BOREAL: 5, TEMPERATE: 6, TROPICAL: 7, DESERT: 8, MOUNTAINS: 9, HIGHLANDS: 10, FERTILE: 11 };
const fRegion = new Uint8Array(FW * FH);
const regionClass = { 'Desert': T.DESERT, 'Range/mtn': T.MOUNTAINS, 'Plateau': T.HIGHLANDS, 'Tundra': T.TUNDRA, 'Delta': T.FERTILE, 'Wetlands': T.FERTILE };
// paint broad classes first, mountains last so they win
for (const cls of ['Plateau', 'Tundra', 'Desert', 'Delta', 'Wetlands', 'Range/mtn']) {
  rasterFeatures(regionsG.filter((f) => f.properties.FEATURECLA === cls), fRegion, () => regionClass[cls]);
}
rasterFeatures(glacierG, fRegion, () => T.ICE);
const fRiver = new Uint8Array(FW * FH);
for (const f of riversG) {
  const g = f.geometry; if (!g) continue;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const ln of lines) for (let k = 0; k + 1 < ln.length; k++) {
    const [ax, ay] = ln[k], [bx, by] = ln[k + 1];
    const x1 = (ax + 180) / FRES, y1 = (90 - ay) / FRES, x2 = (bx + 180) / FRES, y2 = (90 - by) / FRES;
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2) + 1;
    for (let s = 0; s <= steps; s++) {
      const x = Math.floor(x1 + (x2 - x1) * s / steps), y = Math.floor(y1 + (y2 - y1) * s / steps);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= FH || xx < 0 || xx >= FW) continue;
        fRiver[yy * FW + xx] = 1;
      }
    }
  }
}
const ATA = countryByA3.get('ATA');
// deterministic smooth value noise (for natural-looking climate bands and rural density)
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(lng, lat, scale, seed) {
  const x = (lng + 180) / scale, y = (lat + 90) / scale, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (lng, lat, seed) => 0.5 * vnoise(lng, lat, 6, seed) + 0.3 * vnoise(lng, lat, 2, seed + 7) + 0.2 * vnoise(lng, lat, 0.6, seed + 13);
function terrainOf(i) {
  const lat = 90 - (Math.floor(i / FW) + 0.5) * FRES, lng = -180 + ((i % FW) + 0.5) * FRES;
  const al = Math.abs(lat) + (fbm(lng, lat, 3) - 0.5) * 9;
  if (fWater[i]) return T.LAKE;
  if (!fCountry[i]) return T.WATER;
  if (fCountry[i] === ATA || fRegion[i] === T.ICE) return T.ICE;
  if (fRegion[i]) return fRegion[i];
  if (al >= 70) return T.POLAR;
  if (al >= 62) return T.TUNDRA;
  if (al >= 50) return T.BOREAL;
  if (al >= 23.5) return T.TEMPERATE;
  return T.TROPICAL;
}
const HAB = [0, 0, 0, 0.01, 0.04, 0.3, 1, 0.9, 0.04, 0.35, 0.6, 1.6];

// ---------- population on fine grid ----------
log('population');
const fPop = new Float32Array(FW * FH);
const fArea = new Float32Array(FH); // km2 per fine cell by row
for (let r = 0; r < FH; r++) { const lat = 90 - (r + 0.5) * FRES; fArea[r] = (111.32 * FRES) ** 2 * Math.cos(lat * Math.PI / 180); }
// bucket land cells by country
const nC = countries.length + 1;
const cnt = new Int32Array(nC + 1);
for (let i = 0; i < FW * FH; i++) if (fCountry[i] && !fWater[i]) cnt[fCountry[i] + 1]++;
for (let c = 1; c <= nC; c++) cnt[c] += cnt[c - 1];
const byC = new Int32Array(cnt[nC]);
const fillp = cnt.slice();
for (let i = 0; i < FW * FH; i++) if (fCountry[i] && !fWater[i]) byC[fillp[fCountry[i]]++] = i;

const cities = placesG.map((f) => {
  const p = f.properties; const [lng, lat] = f.geometry.coordinates;
  const fx = Math.min(FW - 1, Math.floor((lng + 180) / FRES)), fy = Math.min(FH - 1, Math.floor((90 - lat) / FRES));
  let c = fCountry[fy * FW + fx] || countryByA3.get(p.adm0_a3) || countryByA3.get(p.sov_a3) || 0;
  return { name: p.name, lng: +lng.toFixed(3), lat: +lat.toFixed(3), pop: Math.max(p.pop_max || 0, p.pop_min || 0), country: c, cap: p.adm0cap ? 1 : 0, rank: p.scalerank };
}).filter((c) => c.country);

const urbanW = new Float32Array(FW * FH);
for (let c = 1; c < nC; c++) {
  const P = countries[c - 1].pop; if (!P) continue;
  const cs = cities.filter((x) => x.country === c);
  let U = cs.reduce((s, x) => s + x.pop, 0);
  const scale = U > 0.8 * P ? 0.8 * P / U : 1;
  let placed = 0;
  for (const city of cs) {
    const cp = city.pop * scale; if (!cp) continue;
    const s = 0.6 + 0.9 * Math.log10(Math.max(city.pop, 1e4) / 1e4);
    const R = Math.ceil(s * 3);
    const cx = Math.floor((city.lng + 180) / FRES), cy = Math.floor((90 - city.lat) / FRES);
    let wsum = 0; const cells = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const y = cy + dy; let x = cx + dx; if (y < 0 || y >= FH) continue; x = (x + FW) % FW;
      const i = y * FW + x; if (fCountry[i] !== c || fWater[i]) continue;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * s * s)); cells.push(i, w); wsum += w;
    }
    if (!wsum) { const i = cy * FW + ((cx + FW) % FW); fPop[i] += cp; placed += cp; continue; }
    for (let k = 0; k < cells.length; k += 2) fPop[cells[k]] += cp * cells[k + 1] / wsum;
    placed += cp;
  }
  const R = Math.max(0, P - placed);
  let wsum = 0;
  for (let k = cnt[c]; k < cnt[c + 1]; k++) {
    const i = byC[k]; const t = terrainOf(i);
    let w = HAB[t]; if (fRiver[i]) w *= (t === T.DESERT || t === T.TUNDRA) ? 12 : 1.6;
    const y = Math.floor(i / FW); w *= fArea[y] * (0.25 + 1.5 * fbm(-180 + ((i % FW) + 0.5) * FRES, 90 - (y + 0.5) * FRES, 11) ** 2);
    urbanW[i] = w; wsum += w;
  }
  if (wsum > 0) for (let k = cnt[c]; k < cnt[c + 1]; k++) { const i = byC[k]; fPop[i] += R * urbanW[i] / wsum; }
  else if (cnt[c + 1] > cnt[c]) for (let k = cnt[c]; k < cnt[c + 1]; k++) fPop[byC[k]] += R / (cnt[c + 1] - cnt[c]);
}
// US counties: rescale to real census population
log('county census rescale');
{
  const est = new Float64Array(counties.length + 1), ncell = new Int32Array(counties.length + 1);
  for (let i = 0; i < FW * FH; i++) { const k = fCounty[i]; if (k && !fWater[i]) { est[k] += fPop[i]; ncell[k]++; } }
  const fac = new Float64Array(counties.length + 1);
  for (let k = 1; k <= counties.length; k++) {
    const real = counties[k - 1].censusPop;
    fac[k] = real == null ? 1 : est[k] > 0 ? real / est[k] : NaN;
  }
  for (let i = 0; i < FW * FH; i++) {
    const k = fCounty[i]; if (!k || fWater[i]) continue;
    if (isNaN(fac[k])) fPop[i] = counties[k - 1].censusPop / ncell[k]; else fPop[i] *= fac[k];
  }
}
// province/county pop & area & adjacency
log('unit stats + adjacency');
function unitStats(arr, units) {
  const pop = new Float64Array(units.length + 1), area = new Float64Array(units.length + 1), perim = new Float64Array(units.length + 1);
  const shared = new Map();
  const kmLat = 111.32 * FRES;
  for (let y = 0; y < FH; y++) {
    const kmLon = kmLat * Math.cos((90 - (y + 0.5) * FRES) * Math.PI / 180);
    for (let x = 0; x < FW; x++) {
      const i = y * FW + x; const a = fWater[i] ? 0 : arr[i];
      if (a) { pop[a] += fPop[i]; area[a] += fArea[y]; }
      const right = y * FW + ((x + 1) % FW); const b = fWater[right] ? 0 : arr[right];
      if (a !== b) {
        if (a) perim[a] += kmLat; if (b) perim[b] += kmLat;
        if (a && b) { const key = a < b ? a * 65536 + b : b * 65536 + a; shared.set(key, (shared.get(key) || 0) + kmLat); }
      }
      if (y + 1 < FH) {
        const dn = i + FW; const c = fWater[dn] ? 0 : arr[dn];
        if (a !== c) {
          if (a) perim[a] += kmLon; if (c) perim[c] += kmLon;
          if (a && c) { const key = a < c ? a * 65536 + c : c * 65536 + a; shared.set(key, (shared.get(key) || 0) + kmLon); }
        }
      }
    }
  }
  units.forEach((u, k) => { u.pop = Math.round(pop[k + 1]); u.area = Math.round(area[k + 1]); u.perim = Math.round(perim[k + 1]); });
  const pairs = [];
  for (const [key, len] of shared) pairs.push(Math.floor(key / 65536) - 1, (key % 65536) - 1, Math.round(len));
  return pairs;
}
const adjProv = unitStats(fAdmin, admin1);
const adjCounty = unitStats(fCounty, counties);
counties.forEach((c) => { if (c.censusPop != null) c.pop = c.censusPop; });

// ---------- coarse grid ----------
log('coarse grid');
const N = CW * CH;
const cCountry = new Uint16Array(N), cAdmin = new Uint16Array(N), cCounty = new Uint16Array(N);
const cTerrain = new Uint8Array(N), cFlags = new Uint8Array(N), cPop = new Float32Array(N);
const tally = new Map();
const majority = (vals) => { tally.clear(); let best = 0, bn = 0; for (const v of vals) { if (!v) continue; const n = (tally.get(v) || 0) + 1; tally.set(v, n); if (n > bn) { bn = n; best = v; } } return best; };
for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
  const ci = cy * CW + cx; let land = 0, lake = 0, river = 0, pop = 0;
  const cs = [], as = [], ks = [], ts = [];
  for (let dy = 0; dy < K; dy++) for (let dx = 0; dx < K; dx++) {
    const i = (cy * K + dy) * FW + cx * K + dx; pop += fPop[i];
    if (fWater[i]) { lake++; continue; }
    if (fCountry[i]) { land++; cs.push(fCountry[i]); as.push(fAdmin[i]); ks.push(fCounty[i]); ts.push(terrainOf(i)); if (fRiver[i]) river++; }
  }
  cPop[ci] = pop;
  if (land >= 10) {
    cCountry[ci] = majority(cs); cAdmin[ci] = majority(as); cCounty[ci] = majority(ks);
    cTerrain[ci] = majority(ts.map((t) => t + 1)) - 1;
    if (river >= 3) cFlags[ci] |= 1;
  } else { cTerrain[ci] = lake >= 13 ? T.LAKE : T.WATER; if (lake >= 13) cFlags[ci] |= 4; }
}
// a cell belongs to the country of its province, so province shapes and cell ownership always agree
for (let ci = 0; ci < N; ci++) { const a = cAdmin[ci]; if (a && cCountry[ci]) { const c = admin1[a - 1].country; if (c) cCountry[ci] = c; } }
// move pop off water cells to nearest land cell of any country
for (let ci = 0; ci < N; ci++) {
  if (cCountry[ci] || !cPop[ci]) continue;
  const cy = Math.floor(ci / CW), cx = ci % CW; let done = false;
  for (let r = 1; r <= 3 && !done; r++) for (let dy = -r; dy <= r && !done; dy++) for (let dx = -r; dx <= r && !done; dx++) {
    const y = cy + dy; if (y < 0 || y >= CH) continue; const j = y * CW + ((cx + dx + CW) % CW);
    if (cCountry[j]) { cPop[j] += cPop[ci]; done = true; }
  }
  cPop[ci] = 0;
}
// ensure every country owns at least one cell
const have = new Int32Array(nC);
for (let ci = 0; ci < N; ci++) if (cCountry[ci]) have[cCountry[ci]]++;
let created = 0;
countries.forEach((c, k) => {
  const id = k + 1; if (have[id] || c.a3 === 'ATA') return;
  const [lng, lat] = c.label; if (lng == null) return;
  const cx = Math.min(CW - 1, Math.floor((lng + 180) / CRES)), cy = Math.min(CH - 1, Math.floor((90 - lat) / CRES)); const ci = cy * CW + cx;
  const prev = cCountry[ci];
  if (prev && cPop[ci]) { // give displaced population to a neighbour of the previous owner
    for (const d of [1, -1, CW, -CW]) { const j = ci + d; if (j >= 0 && j < N && cCountry[j] === prev) { cPop[j] += cPop[ci]; break; } }
  }
  cCountry[ci] = id; cPop[ci] = c.pop; cFlags[ci] &= ~4;
  if (!prev) cTerrain[ci] = Math.abs(lat) < 23.5 ? T.TROPICAL : T.TEMPERATE;
  const prov = admin1.findIndex((a) => a.country === id); cAdmin[ci] = prov >= 0 ? prov + 1 : 0; cCounty[ci] = 0;
  created++;
});
// Antarctica has no population
for (let ci = 0; ci < N; ci++) if (cCountry[ci] === ATA) cPop[ci] = 0;
let landCells = 0, totalPop = 0; for (let ci = 0; ci < N; ci++) if (cCountry[ci]) { landCells++; totalPop += cPop[ci]; }
log('land cells', landCells, 'pop', Math.round(totalPop), 'created', created);

// ---------- write cells.bin ----------
const parts = [['country', cCountry], ['admin1', cAdmin], ['county', cCounty], ['terrain', cTerrain], ['flags', cFlags], ['pop', cPop]];
let off = 0; const layout = {}; const bufs = [];
for (const [k, a] of parts) { const pad = (4 - (off % 4)) % 4; if (pad) { bufs.push(Buffer.alloc(pad)); off += pad; } layout[k] = { offset: off, type: a.constructor.name, length: a.length }; bufs.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); off += a.byteLength; }
fs.writeFileSync(path.join(OUT, 'cells.bin'), Buffer.concat(bufs));

// ---------- polygon geometry ----------
function dp(pts, tol) { // Douglas-Peucker on [lng,lat]
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]; let d;
      if (L === 0) d = Math.hypot(px - ax, py - ay);
      else { let t = ((px - ax) * dx + (py - ay) * dy) / L; t = Math.max(0, Math.min(1, t)); d = Math.hypot(px - ax - t * dx, py - ay - t * dy); }
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const merc = (lng, lat) => { lat = Math.max(-85.05, Math.min(85.05, lat)); const s = Math.sin(lat * Math.PI / 180); return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)]; };
// Topology-preserving simplification: rings are cut into arcs at junctions (where the set of
// polygons sharing an edge changes); each arc is simplified once, so neighbours keep identical borders.
function topoSimplify(features, tol) {
  const QD = 1e6, qk = (p) => Math.round(p[0] * QD) + ',' + Math.round(p[1] * QD);
  const polys = features.map((f) => polysOf(f.geometry).map((poly) => poly.map((ring) => {
    const out = []; let last = ''; for (const p of ring) { const k = qk(p); if (k !== last) out.push([Math.round(p[0] * QD) / QD, Math.round(p[1] * QD) / QD]); last = k; }
    if (out.length > 1 && qk(out[0]) === qk(out[out.length - 1])) out.pop(); return out;
  }).filter((r) => r.length >= 3)));
  const ek = (a, b) => { const ka = qk(a), kb = qk(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
  const users = new Map();
  polys.forEach((ps, u) => ps.forEach((rings) => rings.forEach((r) => { for (let k = 0; k < r.length; k++) { const key = ek(r[k], r[(k + 1) % r.length]); const v = users.get(key); users.set(key, v === undefined ? u : v === u ? u : v * 65536 + u + 1e10); } })));
  const cache = new Map();
  const simplifyArc = (arc) => {
    const a = qk(arc[0]), b = qk(arc[arc.length - 1]);
    const fwd = a < b || (a === b && qk(arc[1]) <= qk(arc[arc.length - 2]));
    const norm = fwd ? arc : arc.slice().reverse(), key = norm.map(qk).join(';');
    let res = cache.get(key); if (!res) { res = dp(norm, tol); cache.set(key, res); }
    return fwd ? res : res.slice().reverse();
  };
  let vin = 0, vout = 0;
  const out = polys.map((ps) => ps.map((rings) => rings.map((r) => {
    const n = r.length; vin += n; const sig = (i) => users.get(ek(r[(i - 1 + n) % n], r[i])), j = new Uint8Array(n);
    for (let k = 0; k < n; k++) if (sig(k) !== users.get(ek(r[k], r[(k + 1) % n]))) j[k] = 1;
    const start = j.indexOf(1); let res;
    if (start < 0) { res = dp([...r, r[0]], tol).slice(0, -1); }
    else { res = []; let arc = [r[start]]; for (let s2 = 1; s2 <= n; s2++) { const k = (start + s2) % n; arc.push(r[k]); if (j[k]) { res.push(...simplifyArc(arc).slice(0, -1)); arc = [r[k]]; } } }
    if (res.length < 3) res = r.length >= 3 ? r.slice() : res;
    vout += res.length; return [...res, res[0]]; // closed ring, like GeoJSON
  }).filter((r) => r.length >= 4)).filter((rs) => rs.length));
  log('topo', vin, '->', vout, 'vertices');
  return out;
}
function buildGeom(features, tol, file, withFill = true, uidOf = (f, u) => u, nbOf = null, topo = false) {
  const pos = [], uid = [], idx = [], lpos = [], luid = [], lnb = [];
  const TP = topo ? topoSimplify(features, tol) : null;
  const segOwner = new Map(), sk = (a, b) => { const ka = a[0].toFixed(6) + ',' + a[1].toFixed(6), kb = b[0].toFixed(6) + ',' + b[1].toFixed(6); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
  features.forEach((f, fi) => {
    const u = uidOf(f, fi);
    for (const [pi, poly] of (TP ? TP[fi].map((x, k) => [k, x]) : polysOf(f.geometry).entries())) {
      const rings = TP ? poly : poly.map((r) => dp(r, tol)).filter((r) => r.length >= 4);
      if (!rings.length) continue;
      for (const r of rings) for (let k = 0; k + 1 < r.length; k++) {
        const a = merc(r[k][0], r[k][1]), b = merc(r[k + 1][0], r[k + 1][1]);
        if (Math.abs(r[k][0]) === 180 && r[k][0] === r[k + 1][0]) continue; // skip antimeridian cuts
        const seg = luid.length / 2;
        lpos.push(a[0], a[1], b[0], b[1]); luid.push(u, u);
        if (nbOf) {
          let v = 65535;
          if (topo) { const key = sk(r[k], r[k + 1]), o = segOwner.get(key); if (o && o[0] !== u) { v = o[0]; if (lnb[o[1] * 2] === 65535) lnb[o[1] * 2] = lnb[o[1] * 2 + 1] = u; } else if (!o) segOwner.set(key, [u, seg]); }
          if (v === 65535) v = nbOf(u, r[k][0], r[k][1], r[k + 1][0], r[k + 1][1]);
          lnb.push(v, v);
        }
      }
      if (!withFill) continue;
      const flat = [], holes = [];
      rings.forEach((r, ri) => { if (ri) holes.push(flat.length / 2); for (let k = 0; k < r.length - 1; k++) flat.push(r[k][0], r[k][1]); });
      const tri = earcut(flat, holes, 2); const base = pos.length / 2;
      for (let k = 0; k < flat.length; k += 2) { const m = merc(flat[k], flat[k + 1]); pos.push(m[0], m[1]); uid.push(u); }
      for (const t of tri) idx.push(base + t);
    }
  });
  const hdr = { nVerts: pos.length / 2, nIdx: idx.length, nLine: lpos.length / 2, nb: !!nbOf };
  const b = [Buffer.from(new Float32Array(pos).buffer), Buffer.from(new Uint16Array(uid).buffer)];
  const pad1 = (4 - ((pos.length * 4 + uid.length * 2) % 4)) % 4; if (pad1) b.push(Buffer.alloc(pad1));
  b.push(Buffer.from(new Uint32Array(idx).buffer), Buffer.from(new Float32Array(lpos).buffer), Buffer.from(new Uint16Array(luid).buffer));
  if (nbOf) b.push(Buffer.from(new Uint16Array(lnb).buffer));
  fs.writeFileSync(path.join(OUT, file), Buffer.concat(b));
  log(file, JSON.stringify(hdr));
  return hdr;
}
log('geometry');
// which unit lies across each border segment (65535 = coast / none), from the 0.05° rasters
const sideNb = (arr) => (u, x1, y1, x2, y2) => {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; let nx = -(y2 - y1), ny = x2 - x1; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
  for (const e of [0.04, 0.09, 0.16]) for (const sgn of [1, -1]) {
    const lng = mx + sgn * nx * e, lat = my + sgn * ny * e;
    const c = Math.floor(((lng + 180) % 360 + 360) % 360 / FRES), rr = Math.floor((90 - lat) / FRES); if (rr < 0 || rr >= FH) continue;
    const i = rr * FW + c, v = fWater[i] ? 0 : arr[i];
    if (v && v - 1 !== u) return v - 1;
  }
  return 65535;
};
const geomProv = buildGeom(admin1G, 0.0035, 'geom_prov.bin', true, (f, u) => u, sideNb(fAdmin), true);
const geomCounty = buildGeom(countiesG, 0.0015, 'geom_county.bin', true, (f, u) => u, sideNb(fCounty), true);
// land mask + smooth country fills: 10m countries, uid = our country index (or countries.length when unmatched)
const countries10 = rd('ne/geojson/ne_10m_admin_0_countries.geojson').features;

const lakes10 = rd('ne/geojson/ne_10m_lakes.geojson').features.filter((f) => (f.properties.scalerank ?? 0) <= 8);
const geomLakes = buildGeom(lakes10, 0.004, 'geom_lakes.bin', true, () => 0);

// ---------- units.json ----------
const r3 = (v) => v == null ? null : Math.round(v * 1000) / 1000;
const units = {
  grid: { W: CW, H: CH, res: CRES, layout },
  geom: { prov: geomProv, county: geomCounty, lakes: geomLakes },
  terrains: ['Ocean', 'Lake', 'Ice', 'Polar', 'Tundra', 'Boreal forest', 'Temperate', 'Tropical', 'Desert', 'Mountains', 'Highlands', 'River delta'],
  countries: countries.map((c) => ({ ...c, label: [r3(c.label[0]), r3(c.label[1])] })),
  provinces: admin1.map((a) => ({ n: a.name, c: a.country, t: a.type, r: a.region, iso: a.iso, pop: a.pop, area: a.area, perim: a.perim, l: [r3(a.label[0]), r3(a.label[1])] })),
  counties: counties.map((c) => ({ n: c.name, s: c.state, fips: c.fips, pop: c.pop, area: c.area, perim: c.perim, min: c.minority, blk: c.black, his: c.hispanic })),
  cities: cities.filter((c) => c.pop > 0).sort((a, b) => b.pop - a.pop),
  adj: { prov: adjProv, county: adjCounty },
  sources: 'Natural Earth (public domain); US Census Bureau county estimates via plotly/datasets',
};
fs.writeFileSync(path.join(OUT, 'units.json'), JSON.stringify(units));
log('done');
