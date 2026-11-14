import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackendClient, BackendError, adaptBackendSite, customDateRange, validateCoordinates } from '../src/backend';
import { readFileSync } from 'node:fs';

test('real automatic-sites-v1 response preserves centre, north convergence and dynamic PNG URL', () => {
  // Real generated response, with timeline shortened to two samples for this fixture.
  const raw = JSON.parse(readFileSync(new URL('./fixtures/generated-site.json', import.meta.url), 'utf8'));
  const site = adaptBackendSite(raw);
  assert.equal(site.spatial?.observer_x_km, 0);
  assert.equal(site.spatial?.observer_z_km, 0);
  assert.equal(site.spatial?.grid_convergence_deg, 187.6512);
  assert.equal(site.heightmap_url, `/api/sites/${raw.site_id}/heightmap`);
  assert.equal(site.horizon_mask.length, 360);
  assert.deepEqual(site.ephemeris_timeline, raw.ephemeris_timeline);
  raw.heightmap.center_lon += 1;
  assert.throws(() => adaptBackendSite(raw));
});

test('coordinate validation accepts both longitude conventions and rejects invalid inputs', () => {
  assert.equal(validateCoordinates({ name: ' Point ', latitude: -89.5, longitude: -137.5 }).name, 'Point');
  assert.equal(validateCoordinates({ name: 'Point', latitude: -90, longitude: 360 }).longitude, 360);
  for (const input of [
    { name: '', latitude: 0, longitude: 0 }, { name: 'P', latitude: NaN, longitude: 0 },
    { name: 'P', latitude: -91, longitude: 0 }, { name: 'P', latitude: 0, longitude: 361 },
  ]) assert.throws(() => validateCoordinates(input));
});
test('custom ephemeris window brackets the selected instant and aligns to backend hours', () => {
  const range = customDateRange(Date.parse('2026-11-14T21:07:32Z'));
  assert.deepEqual(range, { start_utc: '2026-11-13T21:00:00Z', end_utc: '2026-11-15T21:00:00Z' });
});
test('registration sends the documented body; generation preserves range, height, errors and cancellation', async t => {
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    init?.signal?.throwIfAborted();
    return url.endsWith('/sites')
      ? new Response(JSON.stringify({ site_id: 'custom_test', status: 'pending_data' }), { status: 201 })
      : new Response(JSON.stringify({ error: 'Sin cobertura DEM' }), { status: 422 });
  });
  const api = new BackendClient('/api');
  assert.equal((await api.registerSite({ name: 'Point', latitude: -89.5, longitude: 222.5 })).site_id, 'custom_test');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { name: 'Point', coordinates: { latitude: -89.5, longitude: 222.5 } });
  const range = customDateRange(Date.parse('2026-11-14T21:07:32Z'));
  await assert.rejects(api.loadSite('custom_test', 5, undefined, range), e => e instanceof BackendError && e.status === 422);
  const query = new URL(calls[1].url, 'http://localhost').searchParams;
  assert.equal(query.get('observer_height_m'), '5');
  assert.equal(query.get('start_utc'), range.start_utc);
  assert.equal(query.get('end_utc'), range.end_utc);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(api.loadSite('custom_test', 2, abort.signal), { name: 'AbortError' });
});
