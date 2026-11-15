import { decode } from 'fast-png';
import type { HeightDecoder, HeightField } from './terrain.js';

/** Reads uint16 directly; never passes scientific heights through an 8-bit canvas. */
export function decodePng16(bytes: Uint8Array): HeightField {
  const image = decode(bytes, { checkCrc: true });
  if (image.depth !== 16 || image.channels !== 1 || image.palette || image.transparency) throw new Error('A 16-bit grayscale PNG without transparency is required');
  const values = new Float32Array(image.width * image.height);
  for (let i = 0; i < values.length; i++) values[i] = image.data[i] / 65535;
  return { width: image.width, height: image.height, values };
}

export const decodeHeightmap16: HeightDecoder = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Heightmap HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  signal.throwIfAborted();
  return decodePng16(bytes);
};
