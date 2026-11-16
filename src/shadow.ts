import type { Terrain } from './terrain';

/**
 * CPU twin of the GPU shadow pass: marches from a point towards the sun over
 * the heightfield. Returns 1 when the point sees the sun, 0 when terrain blocks it.
 */
export function terrainLit(t: Terrain, x: number, z: number, dir: [number, number, number], eye = 2): number {
  if (dir[1] <= 0) return 0;
  const hl = Math.hypot(dir[0], dir[2]);
  if (hl < 1e-4) return 1;
  const tan = dir[1] / hl, dx = dir[0] / hl, dz = dir[2] / hl;
  const h0 = t.heightAt(x, z) + eye;
  const tMax = Math.min((t.maxH - h0) / tan, 26000);
  const N = 220;
  for (let i = 1; i <= N; i++) {
    const f = i / N;
    const d = 20 + tMax * Math.pow(f, 1.4);
    const px = x + dx * d, pz = z + dz * d;
    if (!t.inside(px, pz)) break;
    if (t.heightAt(px, pz) > h0 + d * tan) return 0;
  }
  return 1;
}
