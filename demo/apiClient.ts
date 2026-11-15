import { adaptBackendSite, BackendClient, BackendError, type BackendSiteSummary, type NewSite, type SiteRange } from '../src/backend';
import { decodeHeightmap16 } from '../src/png16';
import type { SiteData } from '../src/data';
import type { HeightField } from '../src/terrain';

export const OFFLINE_SITES = ['Site01', 'Site07'] as const;
export const TRAINING_SITE = 'Site07';
const precomputedSites = new Set(['Site01', 'Site04', 'Site06', 'Site07', 'Site11', 'Site20v2', 'Site23']);
export type SiteOrigin = 'remote' | 'bundled' | 'local';
export interface SiteAsset { site: SiteData; field: HeightField; origin: SiteOrigin }
const directory = `${import.meta.env.BASE_URL}offline`;
export const API_BASE = import.meta.env.VITE_API_URL?.trim() || '/api';

function mayUseBundle(error: unknown, signal?: AbortSignal): boolean {
  return !signal?.aborted && (!(error instanceof BackendError) || error.status === 404 || error.status >= 500);
}

export class ApiClient {
  private readonly backend: BackendClient;
  private readonly heightmaps = new Map<string, HeightField>();
  constructor(private readonly sessionToken?: () => string | undefined) {
    this.backend = new BackendClient(API_BASE, 6500, sessionToken);
  }

  listSavedSites(signal: AbortSignal) { return this.backend.listSavedSites(signal); }
  async listSites(signal?: AbortSignal): Promise<{ sites: BackendSiteSummary[]; offline: boolean }> {
    const bundled = OFFLINE_SITES.map(site_id => ({ site_id, observer_heights_m: [2, 5] }));
    try {
      const sites = await this.backend.listSites(signal);
      return { sites: [...sites, ...bundled.filter(b => !sites.some(s => s.site_id === b.site_id))], offline: false };
    } catch (error) {
      if (!mayUseBundle(error, signal)) throw error;
      return { sites: bundled, offline: true };
    }
  }

  registerSite(input: NewSite, signal?: AbortSignal): Promise<BackendSiteSummary> {
    return this.backend.registerSite(input, signal);
  }

  async loadBundled(id: string, height: 2 | 5, signal?: AbortSignal): Promise<SiteAsset> {
    if (!OFFLINE_SITES.some(site => id === site)) throw new Error('There is no local copy of this site.');
    return this.loadPrecomputed(this.bundledProfile(id, height, signal), directory, id, 'bundled', signal);
  }

  private async bundledProfile(id: string, height: 2 | 5, signal?: AbortSignal): Promise<SiteData> {
    const res = await fetch(`${directory}/${id}-${height}.json`, { signal });
    if (!res.ok) throw new Error(`Local copy unavailable: ${id} (${res.status}).`);
    const site = adaptBackendSite(await res.json(), directory);
    if (site.site_id !== id) throw new Error('The local copy does not match the requested site.');
    return site;
  }

  private async publicHeightmap(url: string, signal: AbortSignal): Promise<HeightField> {
    signal.throwIfAborted();
    const cached = this.heightmaps.get(url);
    const field = cached ?? await decodeHeightmap16(url, signal);
    this.heightmaps.delete(url);
    this.heightmaps.set(url, field);
    // Keep recent public grids in memory without retaining every visited site.
    if (this.heightmaps.size > 3) this.heightmaps.delete(this.heightmaps.keys().next().value!);
    return field;
  }

  private async loadPrecomputed(profile: Promise<SiteData>, base: string, id: string, origin: 'remote' | 'bundled', signal?: AbortSignal): Promise<SiteAsset> {
    const prefetch = new AbortController();
    const timeout = AbortSignal.timeout(15000);
    const mapSignal = AbortSignal.any(signal ? [signal, prefetch.signal, timeout] : [prefetch.signal, timeout]);
    const expectedUrl = `${base.replace(/\/$/, '')}/assets/heightmaps/${id}_heightmap_1024.png`;
    const download = this.publicHeightmap(expectedUrl, mapSignal);
    // The profile can point at a new filename or fail before the terrain arrives.
    void download.catch(() => {});
    try {
      const site = await profile;
      const field = site.heightmap_url === expectedUrl ? await download : await this.publicHeightmap(site.heightmap_url, mapSignal);
      return { site, field, origin };
    } finally { prefetch.abort(); }
  }

  async loadSite(id: string, height: 2 | 5, signal?: AbortSignal, range?: SiteRange, preferBundled = false): Promise<SiteAsset> {
    if (preferBundled && !range && OFFLINE_SITES.some(site => site === id)) return this.loadBundled(id, height, signal);
    try {
      if (precomputedSites.has(id)) return await this.loadPrecomputed(this.backend.loadSite(id, height, signal, range), API_BASE, id, 'remote', signal);
      const site = await this.backend.loadSite(id, height, signal, range);
      const timeout = AbortSignal.timeout(id.startsWith('custom_') ? 270000 : 6500);
      const token = id.startsWith('custom_') ? this.sessionToken?.() : undefined;
      const field = await decodeHeightmap16(site.heightmap_url, signal ? AbortSignal.any([signal, timeout]) : timeout, token);
      return { site, field, origin: 'remote' };
    } catch (error) {
      if (range || !OFFLINE_SITES.some(site => site === id) || !mayUseBundle(error, signal)) throw error;
      return this.loadBundled(id, height, signal);
    }
  }
}
