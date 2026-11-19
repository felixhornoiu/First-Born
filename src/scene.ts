import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Terrain } from './terrain';
import { GRID } from './weather';
import { BUILDING_FRAG, BUILDING_VERT, CLOUD_FRAG, CLOUD_VERT, QUAD_VERT, SHADOW_FRAG, SKY_FRAG, SKY_VERT, TERRAIN_FRAG, TERRAIN_VERT } from './shaders';
import { DSM_SIZE, type City } from './city';

const FAR_EXAG = 1.6;           // vertical exaggeration when zoomed out (display only; shadows use true heights)
const CLOUD_ALT = 2600;         // nominal cloud deck altitude, metres

export class SunScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private shadowScene = new THREE.Scene();
  private shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private shadowRT: THREE.WebGLRenderTarget;
  private shadowMat: THREE.ShaderMaterial;
  private terrainMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private clouds: THREE.Mesh;
  private weatherTex: THREE.DataTexture;
  private weatherData = new Uint8Array(GRID * GRID * 4);
  private sunDirty = true;
  private flyExag = 1;
  private dirty = true;
  private lastRender = 0;
  private slow = 0;
  private ratio = Math.min(devicePixelRatio, 2);
  /** Ask for a redraw; the scene only renders when something changed. */
  invalidate() { this.dirty = true; }
  private shared: Record<string, THREE.IUniform>;
  /** Current vertical exaggeration: 1 near the city, larger when the whole region is in view. */
  exag = 1;
  private fly: { t: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Vector3; q1: THREE.Vector3 } | null = null;
  /** Runs every animation tick, before deciding whether to draw. */
  onTick: () => void = () => {};
  /** Runs after each drawn frame. */
  onFrame: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, private terrain: Terrain) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false }));
    r.setPixelRatio(this.ratio);
    r.setClearColor(0x08090b);
    r.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders output display-ready colour

    const t = terrain;
    const height = new THREE.DataTexture(t.heights, t.w, t.h, THREE.RedFormat, THREE.FloatType);
    height.minFilter = height.magFilter = THREE.LinearFilter;
    height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping;
    height.needsUpdate = true;

    this.weatherTex = new THREE.DataTexture(this.weatherData, GRID, GRID, THREE.RGBAFormat);
    this.weatherTex.minFilter = this.weatherTex.magFilter = THREE.LinearFilter;
    this.weatherTex.needsUpdate = true;

    const size = new THREE.Vector2(t.sizeX, t.sizeY);
    const sun = new THREE.Vector3(0, 1, 0);
    const drift = new THREE.Vector2();
    const shared: Record<string, THREE.IUniform> = (this.shared = {
      uSun: { value: sun }, uSize: { value: size }, uWeather: { value: this.weatherTex },
      uGrid: { value: GRID }, uDrift: { value: drift }, uHeight: { value: height },
      uShadow: { value: null }, uDsm: { value: null }, uCity: { value: new THREE.Vector3() }, uHasCity: { value: 0 },
      uOvercast: { value: 0 }, uCloudAlt: { value: CLOUD_ALT }, uClouds: { value: 1 },
      uExag: { value: 1 }, uMinH: { value: t.minH },
    });

    // Terrain shadow map, re-rendered only when the sun moves.
    this.shadowRT = new THREE.WebGLRenderTarget(t.w, t.h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: SHADOW_FRAG, depthTest: false,
      uniforms: { uHeight: { value: height }, uSun: shared.uSun, uSize: shared.uSize, uMaxH: { value: t.maxH } },
    });
    this.shadowScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shadowMat));
    shared.uShadow.value = this.shadowRT.texture;

    // Terrain grid (displaced in the vertex shader).
    const seg = 640, n = seg + 1;
    const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, u = i / seg, v = j / seg;
      pos[k * 3] = (u - 0.5) * t.sizeX; pos[k * 3 + 2] = (v - 0.5) * t.sizeY;
      uv[k * 2] = u; uv[k * 2 + 1] = v;
    }
    const idx = new Uint32Array(seg * seg * 6);
    for (let j = 0, q = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
      uniforms: {
        ...shared, uTexel: { value: new THREE.Vector2(1 / t.w, 1 / t.h) }, uMap: { value: null }, uHasMap: { value: 0 }, uCityMap: { value: null }, uHasCityMap: { value: 0 },
      },
    });
    // Baked ground colours for the region and, in finer detail, the city (both optional).
    const loadMap = (file: string, uniform: string, flag: string) =>
      new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}data/${file}`, (map) => {
        map.flipY = false;
        map.colorSpace = THREE.NoColorSpace;
        map.anisotropy = r.capabilities.getMaxAnisotropy();
        map.needsUpdate = true;
        this.terrainMat.uniforms[uniform].value = map;
        this.terrainMat.uniforms[flag].value = 1;
        this.dirty = true;
      }, undefined, () => {});
    loadMap('map.webp', 'uMap', 'uHasMap');
    loadMap('city-map.webp', 'uCityMap', 'uHasCityMap');
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    // Translucent cloud deck using the same mask as the ground shadows.
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, uOpacity: { value: 0.26 } },
    });
    const cg = new THREE.PlaneGeometry(t.sizeX, t.sizeY).rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cg, this.cloudMat);
    this.scene.add(this.clouds);

    const sky = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: shared, side: THREE.BackSide, depthWrite: false, depthTest: false,
    }));
    sky.frustumCulled = false; sky.renderOrder = -1;
    this.scene.add(sky);

    this.camera = new THREE.PerspectiveCamera(38, 1, 5, 200000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 120;
    this.controls.maxDistance = 60000;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => (this.fly = null));

    addEventListener('resize', () => this.resize());
    this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  /** World-space display position for a ground point. */
  display(x: number, z: number, lift = 0): THREE.Vector3 {
    return new THREE.Vector3(x, (this.terrain.heightAt(x, z) - this.terrain.minH + lift) * this.exag, z);
  }

  /** Adds the extruded buildings and switches on their shadows. */
  addCity(city: City) {
    const dsm = new THREE.DataTexture(city.dsm, DSM_SIZE, DSM_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    dsm.minFilter = dsm.magFilter = THREE.LinearFilter;
    dsm.needsUpdate = true;
    this.shared.uDsm.value = dsm;
    (this.shared.uCity.value as THREE.Vector3).set(city.cx, city.cz, city.half);
    this.shared.uHasCity.value = 1;
    const mesh = new THREE.Mesh(city.geometry, new THREE.ShaderMaterial({
      vertexShader: BUILDING_VERT, fragmentShader: BUILDING_FRAG, uniforms: this.shared, side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.dirty = true;
  }

  private exagFor(dist: number) {
    const k = Math.min(Math.max((dist - 9000) / 13000, 0), 1);
    return 1 + (FAR_EXAG - 1) * k * k * (3 - 2 * k);
  }

  setView(x: number, z: number, dist: number, azimuthDeg: number, pitchDeg: number, animate = true) {
    // Lay the view out for the exaggeration it will end up with; frame() rescales heights on the way.
    const target = this.display(x, z);
    target.y *= this.exagFor(dist) / this.exag;
    const a = (azimuthDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
    // azimuth = compass bearing the camera looks towards
    const off = new THREE.Vector3(-Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)).multiplyScalar(dist);
    const position = target.clone().add(off);
    if (!animate) {
      this.exag = this.exagFor(dist);
      this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update();
    } else {
      this.flyExag = this.exagFor(dist);
      this.fly = { t: 0, p0: this.camera.position.clone(), p1: position, q0: this.controls.target.clone(), q1: target };
    }
  }

  /** Bearing (deg) the camera currently looks towards. */
  get bearing(): number {
    const d = this.controls.target.clone().sub(this.camera.position);
    return (Math.atan2(d.x, -d.z) * 180) / Math.PI;
  }

  setSun(dir: [number, number, number]) {
    (this.terrainMat.uniforms.uSun.value as THREE.Vector3).set(...dir);
    this.sunDirty = true;
    this.dirty = true;
  }

  setOvercast(v: number) { this.shared.uOvercast.value = v; this.dirty = true; }

  setWeather(cover: Float32Array | null, driftX: number, driftZ: number) {
    for (let i = 0; i < GRID * GRID; i++) this.weatherData[i * 4] = cover ? Math.round(cover[i] * 255) : 0;
    this.weatherTex.needsUpdate = true;
    (this.terrainMat.uniforms.uDrift.value as THREE.Vector2).set(driftX, driftZ);
    this.dirty = true;
  }

  setCloudsVisible(v: boolean) { this.clouds.visible = v; this.dirty = true; }

  /** Intersect a screen point with the terrain; returns the world x/z or null. */
  pick(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0.5);
    const o = this.camera.position, d = ndc.unproject(this.camera).sub(o).normalize();
    const t = this.terrain;
    let s = 0, prev = 0;
    for (let i = 0; i < 1400; i++) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (t.inside(x, z) && y < (t.heightAt(x, z) - t.minH) * this.exag) {
        const m = (prev + s) / 2;
        return { x: o.x + d.x * m, z: o.z + d.z * m };
      }
      prev = s; s += 4 + s * 0.012;
      if (s > 120000) break;
    }
    return null;
  }

  /** Project a display-space point to CSS pixels; null when behind the camera. */
  project(v: THREE.Vector3): { x: number; y: number } | null {
    const p = v.clone().project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    const c = this.renderer.domElement;
    return { x: (p.x * 0.5 + 0.5) * c.clientWidth, y: (-p.y * 0.5 + 0.5) * c.clientHeight };
  }

  private resize() {
    const c = this.renderer.domElement, w = c.clientWidth, h = c.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  private frame() {
    this.onTick();
    if (this.fly) {
      const f = this.fly; f.t = Math.min(f.t + 1 / 55, 1);
      const k = 1 - Math.pow(1 - f.t, 4);
      this.camera.position.lerpVectors(f.p0, f.p1, k);
      this.controls.target.lerpVectors(f.q0, f.q1, k);
      if (f.t >= 1) this.fly = null;
    }
    const moved = this.controls.update();
    // Ease the vertical exaggeration with distance, keeping the camera and target on the same ground.
    const dist = this.camera.position.distanceTo(this.controls.target);
    const want = this.fly ? this.exag + (this.flyExag - this.exag) * 0.08 : this.exagFor(dist);
    if (Math.abs(want - this.exag) > 1e-4) {
      if (!this.fly) {
        const k = want / this.exag;
        this.camera.position.y *= k; this.controls.target.y *= k;
      }
      this.exag = want;
      this.dirty = true;
    }
    if (!moved && !this.dirty && !this.fly) return;
    this.dirty = false;
    // If consecutive frames are slow, trade resolution for smoothness.
    const now = performance.now(), dt = now - this.lastRender;
    this.lastRender = now;
    if (dt < 200) {
      this.slow = dt > 45 ? this.slow + 1 : Math.max(this.slow - 1, 0);
      if (this.slow > 20 && this.ratio > 0.75) {
        this.ratio = Math.max(this.ratio - 0.25, 0.75); this.slow = 0;
        this.renderer.setPixelRatio(this.ratio); this.resize();
      }
    }
    this.shared.uExag.value = this.exag;
    this.clouds.position.y = (CLOUD_ALT - this.terrain.minH) * this.exag;
    this.camera.near = Math.max(2, dist * 0.01);
    this.camera.far = dist * 6 + 90000;
    this.camera.updateProjectionMatrix();
    if (this.sunDirty) {
      this.renderer.setRenderTarget(this.shadowRT);
      this.renderer.render(this.shadowScene, this.shadowCam);
      this.renderer.setRenderTarget(null);
      this.sunDirty = false;
    }
    this.renderer.render(this.scene, this.camera);
    this.onFrame();
  }
}
