// Rewrites Atlas Forge packs (.afp.gz) with compact geometry ("v2"): positions quantised to ~0.6 m and
// delta/varint coded, outlines stored as vertex-index pairs instead of repeated coordinates, unit ids
// run-length coded. Roughly 4–6× smaller; the app decodes back to the same in-memory arrays.
// Usage: node tools/compact-packs.mjs <file-or-dir> [...]   (rewrites in place; already-compact packs are skipped)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const TYPES = { Float32Array, Uint16Array, Int16Array, Uint8Array, Uint32Array, Int32Array, Float64Array };
export const QV2 = 2 ** 23; // ~4.8 m at the equator — finer than any simplification tolerance used by the builders

class VarW { // zigzag varint writer
  constructor(n = 1024) { this.b = new Uint8Array(n); this.n = 0; }
  u(v) { // unsigned
    if (this.n + 10 > this.b.length) { const nb = new Uint8Array(this.b.length * 2); nb.set(this.b); this.b = nb; }
    while (v >= 128) { this.b[this.n++] = (v % 128) | 128; v = Math.floor(v / 128); }
    this.b[this.n++] = v;
  }
  s(v) { this.u(v < 0 ? -2 * v - 1 : 2 * v); }
  out() { return this.b.slice(0, this.n); }
}

export function readAFP(buf) {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
  if (raw.toString('latin1', 0, 4) !== 'AFP1') throw new Error('not a pack');
  const hl = raw.readUInt32LE(4), H = JSON.parse(raw.slice(8, 8 + hl).toString());
  const base = 8 + hl + ((8 - ((8 + hl) % 8)) % 8);
  const ab = raw.buffer.slice(raw.byteOffset + base, raw.byteOffset + raw.length);
  const get = (r) => r ? new TYPES[r.t](ab, r.o, r.n) : null;
  return { H, get };
}

function encodeGeom(g, get) {
  const pos = get(g.pos), uid = get(g.uid), idx = get(g.idx), lpos = get(g.lpos), luid = get(g.luid), lnb = get(g.lnb);
  const nv = pos.length / 2, ns = lpos.length / 4, noNb = uid instanceof Uint32Array ? 0xffffffff : 65535;
  const q = (v) => Math.round(v * QV2);
  // positions: delta varints
  // each vertex is either a new coordinate (0, dx, dy) or a reference to an earlier vertex with the same
  // coordinate — neighbouring areas share their border points, so about half are references (1 byte each)
  const P = new VarW(nv * 3); let px = 0, py = 0, pj = 0; const key = new Map();
  for (let v = 0; v < nv; v++) {
    const x = q(pos[v * 2]), y = q(pos[v * 2 + 1]), k = x * 134217728 + y, j = key.get(k);
    if (j !== undefined) { const d = j - pj; P.u((d < 0 ? -2 * d - 1 : 2 * d) + 1); pj = j; }
    else { P.u(0); P.s(x - px); P.s(y - py); key.set(k, v); pj = v; }
    px = x; py = y;
  }
  // outline endpoints -> vertex indices (extra points if a coordinate is not a vertex)
  const extra = []; const vix = (x, y) => { const k = x * 134217728 + y; let v = key.get(k); if (v === undefined) { v = nv + extra.length / 2; extra.push(x, y); key.set(k, v); } return v; };
  const L = new VarW(ns * 2); let pb = 0;
  for (let s = 0; s < ns; s++) { const a = vix(q(lpos[s * 4]), q(lpos[s * 4 + 1])), b = vix(q(lpos[s * 4 + 2]), q(lpos[s * 4 + 3])); L.s(a - pb); L.s(b - a); pb = b; }
  const X = new VarW(extra.length * 3 + 8); px = 0; py = 0; for (let k = 0; k < extra.length; k += 2) { X.s(extra[k] - px); X.s(extra[k + 1] - py); px = extra[k]; py = extra[k + 1]; }
  // run-length: uid per vertex, luid and lnb per segment
  const rle = (n, at) => { const W = new VarW(1024); let k = 0; while (k < n) { const v = at(k); let r = 1; while (k + r < n && at(k + r) === v) r++; W.u(v); W.u(r); k += r; } return W.out(); };
  const U = rle(nv, (v) => uid[v]), LU = rle(ns, (s) => luid[s * 2]), LN = rle(ns, (s) => lnb[s * 2] === noNb ? 0 : lnb[s * 2] + 1);
  // triangles: delta varints
  const I = new VarW(idx.length * 2); let pi = 0; for (let k = 0; k < idx.length; k++) { I.s(idx[k] - pi); pi = idx[k]; }
  return { enc: 'v2', refs: 1, q: QV2, nv, ns, ni: idx.length, nx: extra.length / 2, big: noNb === 0xffffffff, pos: P.out(), lidx: L.out(), xpos: X.out(), uid: U, luid: LU, lnb: LN, idx: I.out() };
}

export function compactBuffer(buf) {
  const { H, get } = readAFP(buf);
  if (H.geom && H.geom.enc === 'v2') return null;
  const blobs = []; let off = 0;
  const blob = (ta) => { const pad = (8 - (off % 8)) % 8; if (pad) { blobs.push(Buffer.alloc(pad)); off += pad; } const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength); blobs.push(b); const ref = { t: ta.constructor.name, o: off, n: ta.length }; off += b.byteLength; return ref; };
  const isRef = (v) => v && typeof v === 'object' && typeof v.t === 'string' && typeof v.o === 'number' && typeof v.n === 'number';
  // measurements only need 3–4 significant digits; rounding them makes them compress far better
  const sig = (x, d) => { if (!x || !isFinite(x)) return x; const e = Math.pow(10, d - 1 - Math.floor(Math.log10(Math.abs(x)))); return Math.round(x * e) / e; };
  const ROUND = { adjLen: (x) => sig(x, 3), area: (x) => sig(x, 4), perim: (x) => sig(x, 3), pop: (x) => x > 1000 ? Math.round(x) : Math.round(x * 10) / 10 };
  const copy = (v, key) => { // re-blob every typed array reference outside the geometry
    if (isRef(v)) { const a = get(v).slice(); if (ROUND[key] && a instanceof Float32Array) for (let i = 0; i < a.length; i++) a[i] = ROUND[key](a[i]); return blob(a); }
    if (Array.isArray(v)) return v.map((x) => copy(x));
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = copy(x, k); return o; }
    return v;
  };
  const G = encodeGeom(H.geom, get);
  const H2 = {};
  for (const [k, v] of Object.entries(H)) if (k !== 'geom' && k !== 'adj' && k !== 'adjLen' && k !== 'center') H2[k] = copy(v, k);
  // adjacency pairs (sorted, delta varints) with their lengths in the same order; centres as quantised deltas
  { const A = get(H.adj), AL = get(H.adjLen), n = A.length / 2, ord = Array.from({ length: n }, (_, k) => k).sort((x, y) => A[x * 2] - A[y * 2] || A[x * 2 + 1] - A[y * 2 + 1]);
    const W = new VarW(n * 3); let pa = 0; const L2 = new Float32Array(n);
    ord.forEach((k, i) => { const a = A[k * 2], b = A[k * 2 + 1]; W.s(a - pa); W.s(b - a); pa = a; L2[i] = ROUND.adjLen(AL[k]); });
    H2.adjEnc = 'v2'; H2.adjN = n; H2.adj = blob(W.out()); H2.adjLen = blob(L2);
    const C = get(H.center), CW = new VarW(C.length * 2); let cx = 0, cy = 0;
    for (let k = 0; k < C.length; k += 2) { const x = Math.round(C[k] * QV2), y = Math.round(C[k + 1] * QV2); CW.s(x - cx); CW.s(y - cy); cx = x; cy = y; }
    H2.centerEnc = 'v2'; H2.centerQ = QV2; H2.center = blob(CW.out()); }
  H2.geom = { enc: 'v2', refs: 1, q: G.q, nv: G.nv, ns: G.ns, ni: G.ni, nx: G.nx, big: G.big };
  for (const k of ['pos', 'lidx', 'xpos', 'uid', 'luid', 'lnb', 'idx']) H2.geom[k] = blob(G[k]);
  const hj = Buffer.from(JSON.stringify(H2)); const pre = Buffer.alloc(8); pre.write('AFP1', 0); pre.writeUInt32LE(hj.length, 4);
  const pad = Buffer.alloc((8 - ((8 + hj.length) % 8)) % 8);
  return zlib.gzipSync(Buffer.concat([pre, hj, pad, ...blobs]), { level: 9 });
}

// ---- CLI ----
if (process.argv[1] && process.argv[1].endsWith('compact-packs.mjs')) {
  const args = process.argv.slice(2), afz = args.includes('--afz'), files = [];
  for (const a of args.filter((x) => !x.startsWith('--'))) { const st = fs.statSync(a); if (st.isDirectory()) { for (const f of fs.readdirSync(a)) if (f.endsWith('.afp.gz') || f.endsWith('.afz')) files.push(path.join(a, f)); } else files.push(a); }
  let before = 0, after = 0, n = 0;
  for (const f of files) {
    // .afz = the same gzip data under a name Android's build tools leave alone (they un-gzip *.gz assets)
    const buf = fs.readFileSync(f); const out = compactBuffer(buf) || buf, dest = afz ? f.replace(/\.afp\.gz$/, '.afz') : f;
    before += buf.length; after += out.length; if (out !== buf) n++;
    fs.writeFileSync(dest + '.tmp', out); fs.renameSync(dest + '.tmp', dest); if (dest !== f) fs.unlinkSync(f);
  }
  console.log(`compacted ${n} of ${files.length} packs: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);
}
