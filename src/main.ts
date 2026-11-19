import './style.css';
import { Terrain } from './terrain';
import { sunPosition, type SunPos } from './sun';
import { terrainLit } from './shadow';
import { SunScene } from './scene';
import { City } from './city';
import { FORECAST_DAYS, PAST_DAYS, loadWeather, type Weather } from './weather';
import { PLACES, type Place } from './places';
import { DAY, HOUR, fmtDate, fmtLong, fmtTime, fmtWeekday, localMidnight } from './time';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const BINS = 144, BIN = DAY / BINS;
const COL = { sun: [255, 200, 87], cloud: [124, 130, 141], shade: [61, 80, 120], night: [22, 24, 29] };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface Spot extends Place { x: number; z: number; elev: number; row: HTMLButtonElement; marker: HTMLDivElement }
interface DayData { up: Uint8Array; lit: Uint8Array; cover: Float32Array; sunHours: number; window: [number, number] | null }
type Status = 'night' | 'shade' | 'cloud' | 'part' | 'sun';

async function main() {
  const terrain = await Terrain.load();
  const scene = new SunScene($<HTMLCanvasElement>('gl'), terrain);
  const [cLat, cLon] = terrain.toGeo(0, 0);
  const sunAt = (ms: number) => sunPosition(ms, cLat, cLon);

  let weather: Weather | null = null;
  let city: City | null = null;
  let weatherRev = 0;
  const now = Date.now();
  const today = localMidnight(now);
  const days = Array.from({ length: PAST_DAYS + FORECAST_DAYS }, (_, i) => localMidnight(today + (i - PAST_DAYS) * DAY + 12 * HOUR));
  const tMin = days[0], tMax = days[days.length - 1] + DAY - 60_000;
  let time = now;
  let playing = false;
  let selected = 'sfatului';
  let mode: 'city' | 'region' = 'city';
  const shown = (s: Spot) => mode === 'region' || !city || city.inside(s.x, s.z);

  // ---- places -------------------------------------------------------------
  const list = $('places'), markers = $('markers');
  const spots: Spot[] = PLACES.map((p) => {
    const [x, z] = terrain.toWorld(p.lat, p.lon);
    const row = document.createElement('button');
    row.className = 'place';
    row.innerHTML = `<div class="row"><i class="dot"></i><span class="name">${p.name}</span><span class="score"></span></div>
      <div class="sub"><span class="st"></span><span class="meta"></span></div>
      <div class="bar"><canvas width="${BINS}" height="1"></canvas><i></i></div>`;
    row.title = p.note;
    const li = document.createElement('li'); li.append(row); list.append(li);
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.innerHTML = `<i class="pin"></i><span>${p.name}</span>`;
    markers.append(marker);
    const s: Spot = { ...p, x, z, elev: terrain.heightAt(x, z), row, marker };
    row.onclick = marker.onclick = () => select(s.id, true);
    return s;
  });

  // ---- per-day sun tables ---------------------------------------------------
  const sunCache = new Map<number, SunPos[]>();
  const daySun = (day: number) => {
    let a = sunCache.get(day);
    if (!a) sunCache.set(day, (a = Array.from({ length: BINS }, (_, i) => sunAt(day + (i + 0.5) * BIN))));
    return a;
  };
  const litCache = new Map<string, { up: Uint8Array; lit: Uint8Array }>();
  const dataCache = new Map<string, DayData>();
  function dayData(s: Spot, day: number): DayData {
    const key = `${s.id}:${day}:${weatherRev}`;
    let d = dataCache.get(key);
    if (d) return d;
    let g = litCache.get(`${s.id}:${day}`);
    if (!g) {
      const sun = daySun(day), up = new Uint8Array(BINS), lit = new Uint8Array(BINS);
      for (let i = 0; i < BINS; i++) {
        up[i] = sun[i].altitude > 0 ? 1 : 0;
        lit[i] = up[i] && terrainLit(terrain, s.x, s.z, sun[i].dir) && (!city || city.lit(s.x, s.z, sun[i].dir)) ? 1 : 0;
      }
      litCache.set(`${s.id}:${day}`, (g = { up, lit }));
    }
    const cover = new Float32Array(BINS);
    let sunHours = 0, best: [number, number] | null = null, run = -1;
    for (let i = 0; i <= BINS; i++) {
      const ok = i < BINS && g.lit[i] && (cover[i] = weather ? weather.sample(s.x, s.z, day + (i + 0.5) * BIN).cover : 0) < 0.5;
      if (i < BINS && g.lit[i]) sunHours += (1 - cover[i]) / 6;
      if (ok && run < 0) run = i;
      if (!ok && run >= 0) { if (!best || i - run > best[1] - best[0]) best = [run, i]; run = -1; }
    }
    dataCache.set(key, (d = { ...g, cover, sunHours, window: best }));
    return d;
  }

  function paint(canvas: HTMLCanvasElement, d: DayData) {
    const ctx = canvas.getContext('2d')!;
    if (canvas.width !== BINS) canvas.width = BINS;
    const img = ctx.createImageData(BINS, 1);
    for (let i = 0; i < BINS; i++) {
      const c = !d.up[i] ? COL.night : !d.lit[i] ? COL.shade : COL.sun.map((v, k) => v + (COL.cloud[k] - v) * d.cover[i]);
      img.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    ctx.putImageData(img, 0, 0);
  }

  function statusAt(x: number, z: number, t: number, sun: SunPos): { status: Status; score: number; cover: number; temp: number | null } {
    const w = weather?.sample(x, z, t);
    const cover = w?.cover ?? 0, temp = w?.temp ?? null;
    if (sun.altitude <= 0) return { status: 'night', score: 0, cover, temp };
    if (!terrainLit(terrain, x, z, sun.dir)) return { status: 'shade', score: 0, cover, temp };
    if (city && !city.lit(x, z, sun.dir)) return { status: 'shade', score: 0, cover, temp };
    return { status: cover < 0.25 ? 'sun' : cover < 0.6 ? 'part' : 'cloud', score: 1 - cover, cover, temp };
  }
  const LABEL: Record<Status, string> = { night: 'Night', shade: 'Shade', cloud: 'Cloudy', part: 'Partly sunny', sun: 'Sunny' };

  // ---- rendering of UI state --------------------------------------------------
  const strip = $<HTMLCanvasElement>('strip'), playhead = $('playhead');
  let shownDay = -1, shownSel = '', shownRev = -1;
  const scores = new Map<string, number>();

  function update() {
    const day = localMidnight(time), frac = (time - day) / DAY;
    const sun = sunAt(time);
    scene.setSun(sun.dir);
    const secs = (time - today) / 1000;
    scene.setWeather(weather ? weather.coverGrid(time) : null, (weather?.drift[0] ?? 0) * secs, (weather?.drift[1] ?? 0) * secs);

    const dayChanged = day !== shownDay || weatherRev !== shownRev;
    let sunny = 0;
    for (const s of spots) {
      const st = statusAt(s.x, s.z, time, sun);
      scores.set(s.id, st.score);
      if (st.score >= 0.5 && shown(s)) sunny++;
      const cls = st.status === 'night' ? '' : `s-${st.status}`;
      s.row.querySelector('.dot')!.className = `dot ${cls}`;
      s.marker.querySelector('.pin')!.className = `pin ${cls}`;
      s.row.querySelector('.score')!.textContent = st.status === 'night' ? '—' : `${Math.round(st.score * 100)}%`;
      s.row.querySelector('.st')!.textContent = LABEL[st.status];
      const d = dayData(s, day);
      s.row.querySelector('.meta')!.textContent =
        `${Math.round(s.elev)} m${st.temp != null ? ` · ${Math.round(st.temp)}°` : ''} · ${d.sunHours.toFixed(1)} h`;
      (s.row.querySelector('.bar i') as HTMLElement).style.left = `${frac * 100}%`;
      if (dayChanged) paint(s.row.querySelector('canvas')!, d);
    }

    const sel = spots.find((s) => s.id === selected)!;
    if (dayChanged || shownSel !== selected) {
      paint(strip, dayData(sel, day));
      renderDays(sel, day);
    }
    shownDay = day; shownSel = selected; shownRev = weatherRev;
    playhead.style.left = `${frac * 100}%`;
    $('tl-time').textContent = fmtTime(time);
    $('tl-date').textContent = fmtLong(time);

    const d = dayData(sel, day);
    const hm = (bin: number) => fmtTime(day + bin * BIN);
    $('tl-foot').innerHTML = `<b>${sel.name}</b> — ${LABEL[statusAt(sel.x, sel.z, time, sun).status].toLowerCase()} now · ` +
      (d.window ? `best sun <b>${hm(d.window[0])}–${hm(d.window[1])}</b> · ` : 'no clear sun window · ') +
      `${d.sunHours.toFixed(1)} h of sun this day` + (weather ? '' : ' (clear-sky estimate)');

    const area = weather?.sample(0, 0, time);
    scene.setOvercast(area ? Math.min(area.cover * 1.1, 1) : 0);
    $('headline').textContent = sun.altitude <= 0 ? 'The sun is down — scrub the timeline'
      : `Sunny at ${sunny} of ${spots.filter(shown).length} places` + (area ? ` · ${Math.round(area.temp)}°C` : '');
    const az = (sun.azimuth * 180) / Math.PI;
    $('readout').innerHTML = `<span>sun <b>${((sun.altitude * 180) / Math.PI).toFixed(1)}°</b></span>` +
      `<span>az <b>${az.toFixed(0)}° ${COMPASS[Math.round(az / 45) % 8]}</b></span>` +
      (area ? `<span>cloud <b>${Math.round(area.cover * 100)}%</b></span>` : '');
  }

  function renderDays(sel: Spot, current: number) {
    const el = $('days');
    el.replaceChildren(...days.map((day) => {
      const b = document.createElement('button');
      b.className = `day${day === current ? ' sel' : ''}${day === today ? ' today' : ''}${day < today ? ' past' : ''}`;
      b.innerHTML = `<span class="wd">${day === today ? 'Today' : fmtWeekday(day)}</span><span class="dt">${fmtDate(day)}</span>` +
        `<span class="hrs">${dayData(sel, day).sunHours.toFixed(1)} h sun</span>`;
      b.onclick = () => { setTime(day + (time - localMidnight(time))); sortPlaces(); };
      return b;
    }));
    el.querySelector('.sel')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function sortPlaces() {
    const order = [...spots].sort((a, b) => (scores.get(b.id)! - scores.get(a.id)!) ||
      dayData(b, localMidnight(time)).sunHours - dayData(a, localMidnight(time)).sunHours);
    order.forEach((s) => { s.row.parentElement!.hidden = !shown(s); list.append(s.row.parentElement!); });
  }

  function setTime(t: number) {
    time = Math.min(Math.max(t, tMin), tMax);
    update();
  }

  function select(id: string, fly: boolean) {
    selected = id;
    for (const s of spots) {
      s.row.classList.toggle('sel', s.id === id);
      s.marker.classList.toggle('sel', s.id === id);
    }
    const s = spots.find((p) => p.id === id)!;
    if (fly) scene.setView(s.x, s.z, city?.inside(s.x, s.z) ? 1100 : 7000, scene.bearing, 34);
    $('panel').classList.remove('open');
    update();
  }

  // ---- controls ---------------------------------------------------------------
  const track = $('track');
  const scrub = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    const f = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 0.9995);
    setTime(localMidnight(time) + Math.round((f * DAY) / 300_000) * 300_000);
  };
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); setPlaying(false); scrub(e); });
  track.addEventListener('pointermove', (e) => { if (track.hasPointerCapture(e.pointerId)) scrub(e); });
  track.addEventListener('pointerup', sortPlaces);

  const playBtn = $('btn-play');
  function setPlaying(p: boolean) {
    playing = p;
    playBtn.textContent = p ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
    if (!p) sortPlaces();
  }
  playBtn.onclick = () => setPlaying(!playing);
  $('btn-now').onclick = () => { setPlaying(false); setTime(Date.now()); sortPlaces(); };
  const cloudsBtn = $('btn-clouds');
  cloudsBtn.onclick = () => {
    const on = cloudsBtn.getAttribute('aria-pressed') !== 'true';
    cloudsBtn.setAttribute('aria-pressed', String(on));
    scene.setCloudsVisible(on);
  };
  // Two framings: the old town seen from above Tâmpa, and the whole region.
  const [ox, oz] = terrain.toWorld(45.6427, 25.5887);
  const views = {
    city: (animate: boolean) => scene.setView(ox, oz, 1700, 322, 33, animate),
    region: (animate: boolean) => scene.setView(-1500, 1200, 25000, 205, 36, animate),
  };
  const setMode = (m: 'city' | 'region', animate = true) => {
    mode = m;
    views[m](animate);
    $('panel-hint').textContent = m === 'city' ? 'in the city · sunniest first' : 'whole region · sunniest first';
    if (spots.length) { update(); sortPlaces(); scene.invalidate(); }
    $('btn-city').setAttribute('aria-pressed', String(m === 'city'));
    $('btn-region').setAttribute('aria-pressed', String(m === 'region'));
  };
  $('btn-city').onclick = () => setMode('city');
  $('btn-region').onclick = () => setMode('region');
  $('btn-north').onclick = () => scene.setView(scene.controls.target.x, scene.controls.target.z, scene.camera.position.distanceTo(scene.controls.target), 0, 55);
  $('btn-places').onclick = () => $('panel').classList.toggle('open');
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && e.key === ' ') return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    if (e.key === 'ArrowRight') setTime(time + (e.shiftKey ? HOUR : 600_000));
    if (e.key === 'ArrowLeft') setTime(time - (e.shiftKey ? HOUR : 600_000));
  });

  // Hover read-out for any point on the terrain.
  const tip = $('tip'), canvas = scene.renderer.domElement;
  let hover: PointerEvent | null = null;
  canvas.addEventListener('pointermove', (e) => (hover = e.pointerType === 'mouse' && !e.buttons ? e : null));
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });

  let last = performance.now();
  scene.onTick = () => {
    const t = performance.now(), dt = Math.min(t - last, 100); last = t;
    if (playing) {
      if (time >= tMax) setPlaying(false);
      else setTime(time + dt * 2400); // 40 simulated minutes per second
    }
    if (hover) {
      const hit = scene.pick(hover.clientX, hover.clientY);
      tip.hidden = !hit;
      if (hit) {
        const st = statusAt(hit.x, hit.z, time, sunAt(time));
        const roof = city?.buildingAt(hit.x, hit.z) ?? 0;
        tip.innerHTML = `<b>${Math.round(terrain.heightAt(hit.x, hit.z))} m</b> · ${roof > 0 ? 'roof · ' : ''}${LABEL[st.status]}` +
          (st.temp != null ? ` · ${Math.round(st.temp)}°` : '');
        tip.style.left = `${hover.clientX + 14}px`; tip.style.top = `${hover.clientY + 14}px`;
      }
      hover = null;
    }
  };
  scene.onFrame = () => {
    // Place markers; labels yield to the selected place and to earlier ones when they would collide.
    const taken: { x: number; y: number; w: number }[] = [];
    const ordered = [...spots].sort((a, b) => +(b.id === selected) - +(a.id === selected));
    for (const s of ordered) {
      const p = scene.project(scene.display(s.x, s.z, 60));
      s.marker.style.display = p && shown(s) ? '' : 'none';
      if (!p || !shown(s)) continue;
      s.marker.style.transform = `translate(${p.x - 5}px, ${p.y - 8}px)`;
      const w = 22 + s.name.length * 6.6;
      const clash = taken.some((t) => Math.abs(t.y - p.y) < 17 && p.x < t.x + t.w && t.x < p.x + w);
      s.marker.classList.toggle('quiet', clash);
      if (!clash) taken.push({ x: p.x, y: p.y, w });
    }
    $('compass').style.transform = `rotate(${-scene.bearing}deg)`;
  };

  setMode('city', false);
  select(selected, false);
  sortPlaces();
  if (import.meta.env.DEV) Object.assign(window, { __app: { setTime, scene, get time() { return time; } } });

  City.load(terrain).then((c) => {
    if (!c) return;
    city = c;
    scene.addCity(c);
    litCache.clear(); dataCache.clear(); weatherRev++;
    if (!c.inside(spots.find((s) => s.id === selected)!.x, spots.find((s) => s.id === selected)!.z)) selected = 'sfatului';
    update(); sortPlaces();
  });

  loadWeather(terrain).then((w) => {
    weather = w; weatherRev++;
    update(); sortPlaces();
  }).catch((err) => {
    console.warn(err);
    const toast = $('toast');
    toast.textContent = 'Weather forecast unavailable — showing clear-sky sun and terrain shade only.';
    toast.hidden = false;
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById('headline')!.textContent = 'Could not start: ' + (err?.message ?? err);
});
