import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, TextureLoader, SRGBColorSpace, RepeatWrapping } from 'three';
import {keepBelowBloom} from './proceduralTextures.js';
export const MOON_RADIUS_KM = 1737.4;
export const LOCAL_RADIUS_KM = 120;
/** Same square-perimeter parameterisation as the local ring, for a welded circular seam. */
export function ringDirection(t: number): [number, number] {
  const s = (t % 1) * 4, f = s % 1;
  const x = s < 1 ? -1 + 2*f : s < 2 ? 1 : s < 3 ? 1-2*f : -1;
  const z = s < 1 ? -1 : s < 2 ? -1+2*f : s < 3 ? 1 : 1-2*f;
  const length = Math.hypot(x,z); return [x/length,z/length];
}
export function lunarSag(radius: number): number {
  // Stable form of sqrt(R^2-r^2)-R near the origin.
  return -radius * radius / (MOON_RADIUS_KM + Math.sqrt(MOON_RADIUS_KM ** 2 - radius ** 2));
}
/** A whole sphere with only its 120 km local cap replaced by detailed terrain. */
export function buildMoonBody(centerY: number, angular = 128, latitude = 128) {
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = [];
  const start = Math.asin(LOCAL_RADIUS_KM / MOON_RADIUS_KM);
  for (let row=0;row<=latitude;row++) {
    const theta = start + (Math.PI-start)*row/latitude;
    const radius = row===0 ? LOCAL_RADIUS_KM : Math.sin(theta)*MOON_RADIUS_KM;
    const y = row===0 ? centerY+lunarSag(LOCAL_RADIUS_KM) : centerY-MOON_RADIUS_KM+Math.cos(theta)*MOON_RADIUS_KM;
    for(let col=0;col<=angular;col++) {
      const [dx,dz]=ringDirection(col/angular);
      positions.push(dx*radius,y,dz*radius);
      normals.push(dx*Math.sin(theta),Math.cos(theta),dz*Math.sin(theta));
      // Texture registration outside the site is illustrative; no global DEM is inferred.
      const angle = Math.atan2(dz,dx);
      uv.push(col===angular ? 1.125 : ((angle + Math.PI*.75 + Math.PI*2)%(Math.PI*2))/(Math.PI*2)+.125,theta/Math.PI);
    }
  }
  for(let row=0;row<latitude;row++) for(let col=0;col<angular;col++) {
    const a=row*(angular+1)+col,b=a+angular+1;
    indices.push(a,a+1,b,a+1,b+1,b);
  }
  const geometry=new BufferGeometry(); geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeBoundingSphere();return geometry;
}
export function createMoonBody(centerY: number) {
  const texture=new TextureLoader().load('/textures/moon_1024.jpg'); texture.colorSpace=SRGBColorSpace; texture.wrapS=RepeatWrapping;
  const material=new MeshStandardMaterial({map:texture,roughness:.96,metalness:.02});
  keepBelowBloom(material);
  const mesh=new Mesh(buildMoonBody(centerY),material);
  // Global day/night comes from sphere normals. The high-resolution shadow map stays local.
  mesh.castShadow=false;mesh.receiveShadow=false;
  return {mesh,dispose(){texture.dispose();material.dispose();mesh.geometry.dispose();}};
}
