import type { SiteData } from './data.js';
import type { HeightField } from './terrain.js';
/** Offline fixture, deliberately labelled and never used as scientific data. */
export function createMockSite(): { site: SiteData; field: HeightField } {
  const width = 129, values = new Float32Array(width * width);
  for (let row = 0; row < width; row++) for (let col = 0; col < width; col++) {
    const x = (col / (width - 1) - .5) * 20, z = (row / (width - 1) - .5) * 20;
    const r = Math.hypot(x - 3, z + 2);
    values[row * width + col] = .3 + .4 * Math.exp(-((r - 4) ** 2) / 1.2) + .06 * Math.sin(x) * Math.cos(z * .8);
  }
  const start = Date.UTC(2026, 10, 14);
  return {
    field: { width, height: width, values },
    site: {
      site_id: 'MOCK', heightmap_url: 'mock://offline',
      terrain_metadata: { patch_size_km: 20, min_elevation_m: -500, max_elevation_m: 1800 },
      horizon_mask: Array.from({length: 36}, (_, i) => ({azimuth_deg: i * 10, max_elevation_deg: 4})),
      ephemeris_timeline: Array.from({length: 49}, (_, i) => {
        const sun = {azimuth_deg: (90 + i * 5) % 360, elevation_deg: 16 * Math.sin(i * Math.PI / 24)};
        const earth = {azimuth_deg: 160, elevation_deg: 4 + 7 * Math.cos(i * Math.PI / 24)};
        const sun_visible = sun.elevation_deg > 4, earth_visible = earth.elevation_deg > 4;
        return {timestamp_utc: new Date(start + i * 3600000).toISOString(), sun, earth, conditions: {sun_visible, earth_visible, co_visibility: sun_visible && earth_visible}};
      }),
    },
  };
}
