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
import { readDBF, readSHP, makeUnproject } from './lib-shp.mjs';

const OUT = process.argv[2], TMP = process.argv[3] || path.join(OUT, '..', 'prectmp');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const AB = { AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56' };
const OFFICE = { PRE: 'President', USS: 'US Senate', USH: 'US House', GOV: 'Governor', LTG: 'Lieutenant Governor', ATG: 'Attorney General', SOS: 'Secretary of State', TRE: 'Treasurer', AUD: 'Auditor', CON: 'Controller', COM: 'Comptroller', AGR: 'Agriculture Commissioner', INS: 'Insurance Commissioner', LAB: 'Labor Commissioner', SPI: 'Superintendent of Schools', LND: 'Land Commissioner', RRC: 'Railroad Commissioner', PSC: 'Public Service Commission', SSC: 'State Supreme Court', SCC: 'Corporation Commission', CFO: 'Chief Financial Officer', MNI: 'Mine Inspector', SBE: 'Board of Education', REG: 'University Regents', SAC: 'Supreme Court', SPR: 'Supreme Court', TAX: 'Tax Commissioner', CPA: 'Comptroller', PUC: 'Public Utilities Commission', HOU: 'US House' };
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

// ---- VEST: every general (and special) statewide race in a state's precinct shapefile ----
function vestFile(shp, year) {
  const base = shp.slice(0, -4), { fields, rows } = readDBF(base + '.dbf'), shapes = readSHP(shp);
  const prj = fs.existsSync(base + '.prj') ? fs.readFileSync(base + '.prj', 'utf8') : '';
  const un = prj ? makeUnproject(prj) : (x, y) => [x, y];
  const yy = String(year).slice(2), cols = new Map();
  for (const f of fields) {
    const m = /^([GS])(\d\d)([A-Z]{3})([A-Z])([A-Z0-9]{1,3})$/.exec(f.name); if (!m || m[2] !== yy || !(f.type === 'N' || f.type === 'F')) continue;
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
    const ds = await getJSON(`https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=${pid}`); if (!ds || !ds.data) continue;
    const V = ds.data.latestVersion, tf = V.metadataBlocks.citation.fields.find((f) => f.typeName === 'title'), title = tf ? tf.value : '';
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

await vest();
await nyt2024();
let n = 0; for (const d of fs.readdirSync(OUT)) n += fs.readdirSync(path.join(OUT, d)).length;
log('precinct result files:', n);
