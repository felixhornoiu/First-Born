// Solar position (same low-precision astronomy as SunCalc; good to ~0.1°).
const rad = Math.PI / 180;
const e = rad * 23.4397;

export interface SunPos {
  altitude: number; // radians above the horizon
  azimuth: number;  // radians, 0 = north, clockwise (π/2 = east)
  /** Unit vector pointing at the sun in world space (x east, y up, z south). */
  dir: [number, number, number];
}

export function sunPosition(ms: number, lat: number, lon: number): SunPos {
  const d = ms / 86400000 - 0.5 + 2440588 - 2451545;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(e));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const phi = rad * lat;
  const H = rad * (280.16 + 360.9856235 * d) + rad * lon - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // azS: measured from south, positive towards west
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const ca = Math.cos(altitude);
  return {
    altitude,
    azimuth: (azS + Math.PI + 2 * Math.PI) % (2 * Math.PI),
    dir: [-Math.sin(azS) * ca, Math.sin(altitude), Math.cos(azS) * ca],
  };
}
