// Turns one state's 2020 redistricting (PL 94-171) summary files into the same JSON the Census API returns,
// for tracts and block groups. Used when api.census.gov refuses requests without a key.
// Usage: node tools/pl-from-files.mjs <dir with xxgeo2020.pl, xx000012020.pl, xx000022020.pl> <FIPS> <outDir>
import fs from 'fs';
import path from 'path';
import readline from 'readline';

const [DIR, FIPS, OUT] = process.argv.slice(2);
const files = fs.readdirSync(DIR);
const find = (re) => { const f = files.find((x) => re.test(x.toLowerCase())); if (!f) throw new Error('missing ' + re + ' in ' + DIR); return path.join(DIR, f); };
const geoF = find(/geo2020\.pl$/), seg1F = find(/000012020\.pl$/), seg2F = find(/000022020\.pl$/);
const lines = (f) => readline.createInterface({ input: fs.createReadStream(f, { encoding: 'latin1' }), crlfDelay: Infinity });

// geo header: pipe-delimited; SUMLEV is field 2, GEOCOMP field 4, LOGRECNO field 7, GEOID field 8 ("1400000US42001030101")
const want = new Map(); // logrecno -> { lev, geo }
for await (const L of lines(geoF)) {
  const f = L.split('|'); const lev = f[2];
  if ((lev !== '140' && lev !== '150' && lev !== '700') || f[4] !== '00') continue;
  const id = f[8] || ''; const geo = id.includes('US') ? id.slice(id.indexOf('US') + 2) : (f[9] || '');
  want.set(f[7], { lev, geo, v: new Array(12).fill(0) });
}
// API variable -> [segment, table offset, cell]. Segment 1: P1 (71 cells) then P2 (73); segment 2: P3 (71) then P4 (73).
const VARS = [['P1_001N', 1, 0, 1], ['P2_002N', 1, 71, 2], ['P2_005N', 1, 71, 5], ['P2_006N', 1, 71, 6], ['P2_007N', 1, 71, 7], ['P2_008N', 1, 71, 8],
  ['P3_001N', 2, 0, 1], ['P4_002N', 2, 71, 2], ['P4_005N', 2, 71, 5], ['P4_006N', 2, 71, 6], ['P4_007N', 2, 71, 7], ['P4_008N', 2, 71, 8]];
for (const [seg, file] of [[1, seg1F], [2, seg2F]]) {
  for await (const L of lines(file)) {
    const f = L.split('|'); const r = want.get(f[4]); if (!r) continue;
    VARS.forEach(([, s, off, cell], k) => { if (s === seg) r.v[k] = +f[5 + off + cell - 1] || 0; });
  }
}
const H = VARS.map((v) => v[0]);
const tract = [[...H, 'state', 'county', 'tract']], bg = [[...H, 'state', 'county', 'tract', 'block group']], vtd = [[...H, 'state', 'county', 'voting district']];
for (const r of want.values()) {
  const g = r.geo; if (g.length < 11) continue;
  const vals = r.v.map(String);
  if (r.lev === '700') { vtd.push([...vals, g.slice(0, 2), g.slice(2, 5), g.slice(5)]); continue; }
  if (r.lev === '140') tract.push([...vals, g.slice(0, 2), g.slice(2, 5), g.slice(5, 11)]);
  else bg.push([...vals, g.slice(0, 2), g.slice(2, 5), g.slice(5, 11), g.slice(11, 12)]);
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `tract_${FIPS}.json`), JSON.stringify(tract));
fs.writeFileSync(path.join(OUT, `bg_${FIPS}.json`), JSON.stringify(bg));
if (vtd.length > 1) fs.writeFileSync(path.join(OUT, `vtd_${FIPS}.json`), JSON.stringify(vtd));
console.log(FIPS, 'tracts', tract.length - 1, 'block groups', bg.length - 1, 'voting districts', vtd.length - 1, 'pop', tract.slice(1).reduce((s, r) => s + +r[0], 0));
