// Adds real precinct-level election results to finished map packs (US voting districts, block groups, tracts,
// and the MGGG precinct packs). Each area takes the votes of the precinct it sits in; where several areas share
// one precinct, its votes are split by voting-age population; a precinct holding no area's centre gives its
// votes to the nearest area. Packs keep everything they had; new results are appended. Safe to run again.
// Usage: node tools/add-precinct-votes.mjs <precinctDir from fetch-precincts.mjs> <pack-file-or-dir> [...]
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const [PREC, ...targets] = process.argv.slice(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const TYPES = { Float32Array, Uint16Array, Int16Array, Uint8Array, Uint32Array, Int32Array, Float64Array };
const AB = { AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55', WY: '56' };
const MARK = 2; // bump to redo every pack

// ---- precinct sets per state (cached while packs of the same state are processed) ----
const setCache = new Map();
function setsFor(fips) {
  if (setCache.has(fips)) return setCache.get(fips);
  const dir = path.join(PREC, fips), sets = [];
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json.gz')).sort()) {
    try {
      const S = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8'));
      // grid of precinct boxes (0.02°) for point-in-precinct lookups
      const G = new Map(), C = 0.02;
      S.prec.forEach((p, i) => { for (let x = Math.floor(p.b[0] / C); x <= Math.floor(p.b[2] / C); x++) for (let y = Math.floor(p.b[1] / C); y <= Math.floor(p.b[3] / C); y++) { const k = x * 100000 + y; let a = G.get(k); if (!a) G.set(k, a = []); a.push(i); } });
      S.grid = G; S.C = C; sets.push(S);
    } catch (e) { log('bad precinct file', fips, f, e.message); }
  }
  setCache.clear(); setCache.set(fips, sets); return sets;
}
function inPrec(p, x, y) {
  if (x < p.b[0] || x > p.b[2] || y < p.b[1] || y > p.b[3]) return false;
  let c = false;
  for (const r of p.g) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; }
  return c;
}
function findPrec(S, x, y) { const a = S.grid.get(Math.floor(x / S.C) * 100000 + Math.floor(y / S.C)); if (a) for (const i of a) if (inPrec(S.prec[i], x, y)) return i; return -1; }

// ---- pack reading / writing ----
function readPack(buf) {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
  if (raw.toString('latin1', 0, 4) !== 'AFP1') throw new Error('not a pack');
  const hl = raw.readUInt32LE(4), H = JSON.parse(raw.slice(8, 8 + hl).toString());
  const base = 8 + hl + ((8 - ((8 + hl) % 8)) % 8), region = raw.subarray(base);
  const ab = raw.buffer.slice(raw.byteOffset + base, raw.byteOffset + raw.length);
  return { H, region, get: (r) => r ? new TYPES[r.t](ab, r.o, r.n) : null };
}
function writePack(H, region, extra) { // extra: list of typed arrays already given refs relative to region end
  const hj = Buffer.from(JSON.stringify(H)), pre = Buffer.alloc(8); pre.write('AFP1', 0); pre.writeUInt32LE(hj.length, 4);
  const pad = Buffer.alloc((8 - ((8 + hj.length) % 8)) % 8);
  return zlib.gzipSync(Buffer.concat([pre, hj, pad, region, ...extra]), { level: 9 });
}
function centersOf(H, get) {
  const n = H.count; if (H.centerEnc === 'v2') {
    const u8 = get(H.center), out = new Float64Array(n * 2); let p = 0, x = 0, y = 0;
    const rd = () => { let v = 0, m = 1, b; do { b = u8[p++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v % 2 ? -(v + 1) / 2 : v / 2; };
    for (let k = 0; k < n; k++) { x += rd(); y += rd(); out[k * 2] = x / H.centerQ; out[k * 2 + 1] = y / H.centerQ; }
    return out;
  }
  return Float64Array.from(get(H.center));
}

function processPack(file) {
  const buf = fs.readFileSync(file); let P; try { P = readPack(buf); } catch { return 'skip'; }
  const { H, region, get } = P;
  if (H.precVotes === MARK) return 'done';
  const fips = H.stateFips || AB[String(H.state || '').toUpperCase()]; if (!fips || (H.iso && H.iso !== 'USA')) return 'skip';
  const sets = setsFor(fips); if (!sets.length) return 'none';
  const n = H.count, C = centersOf(H, get), [ox, oy] = H.origin || [0, 0];
  const lng = new Float64Array(n), lat = new Float64Array(n);
  for (let u = 0; u < n; u++) { const wx = ox + C[u * 2], wy = oy + C[u * 2 + 1]; lng[u] = wx * 360 - 180; lat[u] = Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) * 180 / Math.PI; }
  const W = get(H.vap) || get(H.pop) || new Float32Array(n).fill(1);
  // unit centres on a grid for "nearest area" lookups
  const UG = new Map(), UC = 0.05; for (let u = 0; u < n; u++) { const k = Math.floor(lng[u] / UC) * 100000 + Math.floor(lat[u] / UC); let a = UG.get(k); if (!a) UG.set(k, a = []); a.push(u); }
  const nearest = (x, y) => { const cx = Math.floor(x / UC), cy = Math.floor(y / UC); let best = -1, bd = Infinity; for (let r = 0; r <= 3 && best < 0; r++) for (let i = cx - r; i <= cx + r; i++) for (let j = cy - r; j <= cy + r; j++) { const a = UG.get(i * 100000 + j); if (a) for (const u of a) { const d = (lng[u] - x) ** 2 + (lat[u] - y) ** 2; if (d < bd) { bd = d; best = u; } } } return best; };
  const have = new Set((H.elections || []).map((e) => e.label.toLowerCase()));
  const added = [], extra = []; let off = region.length;
  const blob = (ta) => { const pad = (8 - (off % 8)) % 8; if (pad) { extra.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); extra.push(b); const ref = { t: ta.constructor.name, o: off, n: ta.length }; off += b.byteLength; return ref; };
  for (const S of sets) {
    const pOf = new Int32Array(n).fill(-1), members = new Map(); let wIn = 0, wAll = 0;
    for (let u = 0; u < n; u++) { wAll += W[u]; const i = findPrec(S, lng[u], lat[u]); if (i < 0) continue; pOf[u] = i; wIn += W[u]; let m = members.get(i); if (!m) members.set(i, m = []); m.push(u); }
    if (process.env.PREC_DEBUG) log('  ', H.key || H.state, S.src, S.year, 'coverage', Math.round(wIn / (wAll || 1) * 100) + '%', S.prec.length, 'precincts', S.offices.map((o) => o.code).join(' '));
    if (wAll > 0 && wIn / wAll < 0.6) { log('  ', H.key || H.state, S.src, S.year, 'covers only', Math.round(wIn / wAll * 100) + '% — skipped'); continue; }
    const share = new Float64Array(n); // each area's share of its precinct
    for (const [, m] of members) { const t = m.reduce((s, u) => s + W[u], 0); for (const u of m) share[u] = t > 0 ? W[u] / t : 1 / m.length; }
    const orphans = []; S.prec.forEach((p, i) => { if (!members.has(i)) { const u = nearest((p.b[0] + p.b[2]) / 2, (p.b[1] + p.b[3]) / 2); if (u >= 0) orphans.push([i, u]); } });
    S.offices.forEach((o, k) => {
      const label = `${o.label}${o.special ? ' (special)' : ''} ${S.year}`; if (have.has(label.toLowerCase())) return;
      const d = new Float32Array(n), r = new Float32Array(n), x = new Float32Array(n);
      for (let u = 0; u < n; u++) { const i = pOf[u]; if (i < 0) continue; const v = S.prec[i].v; d[u] += v[k * 3] * share[u]; r[u] += v[k * 3 + 1] * share[u]; x[u] += v[k * 3 + 2] * share[u]; }
      for (const [i, u] of orphans) { const v = S.prec[i].v; d[u] += v[k * 3]; r[u] += v[k * 3 + 1]; x[u] += v[k * 3 + 2]; }
      if (process.env.PREC_DEBUG) { let pd = 0, pr = 0; for (const q of S.prec) { pd += q.v[k * 3]; pr += q.v[k * 3 + 1]; } log('     ', label, 'precinct totals D', Math.round(pd), 'R', Math.round(pr), have.has(label.toLowerCase()) ? '(already there)' : ''); }
      let tot = 0; for (let u = 0; u < n; u++) { d[u] = Math.round(d[u]); r[u] = Math.round(r[u]); x[u] = Math.round(x[u]); tot += d[u] + r[u]; } if (!(tot > 0)) return; // whole votes compress far better
      have.add(label.toLowerCase());
      added.push({ key: `${o.special ? 'S' : ''}${o.code}${String(S.year).slice(2)}`, label, year: S.year, src: S.src, d: blob(d), r: blob(r), o: blob(x) });
    });
  }
  if (!added.length) { H.precVotes = MARK; fs.writeFileSync(file, writePack(H, region, extra)); return 'none'; }
  // precinct results replace the rough county-based estimates for the same year
  const years = new Set(added.filter((e) => /^President/.test(e.label)).map((e) => e.year));
  const kept = (H.elections || []).filter((e) => !(/county result, estimated/.test(e.label) && years.has(+(/\d{4}/.exec(e.label) || [0])[0])));
  const order = (e) => -(+(/\d{4}/.exec(e.label) || [0])[0]) * 100 + (/^President/.test(e.label) ? 0 : /^US Senate/.test(e.label) ? 1 : /^Governor/.test(e.label) ? 2 : 5);
  H.elections = [...kept, ...added.map(({ year, ...e }) => e)].sort((a, b) => order(a) - order(b));
  H.precVotes = MARK;
  if (!/precinct results/.test(H.source || '')) H.source = (H.source || '') + '; votes: precinct results (VEST, Harvard Dataverse; New York Times 2024)';
  fs.writeFileSync(file + '.tmp', writePack(H, region, extra)); fs.renameSync(file + '.tmp', file);
  return added.length;
}

const files = [];
for (const t of targets) { if (!fs.existsSync(t)) continue; const st = fs.statSync(t); if (st.isDirectory()) { for (const f of fs.readdirSync(t)) if (/\.(afz|afp\.gz)$/.test(f)) files.push(path.join(t, f)); } else files.push(t); }
// one state at a time, so its precinct files load once
const fipsOf = (f) => { const m = /USA_\d_(\d\d)\./.exec(f); if (m) return m[1]; const s = /([A-Z]{2})\.(afz|afp\.gz)$/.exec(path.basename(f)); return s ? AB[s[1]] || 'zz' : 'zz'; };
files.sort((a, b) => fipsOf(a).localeCompare(fipsOf(b)) || a.localeCompare(b));
let withVotes = 0, races = 0; const t0 = Date.now();
for (const f of files) {
  try { const r = processPack(f); if (typeof r === 'number') { withVotes++; races += r; log(path.basename(f), '+', r, 'races'); } }
  catch (e) { log('FAIL', path.basename(f), e.message); }
}
log(`precinct votes added to ${withVotes} of ${files.length} packs (${races} races) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
// the precinct pack list shows each state's elections: bring it up to date
for (const t of targets) {
  const mf = path.join(t, '..', 'data', 'packs.json'); if (!fs.existsSync(mf) || !/packs\/?$/.test(t)) continue;
  const list = JSON.parse(fs.readFileSync(mf, 'utf8'));
  for (const m of list) { const f = path.join(t, m.state + '.afz'); if (!fs.existsSync(f)) continue; try { const { H } = readPack(fs.readFileSync(f)); m.elections = (H.elections || []).map((e) => e.label); m.bytes = fs.statSync(f).size; } catch {} }
  fs.writeFileSync(mf, JSON.stringify(list)); log('updated', mf);
}
