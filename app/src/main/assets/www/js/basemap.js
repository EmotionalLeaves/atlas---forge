// Real map underneath the data: web-map tiles drawn as <img> layers behind / above the WebGL overlay.
// Using DOM images (not WebGL textures) means no CORS requirements and the browser's own tile cache.
export const BASEMAPS = {
  none: { label: 'Built-in', offline: true },
  streets: {
    label: 'Streets', retina: true, max: 20, subs: 'abcd',
    base: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png',
    labels: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}@2x.png',
    attr: '© OpenStreetMap contributors © CARTO',
  },
  light: {
    label: 'Light', retina: true, max: 20, subs: 'abcd',
    base: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
    labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}@2x.png',
    attr: '© OpenStreetMap contributors © CARTO',
  },
  dark: {
    label: 'Dark', retina: true, max: 20, subs: 'abcd',
    base: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
    labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png',
    attr: '© OpenStreetMap contributors © CARTO',
  },
  satellite: {
    label: 'Satellite', retina: false, max: 18,
    base: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png', subs: 'abcd', labelsRetina: true,
    attr: 'Imagery © Esri, Maxar, Earthstar Geographics · Labels © OpenStreetMap contributors © CARTO',
  },
  terrain: {
    label: 'Terrain', retina: false, max: 17, subs: 'abc',
    base: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    labels: null,
    attr: '© OpenStreetMap contributors, SRTM · © OpenTopoMap (CC-BY-SA)',
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
  constructor(baseEl, labelEl, attrEl) { this.base = new TileLayer(baseEl); this.labels = new TileLayer(labelEl); this.attrEl = attrEl; this.style = 'none'; this.showLabels = true; this.onOffline = null; this._warned = false; }
  setStyle(style) { this.style = BASEMAPS[style] ? style : 'none'; this.base.ok = this.base.err = 0; this._warned = false; this.attrEl.textContent = BASEMAPS[this.style].attr || ''; }
  get online() { return this.style !== 'none'; }
  get hasLabels() { return this.online && this.showLabels && !!BASEMAPS[this.style].labels; }
  update(R) {
    const B = BASEMAPS[this.style];
    const fail = (layer) => { if (!this._warned && layer.err >= 6 && layer.ok === 0) { this._warned = true; if (this.onOffline) this.onOffline(); } };
    this.base.update(R, B.base, B.subs, B.max || 18, B.retina, fail);
    this.labels.update(R, this.showLabels ? B.labels : null, B.subs, B.max || 18, B.labelsRetina ?? B.retina, null);
  }
}
