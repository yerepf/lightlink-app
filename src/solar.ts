import { Box3, DirectionalLight, Vector3 } from 'three';
/** Fit all eight corners in light space, not world X/Z, including elevated relief. */
export function fitSolarShadow(light: DirectionalLight, bounds: Box3) {
  light.updateMatrixWorld(); light.target.updateMatrixWorld();
  light.shadow.updateMatrices(light);
  const box = new Box3(), p = new Vector3();
  for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
    box.expandByPoint(p.set(x,y,z).applyMatrix4(light.shadow.camera.matrixWorldInverse));
  }
  const margin = Math.max(.1, bounds.getSize(p).length() * .03), camera = light.shadow.camera;
  camera.left = box.min.x - margin; camera.right = box.max.x + margin;
  camera.bottom = box.min.y - margin; camera.top = box.max.y + margin;
  camera.near = Math.max(.001, -box.max.z - margin); camera.far = Math.max(camera.near + 1, -box.min.z + margin);
  camera.updateProjectionMatrix(); light.shadow.needsUpdate = true;
}
export function linkColor(visible: boolean): number { return visible ? 0x65ed91 : 0xff5d65; }
