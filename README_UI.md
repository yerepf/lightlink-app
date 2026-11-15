# Light&Link interface

Select **Start**, then choose **Explorer** (`#explorer`) or **Mission Planner** (`#planner`). Switch modes from the header. **Restart** returns to the beginning of the Explorer campaign.

## Explorer

The campaign uses the bundled `Site07` dataset. An astronaut speaks from the left of the dialogue panel while the map and timeline remain interactive. Select **Audio off** to turn on music, sound effects and narration. **Replay voice** repeats the current passage. When a recording is unavailable, the app uses the device's English speech synthesis, if available.

1. **Welcome to the lunar south pole.** Rotate the view or select **Let's begin**.
2. **A landing on the wrong slope.** Activate relocation and choose a green point with a slope below 10°.
3. **Find light and signal.** Select a striped green window in the timeline or use **Jump to a window**. The guide confirms your selection when both the Sun and Earth are visible. If the landing point has no overlapping visibility, try another point.
4. **Can we run the experiment?** Decide whether the visible window covers eight continuous hours. Battery life in shadow comes from the power simulation.
5. **How we know what we see.** Read about the LOLA terrain and JPL Horizons ephemerides.
6. **Compare before you commit.** Complete a valid comparison and return to the astronaut to claim the educational badge.

## Mission Planner

The HUD shows UTC, Sun and Earth visibility, and simulated battery. Open **Details** for coverage, terrain diagnostics, elevation plots, and **Export CSV** or **Export JSON**. CSV contains the active windows. JSON also contains totals, the horizon profile, and timeline samples.

- **Relocate.** Select **Activate relocation** under **Lunar site**. Click or tap a terrain point, or use arrow keys and **Enter**. Press **Escape** to exit. The map shows slopes below 10° in green, 10°–15° in amber, and above 15° in red.
- **Compare.** Select two sites or compare the active point with another site. The default time window uses overlapping coverage. To compare dates, enter two UTC start times and a shared duration. The results include Sun visibility, direct-to-Earth visibility, co-visibility, data sources and the share of the terrain patch below 10°.
- **Scrub time.** Drag the playhead or step through samples with the arrow keys. Hold **Shift** for ten-sample steps. **Home** and **End** jump to the edges. Use the wheel or **+** and **−** to zoom. Live mode requires real ephemerides that cover the current time.

The compass accounts for grid convergence in orbital and surface views. Map view puts north at the top. [Planner design reference](DESIGN.md)

## Run the app and interpret the data

Install dependencies with `npm ci`, then run `npm run dev:frontend`. `npm run build` creates `dist-demo/`, which must be served over HTTP. The app uses `/api` by default. Set `VITE_API_URL` at build time to use a different endpoint, or set `BACKEND_URL` to change the Vite proxy target.

The bundled data includes 2 m and 5 m observer profiles for `Site01` and `Site07`, with the original 16-bit terrain maps and backend series from commit `22489b4d12a34eced448dfede9e72986fdf70908`. To regenerate the copies, place the backend checkout in `backend/` and run `node --import tsx scripts/prepare-offline.ts`.

Relocation uses slopes from the unexaggerated terrain and traces 360 rays within the original elevation patch. It retains the base site's JPL Horizons angles. The recomputation costs O(360 × samples per ray + timeline samples). Lookup in a regular horizon profile is O(1). Visibility durations hold each Boolean value until the next sample. DTE measures geometric line of sight, and the battery model is simulated.

**New site** requires a backend that accepts `POST /sites`. The local backend uses Redis for registration and returns `pending_data` while site data is still missing.

`npm test` runs the tests. `npm run build` checks TypeScript and bundles the app.
