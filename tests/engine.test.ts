import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { directionXYZ, horizonElevation, interpolateAzimuth, parseSite, Timeline } from '../src/data.js';
import { buildTerrain } from '../src/terrain.js';

const fixture = () => ({
  site_id: 'Site01', terrain_metadata: { patch_size_km: 20, min_elevation_m: -1200, max_elevation_m: 2100 },
  heightmap_url: '/assets/heightmaps/Site01_heightmap_1024.png',
  horizon_mask: [{ azimuth_deg: 350, max_elevation_deg: 1 }, { azimuth_deg: 10, max_elevation_deg: 3 }],
  ephemeris_timeline: [
    { timestamp_utc: '2026-11-14T00:00:00Z', sun: { azimuth_deg: 359, elevation_deg: 1 }, earth: { azimuth_deg: 136, elevation_deg: -5 }, conditions: { sun_visible: true, earth_visible: false, co_visibility: false } },
    { timestamp_utc: '2026-11-14T01:00:00Z', sun: { azimuth_deg: 1, elevation_deg: 3 }, earth: { azimuth_deg: 140, elevation_deg: 5 }, conditions: { sun_visible: true, earth_visible: true, co_visibility: true } },
  ],
});

test('north, east and zenith use a right-handed local frame', () => {
  const v = new Vector3();
  directionXYZ(0, 0, v); assert.ok(v.distanceTo(new Vector3(0, 0, -1)) < 1e-12);
  directionXYZ(90, 0, v); assert.ok(v.distanceTo(new Vector3(1, 0, 0)) < 1e-12);
  directionXYZ(180, 90, v); assert.ok(v.distanceTo(new Vector3(0, 1, 0)) < 1e-12);
});
test('azimuth and horizon interpolation cross north correctly', () => {
  assert.equal(interpolateAzimuth(359, 1, 0.5), 0);
  assert.equal(interpolateAzimuth(1, 359, 0.5), 0);
  assert.equal(horizonElevation(parseSite(fixture()).horizon_mask, 0), 2);
});
test('timeline clamps, interpolates and holds authoritative conditions', () => {
  const timeline = new Timeline(parseSite(fixture()));
  const start = timeline.times[0], end = timeline.times[1];
  assert.equal(timeline.sample(start - 100).timestampMs, start);
  const middle = timeline.sample((start + end) / 2);
  assert.equal(middle.sun.azimuth_deg, 0); assert.equal(middle.sun.elevation_deg, 2);
  assert.equal(middle.conditions.earth_visible, false);
  assert.equal(timeline.sample(end).conditions.earth_visible, true);
  assert.equal(timeline.sample(end + 100).timestampMs, end);
  assert.throws(() => timeline.sample(NaN));
});
test('one sample and one horizon entry are valid', () => {
  const site = fixture(); site.ephemeris_timeline.length = 1; site.horizon_mask.length = 1;
  const data = parseSite(site), timeline = new Timeline(data);
  assert.equal(timeline.sample(0).sun.azimuth_deg, 359);
  assert.equal(horizonElevation(data.horizon_mask, 42), 1);
});
test('validation rejects malformed and inconsistent scientific inputs', () => {
  assert.throws(() => parseSite(null));
  const site = fixture(); site.ephemeris_timeline.reverse(); assert.throws(() => parseSite(site));
  const duplicate = fixture(); duplicate.horizon_mask.push(duplicate.horizon_mask[0]); assert.throws(() => parseSite(duplicate));
  const inconsistent = fixture(); inconsistent.ephemeris_timeline[0].conditions.co_visibility = true; assert.throws(() => parseSite(inconsistent));
  const invalid = fixture(); invalid.terrain_metadata.patch_size_km = NaN; assert.throws(() => parseSite(invalid));
});
test('heightmap keeps north orientation, metre scale and bilinear centre', () => {
  const { geometry, observerY } = buildTerrain({ width: 2, height: 2, values: new Float32Array([0, 0, 1, 1]) }, fixture().terrain_metadata, 2);
  const p = geometry.attributes.position;
  assert.equal(p.getZ(0), -10); assert.ok(Math.abs(p.getY(0) + 1.2) < 1e-6);
  assert.equal(p.getZ(8), 10); assert.ok(Math.abs(p.getY(8) - 2.1) < 1e-6);
  assert.ok(Math.abs(observerY - 0.45) < 1e-12); geometry.dispose();
});
