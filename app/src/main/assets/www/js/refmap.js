// Offline reference map for the built-in style: roads, railways, rivers and towns (Natural Earth 10m),
// streamed onto the GPU only for the part of the world in view at the current zoom.
const ST = {
  river1: { c: [0.45, 0.68, 0.92, 0.85], w: (z) => clamp(0.8 + (z - 3) * 0.4, 0.8, 3.2), o: 0 },
  river2: { c: [0.45, 0.68, 0.92, 0.7], w: (z) => clamp(0.5 + (z - 5) * 0.3, 0.5, 2.2), o: 0 },
  rail: { c: [0.07, 0.07, 0.09, 0.7], w: (z) => clamp(0.6 + (z - 6) * 0.25, 0.6, 1.6), o: 1 },
  ferry: { c: [0.55, 0.75, 1, 0.5], w: () => 0.9, o: 1 },
  road: { c: [1, 1, 1, 0.4], w: (z) => clamp(0.45 + (z - 6) * 0.35, 0.45, 2), o: 2 },
  primary: { c: [1, 0.97, 0.9, 0.6], w: (z) => clamp(0.55 + (z - 5) * 0.4, 0.55, 2.8), o: 3 },
  motorway: { c: [1, 0.82, 0.5, 0.85], w: (z) => clamp(0.7 + (z - 4) * 0.45, 0.7, 3.6), o: 4 },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SEG_BUDGET = 900000;
export const REF = { H: null, data: null, loading: null, up: new Set(), on: true, failed: false };

async function load() {
  const res = await fetch('data/basemap.bin.gz'); if (!res.ok) throw new Error('no basemap');
  let buf = await res.arrayBuffer(); const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) buf = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const hl = new DataView(buf).getUint32(4, true), H = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hl)));
  const base = 8 + hl + ((8 - ((8 + hl) % 8)) % 8), T = { Float32Array, Uint32Array };
  for (const L of H.layers) { L.posA = new T[L.pos.t](buf, base + L.pos.o, L.pos.n); if (L.start) L.startA = new T[L.start.t](buf, base + L.start.o, L.start.n); if (L.idx) L.idxA = new T[L.idx.t](buf, base + L.idx.o, L.idx.n); L.segs = L.startA ? L.posA.length / 2 - (L.startA.length - 1) : 0; }
  REF.H = H;
}
function wantedLayers(app) {
  const R = app.R, S = R.cam.s / R.dpr, z = Math.log2(S / 256);
  const [w, n] = R.screenToLngLat(0, 0), [e, s] = R.screenToLngLat(R.vw / R.dpr, R.vh / R.dpr), wrap = R.vw / R.cam.s >= 1;
  const out = []; let segs = 0;
  for (let i = 0; i < REF.H.layers.length; i++) {
    const L = REF.H.layers[i]; if (z < L.z - 0.5) continue;
    const b = L.bbox; if (!(b[3] >= s - 1 && b[1] <= n + 1)) continue;
    if (!wrap && !(e >= w ? (b[2] >= w - 1 && b[0] <= e + 1) : (b[2] >= w - 1 || b[0] <= e + 1))) continue;
    out.push(i); segs += L.segs;
  }
  // over budget: drop the most detailed buckets first
  if (segs > SEG_BUDGET) { out.sort((a, b) => REF.H.layers[a].z - REF.H.layers[b].z); while (segs > SEG_BUDGET && out.length) { const i = out.pop(); segs -= REF.H.layers[i].segs; } }
  return out;
}
let timer = 0;
export function scheduleRef(app) { clearTimeout(timer); timer = setTimeout(() => updateRef(app), 150); }
export async function updateRef(app) {
  const R = app.R, show = REF.on && !(app.basemap && app.basemap.online) && R.cam.s / R.dpr > 256 * 6;
  if (!show) { for (const i of REF.up) drop(R, i); REF.up.clear(); return; }
  if (!REF.H) { if (REF.failed) return; if (!REF.loading) REF.loading = load().catch((e) => { REF.failed = true; console.warn(e); }); await REF.loading; if (!REF.H) return; }
  const want = new Set(wantedLayers(app));
  for (const i of [...REF.up]) if (!want.has(i)) { drop(R, i); REF.up.delete(i); }
  for (const i of want) if (!REF.up.has(i)) { upload(app, i); REF.up.add(i); }
  R.dirty();
}
function drop(R, i) { const L = REF.H.layers[i]; if (L.kind === 'poly') R.removePolyLayer('ref' + i); else R.setThickLines('ref' + i, null); }
function upload(app, i) {
  const R = app.R, L = REF.H.layers[i];
  if (L.kind === 'poly') {
    const nv = L.posA.length / 2, geom = { pos: L.posA, idx: L.idxA, uid: new Uint16Array(nv), lpos: new Float32Array(0), luid: new Uint16Array(0) };
    const P = R.addPolyLayer('ref' + i, geom); P.lineColor = [0, 0, 0, 0]; P.alpha = 1; P.visible = true;
    R.setPolyColors('ref' + i, new Uint8Array([255, 246, 225, 30]));
    if (!R.polyOrder.includes('ref' + i)) R.polyOrder.push('ref' + i);
    return;
  }
  const P = L.posA, S0 = L.startA, lpos = new Float32Array(L.segs * 4); let o = 0;
  for (let k = 0; k + 1 < S0.length; k++) for (let v = S0[k]; v + 1 < S0[k + 1]; v++) { lpos[o++] = P[v * 2]; lpos[o++] = P[v * 2 + 1]; lpos[o++] = P[v * 2 + 2]; lpos[o++] = P[v * 2 + 3]; }
  const st = ST[L.cls] || ST.road;
  R.setThickLines('ref' + i, lpos, st.c, (s) => st.w(Math.log2(s / 256)), -10 + st.o);
}
export function setRefOn(app, on) { REF.on = on; updateRef(app); }
