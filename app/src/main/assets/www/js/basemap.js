// Real map underneath the data: web-map tiles drawn as <img> layers behind / above the WebGL overlay.
// Using DOM images (not WebGL textures) means no CORS requirements and the browser's own tile cache.
// All keyless. Esri/ArcGIS Online tiles first; each style lists fallbacks tried in order if a server refuses.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const esri = (svc) => ESRI + svc + '/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Tiles © Esri — Esri, HERE, Garmin, USGS, OpenStreetMap contributors, and the GIS user community';
export const BASEMAPS = {
  none: { label: 'Built-in', offline: true },
  streets: {
    label: 'Streets', retina: false, max: 19,
    base: esri('World_Street_Map'), labels: null, attr: ESRI_ATTR,
    alt: [{ base: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', labels: null, max: 19, attr: '© OpenStreetMap contributors' }],
  },
  light: {
    label: 'Light', retina: false, max: 16,
    base: esri('Canvas/World_Light_Gray_Base'), labels: esri('Canvas/World_Light_Gray_Reference'), attr: ESRI_ATTR,
  },
  dark: {
    label: 'Dark', retina: false, max: 16,
    base: esri('Canvas/World_Dark_Gray_Base'), labels: esri('Canvas/World_Dark_Gray_Reference'), attr: ESRI_ATTR,
  },
  satellite: {
    label: 'Satellite', retina: false, max: 18,
    base: esri('World_Imagery'), labels: esri('Reference/World_Boundaries_and_Places'),
    attr: 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS user community',
  },
  terrain: {
    label: 'Topographic', retina: false, max: 18,
    base: esri('World_Topo_Map'), labels: null, attr: ESRI_ATTR,
    alt: [{ base: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', labels: null, max: 17, attr: '© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)' }],
  },
};

class TileLayer {
  constructor(el) { this.el = el; this.imgs = new Map(); this.ok = 0; this.err = 0; }
  clear() { for (const im of this.imgs.values()) im.remove(); this.imgs.clear(); }
  // R: MapRenderer. template: url with {z}{x}{y}{s}. retina: tiles are 512px.
  update(R, template, subs, maxZ, retina, onError) {
    if (!template) { if (this.imgs.size) this.clear(); this.template = null; return; }
    if (template !== this.template) { this.clear(); this.template = template; }
    const S = R.cssScale, vw = R.vw / R.dpr, vh = R.vh / R.dpr, cam = R.cam;
    const want = retina ? 256 : 256 / Math.min(2, R.dpr);
    const z = Math.max(0, Math.min(maxZ, Math.round(Math.log2(S / want))));
    const keep = new Set();
    // draw the parent level first as a placeholder while the sharp tiles load
    for (const zz of z > 0 ? [z - 1, z] : [z]) {
      const n = 1 << zz, size = S / n;
      const x0 = Math.floor((cam.x - vw / 2 / S) * n), x1 = Math.floor((cam.x + vw / 2 / S) * n);
      const y0 = Math.max(0, Math.floor((cam.y - vh / 2 / S) * n)), y1 = Math.min(n - 1, Math.floor((cam.y + vh / 2 / S) * n));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 140) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const key = zz + '/' + x + '/' + y; keep.add(key);
        let im = this.imgs.get(key);
        if (!im) {
          im = new Image(); im.decoding = 'async'; im.draggable = false; im.className = 'tile z' + (zz === z ? 'hi' : 'lo');
          const xw = ((x % n) + n) % n, s = subs ? subs[(xw + y) % subs.length] : '';
          im.onload = () => { this.ok++; im.classList.add('in'); };
          im.onerror = () => { this.err++; if (onError) onError(this); };
          im.src = template.replace('{z}', zz).replace('{x}', xw).replace('{y}', y).replace('{s}', s);
          this.imgs.set(key, im); this.el.append(im);
        }
        const left = (x / n - cam.x) * S + vw / 2, top = (y / n - cam.y) * S + vh / 2;
        im.style.transform = `translate3d(${left.toFixed(2)}px,${top.toFixed(2)}px,0)`;
        im.style.width = im.style.height = (size + 0.6).toFixed(2) + 'px';
        im.style.zIndex = zz === z ? 2 : 1;
      }
    }
    for (const [k, im] of this.imgs) if (!keep.has(k)) { im.remove(); this.imgs.delete(k); }
  }
}

export class Basemap {
  constructor(baseEl, labelEl, attrEl) { this.base = new TileLayer(baseEl); this.labels = new TileLayer(labelEl); this.attrEl = attrEl; this.style = 'none'; this.showLabels = true; this.onOffline = null; this._warned = false; this.altIdx = -1; }
  get src() { const B = BASEMAPS[this.style]; return this.altIdx >= 0 && B.alt ? { ...B, ...B.alt[this.altIdx] } : B; }
  setStyle(style) { this.style = BASEMAPS[style] ? style : 'none'; this.altIdx = -1; this.base.ok = this.base.err = 0; this._warned = false; this.attrEl.textContent = this.src.attr || ''; }
  get online() { return this.style !== 'none'; }
  get hasLabels() { return this.online && this.showLabels && !!this.src.labels; }
  update(R) {
    const B = this.src;
    const fail = (layer) => {
      if (this._warned || layer.err < 6 || layer.ok > 0) return;
      const alts = BASEMAPS[this.style].alt || [];
      if (this.altIdx + 1 < alts.length) { this.altIdx++; layer.ok = layer.err = 0; this.attrEl.textContent = this.src.attr || ''; R.dirty(); return; }
      this._warned = true; if (this.onOffline) this.onOffline();
    };
    this.base.update(R, B.base, B.subs, B.max || 18, B.retina, fail);
    this.labels.update(R, this.showLabels ? B.labels : null, B.subs, B.max || 18, B.labelsRetina ?? B.retina, null);
  }
}
