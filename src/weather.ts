import type { Terrain } from './terrain';
import { HOUR } from './time';

export const GRID = 4; // GRID x GRID forecast points across the map
export const PAST_DAYS = 2;
export const FORECAST_DAYS = 7;

export interface WeatherSample {
  cover: number;   // 0..1 effective sun-blocking cloud
  low: number; mid: number; high: number; // 0..1 cloud layers
  temp: number;    // °C
  precip: number;  // mm/h
  wind: number;    // km/h
}

const VARS = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'temperature_2m', 'precipitation', 'wind_speed_10m', 'wind_direction_10m'] as const;
type Var = (typeof VARS)[number];
interface Point { hourly: Record<Var, (number | null)[]> & { time: number[] } }

/** How much direct sun a stack of cloud layers blocks. Thin high cloud barely matters. */
export const effectiveCover = (low: number, mid: number, high: number) =>
  1 - (1 - low) * (1 - 0.8 * mid) * (1 - 0.35 * high);

export class Weather {
  readonly times: number[];
  /** Mean wind vector over the period (m/s, world axes) used to drift the cloud pattern. */
  readonly drift: [number, number];
  constructor(private pts: Point[], private terrain: Terrain, readonly fetchedAt: number) {
    this.times = pts[0].hourly.time.map((s) => s * 1000);
    let wx = 0, wz = 0, n = 0;
    const h = pts[0].hourly;
    for (let i = 0; i < this.times.length; i++) {
      const sp = h.wind_speed_10m[i], dr = h.wind_direction_10m[i];
      if (sp == null || dr == null) continue;
      const a = (dr * Math.PI) / 180; // direction the wind comes FROM, clockwise from north
      wx += -Math.sin(a) * sp / 3.6; wz += Math.cos(a) * sp / 3.6; n++;
    }
    this.drift = n ? [wx / n, wz / n] : [3, 0];
  }

  get start() { return this.times[0]; }
  get end() { return this.times[this.times.length - 1]; }

  private at(p: Point, v: Var, t: number): number {
    const f = Math.min(Math.max((t - this.start) / HOUR, 0), this.times.length - 1.001);
    const i = f | 0, k = f - i, a = p.hourly[v];
    return (a[i] ?? 0) * (1 - k) + (a[i + 1] ?? a[i] ?? 0) * k;
  }

  private pointSample(p: Point, t: number): WeatherSample {
    const low = this.at(p, 'cloud_cover_low', t) / 100, mid = this.at(p, 'cloud_cover_mid', t) / 100, high = this.at(p, 'cloud_cover_high', t) / 100;
    return {
      low, mid, high, cover: effectiveCover(low, mid, high),
      temp: this.at(p, 'temperature_2m', t), precip: this.at(p, 'precipitation', t), wind: this.at(p, 'wind_speed_10m', t),
    };
  }

  /** Effective cloud cover on the GRID x GRID lattice (row 0 = north) at time t. */
  coverGrid(t: number, out = new Float32Array(GRID * GRID)): Float32Array {
    for (let i = 0; i < out.length; i++) out[i] = this.pointSample(this.pts[i], t).cover;
    return out;
  }

  /** Bilinear blend of the forecast points at a world position. */
  sample(x: number, z: number, t: number): WeatherSample {
    const fx = Math.min(Math.max((x / this.terrain.sizeX + 0.5) * (GRID - 1), 0), GRID - 1.001);
    const fz = Math.min(Math.max((z / this.terrain.sizeY + 0.5) * (GRID - 1), 0), GRID - 1.001);
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const s = [this.pts[j * GRID + i], this.pts[j * GRID + i + 1], this.pts[(j + 1) * GRID + i], this.pts[(j + 1) * GRID + i + 1]]
      .map((p) => this.pointSample(p, t));
    const w = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
    const mix = (k: keyof WeatherSample) => s.reduce((a, v, n) => a + v[k] * w[n], 0);
    return { cover: mix('cover'), low: mix('low'), mid: mix('mid'), high: mix('high'), temp: mix('temp'), precip: mix('precip'), wind: mix('wind') };
  }
}

const CACHE_KEY = 'brasov-sun:weather:v1';
const CACHE_MS = 30 * 60_000;

export async function loadWeather(terrain: Terrain): Promise<Weather> {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (c && Date.now() - c.at < CACHE_MS) return new Weather(c.pts, terrain, c.at);
  } catch { /* ignore a corrupt cache */ }

  const m = terrain.meta, lats: string[] = [], lons: string[] = [];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    lats.push((m.north + (m.south - m.north) * (j / (GRID - 1))).toFixed(4));
    lons.push((m.west + (m.east - m.west) * (i / (GRID - 1))).toFixed(4));
  }
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&hourly=${VARS.join(',')}&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timeformat=unixtime&timezone=GMT`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open-Meteo responded ${r.status}`);
  const pts = (await r.json()) as Point[];
  if (!Array.isArray(pts) || pts.length !== GRID * GRID) throw new Error('Unexpected Open-Meteo response');
  const at = Date.now();
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at, pts })); } catch { /* storage full or blocked */ }
  return new Weather(pts, terrain, at);
}
