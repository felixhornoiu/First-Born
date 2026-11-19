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
```

No API keys and no backend: it is a static site that calls Open-Meteo from the browser.

There are two views. **City** is a 3D model of Brașov itself — 26,652 buildings with roofs and
windows, streets, parks and squares — where buildings cast shadows as well as the hills, so you
can see which side of a street or which terrace is in the sun. **Region** is the whole basin with
Poiana, Postăvaru, Piatra Mare and Râșnov.

## How it works

| Piece | What it does |
| --- | --- |
| `src/sun.ts` | Solar altitude/azimuth for any instant. |
| `src/shaders.ts`, `src/scene.ts` | A GPU pass marches every terrain texel towards the sun to build a terrain shadow map whenever the time changes. In the city, every pixel also marches a 1.7 m building-height raster towards the sun for sharp building shadows. |
| `src/city.ts` | Turns the packed footprints into one mesh (walls, hip or flat roofs) and the building-height raster. |
| `src/shadow.ts`, `City.lit` | The same marches on the CPU, used to answer "is this place in the sun at 15:20?" |
| `src/weather.ts` | Fetches low/mid/high cloud, temperature, rain and wind for a 4 × 4 grid of points in one request, cached for 30 minutes. |
| `src/main.ts` | Timeline, places ranking, markers, hover read-out. |

**Sun score** for a place = nothing blocks the sun (0/1) × (1 − effective cloud cover), where
effective cover weights low cloud fully, mid cloud at 80 % and thin high cloud at 35 %. The patchy
cloud shadows drawn on the map are an illustration of that cover (a noise field thresholded so the
right fraction of ground is shaded and drifted with the forecast wind), not the position of real
clouds.

### Data

Everything under `public/data` is baked and committed, so none of this is needed to run the app.

```bash
npm run bake:terrain   # elevation: AWS Terrain Tiles, zoom 12 (~27 m), 27 x 27 km

# buildings, roads, land use and water: Overture Maps (OpenStreetMap-based), read straight
# from its public bucket with HTTP range requests
pip install pyarrow requests shapely
python scripts/fetch-overture.py 25.555 45.615 25.650 45.682 scripts/.cache/buildings.jsonl
for t in transportation/segment base/land_use base/land_cover base/land base/water; do
  python scripts/fetch-overture.py 25.4004 45.5217 25.7520 45.7676 scripts/.cache/${t#*/}.jsonl $t
done
npm run bake:city      # -> public/data/city.bin (footprints + heights)
npm run bake:ground    # -> public/data/map.webp, city-map.webp (ground colours)
```

Map data © OpenStreetMap contributors and Overture Maps Foundation (ODbL); weather by Open-Meteo.

### Known approximations

- **Building heights are mostly estimated.** Only about 2,100 of the 26,652 buildings carry a
  height or floor count in the data; the rest are guessed from building type and footprint size,
  and roof shapes are generic. Shadows in a given street can be off by a few metres.
- Trees are not modelled.
- Mountains outside the map (e.g. Bucegi) do not cast shadows; this only matters at sunrise/sunset.
- Forecast models are ~2–11 km wide, so cloud detail inside the city is interpolated.
- Mountain place coordinates in `src/places.ts` are hand-entered and approximate.

## Roadmap

1. **Foundation — done.** Real terrain, sun position, GPU terrain shadows, time scrubbing.
2. **Weather — done.** Open-Meteo cloud layers on the map, per-place sun score and daily sun strip.
3. **Planning basics — done.** Curated places ranked by sun, best sun window per day, 9-day picker.
4. **A recognisable map — done.** Streets, land use, water and squares baked from Overture Maps.
4b. **3D city — done.** Extruded buildings with building shadows, city view and city places.
5. **Inversions and fog.** Use pressure-level cloud cover to estimate cloud base, so "fog in the
   city, sun on Postăvaru" days show up correctly — the classic Brașov winter case.
6. **Planner.** "Sunniest 2 hours this weekend for a terrace / a hike / skiing", activity filters,
   click anywhere on the map to get that point's sun strip, add your own places.
7. **Share and polish.** Time and place in the URL, sun path arc, Romanian/English, building
   shadows in the old town from OSM building heights, deployment.
