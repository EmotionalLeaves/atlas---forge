// Decoder for compact pack geometry ("v2", written by tools/compact-packs.mjs). Returns the same arrays the
// app has always used: positions relative to the pack origin, outline segments, unit ids, triangles.
function reader(u8) {
  let i = 0;
  const u = () => { let v = 0, m = 1, b; do { b = u8[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
  const s = () => { const v = u(); return v % 2 ? -(v + 1) / 2 : v / 2; };
  return { u, s };
}
export function decodeV2(g, get) {
  const q = g.q, nv = g.nv, ns = g.ns, big = g.big, UT = big ? Uint32Array : Uint16Array, noNb = big ? 0xffffffff : 65535;
  const X = new Float64Array((nv + g.nx) * 2);
  let r = reader(get(g.pos)), x = 0, y = 0;
  if (g.refs) { // 0 = new point (dx, dy); n > 0 = same point as an earlier vertex (zigzag index delta + 1)
    let pj = 0;
    for (let v = 0; v < nv; v++) {
      const t = r.u();
      if (t === 0) { x += r.s(); y += r.s(); pj = v; }
      else { const z = t - 1, j = pj + (z % 2 ? -(z + 1) / 2 : z / 2); x = X[j * 2]; y = X[j * 2 + 1]; pj = j; }
      X[v * 2] = x; X[v * 2 + 1] = y;
    }
  } else for (let v = 0; v < nv; v++) { x += r.s(); y += r.s(); X[v * 2] = x; X[v * 2 + 1] = y; }
  r = reader(get(g.xpos)); x = 0; y = 0;
  for (let k = 0; k < g.nx; k++) { x += r.s(); y += r.s(); X[(nv + k) * 2] = x; X[(nv + k) * 2 + 1] = y; }
  const pos = new Float32Array(nv * 2); for (let k = 0; k < nv * 2; k++) pos[k] = X[k] / q;
  const lpos = new Float32Array(ns * 4); r = reader(get(g.lidx)); let pb = 0;
  for (let s = 0; s < ns; s++) { const a = pb + r.s(), b = a + r.s(); pb = b; lpos[s * 4] = X[a * 2] / q; lpos[s * 4 + 1] = X[a * 2 + 1] / q; lpos[s * 4 + 2] = X[b * 2] / q; lpos[s * 4 + 3] = X[b * 2 + 1] / q; }
  const unrle = (u8, n, per, map) => { const out = new UT(n * per); const rr = reader(u8); let k = 0; while (k < n) { const v = map(rr.u()), run = rr.u(); for (let j = 0; j < run * per; j++) out[k * per + j] = v; k += run; } return out; };
  const uid = unrle(get(g.uid), nv, 1, (v) => v);
  const luid = unrle(get(g.luid), ns, 2, (v) => v);
  const lnb = unrle(get(g.lnb), ns, 2, (v) => v === 0 ? noNb : v - 1);
  const idx = new Uint32Array(g.ni); r = reader(get(g.idx)); let pi = 0;
  for (let k = 0; k < g.ni; k++) { pi += r.s(); idx[k] = pi; }
  return { pos, uid, idx, lpos, luid, lnb };
}
// adjacency pairs and unit centres, when stored compactly
export function decodeAdj(u8, n) { const out = new Uint32Array(n * 2), r = reader(u8); let pa = 0; for (let k = 0; k < n; k++) { const a = pa + r.s(); out[k * 2] = a; out[k * 2 + 1] = a + r.s(); pa = a; } return out; }
export function decodeCenters(u8, count, q) { const out = new Float64Array(count * 2), r = reader(u8); let x = 0, y = 0; for (let k = 0; k < count; k++) { x += r.s(); y += r.s(); out[k * 2] = x / q; out[k * 2 + 1] = y / q; } return out; }
