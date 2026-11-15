import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Let perspective mouse drags ease to a stop in elapsed time, independent of display refresh. */
export class ManualOrbitControls extends OrbitControls {
  override update(deltaTime: number | null = null): boolean {
    if (this.enableDamping) {
      // OrbitControls also updates inside its input handlers. Apply a small amount there
      // for instant feedback, then decay the remaining movement on each rendered frame.
      this.dampingFactor = deltaTime === null ? 0.16 : -Math.expm1(-Math.max(0, deltaTime) / 0.085);
    }
    return super.update(deltaTime);
  }

  setSmoothing(enabled: boolean): void {
    if (enabled === this.enableDamping) return;
    if (enabled) {
      this.enableDamping = true;
      return;
    }

    // Flush pending drag input without moving the displayed camera on a preference change.
    const position = this.object.position.clone();
    const rotation = this.object.quaternion.clone();
    const target = this.target.clone();
    this.enableDamping = false;
    super.update();
    this.object.position.copy(position);
    this.object.quaternion.copy(rotation);
    this.target.copy(target);
    this.object.updateMatrixWorld();
  }
}
