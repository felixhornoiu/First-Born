// Packs building footprints for the city view into public/data/city.bin (+ city.json).
//   python scripts/fetch-overture.py 25.555 45.615 25.650 45.682 scripts/.cache/buildings.jsonl
//   node scripts/bake-city.mjs [scripts/.cache/buildings.jsonl]
// Source: Overture Maps buildings (ODbL, © OpenStreetMap contributors and other sources).
// Most buildings carry no height in the data, so heights are estimated from floors, type and size.
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2] ?? 'scripts/.cache/buildings.jsonl';
const meta = JSON.parse(readFileSync('public/data/terrain.json', 'utf8'));
const CENTER = { lat: 45.6485, lon: 25.6025 };
const HALF = 3400;           // the city box is 6.8 km square
const UNIT = HALF / 32000;   // metres per int16 step (~0.11 m)

const merc = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
const mN = merc(meta.north), mS = merc(meta.south);
const toWorld = (lon, lat) => [
  ((lon - meta.west) / (meta.east - meta.west) - 0.5) * meta.sizeX,
  ((mN - merc(lat)) / (mN - mS) - 0.5) * meta.sizeY,
];
const [cx, cz] = toWorld(CENTER.lon, CENTER.lat);

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

function clean(ring) {
  let pts = ring.map(([lon, lat]) => { const [x, z] = toWorld(lon, lat); return [x - cx, z - cz]; });
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.01) pts.pop();
  // drop duplicate and collinear points
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const dist = len < 1e-6 ? 0 : Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / len;
      if (dist < 0.12 || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.15) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts.length >= 3 ? pts : null;
}

/** Shorter side of the minimum-area bounding rectangle. */
function shortSide(r) {
  let best = [Infinity, 0];
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l < 0.5) continue;
    const ux = (q[0] - p[0]) / l, uz = (q[1] - p[1]) / l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of r) { const a = v[0] * ux + v[1] * uz, b = -v[0] * uz + v[1] * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const A = (a1 - a0) * (b1 - b0);
    if (A < best[0]) best = [A, Math.min(a1 - a0, b1 - b0)];
  }
  return best[1];
}

const FLAT = new Set(['apartments', 'industrial', 'retail', 'commercial', 'office', 'garage', 'garages', 'shed', 'warehouse', 'supermarket', 'parking', 'hospital', 'school', 'university', 'hotel', 'dormitory', 'roof', 'service', 'kiosk', 'hangar']);
const GROUP = { apartments: 1, dormitory: 1, hotel: 1, industrial: 2, warehouse: 2, retail: 2, commercial: 2, supermarket: 2, office: 2, parking: 2, house: 4, detached: 4, semidetached_house: 4 };

const out = [];
let count = 0, known = 0;
for (const line of readFileSync(src, 'utf8').split('\n')) {
  if (!line) continue;
  const b = JSON.parse(line);
  if (b.is_underground) continue;
  const polys = b.geometry.type === 'Polygon' ? [b.geometry.coordinates] : b.geometry.coordinates;
  for (const poly of polys) {
    const outer = clean(poly[0]);
    if (!outer) continue;
    const rings = [outer, ...poly.slice(1).map(clean).filter((r) => r && Math.abs(area(r)) > 6)];
    const A = Math.abs(area(outer));
    if (A < 8) continue;
    const mx = outer.reduce((s, p) => s + p[0], 0) / outer.length, mz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    if (Math.abs(mx) > HALF - 20 || Math.abs(mz) > HALF - 20) continue;

    const cls = b.class ?? '', sub = b.subtype ?? '', k = hash(b.id);
    const religious = sub === 'religious' || /^(church|cathedral|chapel|monastery|synagogue)$/.test(cls);
    let group = religious || /^(education|civic|medical)$/.test(sub) ? 3 : GROUP[cls] ?? (sub === 'industrial' || sub === 'commercial' ? 2 : 0);
    let pitched = !FLAT.has(cls) && sub !== 'industrial' && sub !== 'commercial' && A < 1400 && A > 14 && rings.length === 1 && outer.length <= 12;
    if (b.roof_shape) pitched = b.roof_shape !== 'flat' && rings.length === 1 && outer.length <= 14;

    let total;
    if (b.height) { total = b.height; known++; }
    else if (b.num_floors) { total = b.num_floors * 3.1 + (pitched ? 2.5 : 1); known++; }
    else if (religious) total = 15 + 6 * k;
    else if (cls === 'apartments') total = (A > 900 ? 16 : A > 350 ? 15 + (k > 0.8 ? 15 : 0) : 13) + 2 * k;
    else if (/^(shed|garage|garages|roof|kiosk|hut|service)$/.test(cls) || sub === 'outbuilding' || A < 38) total = 2.6 + 1.2 * k;
    else if (group === 2) total = 6.5 + 4 * k;
    else if (group === 3) total = 11 + 4 * k;
    else if (group === 4 || A < 230) total = 6 + 3.2 * k;
    else if (A < 1400) total = 9.5 + 4.5 * k;
    else total = 8 + 4 * k;

    const side = shortSide(outer);
    let roof = pitched ? Math.min(Math.max(side * (religious ? 0.7 : 0.36), 1.2), religious ? 12 : 6) : 0;
    if (b.roof_height && pitched) roof = b.roof_height;
    roof = Math.min(roof, total * 0.55);
    const wall = Math.min(Math.max(total - roof, 2.2), 84);
    out.push({ wall, roof, flags: (pitched ? 1 : 0) | (group << 1) | (Math.floor(k * 8) << 4), rings });
    count++;
  }
}

let bytes = 0;
for (const b of out) bytes += 4 + b.rings.reduce((s, r) => s + 2 + r.length * 4, 0);
const buf = new DataView(new ArrayBuffer(bytes));
let o = 0;
for (const b of out) {
  buf.setUint8(o++, Math.round(b.wall * 3)); buf.setUint8(o++, Math.round(b.roof * 4));
  buf.setUint8(o++, b.flags); buf.setUint8(o++, b.rings.length);
  for (const r of b.rings) {
    buf.setUint16(o, r.length, true); o += 2;
    for (const [x, z] of r) { buf.setInt16(o, Math.round(x / UNIT), true); buf.setInt16(o + 2, Math.round(z / UNIT), true); o += 4; }
  }
}
writeFileSync('public/data/city.bin', Buffer.from(buf.buffer));
writeFileSync('public/data/city.json', JSON.stringify({ count, cx, cz, half: HALF, unit: UNIT, center: CENTER, source: 'Overture Maps buildings', heightsFromData: known }, null, 2));
console.log({ count, known, bytes });
