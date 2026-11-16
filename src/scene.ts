import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Terrain } from './terrain';
import { GRID } from './weather';
import { CLOUD_FRAG, CLOUD_VERT, QUAD_VERT, SHADOW_FRAG, TERRAIN_FRAG, TERRAIN_VERT } from './shaders';

export const EXAG = 1.6;        // vertical exaggeration (display only; shadows use true heights)
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
  private fly: { t: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Vector3; q1: THREE.Vector3 } | null = null;
  onFrame: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, private terrain: Terrain) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
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
    const shared = {
      uSun: { value: sun }, uSize: { value: size }, uWeather: { value: this.weatherTex },
      uGrid: { value: GRID }, uDrift: { value: drift },
    };

    // Terrain shadow map, re-rendered only when the sun moves.
    this.shadowRT = new THREE.WebGLRenderTarget(t.w, t.h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: SHADOW_FRAG, depthTest: false,
      uniforms: { uHeight: { value: height }, uSun: shared.uSun, uSize: shared.uSize, uMaxH: { value: t.maxH } },
    });
    this.shadowScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.shadowMat));

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
        ...shared, uHeight: { value: height }, uShadow: { value: this.shadowRT.texture },
        uTexel: { value: new THREE.Vector2(1 / t.w, 1 / t.h) }, uExag: { value: EXAG }, uMinH: { value: t.minH },
        uCloudAlt: { value: CLOUD_ALT }, uClouds: { value: 1 }, uMap: { value: null }, uHasMap: { value: 0 },
      },
    });
    // Ground colours baked from OpenStreetMap, when present.
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}data/map.png`, (map) => {
      map.flipY = false;
      map.colorSpace = THREE.NoColorSpace;
      map.anisotropy = r.capabilities.getMaxAnisotropy();
      map.needsUpdate = true;
      this.terrainMat.uniforms.uMap.value = map;
      this.terrainMat.uniforms.uHasMap.value = 1;
    }, undefined, () => {});
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
    this.clouds.position.y = (CLOUD_ALT - t.minH) * EXAG;
    this.scene.add(this.clouds);

    this.camera = new THREE.PerspectiveCamera(38, 1, 50, 200000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 800;
    this.controls.maxDistance = 60000;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('start', () => (this.fly = null));

    addEventListener('resize', () => this.resize());
    this.resize();
    r.setAnimationLoop(() => this.frame());
  }

  /** World-space display position for a ground point. */
  display(x: number, z: number, lift = 0): THREE.Vector3 {
    return new THREE.Vector3(x, (this.terrain.heightAt(x, z) - this.terrain.minH) * EXAG + lift, z);
  }

  setView(x: number, z: number, dist: number, azimuthDeg: number, pitchDeg: number, animate = true) {
    const target = this.display(x, z);
    const a = (azimuthDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
    // azimuth = compass bearing the camera looks towards
    const off = new THREE.Vector3(-Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p)).multiplyScalar(dist);
    const position = target.clone().add(off);
    if (!animate) {
      this.camera.position.copy(position); this.controls.target.copy(target); this.controls.update();
    } else {
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
  }

  setWeather(cover: Float32Array | null, driftX: number, driftZ: number) {
    for (let i = 0; i < GRID * GRID; i++) this.weatherData[i * 4] = cover ? Math.round(cover[i] * 255) : 0;
    this.weatherTex.needsUpdate = true;
    (this.terrainMat.uniforms.uDrift.value as THREE.Vector2).set(driftX, driftZ);
  }

  setCloudsVisible(v: boolean) { this.clouds.visible = v; }

  /** Intersect a screen point with the terrain; returns the world x/z or null. */
  pick(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0.5);
    const o = this.camera.position, d = ndc.unproject(this.camera).sub(o).normalize();
    const t = this.terrain;
    let s = 0, prev = 0;
    for (let i = 0; i < 900; i++) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      if (t.inside(x, z) && y < (t.heightAt(x, z) - t.minH) * EXAG) {
        const m = (prev + s) / 2;
        return { x: o.x + d.x * m, z: o.z + d.z * m };
      }
      prev = s; s += 25 + s * 0.012;
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
  }

  private frame() {
    if (this.fly) {
      const f = this.fly; f.t = Math.min(f.t + 1 / 55, 1);
      const k = 1 - Math.pow(1 - f.t, 4);
      this.camera.position.lerpVectors(f.p0, f.p1, k);
      this.controls.target.lerpVectors(f.q0, f.q1, k);
      if (f.t >= 1) this.fly = null;
    }
    this.controls.update();
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
