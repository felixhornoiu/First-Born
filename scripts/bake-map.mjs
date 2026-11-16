// Bakes a ground-colour map for the terrain from OpenStreetMap (via the Overpass API):
// forest, built-up area, water, roads, trails, lifts. Output: public/data/map.png
// © OpenStreetMap contributors, ODbL.
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const meta = JSON.parse(readFileSync('public/data/terrain.json', 'utf8'));
const SIZE = 2048;
const CACHE = 'scripts/.cache/osm.json';
const bbox = `${meta.south},${meta.west},${meta.north},${meta.east}`;
const ROADS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const query = `[out:json][timeout:240];(
  way[highway~"^(${ROADS}|path|track)$"](${bbox});
  way[landuse~"^(forest|residential|industrial|commercial|retail|meadow|grass|farmland|orchard)$"](${bbox});
  relation[landuse~"^(forest|residential)$"](${bbox});
  way[natural~"^(wood|water|scrub|grassland|bare_rock|scree)$"](${bbox});
  relation[natural~"^(wood|water)$"](${bbox});
  way[leisure~"^(park|pitch|golf_course)$"](${bbox});
  way[waterway~"^(river|stream|canal)$"](${bbox});
  way[aerialway](${bbox});
  way[railway=rail](${bbox});
);out geom;`;

async function load() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  for (let i = 0; ; i++) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(query),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'terrain-map-bake/1.0' },
    });
    if (r.ok) {
      const text = await r.text();
      mkdirSync('scripts/.cache', { recursive: true });
      writeFileSync(CACHE, text);
      return JSON.parse(text);
    }
    if (i >= 4) throw new Error(`Overpass ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 5000 * 2 ** i));
  }
}

const merc = (lat) => Math.asinh(Math.tan((lat * Math.PI) / 180));
const mN = merc(meta.north), mS = merc(meta.south);
const X = (lon) => ((lon - meta.west) / (meta.east - meta.west)) * SIZE;
const Y = (lat) => ((mN - merc(lat)) / (mN - mS)) * SIZE;

/** Join relation member ways into closed rings. */
function rings(ways) {
  const segs = ways.filter((g) => g?.length > 1).map((g) => [...g]);
  const out = [];
  const key = (p) => `${p.lat},${p.lon}`;
  while (segs.length) {
    let ring = segs.pop();
    for (let grew = true; grew && key(ring[0]) !== key(ring.at(-1)); ) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (key(s[0]) === key(ring.at(-1))) ring = ring.concat(s.slice(1));
        else if (key(s.at(-1)) === key(ring.at(-1))) ring = ring.concat(s.reverse().slice(1));
        else continue;
        segs.splice(i, 1); grew = true; break;
      }
    }
    out.push(ring);
  }
  return out;
}

const { elements } = await load();
const areas = { forest: [], scrub: [], grass: [], farm: [], urban: [], industrial: [], park: [], water: [], rock: [] };
const lines = { major: [], mid: [], minor: [], trail: [], stream: [], river: [], lift: [], rail: [] };
const areaClass = (t) =>
  t.natural === 'water' ? 'water' : t.landuse === 'forest' || t.natural === 'wood' ? 'forest'
  : t.natural === 'scrub' ? 'scrub' : t.natural === 'bare_rock' || t.natural === 'scree' ? 'rock'
  : t.landuse === 'residential' ? 'urban' : /^(industrial|commercial|retail)$/.test(t.landuse ?? '') ? 'industrial'
  : t.leisure ? 'park' : /^(meadow|grass)$/.test(t.landuse ?? '') || t.natural === 'grassland' ? 'grass'
  : /^(farmland|orchard)$/.test(t.landuse ?? '') ? 'farm' : null;

for (const el of elements) {
  const t = el.tags ?? {};
  if (el.type === 'relation') {
    const c = areaClass(t);
    if (c) areas[c].push(rings(el.members.filter((m) => m.type === 'way').map((m) => m.geometry)));
    continue;
  }
  const g = el.geometry;
  if (!g) continue;
  if (t.highway) {
    const h = t.highway;
    lines[/^(motorway|trunk|primary)/.test(h) ? 'major' : /^(secondary|tertiary)/.test(h) ? 'mid' : /^(path|track)$/.test(h) ? 'trail' : 'minor'].push(g);
  } else if (t.waterway) lines[t.waterway === 'stream' ? 'stream' : 'river'].push(g);
  else if (t.aerialway) lines.lift.push(g);
  else if (t.railway) lines.rail.push(g);
  else { const c = areaClass(t); if (c) areas[c].push([g]); }
}

const canvas = createCanvas(SIZE, SIZE), ctx = canvas.getContext('2d');
ctx.fillStyle = 'rgb(170,164,140)'; // open valley floor / fields
ctx.fillRect(0, 0, SIZE, SIZE);
ctx.lineJoin = ctx.lineCap = 'round';

const fill = (list, color) => {
  ctx.fillStyle = color;
  for (const polys of list) {
    ctx.beginPath();
    for (const ring of polys) { ring.forEach((p, i) => (i ? ctx.lineTo(X(p.lon), Y(p.lat)) : ctx.moveTo(X(p.lon), Y(p.lat)))); ctx.closePath(); }
    ctx.fill('evenodd');
  }
};
const stroke = (list, color, width, dash = []) => {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.beginPath();
  for (const g of list) g.forEach((p, i) => (i ? ctx.lineTo(X(p.lon), Y(p.lat)) : ctx.moveTo(X(p.lon), Y(p.lat))));
  ctx.stroke();
};

fill(areas.farm, 'rgb(176,168,136)');
fill(areas.grass, 'rgb(150,166,112)');
fill(areas.scrub, 'rgb(112,134,88)');
fill(areas.forest, 'rgb(70,100,64)');
fill(areas.rock, 'rgb(176,172,162)');
fill(areas.urban, 'rgb(148,140,134)');
fill(areas.industrial, 'rgb(136,132,134)');
fill(areas.park, 'rgb(118,150,96)');
fill(areas.water, 'rgb(66,112,160)');
stroke(lines.stream, 'rgba(66,112,160,0.7)', 0.8);
stroke(lines.river, 'rgb(66,112,160)', 1.6);
stroke(lines.trail, 'rgba(206,170,120,0.75)', 0.8);
stroke(lines.rail, 'rgba(60,60,66,0.8)', 1.0, [5, 3]);
stroke(lines.minor, 'rgba(214,208,198,0.9)', 1.0);
stroke(lines.mid, 'rgb(226,220,208)', 1.7);
stroke(lines.major, 'rgb(238,226,196)', 2.6);
stroke(lines.lift, 'rgb(44,44,50)', 1.3);

writeFileSync('public/data/map.png', canvas.toBuffer('image/png'));
console.log(Object.fromEntries([...Object.entries(areas), ...Object.entries(lines)].map(([k, v]) => [k, v.length])));
