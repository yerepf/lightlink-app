import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { adaptBackendSite } from '../src/backend.js';
import { localElevation, Timeline, type Frame, type SiteData } from '../src/data.js';
import { HOUR, visibilitySummary } from '../src/missionMetrics.js';
import { decodePng16 } from '../src/png16.js';
import { analyseRelocation, localHorizon, safeTerrainPercent } from '../src/relocation.js';

const meta = { patch_size_km: 2, min_elevation_m: 0, max_elevation_m: 1000 };
const ramp = { width: 3, height: 3, values: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]) };
const date = Date.UTC(2026, 10, 1);
const frame = (hour: number, visible = false): Frame => ({
  timestamp_utc: new Date(date + HOUR * hour).toISOString(),
  sun: { azimuth_deg: 90, elevation_deg: 20 }, earth: { azimuth_deg: 0, elevation_deg: 20 },
  conditions: { sun_visible: visible, earth_visible: visible, co_visibility: visible },
});

test('a slope east of the lander raises the east horizon; convergence rotates the result', () => {
  const mask = localHorizon(ramp, meta, 0, 0, 2, 0);
  assert.equal(mask.length, 360);
  assert.ok(mask[90].max_elevation_deg > 44);
  assert.ok(mask[270].max_elevation_deg < 0);
  const rotated = localHorizon(ramp, meta, 0, 0, 2, 90);
  assert.ok(Math.abs(rotated[0].max_elevation_deg - mask[90].max_elevation_deg) < 1e-9);
  assert.equal(localElevation(rotated, -0.5), localElevation(rotated, 359.5));
  const flat = { ...ramp, values: new Float32Array(9) };
  assert.equal(safeTerrainPercent(flat, meta), 100);
  assert.equal(safeTerrainPercent(ramp, meta), 0);
});

test('moving to the ridge changes visibility without mutating the source ephemeris', () => {
  const original: SiteData = { site_id: 'test', heightmap_url: 'offline.png', terrain_metadata: meta,
    horizon_mask: [{ azimuth_deg: 0, max_elevation_deg: 0 }], ephemeris_timeline: [frame(0, true), frame(1, true)] };
  const plateau = { width: 5, height: 3, values: Float32Array.from([0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1]) };
  const valley = analyseRelocation(original, plateau, 0, 0, 2);
  const ridge = analyseRelocation(original, plateau, .75, 0, 2);
  assert.equal(new Timeline(valley, true).sample(date).conditions.co_visibility, false);
  assert.equal(new Timeline(ridge, true).sample(date).conditions.co_visibility, true);
  assert.equal(valley.ephemeris_timeline[0].conditions.earth_visible, true);
  assert.deepEqual(ridge.ephemeris_timeline[0].sun, original.ephemeris_timeline[0].sun);
  assert.equal(original.ephemeris_timeline[0].conditions.co_visibility, true);
});

test('comparison clips intervals by UTC coverage and does not count the final observation as an hour', () => {
  const frames = [frame(0, true), frame(2, true), frame(4), frame(5, true)];
  const result = visibilitySummary(frames, { start: date + .5 * HOUR, end: date + 8 * HOUR });
  assert.equal(result.totals.co_visibility, 3.5);
  assert.deepEqual(result.windows.filter(w => w.condition === 'co_visibility'), [{ condition: 'co_visibility', start: date + .5 * HOUR, end: date + 4 * HOUR, hours: 3.5 }]);
});

test('both offline sites ship backend-compatible profiles at 2 m and 5 m and original 16-bit maps', async () => {
  for (const id of ['Site01', 'Site07']) {
    const field = decodePng16(await readFile(`public/offline/assets/heightmaps/${id}_heightmap_1024.png`));
    for (const height of [2, 5]) {
      const payload = JSON.parse(await readFile(`public/offline/${id}-${height}.json`, 'utf8'));
      const site = adaptBackendSite(payload, '/offline');
      assert.equal(site.site_id, id); assert.equal(payload.observer_height_m, height);
      assert.equal(field.width, payload.heightmap.web_px);
      assert.ok(visibilitySummary(site.ephemeris_timeline).totals.co_visibility > 0);
    }
  }
});
