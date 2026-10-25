// Atlas Forge map renderer: Web Mercator, WebGL1, no dependencies.
// World coordinates: x in [0,1) west->east (wraps), y in [0,1] north->south.
export const mercX = (lng) => (lng + 180) / 360;
export const mercY = (lat) => { lat = Math.max(-85.0511, Math.min(85.0511, lat)); const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
export const unMercX = (x) => x * 360 - 180;
export const unMercY = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;

const RASTER_VS = `
attribute vec2 a_pos; attribute vec2 a_tex;
uniform vec2 u_center; uniform float u_scale; uniform vec2 u_view; uniform float u_off;
varying highp vec2 v_tex;
void main(){ vec2 p=(a_pos+vec2(u_off,0.0)-u_center)*u_scale; gl_Position=vec4(p.x*2.0/u_view.x,-p.y*2.0/u_view.y,0.0,1.0); v_tex=a_tex; }`;
const RASTER_FS = `
precision highp float;
uniform sampler2D u_color; uniform sampler2D u_group; uniform vec2 u_size; uniform float u_scale;
uniform float u_grid; uniform float u_bpx; uniform float u_dpx; uniform vec3 u_bcol; uniform float u_dim; uniform float u_op;
varying highp vec2 v_tex;
vec4 G(vec2 c){ c.x=mod(c.x,u_size.x); c.y=clamp(c.y,0.0,u_size.y-1.0); return texture2D(u_group,(c+0.5)/u_size); }
float diff2(vec2 a, vec2 b){ return step(0.002, abs(a.x-b.x)+abs(a.y-b.y)); }
void main(){
  vec2 cell=floor(v_tex); vec2 f=v_tex-cell;
  vec4 col=texture2D(u_color,(vec2(mod(cell.x,u_size.x),cell.y)+0.5)/u_size);
  if(col.a<0.02) discard;
  float lat=radians(90.0-v_tex.y*180.0/u_size.y);
  vec2 fw=vec2(u_size.x/u_scale, u_size.x*cos(lat)/u_scale); // texels per pixel
  vec4 g=G(cell), gl=G(cell-vec2(1.0,0.0)), gr=G(cell+vec2(1.0,0.0)), gu=G(cell-vec2(0.0,1.0)), gd=G(cell+vec2(0.0,1.0));
  float bx=min(u_bpx*fw.x,0.34), by=min(u_bpx*fw.y,0.34), dx=min(u_dpx*fw.x,0.2), dy=min(u_dpx*fw.y,0.2);
  float nb=max(max(diff2(g.rg,gl.rg)*step(f.x,bx), diff2(g.rg,gr.rg)*step(1.0-f.x,bx)), max(diff2(g.rg,gu.rg)*step(f.y,by), diff2(g.rg,gd.rg)*step(1.0-f.y,by)));
  float db=max(max(diff2(g.ba,gl.ba)*step(f.x,dx), diff2(g.ba,gr.ba)*step(1.0-f.x,dx)), max(diff2(g.ba,gu.ba)*step(f.y,dy), diff2(g.ba,gd.ba)*step(1.0-f.y,dy)));
  vec3 c=col.rgb;
  if(u_grid>0.0){ float e=min(min(f.x,1.0-f.x)/fw.x, min(f.y,1.0-f.y)/fw.y); c=mix(c,c*0.72,u_grid*(1.0-smoothstep(0.4,1.4,e))); }
  c=mix(c,vec3(1.0),db*0.92);
  c=mix(c,u_bcol,nb*0.9);
  c=mix(c,vec3(0.11,0.13,0.17),u_dim);
  gl_FragColor=vec4(c*u_op,u_op);
}`;
const POLY_VS = `
attribute vec2 a_pos; attribute vec4 a_col;
uniform vec2 u_center; uniform float u_scale; uniform vec2 u_view; uniform float u_off; uniform vec2 u_shift;
varying vec4 v_col;
void main(){ vec2 p=(a_pos+vec2(u_off,0.0)-u_center)*u_scale+u_shift; gl_Position=vec4(p.x*2.0/u_view.x,-p.y*2.0/u_view.y,0.0,1.0); v_col=a_col; }`;
const POLY_FS = `precision mediump float; varying vec4 v_col; uniform float u_alpha; void main(){ gl_FragColor=vec4(v_col.rgb*v_col.a*u_alpha, v_col.a*u_alpha); }`;
const LINE_VS = `
attribute vec2 a_pos;
uniform vec2 u_center; uniform float u_scale; uniform vec2 u_view; uniform float u_off; uniform vec2 u_shift;
void main(){ vec2 p=(a_pos+vec2(u_off,0.0)-u_center)*u_scale+u_shift; gl_Position=vec4(p.x*2.0/u_view.x,-p.y*2.0/u_view.y,0.0,1.0); }`;
const LINE_FS = `precision mediump float; uniform vec4 u_color; void main(){ gl_FragColor=vec4(u_color.rgb*u_color.a,u_color.a); }`;
const LINEC_VS = `
attribute vec2 a_pos; attribute vec4 a_col;
uniform vec2 u_center; uniform float u_scale; uniform vec2 u_view; uniform float u_off; uniform vec2 u_shift;
varying vec4 v_col;
void main(){ vec2 p=(a_pos+vec2(u_off,0.0)-u_center)*u_scale+u_shift; gl_Position=vec4(p.x*2.0/u_view.x,-p.y*2.0/u_view.y,0.0,1.0); v_col=a_col; }`;
const LINEC_FS = `precision mediump float; varying vec4 v_col; uniform float u_alpha; void main(){ float a=v_col.a*u_alpha; gl_FragColor=vec4(v_col.rgb*a,a); }`;
// thick anti-aliased lines: each segment is a quad expanded in screen space
const THICK_VS = `
attribute vec2 a_a; attribute vec2 a_b; attribute vec2 a_c;
uniform vec2 u_center; uniform float u_scale; uniform vec2 u_view; uniform float u_off; uniform float u_w;
varying float v_side;
void main(){
  vec2 pa=(a_a+vec2(u_off,0.0)-u_center)*u_scale, pb=(a_b+vec2(u_off,0.0)-u_center)*u_scale;
  vec2 d=pb-pa; float L=length(d); vec2 dir = L>1e-6 ? d/L : vec2(1.0,0.0); vec2 n=vec2(-dir.y,dir.x);
  float hw=u_w*0.5+1.0;
  vec2 p = mix(pa,pb,a_c.x) + n*a_c.y*hw + dir*(a_c.x*2.0-1.0)*u_w*0.5;
  gl_Position=vec4(p.x*2.0/u_view.x,-p.y*2.0/u_view.y,0.0,1.0); v_side=a_c.y*hw;
}`;
const THICK_FS = `precision mediump float; uniform vec4 u_color; uniform float u_wf; varying float v_side;
void main(){ float a=u_color.a*clamp(u_wf*0.5+0.5-abs(v_side),0.0,1.0); gl_FragColor=vec4(u_color.rgb*a,a); }`;
const PT_VS = `
attribute vec2 a_pos; attribute float a_size; attribute vec4 a_col;
uniform vec2 u_center; uniform float u_scale; uniform vec2 u_view; uniform float u_off; uniform float u_ps;
varying vec4 v_col;
void main(){ vec2 p=(a_pos+vec2(u_off,0.0)-u_center)*u_scale; gl_Position=vec4(p.x*2.0/u_view.x,-p.y*2.0/u_view.y,0.0,1.0); gl_PointSize=a_size*u_ps; v_col=a_col; }`;
const PT_FS = `precision mediump float; varying vec4 v_col; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard; float ring=step(0.32,r); gl_FragColor=vec4(mix(v_col.rgb,vec3(0.08),ring),1.0)*v_col.a; }`;

function compile(gl, vs, fs) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}, a = {};
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
  for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) { const n = gl.getActiveAttrib(p, i).name; a[n] = gl.getAttribLocation(p, n); }
  return { p, u, a };
}

export class MapRenderer {
  constructor(canvas, labelCanvas, gridW, gridH) {
    this.canvas = canvas; this.lc = labelCanvas; this.ctx = labelCanvas.getContext('2d');
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: true });
    if (!gl) throw new Error('WebGL is not available on this device');
    this.gl = gl;
    if (!gl.getExtension('OES_element_index_uint')) throw new Error('Device GPU lacks 32-bit index support');
    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    const fs = hp && hp.precision > 0 ? RASTER_FS : RASTER_FS.replace('precision highp float;', 'precision mediump float;');
    this.prog = { raster: compile(gl, RASTER_VS, fs), poly: compile(gl, POLY_VS, POLY_FS), line: compile(gl, LINE_VS, LINE_FS), lineC: compile(gl, LINEC_VS, LINEC_FS), thick: compile(gl, THICK_VS, THICK_FS), pt: compile(gl, PT_VS, PT_FS) };
    this.thick = {};
    this.gw = gridW; this.gh = gridH;
    this.cam = { x: 0.53, y: 0.4, s: 1 }; // s = device px per world unit
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.opts = { grid: true, borderColor: [0.06, 0.07, 0.09], borderPx: 1.6, distPx: 1.6, dim: 0, opacity: 1 };
    this.polys = {}; this.lines = {}; this.points = null; this.highlight = null;
    this.onLabels = null; this._dirty = true;
    this._buildRasterMesh();
    this.texColor = this._makeTex(); this.texGroup = this._makeTex();
    this.resize();
    const loop = () => { if (this._dirty) { this._dirty = false; this.draw(); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  _makeTex() {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.gw, this.gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  _buildRasterMesh() {
    const gl = this.gl, H = this.gh, rowDeg = 180 / H; const v = [];
    const r0 = Math.ceil((90 - 85.0511) / rowDeg), r1 = Math.floor((90 + 85.0511) / rowDeg);
    for (let r = r0; r < r1; r++) {
      const y0 = mercY(90 - r * rowDeg), y1 = mercY(90 - (r + 1) * rowDeg);
      const W = this.gw;
      v.push(0, y0, 0, r, 1, y0, W, r, 0, y1, 0, r + 1, 1, y0, W, r, 1, y1, W, r + 1, 0, y1, 0, r + 1);
    }
    this.rasterBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.rasterBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW); this.rasterCount = v.length / 4;
  }
  setCellColors(rgba) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.texColor); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gw, this.gh, gl.RGBA, gl.UNSIGNED_BYTE, rgba); this.dirty(); }
  // upload only rows y0..y1 of both textures (fast path while painting)
  setCellRows(colors, groups, y0, y1) {
    const gl = this.gl, w = this.gw, a = y0 * w * 4, b = (y1 + 1) * w * 4;
    gl.bindTexture(gl.TEXTURE_2D, this.texColor); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, w, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, colors.subarray(a, b));
    gl.bindTexture(gl.TEXTURE_2D, this.texGroup); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, w, y1 - y0 + 1, gl.RGBA, gl.UNSIGNED_BYTE, groups.subarray(a, b));
    this.dirty();
  }
  setCellGroups(rgba) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.texGroup); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gw, this.gh, gl.RGBA, gl.UNSIGNED_BYTE, rgba); this.dirty(); }

  // geom: {pos Float32Array, uid Uint16Array, idx Uint32Array, lpos Float32Array, luid Uint16Array}
  // share: reuse another layer's geometry buffers (same shapes, different colours). lineColors: per-unit outline colours.
  addPolyLayer(name, geom, { share = null, lineColors = false } = {}) {
    const gl = this.gl; const L = { geom, visible: false, alpha: 0.9, lineColor: [0.05, 0.05, 0.08, 0.55], lineAlpha: 1 };
    const S = share ? this.polys[share] : null;
    if (S) { L.pos = S.pos; L.idx = S.idx; L.lbuf = S.lbuf; L.n = S.n; L.ln = S.ln; }
    else {
      L.pos = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, L.pos); gl.bufferData(gl.ARRAY_BUFFER, geom.pos, gl.STATIC_DRAW);
      L.idx = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.idx, gl.STATIC_DRAW); L.n = geom.idx.length;
      L.lbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, L.lbuf); gl.bufferData(gl.ARRAY_BUFFER, geom.lpos, gl.STATIC_DRAW); L.ln = geom.lpos.length / 2;
    }
    L.col = gl.createBuffer(); L.colData = new Uint8Array(geom.uid.length * 4); gl.bindBuffer(gl.ARRAY_BUFFER, L.col); gl.bufferData(gl.ARRAY_BUFFER, L.colData, gl.DYNAMIC_DRAW);
    if (lineColors) { L.lcol = gl.createBuffer(); L.lcolData = new Uint8Array(geom.luid.length * 4); gl.bindBuffer(gl.ARRAY_BUFFER, L.lcol); gl.bufferData(gl.ARRAY_BUFFER, L.lcolData, gl.DYNAMIC_DRAW); }
    this.polys[name] = L; return L;
  }
  // Shade everything outside some units of a polygon layer (ids: Set of unit indices); null clears.
  setFocus(name, ids) {
    const gl = this.gl;
    if (this.focus && this.focus.ib) gl.deleteBuffer(this.focus.ib);
    this.focus = null;
    const L = name && this.polys[name];
    if (L && ids && ids.size) {
      const g = L.geom, I = g.idx, U = g.uid, keep = [];
      for (let t = 0; t < I.length; t += 3) if (ids.has(U[I[t]])) keep.push(I[t], I[t + 1], I[t + 2]);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(keep), gl.STATIC_DRAW);
      this.focus = { pos: L.pos, ib, n: keep.length };
    }
    this.dirty();
  }
  removePolyLayer(name) {
    const L = this.polys[name]; if (!L) return; const gl = this.gl;
    for (const b of [L.pos, L.idx, L.lbuf, L.col, L.lcol]) if (b) gl.deleteBuffer(b);
    delete this.polys[name]; this.dirty();
  }
  setPolyColors(name, unitRGBA, lineRGBA) { // Uint8Array(4*units) each
    const L = this.polys[name], uid = L.geom.uid, c = L.colData, gl = this.gl;
    for (let i = 0; i < uid.length; i++) { const u = uid[i] * 4, o = i * 4; c[o] = unitRGBA[u]; c[o + 1] = unitRGBA[u + 1]; c[o + 2] = unitRGBA[u + 2]; c[o + 3] = unitRGBA[u + 3]; }
    gl.bindBuffer(gl.ARRAY_BUFFER, L.col); gl.bufferSubData(gl.ARRAY_BUFFER, 0, c);
    if (lineRGBA && L.lcol) {
      const lu = L.geom.luid, lc = L.lcolData;
      for (let i = 0; i < lu.length; i++) { const u = lu[i] * 4, o = i * 4; lc[o] = lineRGBA[u]; lc[o + 1] = lineRGBA[u + 1]; lc[o + 2] = lineRGBA[u + 2]; lc[o + 3] = lineRGBA[u + 3]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, L.lcol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, lc);
    }
    this.dirty();
  }
  // Clip the cell grid to real land: fill = land polygons layer name, lakes = {pos, idx} cut back out.
  setLandMask(landLayer, lakes) {
    const gl = this.gl, mk = (d, t) => { const b = gl.createBuffer(); gl.bindBuffer(t, b); gl.bufferData(t, d, gl.STATIC_DRAW); return b; };
    this.mask = { land: landLayer, lakePos: mk(lakes.pos, gl.ARRAY_BUFFER), lakeIdx: mk(lakes.idx, gl.ELEMENT_ARRAY_BUFFER), lakeN: lakes.idx.length };
  }
  addLineLayer(name, lpos, color, minS = 0) {
    const gl = this.gl; const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, lpos, gl.STATIC_DRAW);
    this.lines[name] = { buf: b, n: lpos.length / 2, color, visible: true, minS };
  }
  // Thick line layer from segment pairs [x0,y0,x1,y1,...]. width in css px; z orders layers (higher on top).
  setThickLines(name, lpos, color = [1, 1, 1, 1], width = 2, z = 0) {
    const gl = this.gl;
    if (!lpos || !lpos.length) { const T = this.thick[name]; if (T) { gl.deleteBuffer(T.vb); gl.deleteBuffer(T.ib); delete this.thick[name]; } this.dirty(); return; }
    const ns = lpos.length / 4, v = new Float32Array(ns * 24), ix = new Uint32Array(ns * 6);
    for (let s2 = 0; s2 < ns; s2++) {
      const ax = lpos[s2 * 4], ay = lpos[s2 * 4 + 1], bx = lpos[s2 * 4 + 2], by = lpos[s2 * 4 + 3], o = s2 * 24;
      for (let k = 0; k < 4; k++) { const q = o + k * 6; v[q] = ax; v[q + 1] = ay; v[q + 2] = bx; v[q + 3] = by; v[q + 4] = k >> 1; v[q + 5] = k & 1 ? 1 : -1; }
      const b = s2 * 4, io = s2 * 6; ix[io] = b; ix[io + 1] = b + 1; ix[io + 2] = b + 2; ix[io + 3] = b + 1; ix[io + 4] = b + 3; ix[io + 5] = b + 2;
    }
    const T = this.thick[name] || (this.thick[name] = { vb: gl.createBuffer(), ib: gl.createBuffer() });
    gl.bindBuffer(gl.ARRAY_BUFFER, T.vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, T.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.DYNAMIC_DRAW);
    Object.assign(T, { n: ns * 6, color, width, z, visible: true }); this.dirty();
  }
  setOverlayLines(name, lpos, color = [1, 1, 1, 0.95]) { this.setThickLines(name, lpos, color, 2.6, 5); }
  setHighlight(lpos, color = [1, 0.85, 0.2, 1]) { this.setThickLines('_highlight', lpos && lpos.length ? lpos : null, color, 3.2, 10); }
  setPoints(pos, size, col) { // Float32 xy, Float32 size, Uint8 rgba
    const gl = this.gl; const mk = (d) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW); return b; };
    if (this.points) { for (const k of ['pb', 'sb', 'cb']) gl.deleteBuffer(this.points[k]); }
    this.points = { pb: mk(pos), sb: mk(size), cb: mk(col), n: pos.length / 2, visible: this.points ? this.points.visible : true, minS: 0 };
    this.dirty();
  }

  dirty() { this._dirty = true; }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.canvas, this.lc]) { c.width = Math.max(1, Math.round(r.width * this.dpr)); c.height = Math.max(1, Math.round(r.height * this.dpr)); }
    this.vw = this.canvas.width; this.vh = this.canvas.height; this.clampCam(); this.dirty();
  }
  get minScale() { return Math.min(this.vh, this.vw) * 0.95; }
  get maxScale() { return 256 * Math.pow(2, 13) * this.dpr; }
  clampCam() {
    const c = this.cam; c.s = Math.max(this.minScale, Math.min(this.maxScale, c.s));
    const half = this.vh / 2 / c.s, pb = ((this.pad && this.pad.b) || 0) * this.dpr / c.s;
    c.y = half >= 0.5 ? Math.max(1 - half, Math.min(half + pb, c.y)) : Math.max(half, Math.min(1 - half + pb, c.y));
    c.x = ((c.x % 1) + 1) % 1;
  }
  // css px -> world
  screenToWorld(px, py) { const c = this.cam; return [c.x + (px * this.dpr - this.vw / 2) / c.s, c.y + (py * this.dpr - this.vh / 2) / c.s]; }
  worldToScreen(x, y) { const c = this.cam; let dx = x - c.x; dx -= Math.round(dx); return [(dx * c.s + this.vw / 2) / this.dpr, ((y - c.y) * c.s + this.vh / 2) / this.dpr]; }
  screenToLngLat(px, py) { const [x, y] = this.screenToWorld(px, py); return [unMercX(((x % 1) + 1) % 1), unMercY(y)]; }
  zoomAt(px, py, factor) {
    const [wx, wy] = this.screenToWorld(px, py); const c = this.cam;
    c.s = Math.max(this.minScale, Math.min(this.maxScale, c.s * factor));
    c.x = wx - (px * this.dpr - this.vw / 2) / c.s; c.y = wy - (py * this.dpr - this.vh / 2) / c.s; this.clampCam(); this.dirty();
  }
  panBy(dxCss, dyCss) { const c = this.cam; c.x -= dxCss * this.dpr / c.s; c.y -= dyCss * this.dpr / c.s; this.clampCam(); this.dirty(); }
  // pad: css px of the map hidden behind UI (left panel on tablets, bottom sheet on phones)
  get visibleCenter() { const p = this.pad || { l: 0, b: 0 }; return [(this.vw / this.dpr + p.l) / 2, (this.vh / this.dpr - p.b) / 2]; }
  _centerOn(x, y) { const [cx, cy] = this.visibleCenter; this.cam.x = x - (cx * this.dpr - this.vw / 2) / this.cam.s; this.cam.y = y - (cy * this.dpr - this.vh / 2) / this.cam.s; }
  flyTo(lng, lat, zoomPx) { if (zoomPx) this.cam.s = zoomPx * this.dpr; this.clampCam(); this._centerOn(mercX(lng), mercY(lat)); this.clampCam(); this.dirty(); }
  fitBounds(w, s, e, n) {
    const x0 = mercX(w), x1 = mercX(e < w ? e + 360 : e), y0 = mercY(n), y1 = mercY(s);
    const p = this.pad || { l: 0, b: 0 }, ww = this.vw - p.l * this.dpr, hh = this.vh - p.b * this.dpr;
    this.cam.s = Math.min(this.maxScale / 8, Math.min(ww / Math.max(1e-6, x1 - x0), hh / Math.max(1e-6, y1 - y0)) * 0.85); this.clampCam();
    this._centerOn((x0 + x1) / 2, (y0 + y1) / 2); this.clampCam(); this.dirty();
  }
  get cssScale() { return this.cam.s / this.dpr; } // css px per world unit; 256 = zoom 0

  _common(P, off, shift = [0, 0]) {
    const gl = this.gl; gl.uniform2f(P.u.u_center, this.cam.x, this.cam.y); gl.uniform1f(P.u.u_scale, this.cam.s);
    gl.uniform2f(P.u.u_view, this.vw, this.vh); gl.uniform1f(P.u.u_off, off); if (P.u.u_shift) gl.uniform2f(P.u.u_shift, shift[0], shift[1]);
  }
  _attr(P, name, buf, size, type, norm = false) {
    const gl = this.gl, loc = P.a[name]; if (loc === undefined || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type || gl.FLOAT, norm, 0, 0);
  }
  _disableAttrs() { const gl = this.gl; for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i); }
  draw() {
    const gl = this.gl, c = this.cam;
    gl.viewport(0, 0, this.vw, this.vh);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.onFrame) this.onFrame(this);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const left = c.x - this.vw / 2 / c.s, right = c.x + this.vw / 2 / c.s;
    const offs = []; for (let k = Math.floor(left); k <= Math.floor(right) && offs.length < 4; k++) offs.push(k);
    let P;
    // land mask into the stencil buffer (smooth real coastlines for the cell grid)
    const M = this.mask && this.opts.clip !== false ? this.mask : null;
    if (M) {
      const land = this.polys[M.land];
      gl.enable(gl.STENCIL_TEST); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.colorMask(false, false, false, false);
      P = this.prog.poly; gl.useProgram(P.p); this._disableAttrs(); gl.vertexAttrib4f(P.a.a_col, 0, 0, 0, 1); gl.uniform1f(P.u.u_alpha, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff); this._attr(P, 'a_pos', land.pos, 2); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, land.idx);
      for (const o of offs) { this._common(P, o); gl.drawElements(gl.TRIANGLES, land.n, gl.UNSIGNED_INT, 0); }
      gl.stencilFunc(gl.ALWAYS, 0, 0xff); this._attr(P, 'a_pos', M.lakePos, 2); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, M.lakeIdx);
      for (const o of offs) { this._common(P, o); gl.drawElements(gl.TRIANGLES, M.lakeN, gl.UNSIGNED_INT, 0); }
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.EQUAL, 1, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      this._disableAttrs();
    }
    // polygon layers drawn underneath the cell raster (e.g. province colours behind war-front cells)
    for (const L of Object.values(this.polys)) {
      if (!L.under || !L.visible) continue;
      if (M) { if (L.clip) gl.enable(gl.STENCIL_TEST); else gl.disable(gl.STENCIL_TEST); }
      P = this.prog.poly; gl.useProgram(P.p);
      this._attr(P, 'a_pos', L.pos, 2); this._attr(P, 'a_col', L.col, 4, gl.UNSIGNED_BYTE, true);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.idx); gl.uniform1f(P.u.u_alpha, L.alpha * this.opts.opacity);
      for (const o of offs) { this._common(P, o); gl.drawElements(gl.TRIANGLES, L.n, gl.UNSIGNED_INT, 0); }
      this._disableAttrs();
    }
    if (M) gl.enable(gl.STENCIL_TEST);
    // raster
    P = this.prog.raster; gl.useProgram(P.p); this._disableAttrs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.rasterBuf);
    gl.enableVertexAttribArray(P.a.a_pos); gl.vertexAttribPointer(P.a.a_pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(P.a.a_tex); gl.vertexAttribPointer(P.a.a_tex, 2, gl.FLOAT, false, 16, 8);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texColor); gl.uniform1i(P.u.u_color, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texGroup); gl.uniform1i(P.u.u_group, 1);
    gl.uniform2f(P.u.u_size, this.gw, this.gh);
    const cellPx = c.s / this.gw;
    gl.uniform1f(P.u.u_grid, this.opts.grid ? Math.max(0, Math.min(1, (cellPx - 10) / 14)) : 0);
    gl.uniform1f(P.u.u_bpx, this.opts.borderPx * this.dpr); gl.uniform1f(P.u.u_dpx, this.opts.distPx * this.dpr);
    gl.uniform3fv(P.u.u_bcol, this.opts.borderColor); gl.uniform1f(P.u.u_dim, this.opts.dim); gl.uniform1f(P.u.u_op, this.opts.opacity);
    for (const o of offs) { this._common(P, o); gl.drawArrays(gl.TRIANGLES, 0, this.rasterCount); }
    this._disableAttrs();
    if (M) gl.disable(gl.STENCIL_TEST);
    // polygons
    for (const L of (this.polyOrder || Object.keys(this.polys)).map((k) => this.polys[k])) {
      if (M) gl.disable(gl.STENCIL_TEST);
      if (!L || !L.visible || L.under) continue;
      if (M && L.clip) gl.enable(gl.STENCIL_TEST); // lakes stay water
      P = this.prog.poly; gl.useProgram(P.p);
      this._attr(P, 'a_pos', L.pos, 2); this._attr(P, 'a_col', L.col, 4, gl.UNSIGNED_BYTE, true);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.idx); gl.uniform1f(P.u.u_alpha, L.alpha * this.opts.opacity);
      for (const o of offs) { this._common(P, o); gl.drawElements(gl.TRIANGLES, L.n, gl.UNSIGNED_INT, 0); }
      this._disableAttrs();
      const fade = Math.max(0.15, Math.min(1, (c.s / this.dpr - 700) / 2500));
      if (L.lcol) {
        P = this.prog.lineC; gl.useProgram(P.p); this._attr(P, 'a_pos', L.lbuf, 2); this._attr(P, 'a_col', L.lcol, 4, gl.UNSIGNED_BYTE, true);
        gl.uniform1f(P.u.u_alpha, L.lineAlpha * Math.max(0.5, fade));
      } else {
        if (!L.lineColor[3]) continue;
        P = this.prog.line; gl.useProgram(P.p); this._attr(P, 'a_pos', L.lbuf, 2);
        gl.uniform4f(P.u.u_color, L.lineColor[0], L.lineColor[1], L.lineColor[2], L.lineColor[3] * fade);
      }
      for (const o of offs) { this._common(P, o); gl.drawArrays(gl.LINES, 0, L.ln); }
      this._disableAttrs();
      if (M) gl.disable(gl.STENCIL_TEST);
    }
    if (M) gl.disable(gl.STENCIL_TEST);
    // lines
    P = this.prog.line; gl.useProgram(P.p);
    for (const L of Object.values(this.lines)) {
      if (!L.visible || c.s < L.minS * this.dpr) continue;
      this._attr(P, 'a_pos', L.buf, 2); gl.uniform4fv(P.u.u_color, L.color);
      for (const o of offs) { this._common(P, o); gl.drawArrays(gl.LINES, 0, L.n); }
    }
    this._disableAttrs();
    const TL = Object.values(this.thick).filter((T) => T.visible !== false && T.n).sort((a, b) => a.z - b.z);
    if (TL.length) {
      P = this.prog.thick; gl.useProgram(P.p);
      for (const T of TL) {
        gl.bindBuffer(gl.ARRAY_BUFFER, T.vb);
        gl.enableVertexAttribArray(P.a.a_a); gl.vertexAttribPointer(P.a.a_a, 2, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(P.a.a_b); gl.vertexAttribPointer(P.a.a_b, 2, gl.FLOAT, false, 24, 8);
        gl.enableVertexAttribArray(P.a.a_c); gl.vertexAttribPointer(P.a.a_c, 2, gl.FLOAT, false, 24, 16);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, T.ib);
        const w = (typeof T.width === 'function' ? T.width(c.s / this.dpr) : T.width) * this.dpr;
        gl.uniform1f(P.u.u_w, w); gl.uniform1f(P.u.u_wf, w); gl.uniform4fv(P.u.u_color, T.color);
        for (const o of offs) { this._common(P, o); gl.drawElements(gl.TRIANGLES, T.n, gl.UNSIGNED_INT, 0); }
        this._disableAttrs();
      }
      P = this.prog.line; gl.useProgram(P.p);
    }
    this._disableAttrs();
    // points
    const pt = this.points;
    if (pt && pt.visible && pt.n) {
      P = this.prog.pt; gl.useProgram(P.p);
      this._attr(P, 'a_pos', pt.pb, 2); this._attr(P, 'a_size', pt.sb, 1); this._attr(P, 'a_col', pt.cb, 4, gl.UNSIGNED_BYTE, true);
      gl.uniform1f(P.u.u_ps, this.dpr * Math.max(0.6, Math.min(1.6, Math.log2(c.s / this.dpr / 256 + 1) / 3)));
      const cnt = this.pointCount ? Math.min(pt.n, this.pointCount(c.s / this.dpr)) : pt.n;
      for (const o of offs) { this._common(P, o); gl.drawArrays(gl.POINTS, 0, cnt); }
      this._disableAttrs();
    }
    // chosen place: mark it in the stencil, then shade everything else
    const F = this.focus;
    if (F && F.n) {
      gl.enable(gl.STENCIL_TEST); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
      P = this.prog.poly; gl.useProgram(P.p); this._disableAttrs();
      gl.colorMask(false, false, false, false); gl.stencilFunc(gl.ALWAYS, 2, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.vertexAttrib4f(P.a.a_col, 0, 0, 0, 1); gl.uniform1f(P.u.u_alpha, 1);
      this._attr(P, 'a_pos', F.pos, 2); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, F.ib);
      for (const o of offs) { this._common(P, o); gl.drawElements(gl.TRIANGLES, F.n, gl.UNSIGNED_INT, 0); }
      this._disableAttrs();
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.NOTEQUAL, 2, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      const l = left - 1, r = right + 1, quad = new Float32Array([l, -1, r, -1, l, 2, r, -1, r, 2, l, 2]);
      if (!this._quad) this._quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._quad); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(P.a.a_pos); gl.vertexAttribPointer(P.a.a_pos, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttrib4f(P.a.a_col, 0.05, 0.09, 0.125, 0.82); gl.uniform1f(P.u.u_alpha, 1);
      this._common(P, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      this._disableAttrs(); gl.disable(gl.STENCIL_TEST);
    }
    // labels
    const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.lc.width, this.lc.height);
    if (this.onLabels) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.onLabels(ctx, this); }
  }
}
