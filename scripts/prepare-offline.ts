import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { analyse } from '../backend/src/domain.js';
import { loadSites } from '../backend/src/repository.js';

// Run from the repository root with the Light-Link-Backend checkout in backend/.
const repo = await loadSites('backend/data/sites');
const dir = 'public/offline';
await mkdir(`${dir}/assets/heightmaps`, { recursive: true });
for (const id of ['Site01', 'Site07']) {
  const site = repo.get(id);
  const file = basename(site.heightmap_url);
  await copyFile(`backend/public/heightmaps/${file}`, `${dir}/assets/heightmaps/${file}`);
  for (const height of [2, 5]) {
    const { windows, metrics, ...payload } = analyse(site, { observer_height_m: height });
    await writeFile(`${dir}/${id}-${height}.json`, JSON.stringify(payload));
  }
}
