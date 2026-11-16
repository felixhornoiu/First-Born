# Brașov Sun

A WebGL map of Brașov and the mountains around it that shows **where it is sunny right now — and
where it will be** — in 3D. Terrain shadows are computed from a real elevation model (Tâmpa,
Postăvaru, Piatra Mare all cast their true shadows), cloud cover comes from the open
[Open-Meteo](https://open-meteo.com) forecast, and a timeline lets you scrub two days back and a
week ahead to plan what to do and when.

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/
npm run bake:terrain # re-download the elevation model (only needed to change the area)
npm run bake:map     # optional: OpenStreetMap ground colours -> public/data/map.png
```

No API keys and no backend: it is a static site that calls Open-Meteo from the browser.

## How it works

| Piece | What it does |
| --- | --- |
| `scripts/bake-terrain.mjs` | Stitches 16 open AWS Terrain Tiles (zoom 12, ~27 m/px) into a 1024² heightmap covering 27 × 27 km around the city. |
| `src/sun.ts` | Solar altitude/azimuth for any instant. |
| `src/shaders.ts`, `src/scene.ts` | A GPU pass marches every terrain texel towards the sun to build a shadow map whenever the time changes; the terrain shader combines it with slope lighting and a cloud-shadow pattern. |
| `src/shadow.ts` | The same march on the CPU, used to answer "is this place in the sun at 15:20?" |
| `src/weather.ts` | Fetches low/mid/high cloud, temperature, rain and wind for a 4 × 4 grid of points in one request, cached for 30 minutes. |
| `src/main.ts` | Timeline, places ranking, markers, hover read-out. |

**Sun score** for a place = terrain lets the sun through (0/1) × (1 − effective cloud cover), where
effective cover weights low cloud fully, mid cloud at 80 % and thin high cloud at 35 %. The patchy
cloud shadows drawn on the map are an illustration of that cover (a noise field thresholded so the
right fraction of ground is shaded and drifted with the forecast wind), not the position of real
clouds.

### Known approximations

- Buildings and trees are not modelled — a narrow street can be in shade when the map says sun.
- Mountains outside the map (e.g. Bucegi) do not cast shadows; this only matters at sunrise/sunset.
- Forecast models are ~2–11 km wide, so cloud detail inside the city is interpolated.
- Place coordinates in `src/places.ts` are hand-entered and approximate.

## Roadmap

1. **Foundation — done.** Real terrain, sun position, GPU terrain shadows, time scrubbing.
2. **Weather — done.** Open-Meteo cloud layers on the map, per-place sun score and daily sun strip.
3. **Planning basics — done.** Curated places ranked by sun, best sun window per day, 9-day picker.
4. **A recognisable map — in progress.** `npm run bake:map` downloads streets, built-up area,
   forest, water, trails and ski lifts from OpenStreetMap (Overpass API) and rasterises them to
   `public/data/map.png`; the terrain picks the file up automatically and falls back to
   procedural colours without it. The baked file is not in the repo yet — run the command once
   and commit the result. Map data © OpenStreetMap contributors (ODbL); add the attribution to
   the UI when the file ships.
5. **Inversions and fog.** Use pressure-level cloud cover to estimate cloud base, so "fog in the
   city, sun on Postăvaru" days show up correctly — the classic Brașov winter case.
6. **Planner.** "Sunniest 2 hours this weekend for a terrace / a hike / skiing", activity filters,
   click anywhere on the map to get that point's sun strip, add your own places.
7. **Share and polish.** Time and place in the URL, sun path arc, Romanian/English, building
   shadows in the old town from OSM building heights, deployment.
