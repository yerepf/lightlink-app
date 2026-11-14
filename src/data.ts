export interface Direction { azimuth_deg: number; elevation_deg: number }
export interface Conditions { sun_visible: boolean; earth_visible: boolean; co_visibility: boolean }
export interface Frame {
  timestamp_utc: string;
  sun: Direction;
  earth: Direction;
  conditions: Conditions;
}
export interface SiteData {
  site_id: string;
  terrain_metadata: { patch_size_km: number; min_elevation_m: number; max_elevation_m: number };
  horizon_mask: { azimuth_deg: number; max_elevation_deg: number }[];
  ephemeris_timeline: Frame[];
  heightmap_url: string;
  /** Optional projected frame supplied by the backend adapter. */
  spatial?: { observer_x_km: number; observer_y_km: number; observer_z_km: number; grid_convergence_deg: number };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const azimuth = (v: unknown) => finite(v) && v >= 0 && v < 360;
const elevation = (v: unknown) => finite(v) && v >= -90 && v <= 90;

/** Validates at the network boundary and returns an owned copy. */
export function parseSite(input: unknown): SiteData {
  const s = input as SiteData;
  const fail = (message: string): never => { throw new Error(`Invalid site: ${message}`); };
  if (!s || typeof s.site_id !== 'string' || !s.site_id || typeof s.heightmap_url !== 'string' || !s.heightmap_url) fail('identity/heightmap_url');
  const m = s.terrain_metadata;
  if (!m || !finite(m.patch_size_km) || m.patch_size_km <= 0 || !finite(m.min_elevation_m) || !finite(m.max_elevation_m) || m.max_elevation_m < m.min_elevation_m) fail('terrain_metadata');
  if (s.spatial && ![s.spatial.observer_x_km, s.spatial.observer_y_km, s.spatial.observer_z_km, s.spatial.grid_convergence_deg].every(finite)) fail('spatial');
  if (!Array.isArray(s.horizon_mask) || !s.horizon_mask.length) fail('empty horizon_mask');
  const seen = new Set<number>();
  for (const h of s.horizon_mask) {
    if (!h || !azimuth(h.azimuth_deg) || !elevation(h.max_elevation_deg) || seen.has(h.azimuth_deg)) fail('horizon_mask');
    seen.add(h.azimuth_deg);
  }
  if (!Array.isArray(s.ephemeris_timeline) || !s.ephemeris_timeline.length) fail('empty timeline');
  let previous = -Infinity;
  for (const f of s.ephemeris_timeline) {
    if (!f || typeof f.timestamp_utc !== 'string' || !f.timestamp_utc.endsWith('Z')) fail('UTC timestamp required');
    const time = Date.parse(f.timestamp_utc);
    if (!finite(time) || time <= previous) fail('timestamps must be valid and strictly increasing');
    previous = time;
    for (const d of [f.sun, f.earth]) if (!d || !azimuth(d.azimuth_deg) || !elevation(d.elevation_deg)) fail('direction');
    const c = f.conditions;
    if (!c || [c.sun_visible, c.earth_visible, c.co_visibility].some(v => typeof v !== 'boolean') || c.co_visibility !== (c.sun_visible && c.earth_visible)) fail('conditions');
  }
  const result = structuredClone(s);
  result.horizon_mask.sort((a, b) => a.azimuth_deg - b.azimuth_deg);
  return result;
}

/** East +X, up +Y, north -Z; azimuth clockwise from north. */
export function directionXYZ(azimuthDeg: number, elevationDeg: number, out: { set(x: number, y: number, z: number): unknown }): void {
  const a = azimuthDeg * Math.PI / 180, e = elevationDeg * Math.PI / 180;
  out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

export function interpolateAzimuth(a: number, b: number, t: number): number {
  return (a + (((b - a + 540) % 360) - 180) * t + 360) % 360;
}

export function lowerIndex(values: Float64Array, time: number): number {
  let lo = 0, hi = values.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (values[mid] <= time) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function horizonElevation(mask: SiteData['horizon_mask'], az: number): number {
  az = ((az % 360) + 360) % 360;
  let lo = 0, hi = mask.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (mask[mid].azimuth_deg <= az) lo = mid + 1; else hi = mid; }
  const a = mask[(lo - 1 + mask.length) % mask.length], b = mask[lo % mask.length];
  const span = (b.azimuth_deg - a.azimuth_deg + 360) % 360;
  return span === 0 ? a.max_elevation_deg : a.max_elevation_deg + (b.max_elevation_deg - a.max_elevation_deg) * ((az - a.azimuth_deg + 360) % 360) / span;
}

export interface TimeState {
  timestampMs: number;
  sun: Direction;
  earth: Direction;
  /** Backend sample held until the next sample; never interpolated booleans. */
  conditions: Conditions;
  sampleTimestampUtc: string;
  horizonEstimate: Conditions;
}

export class Timeline {
  readonly times: Float64Array;
  readonly state: TimeState;
  constructor(private readonly site: SiteData) {
    this.times = Float64Array.from(site.ephemeris_timeline, f => Date.parse(f.timestamp_utc));
    this.state = { timestampMs: 0, sun: { azimuth_deg: 0, elevation_deg: 0 }, earth: { azimuth_deg: 0, elevation_deg: 0 }, conditions: site.ephemeris_timeline[0].conditions, sampleTimestampUtc: '', horizonEstimate: { sun_visible: false, earth_visible: false, co_visibility: false } };
  }
  sample(time: number): TimeState {
    if (!Number.isFinite(time)) throw new Error('Time must be finite milliseconds since epoch');
    const times = this.times;
    time = Math.max(times[0], Math.min(times[times.length - 1], time));
    const i = lowerIndex(times, time), j = Math.min(i + 1, times.length - 1);
    const a = this.site.ephemeris_timeline[i], b = this.site.ephemeris_timeline[j];
    const t = i === j ? 0 : (time - times[i]) / (times[j] - times[i]);
    const state = this.state;
    for (const key of ['sun', 'earth'] as const) {
      state[key].azimuth_deg = interpolateAzimuth(a[key].azimuth_deg, b[key].azimuth_deg, t);
      state[key].elevation_deg = a[key].elevation_deg + (b[key].elevation_deg - a[key].elevation_deg) * t;
    }
    state.timestampMs = time;
    state.conditions = a.conditions;
    state.sampleTimestampUtc = a.timestamp_utc;
    state.horizonEstimate.sun_visible = state.sun.elevation_deg > horizonElevation(this.site.horizon_mask, state.sun.azimuth_deg);
    state.horizonEstimate.earth_visible = state.earth.elevation_deg > horizonElevation(this.site.horizon_mask, state.earth.azimuth_deg);
    state.horizonEstimate.co_visibility = state.horizonEstimate.sun_visible && state.horizonEstimate.earth_visible;
    return state;
  }
}
