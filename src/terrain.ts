import { PlaneGeometry } from 'three';
import type { SiteData } from './data.js';

export interface HeightField { width: number; height: number; values: Float32Array }
export type HeightDecoder = (url: string, signal: AbortSignal) => Promise<HeightField>;

/** Linear normalized red channel, 8 bit. Top row = north. No color texture conversion. */
export const decodeHeightmap: HeightDecoder = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Heightmap HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Cannot decode heightmap');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const values = new Float32Array(canvas.width * canvas.height);
    for (let i = 0; i < values.length; i++) {
      if (pixels[i * 4 + 3] !== 255) throw new Error('Heightmap contains transparent/no-data pixels');
      values[i] = pixels[i * 4] / 255;
    }
    return { width: canvas.width, height: canvas.height, values };
  } finally { bitmap.close(); }
};

export function sampleHeight(field: HeightField, u: number, v: number): number {
  const x = u * (field.width - 1), y = v * (field.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, field.width - 1), y1 = Math.min(y0 + 1, field.height - 1);
  const tx = x - x0, ty = y - y0, data = field.values;
  return (data[y0 * field.width + x0] * (1 - tx) + data[y0 * field.width + x1] * tx) * (1 - ty) + (data[y1 * field.width + x0] * (1 - tx) + data[y1 * field.width + x1] * tx) * ty;
}

export function buildTerrain(field: HeightField, metadata: SiteData['terrain_metadata'], segments: number): { geometry: PlaneGeometry; observerY: number } {
  if (!Number.isInteger(field.width) || !Number.isInteger(field.height) || field.width < 2 || field.height < 2 || field.values.length !== field.width * field.height || field.values.some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error('Invalid normalized height field');
  const geometry = new PlaneGeometry(metadata.patch_size_km, metadata.patch_size_km, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const base = metadata.min_elevation_m / 1000, range = (metadata.max_elevation_m - metadata.min_elevation_m) / 1000;
  for (let row = 0; row <= segments; row++) for (let col = 0; col <= segments; col++) positions.setY(row * (segments + 1) + col, base + range * sampleHeight(field, col / segments, row / segments));
  positions.needsUpdate = true;
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, observerY: base + range * sampleHeight(field, 0.5, 0.5) };
}
