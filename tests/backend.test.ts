import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { encode } from 'fast-png';
import { adaptBackendSite } from '../src/backend.js';
import { decodePng16 } from '../src/png16.js';
import { Timeline, directionXYZ } from '../src/data.js';
import { Vector3 } from 'three';

test('16-bit decoding preserves adjacent digital numbers', () => {
  const png = encode({ width: 2, height: 2, depth: 16, channels: 1, data: new Uint16Array([0, 32768, 32769, 65535]) });
  const field = decodePng16(png);
  assert.equal(field.values[0], 0); assert.equal(field.values[3], 1);
  assert.ok(field.values[2] > field.values[1]);
  assert.ok(Math.abs(field.values[1] * 65535 - 32768) < 0.01);
  assert.throws(() => decodePng16(encode({ width: 2, height: 2, depth: 8, channels: 1, data: new Uint8Array(4) })));
});

test('PB-05: seven sites, both heights, PNG hashes and authoritative states', { skip: !existsSync('backend/node_modules/fastify') }, async () => {
  const previous = process.cwd();
  const directory = resolve('backend');
  process.chdir(directory);
  const { buildApp } = await import('../backend/src/app.ts');
  const app = await buildApp();
  try {
    const catalog = (await app.inject('/sites')).json();
    assert.equal(catalog.length, 7);
    for (const summary of catalog) {
      for (const height of [2, 5]) {
        const response = await app.inject(`/sites/${summary.site_id}?observer_height_m=${height}`);
        assert.equal(response.statusCode, 200);
        const raw = response.json();
        const site = adaptBackendSite(raw);
        const generated = structuredClone(raw);
        generated.site_id = 'custom_example'; generated.heightmap_url = '/sites/custom_example/heightmap';
        assert.equal(adaptBackendSite(generated).heightmap_url, '/api/sites/custom_example/heightmap');
        for (const url of ['/sites/other/heightmap', 'https://example.com/map.png', '/sites/../heightmap']) {
          generated.heightmap_url = url;
          assert.throws(() => adaptBackendSite(generated));
        }
        assert.equal(site.ephemeris_timeline.length, 1464);
        assert.equal(site.horizon_mask.length, 3600);
        assert.equal(site.spatial!.observer_y_km, (raw.target.observer_ground_z_m + height) / 1000);
        assert.equal(site.spatial!.grid_convergence_deg, raw.target.grid_convergence_deg);
        assert.equal(site.spatial!.observer_x_km, (raw.target.observer_x_m - raw.heightmap.center_x_m) / 1000);
        assert.equal(site.spatial!.observer_z_km, -(raw.target.observer_y_m - raw.heightmap.center_y_m) / 1000);
        const timeline = new Timeline(site);
        for (const frame of site.ephemeris_timeline) assert.deepEqual(timeline.sample(Date.parse(frame.timestamp_utc)).horizonEstimate, frame.conditions);
        if (height === 2) {
          const png = await app.inject(raw.heightmap_url);
          assert.equal(png.statusCode, 200);
          const filename = raw.heightmap_url.split('/').at(-1);
          assert.equal(createHash('sha256').update(png.rawPayload).digest('hex'), raw.provenance.input_sha256[filename]);
          const field = decodePng16(png.rawPayload);
          assert.equal(field.width, raw.heightmap.web_px);
          assert.equal(field.height, raw.heightmap.web_px);
          assert.ok(field.values.every(v => v >= 0 && v <= 1));
          const bad = structuredClone(raw); bad.target.grid_convergence_deg = null;
          assert.throws(() => adaptBackendSite(bad));
        }
      }
    }
    const raw = JSON.parse(await readFile('data/sites/Site01.json', 'utf8'));
    const gamma = raw.target.grid_convergence_deg * Math.PI / 180;
    const north = new Vector3(); directionXYZ(raw.target.grid_convergence_deg, 0, north);
    assert.ok(north.distanceTo(new Vector3(Math.sin(gamma), 0, -Math.cos(gamma))) < 1e-12);
    // The observer's convergence differs from the tile centre and must not be replaced by it.
    assert.notEqual(raw.target.grid_convergence_deg % 360, (raw.heightmap.grid_convergence_deg + 360) % 360);
  } finally { await app.close(); process.chdir(previous); }
});
