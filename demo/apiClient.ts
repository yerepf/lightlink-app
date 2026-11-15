import { adaptBackendSite, BackendClient, BackendError, type BackendSiteSummary, type NewSite, type customDateRange } from '../src/backend';
import { decodeHeightmap16 } from '../src/png16';
import type { SiteData } from '../src/data';
import type { HeightField } from '../src/terrain';

export const OFFLINE_SITES = ['Site01', 'Site07'] as const;
export const TRAINING_SITE = 'Site07';
export type SiteOrigin = 'remote' | 'bundled' | 'mock' | 'local';
export interface SiteAsset { site: SiteData; field: HeightField; origin: SiteOrigin }
const directory = `${import.meta.env.BASE_URL}offline`;

function mayUseBundle(error: unknown, signal?: AbortSignal): boolean {
  return !signal?.aborted && (!(error instanceof BackendError) || error.status === 404 || error.status >= 500);
}

export class ApiClient {
  private readonly backend = new BackendClient(import.meta.env.VITE_API_URL?.trim() || '/api', 6500);
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
    const res = await fetch(`${directory}/${id}-${height}.json`, { signal });
    if (!res.ok) throw new Error(`Local copy unavailable: ${id} (${res.status}).`);
    const site = adaptBackendSite(await res.json(), directory);
    if (site.site_id !== id) throw new Error('The local copy does not match the requested site.');
    return { site, field: await decodeHeightmap16(site.heightmap_url, signal ?? new AbortController().signal), origin: 'bundled' };
  }

  async loadSite(id: string, height: 2 | 5, signal?: AbortSignal, range?: ReturnType<typeof customDateRange>, preferBundled = false): Promise<SiteAsset> {
    if (preferBundled && !range && OFFLINE_SITES.some(site => site === id)) return this.loadBundled(id, height, signal);
    try {
      const site = await this.backend.loadSite(id, height, signal, range);
      const timeout = AbortSignal.timeout(id.startsWith('custom_') ? 270000 : 6500);
      const field = await decodeHeightmap16(site.heightmap_url, signal ? AbortSignal.any([signal, timeout]) : timeout);
      return { site, field, origin: 'remote' };
    } catch (error) {
      if (range || !OFFLINE_SITES.some(site => site === id) || !mayUseBundle(error, signal)) throw error;
      return this.loadBundled(id, height, signal);
    }
  }
}
