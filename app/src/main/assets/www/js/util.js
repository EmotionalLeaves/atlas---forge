// Shared helpers: RNG, noise, colors, formatting, names.
export function makeRng(seed) {
  let s = seed >>> 0;
  const f = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.state = () => s; f.setState = (v) => { s = v >>> 0; };
  return f;
}
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---- colors ----
export function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}
export const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
export const parseHex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function catColor(k) { const h = (k * 137.508) % 360; return hsl(h, 0.55 + 0.2 * ((k * 7) % 3) / 2, 0.5 + 0.12 * ((k * 5) % 3) / 2); }
export const RAMPS = {
  inferno: ['#1b0c41', '#6a176e', '#c03a51', '#f1711f', '#fcffa4'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  greens: ['#17301f', '#1f6b3a', '#41ab5d', '#a1d99b', '#f0fbe8'],
  blues: ['#0c2747', '#1d5c96', '#3f8fcf', '#8cc3ec', '#e5f3ff'],
  ember: ['#2a1708', '#7a3510', '#c9601a', '#f2a541', '#fff1c2'],
  diverge: ['#b8235a', '#ec8fb0', '#f3efe6', '#8fd1c6', '#0d7d70'],
  stability: ['#8c1d18', '#e2683c', '#f5d061', '#9ed36a', '#2e9b55'],
};
const rampCache = {};
export function rampLUT(name) {
  if (rampCache[name]) return rampCache[name];
  const stops = RAMPS[name].map(parseHex), lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f);
  }
  return (rampCache[name] = lut);
}
export const PARTY_COLORS = [[214, 84, 132], [236, 186, 64], [38, 160, 150]];
export const TERRAIN_COLORS = [[20, 34, 52], [70, 120, 190], [236, 240, 246], [196, 205, 214], [150, 160, 138], [52, 99, 64], [118, 168, 92], [42, 135, 64], [226, 196, 128], [132, 106, 86], [168, 140, 104], [86, 196, 130]];
// 9-colour map palette for nations (Natural Earth MAPCOLOR9 is a graph colouring of real borders)
const MAP9 = [214, 32, 140, 270, 96, 352, 190, 52, 236];
export function nationColor(mapcolor, seed) { const h = MAP9[(mapcolor - 1 + 9) % 9] + ((seed * 47) % 24) - 12; return hsl(h, 0.42 + ((seed * 13) % 20) / 100, 0.52 + ((seed * 7) % 14) / 100); }
export function districtColor(k) { const h = (k * 137.508 + 12) % 360; return hsl(h, 0.62, k % 2 ? 0.58 : 0.5); }

// ---- formatting ----
export function fmt(n, d = 1) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(d) + 'T'; if (a >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(d) + 'M'; if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  if (a >= 100) return Math.round(n).toLocaleString(); if (a >= 1) return n.toFixed(d); return n.toFixed(d + 1);
}
export const pct = (v, d = 0) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%';
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dateOf = (m, start = 2026) => `${MONTHS[m % 12]} ${start + Math.floor(m / 12)}`;
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- generated names ----
const LEFT = ['Progress Union', 'Labour Front', 'Green Accord', 'Commons Party', 'Social Forum', 'Workers\' Alliance', 'New Dawn'];
const MID = ['Unity Movement', 'Reform League', 'Moderate Bloc', 'Civic Centre', 'Common Ground', 'Renewal'];
const RIGHT = ['Heritage Party', 'Liberty League', 'National Rally', 'Order & Tradition', 'Homeland Union', 'Free Enterprise'];
export function makeParties(rng) {
  const pick = (a) => a[Math.floor(rng() * a.length)];
  return [{ name: pick(LEFT), pos: -0.5 - rng() * 0.15 }, { name: pick(MID), pos: (rng() - 0.5) * 0.15 }, { name: pick(RIGHT), pos: 0.5 + rng() * 0.15 }];
}
const REBEL = ['Free State of %', '% Republic', 'Republic of %', '%n Federation', 'People\'s Republic of %', 'Commonwealth of %', 'Principality of %'];
export function rebelName(prov, rng) {
  const t = REBEL[Math.floor(rng() * REBEL.length)];
  return t.includes('%n') ? t.replace('%n', prov) : t.replace('%', prov);
}
const BLOC = ['% Pact', '% Accord', 'League of %', '% Entente', '% Compact', '% Union'];
export function blocName(base, rng) { return BLOC[Math.floor(rng() * BLOC.length)].replace('%', base); }

// ---- tiny DOM helper ----
export function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v; else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } }
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v;
    else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
