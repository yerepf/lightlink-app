import { parseSite, type SiteData } from './data.js';

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Backend: missing ${name}`);
  return value as Record<string, unknown>;
}
function number(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Backend: ${name} is not finite`);
  return value;
}

/** Adapts PB-05 without recalculating backend conditions or changing true-north angles. */
export function adaptBackendSite(input: unknown, apiBase = '/api'): SiteData {
  const raw = record(input, 'response'), h = record(raw.heightmap, 'heightmap'), target = record(raw.target, 'target');
  const n = (key: string) => number(h[key], `heightmap.${key}`);
  const t = (key: string) => number(target[key], `target.${key}`);
  const size = n('plane_size_m'), min = n('z_min_m'), scale = n('z_scale_m_per_dn');
  const height = number(raw.observer_height_m, 'observer_height_m');
  const px = n('web_px');
  const generated = (raw.provenance as Record<string, unknown> | undefined)?.generator === 'automatic-sites-v1';
  if (size <= 0 || scale <= 0 || !Number.isInteger(px) || px < 2 || ![2, 5].includes(height)) throw new Error('Backend: unsupported scale or observer height');
  if (generated) {
    const provenance = record(raw.provenance, 'provenance');
    const terrain = record(provenance.terrain, 'provenance.terrain');
    if (terrain.azimuth_frame !== 'true_north' || h.three_axes !== 'PNG fila 0 -> -Z; columna 0 -> -X; altura -> +Y' || n('center_lat') !== t('observer_lat_deg') || n('center_lon') !== t('observer_lon_deg')) throw new Error('Backend: unsupported generated coordinate frame');
  } else if (target.azimuth_frame !== 'true_north' || h.grid_north !== '+Y (fila 0 del PNG)' || !String(h.crs_proj4).includes('+lat_0=-90')) throw new Error('Backend: unsupported coordinate frame or encoding');
  if (!String(h.value_encoding).startsWith('uint16 grayscale')) throw new Error('Backend: unsupported encoding');
  if (Math.abs((n('z_max_m') - min) - scale * 65535) > 0.01 || Math.abs(size - n('vertex_spacing_m') * (px - 1)) > 0.01) throw new Error('Backend: inconsistent scale metadata');
  // automatic-sites-v1 centres the PNG exactly at the requested observer.
  const x = generated ? 0 : (t('observer_x_m') - n('center_x_m')) / 1000;
  const z = generated ? 0 : -(t('observer_y_m') - n('center_y_m')) / 1000;
  if (Math.abs(x) > size / 2000 || Math.abs(z) > size / 2000) throw new Error('Backend: observer is outside the heightmap');
  const staticMap = typeof raw.heightmap_url === 'string' && /^\/assets\/heightmaps\/[A-Za-z0-9_.-]+\.png$/.test(raw.heightmap_url);
  const dynamicMap = typeof raw.site_id === 'string' && /^[A-Za-z0-9_-]+$/.test(raw.site_id) && raw.heightmap_url === `/sites/${raw.site_id}/heightmap`;
  if (!staticMap && !dynamicMap) throw new Error('Backend: unsupported heightmap URL');
  return parseSite({
    site_id: raw.site_id,
    terrain_metadata: { patch_size_km: size / 1000, min_elevation_m: min, max_elevation_m: min + scale * 65535 },
    heightmap_url: apiBase.replace(/\/$/, '') + raw.heightmap_url,
    horizon_mask: raw.horizon_mask, ephemeris_timeline: raw.ephemeris_timeline,
    spatial: { observer_x_km: x, observer_y_km: (t('observer_ground_z_m') + height) / 1000, observer_z_km: z, grid_convergence_deg: generated ? n('grid_convergence_deg') : t('grid_convergence_deg') },
  });
}

export interface SiteCoordinates { latitude: number; longitude: number }
export interface BackendSiteSummary { site_id: string; name?: string; status?: string; observer_heights_m?: number[]; coordinates?: SiteCoordinates }
export interface NewSite { name: string; latitude: number; longitude: number }
export function validateCoordinates(input: NewSite): NewSite {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error('Enter a name between 1 and 120 characters.');
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) throw new Error('Latitude must be between −90 and 90 degrees.');
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 360) throw new Error('Longitude must be between −180 and 360 degrees.');
  return { ...input, name };
}
export function customDateRange(at: number) {
  const hour = Math.floor(at / 3600000) * 3600000;
  const utc = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');
  return { start_utc: utc(hour - 86400000), end_utc: utc(hour + 86400000) };
}
export class BackendError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export type SiteRange = ReturnType<typeof customDateRange> & { step_hours?: number };
export class BackendClient {
  constructor(readonly baseUrl = '/api', private readonly readTimeoutMs = 270000, private readonly sessionToken?: () => string | undefined) {}
  private async get(path: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
    const timeout = AbortSignal.timeout(body === undefined && !path.startsWith('/sites/custom_') ? this.readTimeoutMs : 270000);
    const token = (body !== undefined || path.startsWith('/sites/custom_') || path === '/me/sites') ? this.sessionToken?.() : undefined;
    const response = await fetch(this.baseUrl.replace(/\/$/, '') + path, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(token ? { cache: 'no-store' } : {}),
      ...(body !== undefined || token ? { headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } } : {}),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new BackendError(response.status, `API ${response.status}: ${typeof body?.error === 'string' ? body.error : response.statusText}`);
    }
    return response.json();
  }
  async listSites(signal?: AbortSignal): Promise<BackendSiteSummary[]> {
    const list = await this.get('/sites', signal);
    if (!Array.isArray(list) || list.some(s => !s || typeof s.site_id !== 'string')) throw new Error('API: invalid site catalog');
    return list;
  }
  async listSavedSites(signal?: AbortSignal): Promise<BackendSiteSummary[]> {
    if (!this.sessionToken?.()) return [];
    const list = await this.get('/me/sites', signal);
    if (!Array.isArray(list) || list.some(s => !s || typeof s.site_id !== 'string')) throw new Error('API: invalid saved site catalog');
    return list;
  }
  async registerSite(input: NewSite, signal?: AbortSignal): Promise<BackendSiteSummary> {
    const value = validateCoordinates(input);
    const result = record(await this.get('/sites', signal, { name: value.name, coordinates: { latitude: value.latitude, longitude: value.longitude } }), 'registered site');
    if (typeof result.site_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(result.site_id)) throw new Error('API: invalid site ID');
    return { site_id: result.site_id, name: value.name, coordinates: { latitude: value.latitude, longitude: value.longitude },
      status: typeof result.status === 'string' ? result.status : undefined };
  }
  async loadSite(id: string, height: 2 | 5 = 2, signal?: AbortSignal, range?: SiteRange): Promise<SiteData> {
    const query = new URLSearchParams({ observer_height_m: String(height) });
    if (range) { query.set('start_utc', range.start_utc); query.set('end_utc', range.end_utc); }
    if (range?.step_hours !== undefined) query.set('step_hours', String(range.step_hours));
    return adaptBackendSite(await this.get(`/sites/${encodeURIComponent(id)}?${query}`, signal), this.baseUrl);
  }
}
