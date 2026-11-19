// Bakes ground-colour maps from Overture Maps (roads, land use, land cover, water):
//   public/data/map.webp       whole region, 2048 px
//   public/data/city-map.webp  the city box, 4096 px (~1.7 m per pixel)
// Inputs are the .jsonl files written by scripts/fetch-overture.py into scripts/.cache
// (see README). Data © OpenStreetMap contributors and Overture Maps Foundation, ODbL.
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const meta = JSON.parse(readFileSync('public/data/terrain.json', 'utf8'));
const city = JSON.parse(readFileSync('public/data/city.json', 'utf8'));
const load = (name) => {
  const f = `scripts/.cache/${name}.jsonl`;
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

const merc = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
const mN = merc(meta.north), mS = merc(meta.south);
const world = ([lon, lat]) => [
  ((lon - meta.west) / (meta.east - meta.west) - 0.5) * meta.sizeX,
  ((mN - merc(lat)) / (mN - mS) - 0.5) * meta.sizeY,
];

// Pre-project everything once.
const polys = (rows) => rows.flatMap((r) => {
  const g = r.geometry;
  const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return list.map((rings) => ({ ...r, rings: rings.map((ring) => ring.map(world)) }));
});
const lines = (rows) => rows.filter((r) => r.geometry.type === 'LineString').map((r) => ({ ...r, pts: r.geometry.coordinates.map(world) }));

const cover = polys(load('land_cover')), land = polys(load('land')), use = polys(load('land_use'));
const waterRows = load('water'), water = polys(waterRows), streams = lines(waterRows);
const segs = lines(load('segment'));

const AREA = {
  // land cover (coarse) then natural land, then land use
  crop: '#b4ab8a', barren: '#b0aa9a', urban: '#a39d95', shrub: '#7f9463', forest: '#4d6b45', wood: '#4d6b45', wetland: '#7d9a86',
  grassland: '#93a56f', grass: '#8fa86a', heath: '#869464', scrub: '#74895b', bare_rock: '#aaa69c',
  residential: '#a8a199', industrial: '#99969a', brownfield: '#9f998c', retail: '#a39c9e', commercial: '#a39c9e', construction: '#a89f8c',
  park: '#6f9a5c', village_green: '#7ba064', garden: '#7c9d62', playground: '#93a777', pitch: '#7fae6d', stadium: '#86a874',
  meadow: '#9cae74', farmland: '#b6ac86', orchard: '#8ea368', allotments: '#8fa16c', cemetery: '#839a70', grave_yard: '#839a70',
  pedestrian: '#c6beac', school: '#aaa397', kindergarten: '#aaa397', college: '#aaa397', downhill: '#c9cfc4', quarry: '#b3ada2', military: '#a09a8c',
};
// [class list, width in metres, minimum px, colour, draw in region map]
const ROADS = [
  [['track'], 3, 0.6, '#b5a585', true],
  [['path', 'footway', 'steps', 'cycleway', 'bridleway'], 1.8, 0.7, '#c9bfa6', false],
  [['service', 'unknown'], 4, 0.5, '#8d8b8c', false],
  [['pedestrian'], 6, 0.8, '#c9c0ad', false],
  [['residential', 'living_street', 'unclassified'], 7, 0.8, '#868486', true],
  [['tertiary'], 9, 1.3, '#807e81', true],
  [['secondary'], 11, 1.6, '#7b797d', true],
  [['primary', 'trunk', 'motorway'], 14, 2.2, '#757378', true],
];

function render(size, x0, z0, extent, file, regional) {
  const canvas = createCanvas(size, size), ctx = canvas.getContext('2d');
  const k = size / extent, X = (p) => (p[0] - x0) * k, Y = (p) => (p[1] - z0) * k;
  ctx.fillStyle = '#aca58f';
  ctx.fillRect(0, 0, size, size);
  ctx.lineJoin = ctx.lineCap = 'round';
  const fill = (items, pick) => {
    for (const it of items) {
      const c = AREA[pick(it)];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.beginPath();
      for (const ring of it.rings) { ring.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.closePath(); }
      ctx.fill('evenodd');
    }
  };
  const stroke = (items, color, width, dash = []) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath();
    for (const it of items) it.pts.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.stroke();
  };

  fill(cover, (r) => r.subtype);
  fill(land, (r) => r.class);
  fill(use.filter((r) => r.class !== 'pedestrian'), (r) => r.class);
  ctx.fillStyle = '#4b7ba6';
  for (const w of water) {
    ctx.beginPath();
    for (const ring of w.rings) { ring.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.closePath(); }
    ctx.fill('evenodd');
  }
  stroke(streams.filter((s) => s.subtype === 'stream' || s.subtype === 'canal'), 'rgba(75,123,166,0.75)', Math.max(1.5 * k, 0.7));
  stroke(streams.filter((s) => s.subtype === 'river'), '#4b7ba6', Math.max(6 * k, 1.4));
  stroke(segs.filter((s) => s.subtype === 'rail'), '#5b5a60', Math.max(2.2 * k, 0.9), regional ? [5, 3] : []);
  for (const [classes, metres, minPx, color, inRegion] of ROADS) {
    if (regional && !inRegion) continue;
    const set = new Set(classes);
    // On the regional map roads are drawn lighter so they read as lines from far away.
    stroke(segs.filter((s) => s.subtype === 'road' && set.has(s.class)), regional && metres >= 7 ? '#d9d3c6' : color, Math.max(metres * k, minPx));
  }
  fill(use.filter((r) => r.class === 'pedestrian'), (r) => r.class); // squares sit on top of the streets
  writeFileSync(file, canvas.toBuffer('image/webp', 86));
  console.log(file, size);
}

render(2048, -meta.sizeX / 2, -meta.sizeY / 2, meta.sizeX, 'public/data/map.webp', true);
render(4096, city.cx - city.half, city.cz - city.half, city.half * 2, 'public/data/city-map.webp', false);
