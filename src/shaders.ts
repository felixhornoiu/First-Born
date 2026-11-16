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

export const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const TERRAIN_VERT = /* glsl */ `
uniform sampler2D uHeight;
uniform float uExag, uMinH;
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  vUv = uv;
  float h = texture2D(uHeight, uv).r;
  vWorld = vec3(position.x, h, position.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(position.x, (h - uMinH) * uExag, position.z, 1.0);
}`;

export const TERRAIN_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uHeight, uShadow, uMap;
uniform float uHasMap;
uniform vec3 uSun;
uniform vec2 uTexel;
uniform float uCloudAlt, uClouds;
varying vec2 vUv;
varying vec3 vWorld;
${NOISE}
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
  // Optional OpenStreetMap ground colours (npm run bake:map)
  if (uHasMap > 0.5) albedo = pow(texture2D(uMap, vUv).rgb, vec3(2.2));
  albedo *= 0.94 + 0.12 * vnoise(vWorld.xz / 90.0);

  float day = smoothstep(-0.05, 0.10, uSun.y);
  float ndl = max(dot(n, uSun), 0.0);
  float terr = texture2D(uShadow, vUv).r * smoothstep(0.0, 0.06, ndl);
  // Cloud shadow: where the ray from this point to the sun crosses the cloud deck.
  vec2 cp = vWorld.xz + uSun.xz / max(uSun.y, 0.12) * max(uCloudAlt - h, 0.0);
  float cloud = uClouds * cloudMask(cp);
  float sun = terr * (1.0 - 0.9 * cloud) * day;

  vec3 sunCol = mix(vec3(1.0, 0.62, 0.36), vec3(1.0, 0.95, 0.84), smoothstep(0.03, 0.35, uSun.y));
  vec3 sky = mix(vec3(0.035, 0.05, 0.09), vec3(0.26, 0.33, 0.46), day);
  sky = mix(sky, vec3(0.42, 0.44, 0.47), cloud * day * 0.6);
  vec3 col = albedo * (sky * (0.55 + 0.45 * n.y) + sunCol * sun * (0.35 + 1.05 * ndl));
  // Warm wash on everything in direct sun so sunny ground reads at a glance.
  col = mix(col, col * vec3(1.16, 1.06, 0.82) + vec3(0.05, 0.035, 0.0), sun * 0.7);

  // 100 m contours
  float c = abs(fract(h / 100.0 - 0.5) - 0.5) / (fwidth(h / 100.0) + 1e-5);
  col *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 1.2, c));

  // Fade the slab edge
  vec2 e = min(vUv, 1.0 - vUv);
  col *= 0.35 + 0.65 * smoothstep(0.0, 0.012, min(e.x, e.y));
  col = 1.0 - exp(-col * 1.5); // soft shoulder so sunlit ground never clips
  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
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
