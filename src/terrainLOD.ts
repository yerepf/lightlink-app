import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';
import { buildTerrain, sampleHeight, type HeightField } from './terrain.js';
import { regolithTexture, keepBelowBloom } from './proceduralTextures.js';
import { lunarSag } from './MoonBody.js';
import type { SiteData } from './data.js';

/** Two spatial resolutions in kilometres; outer relief is illustrative, not a DEM. */
export function createTerrainLOD(field: HeightField, metadata: SiteData['terrain_metadata'], segments = 512) {
  const { geometry, observerY } = buildTerrain(field, metadata, segments);
  const centerY = geometry.attributes.position.getY((segments / 2) * (segments + 1) + segments / 2);
  const material = new MeshStandardMaterial({ color: 0x999794, roughness: 0.96, metalness: 0.02 });
  const bump=regolithTexture(metadata.patch_size_km);
  material.bumpMap=bump;
  // Normal perturbation only: this does not displace scientific vertex heights.
  material.bumpScale=.15;keepBelowBloom(material);
  const topoMaterial = new ShaderMaterial({
    uniforms: { low: { value: metadata.min_elevation_m / 1000 }, high: { value: metadata.max_elevation_m / 1000 } },
    vertexShader: `attribute float elevation; varying float h; void main(){h=elevation;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float low; uniform float high; varying float h; void main(){float t=clamp((h-low)/max(high-low,.001),0.,1.);vec3 c=mix(vec3(.13,.24,.31),vec3(.85,.78,.53),t);float contour=abs(fract(h*10.+.5)-.5);float edge=max(fwidth(h*10.),.008);c*=mix(.55,1.,smoothstep(0.,edge*1.5,contour));gl_FragColor=vec4(c,1.);\n #include <colorspace_fragment>\n }`,
  });
  const group = new Group();
  const half = metadata.patch_size_km / 2, angular = 128, radial = 64;
  const base = metadata.min_elevation_m / 1000, range = (metadata.max_elevation_m - metadata.min_elevation_m) / 1000;
  // Parameterise a square perimeter: every high-resolution boundary vertex is stitched.
  function perimeter(t: number): [number, number] {
    const s = (t % 1) * 4, f = s % 1;
    if (s < 1) return [-half + f * 2 * half, -half];
    if (s < 2) return [half, -half + f * 2 * half];
    if (s < 3) return [half - f * 2 * half, half];
    return [-half, half - f * 2 * half];
  }
  const vertices: number[] = [], indices: number[] = [], curvature: number[] = [];
  const counts = [segments * 4, ...Array(radial).fill(angular)] as number[];
  const starts: number[] = [];
  for (let row = 0; row <= radial; row++) {
    starts.push(vertices.length / 3);
    const t = row / radial, blend = t * t * (3 - 2 * t);
    for (let col = 0; col < counts[row]; col++) {
      const [px, pz] = perimeter(col / counts[row]), innerR = Math.hypot(px, pz);
      const r = innerR + (120 - innerR) * t, x = px / innerR * r, z = pz / innerR * r;
      const edge = base + range * sampleHeight(field, (px + half) / (2 * half), (pz + half) / (2 * half));
      const ridges = 0.55 * Math.sin(x * .23) * Math.cos(z * .19) + .22 * Math.sin(x * .71 + z * .43);
      const craterR = Math.hypot(x - 32, z + 18);
      const crater = .9 * Math.exp(-(((craterR - 13) / 2.2) ** 2)) - .5 * Math.exp(-((craterR / 10) ** 4));
      const sag = lunarSag(r) * blend;
      const relief = (edge - centerY) * (1 - blend) + (ridges + crater) * Math.sin(Math.PI * t) ** 2;
      const y = centerY + sag + relief;
      curvature.push(sag);
      vertices.push(x, y, z);
    }
  }
  // Merge two cyclic polylines, retaining every DEM edge sample at the seam.
  for (let row = 0; row < radial; row++) {
    const n = counts[row], m = counts[row + 1], a = starts[row], b = starts[row + 1];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && (i + 1) / n <= (j + 1) / m) {
        indices.push(a + i % n, b + j % m, a + (i + 1) % n); i++;
      } else {
        indices.push(a + i % n, b + j % m, b + (j + 1) % m); j++;
      }
    }
  }
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const outer = new BufferGeometry();
  outer.setAttribute('position', new Float32BufferAttribute(vertices, 3)); outer.setIndex(indices);
  outer.setAttribute('uv',new Float32BufferAttribute(Array.from({length:vertices.length/3},(_,i)=>[vertices[i*3]/metadata.patch_size_km+.5,.5-vertices[i*3+2]/metadata.patch_size_km]).flat(),2));
  for (const g of [geometry, outer]) {
    const mesh = new Mesh(g, material); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  const originals = [geometry, outer].map(g => Float32Array.from(g.attributes.position.array));
  [geometry, outer].forEach((g, index) => {
    g.setAttribute('elevation', new Float32BufferAttribute(Array.from({length: g.attributes.position.count}, (_, i) => originals[index][i * 3 + 1]), 1));
  });
  return {
    group, centerY,
    setTopographic(enabled: boolean) { for (const mesh of group.children as Mesh[]) mesh.material = enabled ? topoMaterial : material; },
    disposeMaterials() { bump?.dispose(); material.dispose(); topoMaterial.dispose(); },
    setExaggeration(value: number) {
      [geometry, outer].forEach((g, index) => {
        const p = g.attributes.position, original = originals[index];
        for (let i = 0; i < p.count; i++) {
          const sag = index === 1 ? curvature[i] : 0;
          p.setY(i, centerY + sag + (original[i * 3 + 1] - centerY - sag) * value);
        }
        p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
      });
    },
  };
}
