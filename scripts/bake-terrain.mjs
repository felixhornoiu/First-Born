// Bakes a heightmap for the Brașov area from the open AWS Terrain Tiles
// (Terrarium encoding, https://registry.opendata.aws/terrain-tiles/).
// Output: public/data/terrain.bin (Uint16 LE, decimetres) + terrain.json (metadata).
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const Z = 12;
const X0 = 2337, Y0 = 1461; // top-left tile (north-west corner)
const NX = 4, NY = 4;        // 4x4 tiles of 256px = 1024x1024 samples
const T = 256;
const W = NX * T, H = NY * T;

const lon = (x) => (x / 2 ** Z) * 360 - 180;
const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;

async function tile(x, y) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return PNG.sync.read(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

const out = new Uint16Array(W * H);
let min = Infinity, max = -Infinity;
for (let ty = 0; ty < NY; ty++) {
  for (let tx = 0; tx < NX; tx++) {
    const png = await tile(X0 + tx, Y0 + ty);
    for (let py = 0; py < T; py++) {
      for (let px = 0; px < T; px++) {
        const i = (py * T + px) * 4;
        const h = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
        min = Math.min(min, h); max = Math.max(max, h);
        out[(ty * T + py) * W + tx * T + px] = Math.round(Math.max(0, h) * 10);
      }
    }
  }
}

const west = lon(X0), east = lon(X0 + NX), north = lat(Y0), south = lat(Y0 + NY);
const midLat = (north + south) / 2;
const R = 6371008.8;
const meta = {
  width: W, height: H, zoom: Z,
  west, east, north, south,
  // ground extent in metres (local scale at the centre latitude)
  sizeX: ((east - west) * Math.PI / 180) * R * Math.cos((midLat * Math.PI) / 180),
  sizeY: ((north - south) * Math.PI / 180) * R,
  minHeight: Math.round(min), maxHeight: Math.round(max),
  encoding: 'uint16le-decimetres',
  source: 'Mapzen/AWS Terrain Tiles (terrarium)',
};
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/terrain.bin', Buffer.from(out.buffer));
writeFileSync('public/data/terrain.json', JSON.stringify(meta, null, 2));
console.log(meta);
