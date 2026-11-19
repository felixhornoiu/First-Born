export const NOISE = /* glsl */ `
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.7; a *= 0.5; }
  return s / 0.96875;
}
uniform sampler2D uWeather; // GRID x GRID effective cloud cover
uniform float uGrid;
uniform vec2 uSize;         // terrain extent in metres
uniform vec2 uDrift;        // cloud pattern offset in metres
// Fraction of direct sun blocked by cloud above world position xz (metres).
float cloudMask(vec2 xz){
  vec2 uv = clamp(xz / uSize + 0.5, 0.0, 1.0);
  float cover = texture2D(uWeather, uv * (uGrid - 1.0) / uGrid + 0.5 / uGrid).r;
  float n = fbm((xz - uDrift) / 4200.0);
  float th = 0.80 - 0.62 * cover;
  float m = smoothstep(th - 0.07, th + 0.07, n);
  return max(m * smoothstep(0.02, 0.12, cover), smoothstep(0.88, 1.0, cover));
}
`;

// Full-screen pass: for every terrain texel, march towards the sun over the heightfield.
export const SHADOW_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uHeight;
uniform vec3 uSun;
uniform vec2 uSize;
uniform float uMaxH;
varying vec2 vUv;
void main(){
  if (uSun.y <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float h0 = texture2D(uHeight, vUv).r + 2.0;
  float hl = max(length(uSun.xz), 1e-4);
  float tanAlt = uSun.y / hl;
  vec2 dirUv = (uSun.xz / hl) / uSize;
  float tMax = min((uMaxH - h0) / tanAlt, 26000.0);
  float lit = 1.0;
  for (int i = 1; i <= 220; i++) {
    float f = float(i) / 220.0;
    float t = 20.0 + tMax * pow(f, 1.4);
    vec2 p = vUv + dirUv * t;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) break;
    float clear = h0 + t * tanAlt - texture2D(uHeight, p).r;
    float w = max(t * 0.006, 2.0); // penumbra from the sun's angular size
    lit = min(lit, smoothstep(-w, w, clear));
    if (lit <= 0.0) break;
  }
  gl_FragColor = vec4(lit, lit, lit, 1.0);
}`;

// Sky colour, haze and building shadows shared by the terrain and building shaders.
export const LIGHT = /* glsl */ `
uniform sampler2D uHeight, uShadow, uDsm;
uniform vec3 uSun;
uniform vec3 uCity;      // centre x, centre z, half size (metres)
uniform float uHasCity, uOvercast, uCloudAlt, uClouds;

vec3 skyColor(vec3 dir){
  float day = smoothstep(-0.08, 0.12, uSun.y);
  vec3 zen = mix(vec3(0.012, 0.016, 0.035), vec3(0.16, 0.33, 0.62), day);
  vec3 hor = mix(vec3(0.03, 0.04, 0.07), vec3(0.58, 0.69, 0.80), day);
  float dusk = smoothstep(0.30, 0.02, uSun.y) * smoothstep(-0.12, 0.0, uSun.y);
  vec3 sunDir = normalize(vec3(uSun.x, 0.0, uSun.z) + 1e-5);
  float toward = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z) + 1e-5), sunDir), 0.0), 3.0);
  hor = mix(hor, vec3(1.0, 0.52, 0.26), dusk * (0.25 + 0.6 * toward));
  vec3 c = mix(hor, zen, pow(clamp(dir.y, 0.0, 1.0), 0.45));
  c = mix(c, mix(vec3(0.05, 0.055, 0.065), vec3(0.50, 0.52, 0.55), day), uOvercast * 0.85);
  c += vec3(1.0, 0.9, 0.7) * pow(max(dot(dir, uSun), 0.0), 900.0) * 3.0 * (1.0 - uOvercast) * step(0.0, uSun.y);
  c += vec3(1.0, 0.75, 0.5) * pow(max(dot(dir, uSun), 0.0), 24.0) * 0.16 * (1.0 - uOvercast) * day;
  return mix(c, vec3(0.025, 0.03, 0.04), smoothstep(0.0, -0.22, dir.y));
}

// Sharp shadows from buildings: march the building-height raster towards the sun.
float cityLit(vec3 p){
  if (uHasCity < 0.5 || uSun.y <= 0.0) return 1.0;
  float lit = 1.0, t = 1.5;
  for (int i = 0; i < 64; i++) {
    vec3 q = p + uSun * t;
    vec2 c = (q.xz - uCity.xy) / (2.0 * uCity.z) + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0) break;
    float above = q.y - texture2D(uHeight, q.xz / uSize + 0.5).r;
    if (above > 85.0) break;
    float b = texture2D(uDsm, c).r * 85.0;
    if (b > 0.3) {
      float w = max(t * 0.012, 0.4);
      lit = min(lit, smoothstep(-w, w, above - b));
      if (lit <= 0.0) break;
    }
    t += max(1.5, t * 0.06);
  }
  return lit;
}

// Direct sun reaching point p (true metres): terrain shadow map x buildings x cloud.
vec2 sunAt(vec3 p){
  vec2 uv = p.xz / uSize + 0.5;
  vec2 cp = p.xz + uSun.xz / max(uSun.y, 0.12) * max(uCloudAlt - p.y, 0.0);
  float cloud = uClouds * cloudMask(cp);
  float day = smoothstep(-0.05, 0.10, uSun.y);
  return vec2(texture2D(uShadow, uv).r * cityLit(p) * (1.0 - 0.9 * cloud) * day, cloud);
}

vec3 shade(vec3 albedo, vec3 n, float ndl, vec2 sc){
  float day = smoothstep(-0.05, 0.10, uSun.y);
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.36), vec3(1.0, 0.95, 0.84), smoothstep(0.03, 0.35, uSun.y));
  vec3 sky = mix(vec3(0.035, 0.05, 0.09), vec3(0.26, 0.33, 0.46), day);
  sky = mix(sky, vec3(0.42, 0.44, 0.47), sc.y * day * 0.6);
  vec3 col = albedo * (sky * (0.55 + 0.45 * n.y) + sunCol * sc.x * (0.35 + 1.05 * ndl));
  // Warm wash on everything in direct sun so sunny ground reads at a glance.
  return mix(col, col * vec3(1.16, 1.06, 0.82) + vec3(0.05, 0.035, 0.0), sc.x * 0.7);
}

vec3 finish(vec3 col, vec3 world){
  vec3 v = world - cameraPosition;
  float d = length(v);
  col = mix(col, skyColor(normalize(vec3(v.x, 0.02, v.z))), 1.0 - exp(-d / 110000.0));
  col = 1.0 - exp(-col * 1.5); // soft shoulder so sunlit surfaces never clip
  return pow(col, vec3(1.0 / 2.2));
}
`;

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const TERRAIN_VERT = /* glsl */ `
uniform sampler2D uHeight;
uniform float uExag, uMinH;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vDisplay;
void main(){
  vUv = uv;
  float h = texture2D(uHeight, uv).r;
  vWorld = vec3(position.x, h, position.z);
  vDisplay = vec3(position.x, (h - uMinH) * uExag, position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vDisplay, 1.0);
}`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap, uCityMap;
uniform float uHasMap, uHasCityMap;
uniform vec2 uTexel;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vDisplay;
${NOISE}
${LIGHT}
void main(){
  float h = vWorld.y;
  vec2 cell = uSize * uTexel;
  float hx = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;
  float hz = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r - texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
  vec3 n = normalize(vec3(-hx / (2.0 * cell.x), 1.0, -hz / (2.0 * cell.y)));
  float slope = 1.0 - n.y;

  // Stylised land cover: pale valley floor, forested slopes, bare alpine tops.
  vec3 valley = vec3(0.66, 0.64, 0.57), forest = vec3(0.30, 0.42, 0.27), alpine = vec3(0.74, 0.72, 0.66);
  float wood = smoothstep(0.012, 0.07, slope) * (1.0 - smoothstep(1500.0, 1750.0, h));
  wood = max(wood, smoothstep(700.0, 900.0, h) * (1.0 - smoothstep(1500.0, 1750.0, h)) * 0.85);
  vec3 albedo = mix(valley, forest, wood);
  albedo = mix(albedo, alpine, smoothstep(1500.0, 1780.0, h));
  // Baked ground colours (npm run bake:ground): streets, land use, water.
  if (uHasMap > 0.5) {
    albedo = pow(texture2D(uMap, vUv).rgb, vec3(2.2));
    albedo = mix(albedo, alpine, smoothstep(1650.0, 1800.0, h) * 0.6);
  }
  if (uHasCityMap > 0.5) {
    vec2 c = (vWorld.xz - uCity.xy) / (2.0 * uCity.z) + 0.5;
    vec2 e = min(c, 1.0 - c);
    float inside = smoothstep(0.0, 0.03, min(e.x, e.y));
    if (inside > 0.0) albedo = mix(albedo, pow(texture2D(uCityMap, c).rgb, vec3(2.2)), inside);
  }
  // Canopy texture on anything green, fine grain everywhere else.
  float green = smoothstep(0.02, 0.10, albedo.g - max(albedo.r, albedo.b));
  albedo *= mix(0.95 + 0.10 * vnoise(vWorld.xz / 90.0), 0.72 + 0.5 * vnoise(vWorld.xz / 7.0) * (0.6 + 0.4 * vnoise(vWorld.xz / 37.0)), green);

  float ndl = max(dot(n, uSun), 0.0);
  vec2 sc = sunAt(vWorld + vec3(0.0, 0.4, 0.0));
  sc.x *= smoothstep(0.0, 0.06, ndl);
  vec3 col = shade(albedo, n, ndl, sc);

  // 100 m contours
  float c = abs(fract(h / 100.0 - 0.5) - 0.5) / (fwidth(h / 100.0) + 1e-5);
  col *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 1.2, c));

  // Fade the slab edge
  vec2 e = min(vUv, 1.0 - vUv);
  col *= 0.35 + 0.65 * smoothstep(0.0, 0.012, min(e.x, e.y));
  gl_FragColor = vec4(finish(col, vDisplay), 1.0);
}`;

export const BUILDING_VERT = /* glsl */ `
uniform float uExag, uMinH;
attribute float aBase;
attribute vec3 color;
varying vec3 vWorld;
varying vec3 vDisplay;
varying vec3 vColor;
varying float vUp;
void main(){
  vColor = color;
  vUp = position.y;
  vWorld = vec3(position.x, aBase + position.y, position.z);
  vDisplay = vec3(position.x, (vWorld.y - uMinH) * uExag, position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(vDisplay, 1.0);
}`;

export const BUILDING_FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vDisplay;
varying vec3 vColor;
varying float vUp;
${NOISE}
${LIGHT}
void main(){
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld))); // flat normal, facing the camera
  vec3 albedo = vColor;
  vec3 glow = vec3(0.0);
  float wall = 1.0 - smoothstep(0.25, 0.4, abs(n.y));
  if (wall > 0.0) {
    // Procedural windows: one per 2.5 m along the facade, one row per storey.
    vec2 cell = vec2(dot(vWorld.xz, normalize(vec2(-n.z, n.x) + 1e-5)) / 2.5, vUp / 3.1);
    vec2 f = fract(cell);
    float win = step(0.27, f.x) * step(f.x, 0.73) * step(0.32, f.y) * step(f.y, 0.80) * step(0.3, vUp);
    win *= wall * (1.0 - smoothstep(0.2, 0.55, max(fwidth(cell.x), fwidth(cell.y))));
    albedo = mix(albedo, vec3(0.13, 0.17, 0.23), win * 0.8);
    float on = step(0.62, hash(floor(cell) + floor(vWorld.xz * 0.05)));
    glow = vec3(1.0, 0.74, 0.38) * win * on * (1.0 - smoothstep(-0.10, 0.04, uSun.y)) * 0.9;
    albedo *= 0.92 + 0.08 * smoothstep(0.0, 2.5, vUp); // slightly darker plinth
  } else {
    albedo *= 0.9 + 0.2 * vnoise(vWorld.xz * 1.3);
  }
  float ndl = max(dot(n, uSun), 0.0);
  // Start the shadow ray clear of the building's own footprint in the height raster.
  vec3 origin = vWorld + vec3(n.x, 0.0, n.z) * 2.6 + vec3(0.0, 0.9, 0.0);
  vec2 sc = sunAt(origin);
  sc.x *= smoothstep(0.0, 0.08, ndl);
  vec3 col = shade(albedo, n, ndl, sc) + glow;
  gl_FragColor = vec4(finish(col, vDisplay), 1.0);
}`;

export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
${NOISE}
${LIGHT}
void main(){
  vec3 c = skyColor(normalize(vDir));
  gl_FragColor = vec4(pow(1.0 - exp(-c * 1.5), vec3(1.0 / 2.2)), 1.0);
}`;

export const CLOUD_VERT = /* glsl */ `
varying vec2 vXZ;
void main(){ vXZ = position.xz; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;

export const CLOUD_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSun;
uniform float uOpacity;
varying vec2 vXZ;
${NOISE}
void main(){
  float m = cloudMask(vXZ);
  vec2 e = min(vXZ / uSize + 0.5, 0.5 - vXZ / uSize);
  float edge = smoothstep(0.0, 0.05, min(e.x, e.y));
  float day = smoothstep(-0.05, 0.10, uSun.y);
  vec3 col = mix(vec3(0.16, 0.18, 0.23), vec3(0.96, 0.97, 1.0), day);
  gl_FragColor = vec4(col, m * edge * uOpacity);
}`;
