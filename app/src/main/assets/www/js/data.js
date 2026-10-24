// Loads the bundled world data files.
async function bin(url) { const r = await fetch(url); if (!r.ok) throw new Error('Missing ' + url); return r.arrayBuffer(); }

function parseGeom(buf, hdr) {
  let o = 0;
  const pos = new Float32Array(buf, o, hdr.nVerts * 2); o += hdr.nVerts * 8;
  const uid = new Uint16Array(buf, o, hdr.nVerts); o += hdr.nVerts * 2; o += (4 - (o % 4)) % 4;
  const idx = new Uint32Array(buf, o, hdr.nIdx); o += hdr.nIdx * 4;
  const lpos = new Float32Array(buf, o, hdr.nLine * 2); o += hdr.nLine * 8;
  const luid = new Uint16Array(buf, o, hdr.nLine); o += hdr.nLine * 2;
  const lnb = hdr.nb ? new Uint16Array(buf, o, hdr.nLine) : null;
  return { pos, uid, idx, lpos, luid, lnb };
}

export async function loadData(progress = () => {}) {
  progress('Loading atlas…', 0.05);
  const units = await (await fetch('data/units.json')).json();
  progress('Loading world grid…', 0.25);
  const [cellsBuf, provBuf, countyBuf, countryBuf, lakesBuf] = await Promise.all([bin('data/cells.bin'), bin('data/geom_prov.bin'), bin('data/geom_county.bin'), bin('data/geom_country.bin'), bin('data/geom_lakes.bin')]);
  progress('Unpacking…', 0.6);
  const L = units.grid.layout, T = { Uint16Array, Uint8Array, Float32Array };
  const cells = {};
  for (const k of Object.keys(L)) cells[k] = new T[L[k].type](cellsBuf, L[k].offset, L[k].length);
  const geom = { prov: parseGeom(provBuf, units.geom.prov), county: parseGeom(countyBuf, units.geom.county), country: parseGeom(countryBuf, units.geom.country), lakes: parseGeom(lakesBuf, units.geom.lakes) };
  // adjacency lists
  const adj = {};
  for (const [k, pairs] of Object.entries(units.adj)) {
    const n = k === 'prov' ? units.provinces.length : units.counties.length;
    const lists = Array.from({ length: n }, () => []);
    for (let i = 0; i < pairs.length; i += 3) { lists[pairs[i]].push(pairs[i + 1], pairs[i + 2]); lists[pairs[i + 1]].push(pairs[i], pairs[i + 2]); }
    adj[k] = lists;
  }
  return { units, cells, geom, adj };
}
