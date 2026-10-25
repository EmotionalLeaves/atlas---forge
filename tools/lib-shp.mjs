// Minimal shapefile (.shp/.dbf) readers and the projection inverses used by the US data builders.
import fs from 'fs';

// ---------------- DBF ----------------
export function readDBF(p) {
  const b = fs.readFileSync(p), n = b.readUInt32LE(4), hl = b.readUInt16LE(8), rl = b.readUInt16LE(10);
  const fields = []; let o = 32, off = 1;
  while (b[o] !== 0x0d) { const name = b.toString('latin1', o, o + 11).replace(/\0.*$/, ''); const type = String.fromCharCode(b[o + 11]); const len = b[o + 16]; fields.push({ name, type, len, off }); off += len; o += 32; }
  const rows = [];
  for (let r = 0; r < n; r++) {
    const ro = hl + r * rl, row = {};
    for (const f of fields) { const s = b.toString('latin1', ro + f.off, ro + f.off + f.len).trim(); row[f.name] = (f.type === 'N' || f.type === 'F') ? (s === '' ? null : Number(s)) : s; }
    rows.push(row);
  }
  return { fields, rows };
}
// ---------------- SHP ----------------
export function readSHP(p) {
  const b = fs.readFileSync(p); const out = []; let o = 100;
  while (o + 8 <= b.length) {
    const len = b.readInt32BE(o + 4) * 2; const ro = o + 8; const type = b.readInt32LE(ro);
    if (type === 5 || type === 15 || type === 25) {
      const nParts = b.readInt32LE(ro + 36), nPts = b.readInt32LE(ro + 40);
      const parts = []; for (let k = 0; k < nParts; k++) parts.push(b.readInt32LE(ro + 44 + k * 4));
      const pb = ro + 44 + nParts * 4; const rings = [];
      for (let k = 0; k < nParts; k++) {
        const s = parts[k], e = k + 1 < nParts ? parts[k + 1] : nPts; const ring = [];
        for (let i = s; i < e; i++) ring.push([b.readDoubleLE(pb + i * 16), b.readDoubleLE(pb + i * 16 + 8)]);
        rings.push(ring);
      }
      out.push(rings);
    } else out.push([]);
    o = ro + len;
  }
  return out;
}
// ---------------- projections ----------------
export function makeUnproject(wkt) {
  const num = (k) => { const m = wkt.match(new RegExp('PARAMETER\\["' + k + '",\\s*([-\\d.eE]+)', 'i')); return m ? +m[1] : null; };
  const sph = wkt.match(/SPHEROID\["[^"]*",\s*([\d.]+),\s*([\d.]+)/i); const a = sph ? +sph[1] : 6378137, invf = sph ? +sph[2] : 298.257222101;
  const f = invf ? 1 / invf : 0, e2 = 2 * f - f * f, e = Math.sqrt(e2), ep2 = e2 / (1 - e2);
  const unitM = wkt.match(/UNIT\["([^"]+)",\s*([\d.eE-]+)\]\s*(?:,\s*AUTHORITY\[[^\]]*\])?\]\s*$/i) || wkt.match(/UNIT\["([^"]+)",\s*([\d.eE-]+)\][^\]]*$/i);
  const isProj = /^PROJCS/i.test(wkt.trim());
  if (!isProj) return (x, y) => [x, y];
  // the linear unit is the last UNIT[] of the PROJCS
  const units = [...wkt.matchAll(/UNIT\["([^"]+)",\s*([\d.eE-]+)/gi)]; const uf = units.length ? +units[units.length - 1][2] : 1;
  const proj = (wkt.match(/PROJECTION\["([^"]+)"/i) || [])[1] || '';
  const d2r = Math.PI / 180, FE = (num('False_Easting') || 0) * uf, FN = (num('False_Northing') || 0) * uf;
  const lon0 = (num('Central_Meridian') ?? num('Longitude_Of_Center') ?? 0) * d2r, lat0 = (num('Latitude_Of_Origin') ?? num('Latitude_Of_Center') ?? 0) * d2r;
  if (/Transverse_Mercator/i.test(proj)) {
    const k0 = num('Scale_Factor') ?? 1;
    const Mf = (p) => a * ((1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p) + (15 * e2 * e2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
    const M0 = Mf(lat0), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    return (X, Y) => {
      const x = X * uf - FE, y = Y * uf - FN, M = M0 + y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
      const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
      const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1), C1 = ep2 * c * c, T1 = t * t, N1 = a / Math.sqrt(1 - e2 * s * s), R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), D = x / (N1 * k0);
      const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
      const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c;
      return [lon / d2r, lat / d2r];
    };
  }
  if (/Lambert_Conformal_Conic/i.test(proj)) {
    const p1 = (num('Standard_Parallel_1') ?? lat0 / d2r) * d2r, p2 = (num('Standard_Parallel_2') ?? p1 / d2r) * d2r, k0 = num('Scale_Factor') ?? 1;
    const m = (p) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2), t = (p) => Math.tan(Math.PI / 4 - p / 2) / Math.pow((1 - e * Math.sin(p)) / (1 + e * Math.sin(p)), e / 2);
    const n = Math.abs(p1 - p2) < 1e-10 ? Math.sin(p1) : (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
    const F = m(p1) / (n * Math.pow(t(p1), n)), rho0 = a * F * k0 * Math.pow(t(lat0), n);
    return (X, Y) => {
      const x = X * uf - FE, y = rho0 - (Y * uf - FN), rho = Math.sign(n) * Math.hypot(x, y);
      const theta = Math.atan2(Math.sign(n) * x, Math.sign(n) * y), tt = Math.pow(rho / (a * F * k0), 1 / n);
      let phi = Math.PI / 2 - 2 * Math.atan(tt);
      for (let k = 0; k < 8; k++) phi = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - e * Math.sin(phi)) / (1 + e * Math.sin(phi)), e / 2));
      return [(theta / n + lon0) / d2r, phi / d2r];
    };
  }
  if (/Albers/i.test(proj)) {
    const p1 = num('Standard_Parallel_1') * d2r, p2 = num('Standard_Parallel_2') * d2r;
    const m = (p) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
    const q = (p) => { const s = Math.sin(p); return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s))); };
    const n = (m(p1) ** 2 - m(p2) ** 2) / (q(p2) - q(p1)), C = m(p1) ** 2 + n * q(p1), rho0 = a * Math.sqrt(C - n * q(lat0)) / n;
    return (X, Y) => {
      const x = X * uf - FE, y = rho0 - (Y * uf - FN), rho = Math.hypot(x, y), theta = Math.atan2(x, y);
      const qq = (C - (rho * n / a) ** 2) / n; let phi = Math.asin(qq / 2);
      for (let k = 0; k < 10; k++) { const s = Math.sin(phi); phi += (1 - e2 * s * s) ** 2 / (2 * Math.cos(phi)) * (qq / (1 - e2) - s / (1 - e2 * s * s) + (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s))); }
      return [(lon0 + theta / n) / d2r, phi / d2r];
    };
  }
  if (/Mercator/i.test(proj) && /Auxiliary_Sphere|Pseudo/i.test(wkt)) return (X, Y) => [X / 6378137 / d2r, (2 * Math.atan(Math.exp(Y / 6378137)) - Math.PI / 2) / d2r];
  throw new Error('Unsupported projection: ' + proj);
}

