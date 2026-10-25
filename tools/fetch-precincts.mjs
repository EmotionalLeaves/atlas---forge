// Downloads precinct-level election results with precinct boundaries and boils them down to one small file
// per state and election year: simplified precinct outlines plus Dem / Rep / other votes for every race.
//   * VEST (Voting and Election Science Team, Harvard Dataverse): every statewide race, 2016 onward
//   * The New York Times precinct map: President 2024
// Usage: node tools/fetch-precincts.mjs <outDir> [tmpDir]
// Output: <outDir>/<FIPS>/<src>_<year>.json.gz  {src, year, offices:[{code,label,special}], prec:[{b:[x0,y0,x1,y1], g:[rings], v:[d,r,o,...]}]}
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { readSHP, makeUnproject } from './lib-shp.mjs';

// DBF reader that copes with long text fields (their length uses the 'decimals' byte as a high byte), which
// otherwise shifts every following column and turns vote counts into zeros
function readDBF(p) {
  const b = fs.readFileSync(p), n = b.readUInt32LE(4), hl = b.readUInt16LE(8), rl = b.readUInt16LE(10);
  const parse = (wide) => { const fields = []; let o = 32, off = 1; while (b[o] !== 0x0d && o < hl) { const name = b.toString('latin1', o, o + 11).replace(/\0.*$/, ''); const type = String.fromCharCode(b[o + 11]); const len = b[o + 16] + (wide && type === 'C' ? b[o + 17] * 256 : 0); fields.push({ name, type, len, off }); off += len; o += 32; } return { fields, size: off }; };
  let F = parse(false); if (F.size !== rl) { const G = parse(true); if (G.size === rl) F = G; }
  const rows = [];
  for (let r = 0; r < n; r++) { const ro = hl + r * rl, row = {}; for (const f of F.fields) { const s = b.toString('latin1', ro + f.off, ro + f.off + f.len).trim(); row[f.name] = f.type === 'C' && !/^-?[\d.]+$/.test(s) ? s : (s === '' ? null : Number(s)); } rows.push(row); }
  return { fields: F.fields, rows };
}

const OUT = process.argv[2], TMP = process.argv[3] || path.join(OUT, '..', 'prectmp');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const AB = { AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56' };
const OFFICE = { HOD: 'State House (all seats)', SEN: 'State Senate (all seats)', STH: 'State House (all seats)', STS: 'State Senate (all seats)', PRE: 'President', USS: 'US Senate', USH: 'US House', HAL: 'US House (at-large)', COU: 'City Council', UBR: 'University Regents', SBE: 'Board of Education', GOV: 'Governor', LTG: 'Lieutenant Governor', ATG: 'Attorney General', SOS: 'Secretary of State', TRE: 'Treasurer', AUD: 'Auditor', CON: 'Controller', COM: 'Comptroller', AGR: 'Agriculture Commissioner', INS: 'Insurance Commissioner', LAB: 'Labor Commissioner', SPI: 'Superintendent of Schools', LND: 'Land Commissioner', RRC: 'Railroad Commissioner', PSC: 'Public Service Commission', SSC: 'State Supreme Court', SCC: 'Corporation Commission', CFO: 'Chief Financial Officer', MNI: 'Mine Inspector', SBE: 'Board of Education', REG: 'University Regents', SAC: 'Supreme Court', SPR: 'Supreme Court', TAX: 'Tax Commissioner', CPA: 'Comptroller', PUC: 'Public Utilities Commission', HOU: 'US House' };
const UA = { 'User-Agent': 'AtlasForge-build (github.com/EmotionalLeaves/atlas---forge)' };

async function getJSON(url) { for (let k = 0; k < 4; k++) { try { const r = await fetch(url, { headers: UA }); if (r.ok) return await r.json(); log('HTTP', r.status, url); } catch (e) { log('ERR', e.message, url); } await new Promise((s) => setTimeout(s, 3000 * (k + 1))); } return null; }
async function download(url, file) { for (let k = 0; k < 4; k++) { try { const r = await fetch(url, { headers: UA, redirect: 'follow' }); if (r.ok) { await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(file)); return true; } log('HTTP', r.status, url); if (r.status === 404 || r.status === 403) return false; } catch (e) { log('ERR', e.message, url); } await new Promise((s) => setTimeout(s, 4000 * (k + 1))); } return false; }

// ---- geometry: simplify (~30 m) and round, enough to tell which precinct a point is in ----
function dp(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) { const [px, py] = pts[i]; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(px - ax - t * dx, py - ay - t * dy); if (d > md) { md = d; mi = i; } }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;
function packRings(rings) {
  const g = [], b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    if (!ring || ring.length < 4) continue;
    const s = dp(ring, 0.0003); if (s.length < 4) continue;
    const flat = []; for (const [x, y] of s) { const X = r5(x), Y = r5(y); flat.push(X, Y); if (X < b[0]) b[0] = X; if (Y < b[1]) b[1] = Y; if (X > b[2]) b[2] = X; if (Y > b[3]) b[3] = Y; }
    g.push(flat);
  }
  return g.length ? { g, b } : null;
}
function save(fips, name, obj) { const d = path.join(OUT, fips); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name + '.json.gz'), zlib.gzipSync(JSON.stringify(obj), { level: 6 })); }

// projections: the shared ones, plus Hotine oblique Mercator (Michigan GeoRef), EPSG method 9812
function unprojector(wkt) { try { return makeUnproject(wkt); } catch (e) { if (/Hotine/i.test(wkt)) return hotine(wkt); throw e; } }
export function hotine(wkt, forward = false) {
  const num = (k) => { const m = wkt.match(new RegExp('PARAMETER\\["' + k + '",\\s*([-\\d.eE]+)', 'i')); return m ? +m[1] : null; };
  const unit = /Foot_US|US survey foot/i.test(wkt) ? 1200 / 3937 : /Foot/i.test(wkt) ? 0.3048 : 1, d2r = Math.PI / 180;
  const sph = wkt.match(/SPHEROID\["[^"]*",\s*([\d.]+),\s*([\d.]+)/i), a = sph ? +sph[1] : 6378137, invf = sph ? +sph[2] : 298.257222101, f = 1 / invf, e2 = 2 * f - f * f, e = Math.sqrt(e2);
  const FE = (num('False_Easting') || 0) * unit, FN = (num('False_Northing') || 0) * unit, k0 = num('Scale_Factor') || 1;
  const ac = (num('Azimuth') || 0) * d2r, lc = (num('Longitude_Of_Center') ?? num('Longitude_Of_Origin') ?? 0) * d2r, pc = (num('Latitude_Of_Center') ?? num('Latitude_Of_Origin') ?? 0) * d2r;
  const B = Math.sqrt(1 + e2 * Math.cos(pc) ** 4 / (1 - e2)), A = a * B * k0 * Math.sqrt(1 - e2) / (1 - e2 * Math.sin(pc) ** 2);
  const tf = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
  const t0 = tf(pc); let D = B * Math.sqrt(1 - e2) / (Math.cos(pc) * Math.sqrt(1 - e2 * Math.sin(pc) ** 2)); if (D < 1) D = 1;
  const F = D + Math.sign(pc || 1) * Math.sqrt(D * D - 1), H = F * Math.pow(t0, B), G = (F - 1 / F) / 2, g0 = Math.asin(Math.sin(ac) / D), l0 = lc - Math.asin(G * Math.tan(g0)) / B, gc = ac;
  if (forward) return (lon, lat) => { const p = lat * d2r, l = lon * d2r, Q = H / Math.pow(tf(p), B), S = (Q - 1 / Q) / 2, T = (Q + 1 / Q) / 2, V = Math.sin(B * (l - l0)), U = (-V * Math.cos(g0) + S * Math.sin(g0)) / T;
    const v = A * Math.log((1 - U) / (1 + U)) / (2 * B), u = A * Math.atan2(S * Math.cos(g0) + V * Math.sin(g0), Math.cos(B * (l - l0))) / B; return [(v * Math.cos(gc) + u * Math.sin(gc) + FE) / unit, (u * Math.cos(gc) - v * Math.sin(gc) + FN) / unit]; };
  return (X, Y) => {
    const E = X * unit - FE, N = Y * unit - FN, v = E * Math.cos(gc) - N * Math.sin(gc), u = N * Math.cos(gc) + E * Math.sin(gc);
    const Qp = Math.exp(-B * v / A), Sp = (Qp - 1 / Qp) / 2, Tp = (Qp + 1 / Qp) / 2, Vp = Math.sin(B * u / A), Up = (Vp * Math.cos(g0) + Sp * Math.sin(g0)) / Tp;
    const tp = Math.pow(H / Math.sqrt((1 + Up) / (1 - Up)), 1 / B), chi = Math.PI / 2 - 2 * Math.atan(tp);
    const p = chi + Math.sin(2 * chi) * (e2 / 2 + 5 * e2 ** 2 / 24 + e2 ** 3 / 12 + 13 * e2 ** 4 / 360) + Math.sin(4 * chi) * (7 * e2 ** 2 / 48 + 29 * e2 ** 3 / 240 + 811 * e2 ** 4 / 11520) + Math.sin(6 * chi) * (7 * e2 ** 3 / 120 + 81 * e2 ** 4 / 1120) + Math.sin(8 * chi) * (4279 * e2 ** 4 / 161280);
    const l = l0 - Math.atan2(Sp * Math.cos(g0) - Vp * Math.sin(g0), Math.cos(B * u / A)) / B;
    return [l / d2r, p / d2r];
  };
}

// ---- VEST: every general (and special) statewide race in a state's precinct shapefile ----
function vestFile(shp, year) {
  const base = shp.slice(0, -4), { fields, rows } = readDBF(base + '.dbf'), shapes = readSHP(shp);
  const prj = fs.existsSync(base + '.prj') ? fs.readFileSync(base + '.prj', 'utf8') : '';
  const un = prj ? unprojector(prj) : (x, y) => [x, y];
  const yy = String(year).slice(2), cols = new Map();
  for (const f of fields) {
    const m = /^([GS])(\d\d)([A-Z]{3})([A-Z])([A-Za-z0-9]{1,3})$/.exec(f.name); if (!m || m[2] !== yy) continue; // numbers are sometimes stored as text
    const key = m[1] + m[3]; if (!cols.has(key)) cols.set(key, { code: m[3], special: m[1] === 'S', d: [], r: [], o: [] });
    const c = cols.get(key); (m[4] === 'D' ? c.d : m[4] === 'R' ? c.r : c.o).push(f.name);
  }
  const offices = [...cols.values()].filter((c) => c.d.length && c.r.length);
  if (!offices.length) return null;
  const prec = [];
  for (let k = 0; k < rows.length; k++) {
    const rings = shapes[k]; if (!rings || !rings.length) continue;
    const pr = packRings(rings.map((ring) => ring.map(([x, y]) => un(x, y)))); if (!pr) continue;
    const v = []; const sum = (names) => names.reduce((s, n) => s + (+rows[k][n] || 0), 0);
    for (const c of offices) v.push(sum(c.d), sum(c.r), sum(c.o));
    prec.push({ b: pr.b, g: pr.g, v });
  }
  return { offices: offices.map((c) => ({ code: c.code, label: OFFICE[c.code] || `Statewide race (${c.code})`, special: c.special })), prec };
}
async function vest() {
  const listing = await getJSON('https://dataverse.harvard.edu/api/dataverses/electionscience/contents');
  if (!listing || !listing.data) { log('VEST: could not list the dataverse'); return; }
  for (const item of listing.data) {
    if (item.type !== 'dataset') continue;
    const pid = `${item.protocol}:${item.authority}/${item.identifier}`;
    const ds = await getJSON(`https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=${pid}`); if (!ds || !ds.data || !ds.data.latestVersion) { log('VEST: no details for', pid); continue; }
    const V = ds.data.latestVersion, fields = (V.metadataBlocks && V.metadataBlocks.citation && V.metadataBlocks.citation.fields) || [], tf = fields.find((f) => f.typeName === 'title'), title = tf ? String(tf.value) : '';
    if (!V.files) continue;
    const m = /^(\d{4}) Precinct-Level Election Results$/i.exec(title.trim()); if (!m || +m[1] < 2016) { log('VEST skip:', title); continue; }
    const year = +m[1]; log('VEST', title, V.files.length, 'files');
    for (const f of V.files) {
      const name = f.dataFile.filename || f.label, sm = /^([a-z]{2})_.*?(\d{4})?.*\.zip$/i.exec(name); if (!sm) continue;
      const fips = AB[sm[1].toUpperCase()]; if (!fips) continue;
      const outName = `vest_${year}`; if (fs.existsSync(path.join(OUT, fips, outName + '.json.gz'))) continue;
      const zip = path.join(TMP, name), dir = path.join(TMP, name + '_x');
      if (!await download(`https://dataverse.harvard.edu/api/access/datafile/${f.dataFile.id}`, zip)) { log('FAIL download', name); continue; }
      try {
        fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
        execFileSync('unzip', ['-oq', zip, '-d', dir]);
        const shps = []; const walk = (d) => { for (const x of fs.readdirSync(d)) { const p = path.join(d, x); if (fs.statSync(p).isDirectory()) walk(p); else if (x.toLowerCase().endsWith('.shp')) shps.push(p); } }; walk(dir);
        shps.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size); // the main precinct file is the largest
        let res = null; for (const s of shps) { try { res = vestFile(s, year); } catch (e) { log('read error', path.basename(s), e.message); } if (res) break; }
        if (res) { save(fips, outName, { src: 'VEST', year, ...res }); log(name, '->', fips, res.prec.length, 'precincts,', res.offices.map((o) => o.code + (o.special ? '*' : '')).join(' ')); }
        else log('no usable races in', name);
      } catch (e) { log('FAIL', name, e.message); }
      fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(zip, { force: true });
    }
  }
}

// ---- NYT 2024: president by precinct ----
async function nyt2024() {
  for (const [ab, fips] of Object.entries(AB)) {
    if (fs.existsSync(path.join(OUT, fips, 'nyt_2024.json.gz'))) continue;
    const gz = path.join(TMP, ab + '24.geojson.gz');
    if (!await download(`https://int.nyt.com/newsgraphics/elections/map-data/2024/national/${ab}-precincts-with-results.geojson.gz`, gz)) { log('NYT 2024: none for', ab); continue; }
    try {
      let raw = fs.readFileSync(gz); if (raw[0] === 0x1f && raw[1] === 0x8b) raw = zlib.gunzipSync(raw);
      const J = JSON.parse(raw.toString('utf8')), prec = [];
      for (const ft of J.features || []) {
        const p = ft.properties || {}, g = ft.geometry; if (!g) continue;
        const d = +p.votes_dem || 0, r = +p.votes_rep || 0, t = +p.votes_total || d + r; if (!(t > 0)) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        const pr = packRings(polys.flat()); if (!pr) continue;
        prec.push({ b: pr.b, g: pr.g, v: [d, r, Math.max(0, t - d - r)] });
      }
      if (prec.length) { save(fips, 'nyt_2024', { src: 'NYT', year: 2024, offices: [{ code: 'PRE', label: 'President', special: false }], prec }); log('NYT 2024', ab, prec.length, 'precincts'); }
    } catch (e) { log('FAIL NYT', ab, e.message); }
    fs.rmSync(gz, { force: true });
  }
}

try { await vest(); } catch (e) { log('VEST stopped:', e.message); } // keep what was fetched
try { await nyt2024(); } catch (e) { log('NYT stopped:', e.message); }
let n = 0; for (const d of fs.readdirSync(OUT)) n += fs.readdirSync(path.join(OUT, d)).length;
log('precinct result files:', n);
