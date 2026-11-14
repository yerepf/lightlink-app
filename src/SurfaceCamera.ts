import { PerspectiveCamera, OrthographicCamera, Vector3, Quaternion } from 'three';
import { MOON_RADIUS_KM } from './MoonBody.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
/** Match an orthographic ground-plane footprint before beginning a perspective flight. */
export function mapExitFov(camera: OrthographicCamera, target: Vector3): number {
  const halfHeight = (camera.top - camera.bottom) / (2 * camera.zoom);
  const distance = Math.max(.00001, camera.position.distanceTo(target));
  return 2 * Math.atan(halfHeight / distance) * 180 / Math.PI;
}
export type ViewMode = 'surface' | 'orbital' | 'cinematic' | 'top' | 'globe' | 'lander';
/** OrbitControls supplies gestures; translate its pivot after each update to pin the eye. */
export class SurfaceCamera {
  mode: ViewMode = 'surface';
  cinematicPaused = false;
  private phase = 0;
  private transition?: { elapsed: number; from: Vector3; to: Vector3; fromQ: Quaternion; toQ: Quaternion; fromFov: number; toFov: number; clearance: number; spherical: boolean; center: Vector3 };
  get isTransitioning() { return !!this.transition; }
  transitionTo(eye: Vector3, radius: number, mode: ViewMode, animate = true) {
    const spherical = mode === 'globe' || this.mode === 'globe' || this.transition?.spherical === true;
    const center = new Vector3(eye.x, this.groundY - MOON_RADIUS_KM, eye.z);
    const from = this.camera.position.clone(), fromQ = this.camera.quaternion.clone(), fromFov = this.camera.fov;
    this.configure(eye, radius, mode);
    if (!animate) return;
    this.transition = { elapsed: 0, from, to: this.camera.position.clone(), fromQ, toQ: this.camera.quaternion.clone(), fromFov, toFov: this.camera.fov, spherical, center, clearance: spherical ? Math.max(from.distanceTo(center), this.camera.position.distanceTo(center), MOON_RADIUS_KM + this.terrainCeiling - this.groundY + 300) : Math.max(from.y, this.camera.position.y, this.terrainCeiling) + 3 };
    this.controls.enabled = false; this.camera.position.copy(from); this.camera.quaternion.copy(fromQ);
    this.camera.fov = fromFov; this.camera.updateProjectionMatrix();
  }
  private readonly inspectionPosition=new Vector3(.012,.02,.016);
  private readonly inspectionTarget=new Vector3(0,.004,0);
  setInspectionPose(position:Vector3,target:Vector3){this.inspectionPosition.copy(position);this.inspectionTarget.copy(target);}
  private groundY = 0;
  setGroundHeight(height: number) { this.groundY = height; }
  private radius = 12;
  private terrainCeiling = 0;
  private readonly aim = new Vector3();
  setTerrainCeiling(height: number) { this.terrainCeiling = height; }
  private readonly eye = new Vector3();
  private readonly offset = new Vector3();
  constructor(private camera: PerspectiveCamera, private controls: OrbitControls) {}
  configure(eye: Vector3, radius: number, mode = this.mode) {
    this.transition = undefined;
    this.mode = mode; this.eye.copy(eye); this.radius = radius;
    this.controls.enabled = mode !== 'cinematic' && mode !== 'top';
    this.camera.up.set(0, 1, 0);
    if (mode === 'lander') {
      this.controls.enableDamping=false;this.controls.enablePan=false;this.controls.enableZoom=true;
      this.controls.minPolarAngle=.02;this.controls.maxPolarAngle=Math.PI/2-.03;
      this.controls.minDistance=.006;this.controls.maxDistance=.08;
      this.controls.target.copy(this.inspectionTarget);
      this.camera.position.copy(this.inspectionPosition);
      this.camera.fov=45;this.camera.near=.00001;this.camera.far=30000;this.camera.updateProjectionMatrix();this.controls.update();return;
    }
    if (mode === 'globe') {
      this.controls.enableDamping = false; this.controls.enablePan = false; this.controls.enableZoom = true;
      this.controls.minPolarAngle = .01; this.controls.maxPolarAngle = Math.PI - .01;
      this.controls.minDistance = MOON_RADIUS_KM + Math.max(150, this.terrainCeiling - this.groundY + 10); this.controls.maxDistance = 14000;
      this.controls.target.set(0, this.groundY - MOON_RADIUS_KM, 0);
      const halfAngle = Math.atan(Math.tan(Math.PI/8)*Math.min(1,this.camera.aspect));
      const distance = Math.max(6000,MOON_RADIUS_KM/Math.sin(halfAngle)*1.15);
      this.camera.position.copy(this.controls.target).add(new Vector3(.8,1,.65).normalize().multiplyScalar(distance));
      this.camera.fov=45;this.camera.near=1;this.camera.far=30000;this.camera.updateProjectionMatrix();this.controls.update();return;
    }
    if (mode === 'top') {
      this.camera.position.set(eye.x, Math.max(eye.y, this.terrainCeiling) + radius * 2.8, eye.z);
      this.camera.up.set(0, 0, -1); this.camera.lookAt(eye);
      this.camera.fov = 55; this.camera.near = .001; this.camera.far = 30000; this.camera.updateProjectionMatrix();
      this.controls.target.copy(eye); return;
    }
    if (mode === 'cinematic') {
      this.camera.fov = 62; this.camera.near = .001; this.camera.far = 30000;
      this.camera.updateProjectionMatrix(); this.updateCinematic(); return;
    }
    this.controls.enableDamping = false;
    this.controls.enablePan = mode === 'orbital'; this.controls.enableZoom = mode === 'orbital';
    this.controls.minPolarAngle = mode === 'surface' ? Math.PI / 2 : .05;
    this.controls.maxPolarAngle = mode === 'surface' ? Math.PI - .02 : Math.PI / 2 - .01;
    this.controls.minDistance = mode === 'surface' ? .1 : radius * .02;
    this.controls.maxDistance = mode === 'surface' ? .1 : 250;
    this.camera.fov = 55; this.camera.near = .00001; this.camera.far = 30000; this.camera.updateProjectionMatrix();
    this.camera.position.copy(eye);
    if (mode === 'surface') this.controls.target.copy(eye).add(new Vector3(.099679486, .008, 0));
    else { this.camera.position.add(new Vector3(radius, Math.max(radius * .8, this.terrainCeiling - eye.y + 3), radius)); this.controls.target.copy(eye); }
    this.update(0);
  }
  private updateCinematic() {
    const orbit = Math.max(18, this.radius * 1.9);
    const altitude = Math.max(this.eye.y, this.terrainCeiling) + 6 + this.radius * .45;
    this.camera.position.set(
      this.eye.x + Math.cos(this.phase) * orbit,
      altitude + Math.sin(this.phase * 2) * 1.2,
      this.eye.z + Math.sin(this.phase) * orbit,
    );
    // A distant look target keeps the horizon in frame rather than looking straight down.
    this.aim.set(this.eye.x - Math.cos(this.phase) * 25, this.eye.y, this.eye.z - Math.sin(this.phase) * 25);
    this.camera.up.set(Math.sin(this.phase * .7) * .012, 1, Math.cos(this.phase * .7) * .012).normalize();
    this.camera.lookAt(this.aim);
    this.controls.target.copy(this.aim);
  }
  update(delta: number) {
    if (this.transition) {
      const t = this.transition; t.elapsed = Math.min(3, t.elapsed + Math.max(0, delta));
      const progress = t.elapsed / 3, part = Math.min(2, Math.floor(t.elapsed));
      const local = t.elapsed === 3 ? 1 : t.elapsed - part, smooth = local * local * (3 - 2 * local);
      if (t.spherical) {
        const from = t.from.clone().sub(t.center), to = t.to.clone().sub(t.center);
        const fromRadius = from.length(), toRadius = to.length(); from.normalize(); to.normalize();
        if (part === 0) this.camera.position.copy(from).multiplyScalar(fromRadius + (t.clearance-fromRadius)*smooth).add(t.center);
        else if (part === 2) this.camera.position.copy(to).multiplyScalar(t.clearance+(toRadius-t.clearance)*smooth).add(t.center);
        else {
          const rotation = new Quaternion().setFromUnitVectors(from,to);
          this.camera.position.copy(from).applyQuaternion(new Quaternion().slerp(rotation,smooth)).multiplyScalar(t.clearance).add(t.center);
        }
      }
      else if (part === 0) this.camera.position.copy(t.from).setY(t.from.y + (t.clearance - t.from.y) * smooth);
      else if (part === 1) this.camera.position.lerpVectors(t.from, t.to, smooth).setY(t.clearance);
      else this.camera.position.copy(t.to).setY(t.clearance + (t.to.y - t.clearance) * smooth);
      const eased = progress * progress * (3 - 2 * progress);
      this.camera.quaternion.slerpQuaternions(t.fromQ, t.toQ, eased);
      this.camera.fov = t.fromFov + (t.toFov - t.fromFov) * eased; this.camera.updateProjectionMatrix();
      if (progress === 1) { this.transition = undefined; this.controls.enabled = this.mode === 'surface' || this.mode === 'orbital' || this.mode === 'globe' || this.mode === 'lander'; }
      return;
    }
    if (this.mode === 'top') return;
    if (this.mode === 'cinematic') {
      if (!this.cinematicPaused) this.phase += Math.max(0, Math.min(delta, .1)) * .018;
      this.updateCinematic(); return;
    }
    this.controls.update(delta);
    if (this.mode === 'surface') {
      this.offset.subVectors(this.eye, this.camera.position);
      this.camera.position.copy(this.eye); this.controls.target.add(this.offset);
    }
  }
}
