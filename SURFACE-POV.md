# Surface POV

Run `npm run dev`, then open http://localhost:5173. Site04 is selected by default.

- `src/terrainLOD.ts`: 512 x 512 CPU-deformed central patch, stitched square-to-radial outer mesh (128 x 64, plus full-resolution seam) out to 120 km. Distances are kilometres. Exaggeration defaults to 4x and is anchored to the actual centre vertex; observer height remains in metres.
- `src/SurfaceCamera.ts`: 55-degree fixed-eye surface view with OrbitControls, a 0.1 km look target, upward-only look angles and orbital toggle.
- `src/CelestialSky.ts`: local Earth texture, directional phase shader, atmospheric limb, solar disc/corona and 3,600 stars. Bodies at 800 km; stars at 1,200 km.
- `src/LunarEngine.ts`: integration, shadow lighting, optional technical group and resource cleanup.
- `demo/main.ts` and `index.html`: view, exaggeration, guides, existing site/height/time controls.

Public methods: `setViewMode('surface' | 'orbital')`, `setTerrainExaggeration(1..15)`, `setObserverHeight(metres)`, `setGuidesVisible(boolean)`.

Scientific limits: central geometry uses the supplied PNG's full 16-bit values, sampled onto 513 x 513 vertices. Site04 spans 15.984 km total, not a 16 km radius. The outer terrain and stars are illustrative. The camera follows the requested patch centre, which differs from the backend's original target coordinate; horizon_mask and backend visibility remain original scientific data and are not recomputed for the moved observer or exaggerated terrain. 2 m and 5 m are the supported backend profiles; 5 m reuses the 2 m ephemerides. The engine accepts other camera heights, but those do not create new scientific profiles. Earth phases follow solar direction; continent orientation is illustrative, without Earth attitude/rotation ephemerides. Apparent Earth diameter is intentionally enlarged to 2.5 degrees.

Earth texture: https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg (Three.js example asset, downloaded locally to public/textures). No remote texture request is needed at runtime.

Validation: `npm run build` and `npm test`. Tests cover uint16 precision, backend profiles, time interpolation, geometry orientation, LOD seam closure at 1x and 15x, centre anchoring and fixed-eye camera translation.

## Backlog PB-07 to PB-11 (2026-11-14)

| Item | Before audit | Delivered | Acceptance status |
| --- | --- | --- | --- |
| PB-07 | Scene, local tangent plane and OrbitControls existed; no built-in offline mode | 20 x 20 km deterministic offline demo, immediate startup before API, selectable MOCK, live actual frame-time/FPS/draw counter; static shadow cache | Functional requirements implemented. Browser samples reported 240 FPS at current viewport, not a sustained hardware-independent 60 FPS certification. Real sites retain native patch extent (Site04 15.984 km). |
| PB-08 | Already implemented | Native uint16 PNG decode, calibrated kilometres from metre metadata, CPU vertex heights, normals, tests | Done via CPU deformation per the newer explicit request; no displacementMap or 8-bit browser conversion. Use 1x for real relief. |
| PB-09 | Solar vectors and shadows existed; fixed approximate frustum | Light-space bounds fit to all 8 central terrain box corners; PCFSoft shadows; update on time or geometry change; authoritative solar state on vector/UI | Technical implementation complete; exact pixel-shadow/boolean equality is NOT certified. Backend boolean is a point observation based on a different target and full scientific DEM; renderer includes resampling, visual exaggeration and procedural exterior. Turning off the global sun when this boolean is false would incorrectly darken other illuminated slopes. |
| PB-10 | Generic marker and blue/grey estimated Earth arrow | Small lander model at central ground, tactical beacon, green/red DTE arrow and text using authoritative timeline conditions | Backend link indication implemented and checked in UI in both states. Arrow is an overlay, not a computed ray intersection; mountain intersection location cannot be recovered from the boolean. |
| PB-11 | Surface and orbital views, hard cuts | Top-down orthographic map with elevation colours and 100 m contours; pan/zoom; map-zoom-preserving exits and three-stage 3-second camera moves (vertical rise, cruise above maximum relief, vertical descent); reduced-motion preference skips animation | Implemented and path tested. Cinematic flight is an additional mode with pause/resume. |

Map north is GRID north. Existing grid convergence still transforms true-north ephemeris vectors. Map contours and colours use original elevations, irrespective of visual exaggeration. Outer procedural contours are illustrative.

Offline: select `Demo sin API (simulado)`. On an API startup failure this remains usable. To run frontend without backend installation, use `npm run dev:frontend`.

Additional modules: `src/mock.ts`, `src/solar.ts`, `src/lander.ts`. `loadSite(site, optionalHeightField)` allows an in-memory fixture without PNG/network access. New API: `setViewMode('top' | 'cinematic')`, `setCinematicPaused(boolean)`; `mapCamera` exposes the orthographic camera.

Validation: production build, 15 passing tests; browser checked Site04 map, guides, mock selection and active/blocked DTE. Captures: `.impeccable/review/backlog-map.jpg` and `.impeccable/review/cinematic.jpg`.


## Whole Moon (2026-11-14)

`Luna completa` adds an orbitable, low-resolution lunar body of radius 1737.4 km. `src/MoonBody.ts` builds the sphere with its 120 km cap removed; the existing local terrain and ring close that cap. All 128 seam points match at 1x, 4x and 15x. Curvature is now applied separately from relief, so exaggeration never scales the lunar radius or pulls the seam away from the globe. The central LOLA patch remains unchanged.

The body uses a locally bundled texture from https://threejs.org/examples/textures/planets/moon_1024.jpg. Global texture registration is illustrative; it is not a georeferenced global DEM. Only the existing local patch has the delivered LOLA detail.

The globe preset orbits the Moon's centre and keeps zoom outside the sphere. Transitions to/from it ascend radially and travel along an exterior spherical arc, including from the far side. Local presets and the cinematic local flight remain available. The sky is now rendered in a separate background pass at infinite visual distance; its 800/1200 construction radii no longer constrain global camera travel. Adaptive near clipping and a 30000 km far plane support both lander and globe views.

Validation: production build and 18 passing tests, including globe radius/winding, stitched outer boundary under exaggeration, and collision-free return from the far side, including interrupted transitions. Browser screenshot: `.impeccable/review/full-moon.jpg`.

## Procedural mission visuals (2026-11-14)

### Analytical overlays and illustrative power model

`src/analytics.ts` precomputes parallel `power_telemetry` at the source timestamps, starting at 85% battery and −20 °C. Sampling integrates only the remainder of the selected interval, using its authoritative sun condition and actual elapsed hours; scrubbing order never changes results. Sun input is `450 * max(.25, sin(elevation))` W, with charging scaled from 4 to 7 percentage points/hour. Shadow uses −120 W and −2.8 points/hour. Temperatures approach +45/−180 °C exponentially with illustrative 6/12-hour constants. Percentage rates are prescribed independently of watts: this is not a battery-capacity/energy-balance model. The HUD includes a simple battery bar and expandable technical telemetry; `getPowerTelemetry()` exposes the same current values. Beacon color and pulse rate follow the 40%/15% thresholds, while DTE and solar-panel conditions stay authoritative.

Slope vertex colors are computed once from the central DEM at 1x and retained through 1–15x exaggeration. Green <10°, amber 10–15°, red >15°; these categories do not certify landing safety. The overlay overrides central topographic shading while enabled; disabling restores the active map/lunar material. Procedural outer terrain is deliberately unclassified. Sky paths use every supplied sample, the same true-north/grid convergence transform and sky pass as celestial bodies: dashed gold Sun, cyan Earth. Earth is not forced into a figure-eight when the selected interval does not describe one.

Science markers select up to three spatially separated depressions within the bottom elevation decile, requiring a surrounding local ring at least 2 m higher. Flat or unsuitable terrain can yield fewer or no markers. Labels explicitly identify unconfirmed topographic candidates: low elevation alone establishes neither permanent shadow nor water ice. Marker ground positions follow visual exaggeration; scientific data remains unchanged. Site04 yielded one candidate in the checked dataset. All new geometry/material/texture resources are released when switching sites or disposing the engine.

Validation: production build and 34 tests pass, including reversible telemetry, uneven source intervals, thermal/battery limits, slope invariance at 15x, correct sky orientation and rejection of flat/sloping PSR candidates. Browser checked real Site04, manual endpoints, live return, slope and path toggles, with no console errors and 60 FPS observed after warmup. Capture: `.impeccable/review/analytics.jpg`.

### Coordinate-based sites

Open **Explorar por coordenadas lunares**, enter a name, latitude (−90..90) and east longitude (−180..360), then **Generar y explorar**. The frontend registers with `POST /sites` and requests `GET /sites/:id` with observer height and a 48-hour window around the selected time (current time in live mode), aligned to whole UTC hours. Existing pending sites can also be selected to trigger generation. Changing observer height requests the corresponding product. Generation requires the backend's local DEM coverage, Python, Horizons access and Redis; this does not upload an arbitrary local heightmap or supply global high-resolution coverage.

The interface shows elapsed wait and processing stage, preserves the previous scene on failure, supports retry and cancellation of the browser wait (not the server job). Client timeout is 270 seconds and Vite proxy timeout 300 seconds, exceeding the backend's 240-second generation limit. Error messages distinguish no coverage, expired records, busy server and missing generation dependencies. Custom records follow the backend cache TTL.

The adapter supports both original metadata and `automatic-sites-v1`: custom PNGs are centred at the requested coordinates; grid convergence comes from `heightmap`, true-north provenance and explicit Three.js axes are validated. Dynamic URLs must match the returned site's own `/sites/:id/heightmap` path. No horizon or ephemeris values are altered. A real point at −89.7628°, 187.6512° was registered, generated and rendered against the deployed API at 2 m and 5 m; cancellation was also verified in the browser. Its abbreviated response is retained as a regression fixture in `tests/fixtures/generated-site.json`. Production build and all 29 tests pass.

### Live clock details

The frontend defaults to live wall-clock playback for real sites whose loaded ephemerides cover `Date.now()`. `En vivo` / `Pausar en vivo` switches modes; moving the timeline selects manual exploration. Mode preference survives site/height changes. Positions are interpolated once per second without new network requests, using the device clock; visibility remains the backend's hourly sample-and-hold condition. Returning to a backgrounded tab resynchronizes directly to the clock, without accumulated timer drift. Mock data and dates outside loaded coverage disable live playback and show why; no extrapolation or silently clamped timestamp is labelled live.

Verified against https://github.com/RamCodeZ3/Light-Link-Backend/blob/main/src/app.ts and its README, and the deployed Site04 response on 2026-11-14: predefined sites currently cover 2026-11-01T00:00:00Z through 2026-12-31T23:00:00Z in hourly samples. The backend returns predefined data directly and does not regenerate that coverage automatically. Extending live use beyond it requires updated backend products. Existing horizon/terrain physics is unchanged. Build and 25 tests pass, including live range endpoints, invalid dates, mock rejection, manual mode and resumed clock sampling.

- `src/lander.ts`: CLPS-inspired octagonal Kapton body (`#d4af37`, metalness 0.9, roughness 0.25), white/dark structural details, articulated landing struts and pads seated on the rendered triangle heights/normals. The root remains `(0, centerY, 0)`; strut deployment raises the chassis enough to clear the local slope. Two blue-grid photovoltaic wings react to `sun_visible`. The paraboloid and feed track the Earth direction each render frame. Beacon pulse uses wall-clock time, independently of simulation time.
- `src/TerrainQueries.ts`: exact triangle sampling for feet/HUD and spatially tiled Raycaster geometry. This is a collision copy of the actual central mesh, not a reduced scientific terrain. It is rebuilt on site/exaggeration changes, and DTE intersection is recomputed on timeline/height changes. Outer terrain and Moon also participate in line-of-sight collision.
- `src/MissionEffects.ts`: additive pulsed cylindrical RF beam originating at the antenna feed, with a bright narrow core; emerald/cyan when the backend Earth condition is true, alert red when false. Blocked beams stop at the nearest rendered-terrain hit and show a depth-tested impact sprite. If the backend reports blockage but the visual mesh has no hit, the ray stays red without a fabricated impact; the UI explicitly reports this mismatch. The logical sky target is the observer plus the Earth direction at R=800 km; the background sky pass preserves apparent angular placement.
- The landing ring is draped over the actual rendered terrain and includes 5-degree ticks, with major ticks every 30 degrees. Its color is green for co-visibility, amber when just one body is visible, and red when neither is visible.
- Lensflare uses procedural halo/ring textures and Three.js depth-buffer occlusion in the world render pass. It follows the same angular direction as the Sun background disc. The translucent solar cone (opacity 0.06) points from the Sun direction down to the panel assembly only when `sun_visible` is true. RF and solar volumes are illustrative overlays in vacuum, not scattering or communication/power calculations.
- `src/proceduralTextures.ts`: deterministic CanvasTexture regolith noise (2 m repeats), bumpScale 0.15, and panel/flare textures. Bump changes normals only; it does not modify the 16-bit displacement or scientific horizon.
- `src/LunarPostProcessing.ts`: EffectComposer, sky/world RenderPass stages, UnrealBloomPass (0.45, 0.4, 0.85), OutputPass/ACES. Ordinary material radiance is capped below the bloom threshold, so lit mountains do not produce bloom; emissive Sun, RF and beacons exceed it. Composer pixel ratio is capped at 1.25, bloom runs at reduced resolution, and there is no duplicate terrain bloom-mask draw.

Select `Lander - Inspeccion` for a close view from the downhill side. `Bloom y efectos de mision` disables the beam, HUD, solar overlay, flare and bloom for comparison; lander articulation/panel state remain intact. Existing Surface, Orbital, Map, Cinematic and Whole Moon modes remain available.

The enclosing lander model is hidden in the settled Surface preset because the fixed 2 m eye can be inside the chassis; antenna tracking and mission effects continue. Exterior views show the complete model. Final validation: production build and 23 passing tests; Site07 at 2026-11-01 00:00 UTC also verified the connected green beam and ring. Observer height, 1x/15x exaggeration, timeline and effects toggle were exercised in the browser without console errors.

Verification includes real Site04 blocked-beam impact, shader error inspection and observed 60 FPS after startup at the tested browser viewport. Startup shader compilation is not steady-state frame rate, and this is not a universal 60 FPS certification. Dedicated tests compare tiled collisions against full-mesh Raycaster results, ensure exact pad contact on slopes, antenna orientation, authoritative state colors, and beam endpoints/no fabricated impact. No changes were made to horizon_mask, ephemeris_timeline or their backend conditions.
