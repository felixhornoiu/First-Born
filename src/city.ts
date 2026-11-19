import * as THREE from 'three';
import type { Terrain } from './terrain';

interface CityMeta { count: number; cx: number; cz: number; half: number; unit: number }

export const DSM_SIZE = 4096;   // building-height raster over the city box (~1.7 m per texel)
export const DSM_STEP = 1 / 3;  // metres per stored unit
const MAX_B = 85;

// Plaster and roof colours (linear-ish albedo), picked per building by a stored 3-bit seed.
const WALLS: Record<number, number[][]> = {
  0: [[0.80, 0.74, 0.60], [0.83, 0.79, 0.70], [0.78, 0.66, 0.52], [0.72, 0.74, 0.70], [0.84, 0.72, 0.62], [0.70, 0.76, 0.74], [0.86, 0.83, 0.76], [0.76, 0.70, 0.56]],
  1: [[0.70, 0.69, 0.66], [0.76, 0.73, 0.67], [0.66, 0.68, 0.70], [0.78, 0.76, 0.72]],
  2: [[0.60, 0.61, 0.63], [0.68, 0.67, 0.64], [0.55, 0.58, 0.62]],
  3: [[0.82, 0.78, 0.68], [0.76, 0.72, 0.64]],
  4: [[0.84, 0.80, 0.70], [0.80, 0.72, 0.58], [0.86, 0.84, 0.78], [0.76, 0.74, 0.66]],
};
const TILE = [[0.56, 0.25, 0.16], [0.50, 0.22, 0.15], [0.62, 0.30, 0.19], [0.44, 0.22, 0.17], [0.36, 0.30, 0.28]];
const FLAT_ROOF = [[0.40, 0.40, 0.42], [0.47, 0.46, 0.45], [0.34, 0.35, 0.38]];

export class City {
  readonly cx: number; readonly cz: number; readonly half: number;
  /** Height of the built surface above the ground, per texel, in DSM_STEP units. */
  readonly dsm = new Uint8Array(DSM_SIZE * DSM_SIZE);
  readonly geometry = new THREE.BufferGeometry();
  count = 0;

  private constructor(meta: CityMeta, buf: ArrayBuffer, private terrain: Terrain) {
    this.cx = meta.cx; this.cz = meta.cz; this.half = meta.half;
    this.build(new DataView(buf), meta.unit);
  }

  static async load(terrain: Terrain, base = `${import.meta.env.BASE_URL}data/`): Promise<City | null> {
    try {
      const [meta, buf] = await Promise.all([
        fetch(`${base}city.json`).then((r) => { if (!r.ok) throw new Error('no city data'); return r.json() as Promise<CityMeta>; }),
        fetch(`${base}city.bin`).then((r) => { if (!r.ok) throw new Error('no city data'); return r.arrayBuffer(); }),
      ]);
      return new City(meta, buf, terrain);
    } catch (err) {
      console.warn(err);
      return null;
    }
  }

  inside(x: number, z: number): boolean {
    return Math.abs(x - this.cx) < this.half && Math.abs(z - this.cz) < this.half;
  }

  /** Building height above the ground at a world position (0 when there is none). */
  buildingAt(x: number, z: number): number {
    const u = ((x - this.cx) / (2 * this.half) + 0.5) * DSM_SIZE, v = ((z - this.cz) / (2 * this.half) + 0.5) * DSM_SIZE;
    if (u < 0 || v < 0 || u >= DSM_SIZE || v >= DSM_SIZE) return 0;
    return this.dsm[(v | 0) * DSM_SIZE + (u | 0)] * DSM_STEP;
  }

  /** 1 when no building blocks the sun from a point `eye` metres above the surface. */
  lit(x: number, z: number, dir: [number, number, number], eye = 2): number {
    if (!this.inside(x, z) || dir[1] <= 0) return 1;
    const t = this.terrain;
    const y0 = t.heightAt(x, z) + this.buildingAt(x, z) + eye;
    let d = 1.5;
    for (let i = 0; i < 90; i++) {
      const px = x + dir[0] * d, pz = z + dir[2] * d, py = y0 + dir[1] * d;
      if (!this.inside(px, pz)) break;
      const g = t.heightAt(px, pz);
      if (py - g > MAX_B) break;
      if (py < g + this.buildingAt(px, pz)) return 0;
      d += Math.max(1.5, d * 0.06);
    }
    return 1;
  }

  private build(view: DataView, unit: number) {
    const t = this.terrain, { cx, cz, half } = this;
    const pos: number[] = [], base: number[] = [], col: number[] = [], idx: number[] = [];
    const texel = (2 * half) / DSM_SIZE;
    const push = (x: number, y: number, z: number, g: number, c: number[]) => { pos.push(x, y, z); base.push(g); col.push(c[0] * 255, c[1] * 255, c[2] * 255); return pos.length / 3 - 1; };

    for (let o = 0; o < view.byteLength; ) {
      const wall = view.getUint8(o) / 3, roofH = view.getUint8(o + 1) / 4, flags = view.getUint8(o + 2), nRings = view.getUint8(o + 3);
      o += 4;
      const rings: THREE.Vector2[][] = [];
      for (let r = 0; r < nRings; r++) {
        const n = view.getUint16(o, true); o += 2;
        const ring: THREE.Vector2[] = [];
        for (let i = 0; i < n; i++, o += 4) ring.push(new THREE.Vector2(cx + view.getInt16(o, true) * unit, cz + view.getInt16(o + 2, true) * unit));
        rings.push(ring);
      }
      const outer = rings[0], pitched = (flags & 1) === 1 && roofH > 0.5, group = (flags >> 1) & 7, seed = flags >> 4;
      // Sit the building on the lowest ground under its outline so no wall floats.
      let ground = Infinity, top = -Infinity;
      for (const p of outer) { const h = t.heightAt(p.x, p.y); ground = Math.min(ground, h); top = Math.max(top, h); }
      const eave = top - ground + wall; // wall height measured on the uphill side
      const wc = (WALLS[group] ?? WALLS[0])[seed % (WALLS[group] ?? WALLS[0]).length];
      const rc = pitched ? TILE[seed % (group === 3 ? 5 : 4)] : FLAT_ROOF[seed % 3];

      // Walls: one quad per edge of every ring; vertices are shared, normals come from derivatives.
      for (const ring of rings) {
        const first = pos.length / 3;
        for (const p of ring) { push(p.x, -4, p.y, ground, wc); push(p.x, eave, p.y, ground, wc); }
        for (let i = 0; i < ring.length; i++) {
          const a = first + i * 2, b = first + ((i + 1) % ring.length) * 2;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }

      if (pitched) {
        // Hip roof: every eave point connects to its projection on a ridge along the long axis.
        let best = { area: Infinity, ux: 1, uz: 0, a0: 0, a1: 0, b0: 0, b1: 0 };
        for (let i = 0; i < outer.length; i++) {
          const p = outer[i], q = outer[(i + 1) % outer.length], l = p.distanceTo(q);
          if (l < 0.5) continue;
          const ux = (q.x - p.x) / l, uz = (q.y - p.y) / l;
          let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
          for (const v of outer) { const a = v.x * ux + v.y * uz, b = -v.x * uz + v.y * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
          const area = (a1 - a0) * (b1 - b0);
          if (area < best.area) best = { area, ux, uz, a0, a1, b0, b1 };
        }
        let { ux, uz, a0, a1, b0, b1 } = best;
        if (b1 - b0 > a1 - a0) { [ux, uz] = [-uz, ux]; [a0, a1, b0, b1] = [b0, b1, -a1, -a0]; }
        const bm = (b0 + b1) / 2, inset = Math.min((b1 - b0) / 2, (a1 - a0) / 2);
        const first = pos.length / 3;
        for (const p of outer) {
          const a = Math.min(Math.max(p.x * ux + p.y * uz, a0 + inset), a1 - inset);
          push(p.x, eave, p.y, ground, rc);
          push(a * ux - bm * uz, eave + roofH, a * uz + bm * ux, ground, rc);
        }
        for (let i = 0; i < outer.length; i++) {
          const a = first + i * 2, b = first + ((i + 1) % outer.length) * 2;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      } else {
        const first = pos.length / 3;
        for (const ring of rings) for (const p of ring) push(p.x, eave, p.y, ground, rc);
        for (const tri of THREE.ShapeUtils.triangulateShape(outer, rings.slice(1))) idx.push(first + tri[0], first + tri[1], first + tri[2]);
      }

      this.rasterise(rings, ground + eave, texel);
      this.count++;
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    this.geometry.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(base), 1));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true));
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  }

  /** Even-odd scanline fill of a footprint into the height raster. */
  private rasterise(rings: THREE.Vector2[][], topAbs: number, texel: number) {
    const { cx, cz, half, terrain: t } = this;
    const tx = (x: number) => (x - cx + half) / texel, tz = (z: number) => (z - cz + half) / texel;
    let z0 = Infinity, z1 = -Infinity;
    for (const p of rings[0]) { z0 = Math.min(z0, p.y); z1 = Math.max(z1, p.y); }
    const r0 = Math.max(0, Math.floor(tz(z0))), r1 = Math.min(DSM_SIZE - 1, Math.ceil(tz(z1)));
    const xs: number[] = [];
    for (let r = r0; r <= r1; r++) {
      const zc = cz - half + (r + 0.5) * texel;
      xs.length = 0;
      for (const ring of rings) for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        if ((p.y <= zc) !== (q.y <= zc)) xs.push(p.x + ((zc - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.round(tx(xs[k]))), c1 = Math.min(DSM_SIZE - 1, Math.round(tx(xs[k + 1])) - 1);
        for (let c = c0; c <= c1; c++) {
          const h = topAbs - t.heightAt(cx - half + (c + 0.5) * texel, zc);
          const v = Math.min(Math.max(Math.round(h / DSM_STEP), 1), 255), i = r * DSM_SIZE + c;
          if (v > this.dsm[i]) this.dsm[i] = v;
        }
      }
    }
  }
}
