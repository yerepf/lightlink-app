import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createPowerTelemetry, batteryIndicator, addSlopeColors, createSkyPaths, disposeSkyPaths, findScienceCandidates } from '../src/analytics';
import { createTerrainLOD } from '../src/terrainLOD';
import type { Frame } from '../src/data';

function frame(hour: number, sun: boolean, elevation = 90): Frame {
  return { timestamp_utc: new Date(Date.UTC(2026, 10, 1) + hour * 3600000).toISOString(),
    sun: { azimuth_deg: 0, elevation_deg: elevation }, earth: { azimuth_deg: 90, elevation_deg: 0 },
    conditions: { sun_visible: sun, earth_visible: true, co_visibility: sun } };
}
test('power is deterministic under time reversal and uses actual interval durations', () => {
  const frames = [frame(0, false), frame(2, true), frame(3, true)];
  const original = structuredClone(frames), model = createPowerTelemetry(frames), start = Date.parse(frames[0].timestamp_utc);
  assert.equal(model.power_telemetry[0].battery_pct, 85);
  assert.ok(Math.abs(model.power_telemetry[1].battery_pct - 79.4) < 1e-8);
  assert.ok(Math.abs(model.power_telemetry[2].battery_pct - 86.4) < 1e-8);
  const at = model.sample(start + 3600000);
  model.sample(start + 3 * 3600000);
  assert.deepEqual(model.sample(start + 3600000), at);
  assert.equal(at.net_watts, -120); assert.ok(at.temp_celsius < -20);
  assert.equal(model.power_telemetry[1].solar_watts, 450);
  assert.deepEqual(frames, original);
});
test('battery clamps, thermal asymptotes, charging floor and LED thresholds', () => {
  const dark = createPowerTelemetry([frame(0, false), frame(100, false)]);
  assert.equal(dark.power_telemetry[1].battery_pct, 0);
  assert.equal(dark.power_telemetry[1].status_label, 'AGOTADA');
  assert.ok(dark.power_telemetry[1].temp_celsius > -180);
  const sun = createPowerTelemetry([frame(0, true, 0), frame(1, true, 0), frame(100, true, 0)]);
  assert.equal(sun.power_telemetry[0].solar_watts, 112.5);
  assert.equal(sun.power_telemetry[1].battery_pct, 89);
  assert.equal(sun.power_telemetry[2].battery_pct, 100);
  assert.ok(sun.power_telemetry[2].temp_celsius < 45);
  assert.equal(batteryIndicator(41).color, 0xa8b99a);
  assert.equal(batteryIndicator(40).color, 0xe8a93c);
  assert.equal(batteryIndicator(15).color, 0xe8a93c);
  assert.equal(batteryIndicator(14).color, 0xd9694f);
  assert.ok(batteryIndicator(14).hz > batteryIndicator(41).hz);
});
test('slope colors classify real planes and stay unchanged after 15x exaggeration', () => {
  for (const [degrees, hex] of [[5, '#22c55e'], [12, '#eab308'], [25, '#ef4444']] as const) {
    const g = new T.PlaneGeometry(2, 2, 4, 4); g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setY(i, p.getX(i) * Math.tan(T.MathUtils.degToRad(degrees)));
    addSlopeColors(g); const expected = new T.Color(hex), color = g.getAttribute('color');
    assert.ok(Math.abs(color.getX(0) - expected.r) < 1e-6); g.dispose();
  }
  const terrain = createTerrainLOD({ width: 3, height: 3, values: Float32Array.from([0,.5,1,0,.5,1,0,.5,1]) },
    { patch_size_km: 2, min_elevation_m: 0, max_elevation_m: 500 }, 4);
  const mesh = terrain.group.children[0] as T.Mesh;
  const original = Array.from(mesh.geometry.getAttribute('color').array), normalMaterial = mesh.material;
  terrain.setSlopeHazard(true); const hazardMaterial = mesh.material;
  terrain.setExaggeration(15);
  assert.deepEqual(Array.from(mesh.geometry.getAttribute('color').array), original);
  terrain.setTopographic(true); assert.equal(mesh.material, hazardMaterial);
  terrain.setSlopeHazard(false); assert.notEqual(mesh.material, hazardMaterial);
  terrain.setTopographic(false); assert.equal(mesh.material, normalMaterial);
  terrain.disposeMaterials(); terrain.group.children.forEach(o => (o as T.Mesh).geometry.dispose());
});
test('sky paths retain every sample and the same grid convergence as the engine', () => {
  const frames = [frame(0, true, 0), frame(1, true, 0)], group = createSkyPaths(frames, 90);
  const line = group.children[0] as T.Line, positions = line.geometry.getAttribute('position');
  assert.equal(positions.count, 2); assert.ok(Math.abs(positions.getX(0) - 800) < 1e-5);
  assert.ok(line.geometry.getAttribute('lineDistance')); disposeSkyPaths(group);
});
test('science candidates reject flat/slope fields and select distinct low depressions', () => {
  const width = 65, metadata = { patch_size_km: 20, min_elevation_m: 0, max_elevation_m: 1000 };
  assert.equal(findScienceCandidates({ width, height: width, values: new Float32Array(width*width).fill(.5) }, metadata).length, 0);
  const values = new Float32Array(width*width);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) values[y*width+x] = x / width;
  assert.equal(findScienceCandidates({ width, height: width, values }, metadata).length, 0);
  values.fill(.8);
  for (const [cx, cy] of [[12,12],[50,12],[12,50]]) {
    for (let y = cy-4; y <= cy+4; y++) for (let x = cx-4; x <= cx+4; x++) values[y*width+x] = Math.min(.8, Math.hypot(x-cx,y-cy)*.1);
  }
  assert.equal(findScienceCandidates({ width, height: width, values }, metadata).length, 3);
});
