import { localElevation, type SiteData } from './data.js';
import { sampleHeight, type HeightField } from './terrain.js';

type Metadata = SiteData['terrain_metadata'];
type Mask = SiteData['horizon_mask'];
const radians = Math.PI / 180;
const moonRadiusKm = 1737.4;

/** Ray march the original DEM, never the exaggerated mesh or procedural ring. */
export function localHorizon(field: HeightField, meta: Metadata, x: number, z: number, heightM: number, convergence: number): Mask {
  const size = meta.patch_size_km, half = size / 2;
  const step = size / (2 * Math.max(field.width - 1, field.height - 1));
  const scale = (meta.max_elevation_m - meta.min_elevation_m) / 1000;
  const elevation = (px: number, pz: number) => scale * sampleHeight(field, Math.max(0, Math.min(1, px / size + .5)), Math.max(0, Math.min(1, pz / size + .5)));
  const eye = elevation(x, z) + heightM / 1000;
  return Array.from({ length: 360 }, (_, azimuth_deg) => {
    const angle = (azimuth_deg + convergence) * radians;
    const dx = Math.sin(angle), dz = -Math.cos(angle);
    const edge = (origin: number, direction: number) => Math.abs(direction) < 1e-12 ? Infinity : ((direction > 0 ? half : -half) - origin) / direction;
    const end = Math.min(edge(x, dx), edge(z, dz));
    let max = -Infinity;
    for (let dist = Math.min(step, end); dist > 0;) {
      const rise = elevation(x + dx * dist, z + dz * dist) - eye - dist ** 2 / (2 * moonRadiusKm);
      max = Math.max(max, rise / dist);
      if (dist >= end) break;
      dist = Math.min(dist + step, end);
    }
    return { azimuth_deg, max_elevation_deg: Math.atan(max) / radians };
  });
}

export function analyseRelocation(site: SiteData, field: HeightField, x: number, z: number, heightM: number): SiteData {
  const horizon_mask = localHorizon(field, site.terrain_metadata, x, z, heightM, site.spatial?.grid_convergence_deg ?? 0);
  const ephemeris_timeline = site.ephemeris_timeline.map(frame => {
    const sun_visible = frame.sun.elevation_deg > localElevation(horizon_mask, frame.sun.azimuth_deg);
    const earth_visible = frame.earth.elevation_deg > localElevation(horizon_mask, frame.earth.azimuth_deg);
    return { ...frame, conditions: { sun_visible, earth_visible, co_visibility: sun_visible && earth_visible } };
  });
  return { ...site, horizon_mask, ephemeris_timeline };
}

/** Equal-area estimate on the native DEM grid, excluding the outermost pixels. */
export function safeTerrainPercent(field: HeightField, meta: Metadata): number {
  const { width, height, values } = field;
  const range = (meta.max_elevation_m - meta.min_elevation_m) / 1000;
  const horizontal = range * (width - 1) / (2 * meta.patch_size_km);
  const vertical = range * (height - 1) / (2 * meta.patch_size_km);
  const limit = Math.tan(10 * radians) ** 2;
  let safe = 0;
  for (let z = 1; z < height - 1; z++) for (let x = 1; x < width - 1; x++) {
    const i = z * width + x;
    if (((values[i + 1] - values[i - 1]) * horizontal) ** 2 + ((values[i + width] - values[i - width]) * vertical) ** 2 < limit) safe++;
  }
  return width > 2 && height > 2 ? 100 * safe / ((width - 2) * (height - 2)) : NaN;
}
