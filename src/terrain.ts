export interface TerrainMeta {
  width: number; height: number;
  west: number; east: number; north: number; south: number;
  sizeX: number; sizeY: number;
  minHeight: number; maxHeight: number;
}

const merc = (lat: number) => Math.asinh(Math.tan((lat * Math.PI) / 180));

/** Heightfield in a local metric frame: x = east, z = south, origin at the centre. */
export class Terrain {
  readonly w: number;
  readonly h: number;
  readonly sizeX: number;
  readonly sizeY: number;
  readonly minH: number;
  readonly maxH: number;
  constructor(readonly meta: TerrainMeta, readonly heights: Float32Array) {
    this.w = meta.width; this.h = meta.height;
    this.sizeX = meta.sizeX; this.sizeY = meta.sizeY;
    let lo = Infinity, hi = -Infinity;
    for (const v of heights) { if (v < lo) lo = v; if (v > hi) hi = v; }
    this.minH = lo; this.maxH = hi;
  }

  static async load(base = `${import.meta.env.BASE_URL}data/`): Promise<Terrain> {
    const [meta, buf] = await Promise.all([
      fetch(`${base}terrain.json`).then((r) => r.json() as Promise<TerrainMeta>),
      fetch(`${base}terrain.bin`).then((r) => r.arrayBuffer()),
    ]);
    const raw = new Uint16Array(buf);
    const heights = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) heights[i] = raw[i] / 10;
    return new Terrain(meta, heights);
  }

  inside(x: number, z: number): boolean {
    return Math.abs(x) <= this.sizeX / 2 && Math.abs(z) <= this.sizeY / 2;
  }

  /** Bilinear height (metres above sea level) at a world position. */
  heightAt(x: number, z: number): number {
    const fx = Math.min(Math.max((x / this.sizeX + 0.5) * this.w - 0.5, 0), this.w - 1.001);
    const fy = Math.min(Math.max((z / this.sizeY + 0.5) * this.h - 0.5, 0), this.h - 1.001);
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const i = y0 * this.w + x0, d = this.heights;
    return (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + this.w] * (1 - tx) + d[i + this.w + 1] * tx) * ty;
  }

  toWorld(lat: number, lon: number): [number, number] {
    const m = this.meta;
    const u = (lon - m.west) / (m.east - m.west);
    const v = (merc(m.north) - merc(lat)) / (merc(m.north) - merc(m.south));
    return [(u - 0.5) * this.sizeX, (v - 0.5) * this.sizeY];
  }

  toGeo(x: number, z: number): [number, number] {
    const m = this.meta;
    const u = x / this.sizeX + 0.5, v = z / this.sizeY + 0.5;
    const y = merc(m.north) - v * (merc(m.north) - merc(m.south));
    return [(Math.atan(Math.sinh(y)) * 180) / Math.PI, m.west + u * (m.east - m.west)];
  }
}
