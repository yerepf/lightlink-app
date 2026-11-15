import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3, PerspectiveCamera, OrthographicCamera } from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrainLOD } from '../src/terrainLOD.js';
import { SurfaceCamera, mapExitFov } from '../src/SurfaceCamera.js';
import { ManualOrbitControls } from '../src/ManualOrbitControls.js';

function mouseOrbit() {
  const camera = new PerspectiveCamera();
  const canvas = Object.assign(new EventTarget(), {
    clientHeight: 600, style: {}, getRootNode() { return this; }, setPointerCapture() {}, releasePointerCapture() {},
  });
  const controls = new ManualOrbitControls(camera, canvas as unknown as HTMLElement);
  const view = new SurfaceCamera(camera, controls);
  controls.setSmoothing(true);
  view.configure(new Vector3(), 12, 'orbital');
  const drag = () => {
    for (const [kind, clientX] of [['pointerdown', 200], ['pointermove', 270], ['pointerup', 270]] as const) {
      canvas.dispatchEvent(Object.assign(new Event(kind), { button: 0, pointerId: 1, pointerType: 'mouse', clientX, clientY: 300 }));
    }
  };
  return { camera, controls, view, drag };
}

test('mouse orbit reacts during the drag and eases out at the same rate at 30 and 120 FPS', () => {
  const slow = mouseOrbit(), fast = mouseOrbit();
  const start = slow.camera.quaternion.clone();
  slow.drag(); fast.drag();
  const released = slow.camera.quaternion.clone();
  assert.ok(start.angleTo(released) > 0.05);
  for (let i = 0; i < 6; i++) slow.view.update(1 / 30);
  for (let i = 0; i < 24; i++) fast.view.update(1 / 120);
  assert.ok(released.angleTo(slow.camera.quaternion) > 0.2);
  assert.ok(slow.camera.quaternion.angleTo(fast.camera.quaternion) < 1e-6);
});

test('reduced motion and preset changes discard the previous drag', () => {
  const { camera, controls, view, drag } = mouseOrbit();
  drag();
  const released = camera.quaternion.clone();
  controls.setSmoothing(false);
  view.update(1 / 60);
  assert.ok(camera.quaternion.angleTo(released) < 1e-6);
  drag();
  const direct = camera.quaternion.clone();
  view.update(1 / 60);
  assert.ok(camera.quaternion.angleTo(direct) < 1e-6);
  controls.setSmoothing(true);
  drag();
  const eye = new Vector3(1, 2, 3);
  view.configure(eye, 12, 'surface');
  const surface = camera.quaternion.clone();
  view.update(1 / 60);
  assert.deepEqual(camera.position, eye);
  assert.ok(camera.quaternion.angleTo(surface) < 1e-6);
});

test('LOD seam retains every central boundary sample at 1x and 15x, with upward winding', () => {
  const field = { width: 3, height: 3, values: new Float32Array([0,.3,.5,.2,.6,.9,.1,.7,1]) };
  const lod = createTerrainLOD(field, {patch_size_km:16,min_elevation_m:-100,max_elevation_m:1300}, 8);
  for (const factor of [1,15]) {
    lod.setExaggeration(factor);
    const inner = (lod.group.children[0] as Mesh).geometry.attributes.position;
    const outer = (lod.group.children[1] as Mesh).geometry;
    for(let i=0;i<32;i++) {
      const p = new Vector3().fromBufferAttribute(outer.attributes.position,i);
      let distance=Infinity;
      for(let j=0;j<inner.count;j++) distance=Math.min(distance,p.distanceTo(new Vector3().fromBufferAttribute(inner,j)));
      assert.ok(distance<1e-5,`seam ${i}: ${distance}`);
    }
    assert.equal(inner.getY(40),lod.centerY);
    const index=outer.index!;
    for(let i=0;i<index.count;i+=3){
      const a=new Vector3().fromBufferAttribute(outer.attributes.position,index.getX(i));
      const b=new Vector3().fromBufferAttribute(outer.attributes.position,index.getX(i+1));
      const c=new Vector3().fromBufferAttribute(outer.attributes.position,index.getX(i+2));
      assert.ok(b.sub(a).cross(c.sub(a)).y>=-1e-8);
    }
  }
});
test('surface controls pin the eye after orbit gestures, keeping target 0.1 km ahead',()=>{
  const camera=new PerspectiveCamera(), eye=new Vector3(0,.742,0);
  const controls={target:new Vector3(),update(){}} as unknown as OrbitControls;
  const view=new SurfaceCamera(camera,controls);view.configure(eye,12);
  camera.position.add(new Vector3(.03,-.01,.04));
  const before=controls.target.clone().sub(camera.position).normalize();
  view.update(0);
  assert.deepEqual(camera.position,eye);
  assert.ok(controls.target.clone().sub(camera.position).normalize().distanceTo(before)<1e-10);
  view.configure(eye,12,'orbital');assert.ok(camera.position.distanceTo(eye)>12);
});

test('cinematic flight clears the terrain ceiling, pauses, and restores manual controls', () => {
  const camera = new PerspectiveCamera();
  const controls = { target: new Vector3(), enabled: true, update() {} } as unknown as OrbitControls;
  const view = new SurfaceCamera(camera, controls);
  view.setTerrainCeiling(45);
  view.configure(new Vector3(0, .742, 0), 12, 'cinematic');
  assert.equal(controls.enabled, false);
  const initial = camera.position.clone();
  for (let i = 0; i < 100; i++) view.update(.1);
  assert.ok(camera.position.y > 45);
  assert.ok(camera.position.distanceTo(initial) > 1);
  view.cinematicPaused = true;
  const paused = camera.position.clone(); view.update(.1);
  assert.deepEqual(camera.position, paused);
  view.configure(new Vector3(0, .742, 0), 12, 'surface');
  assert.equal(controls.enabled, true);
  assert.equal(camera.fov, 55);
  assert.deepEqual(camera.up, new Vector3(0, 1, 0));
});

test('preset transition rises before horizontal travel and descends vertically to lander', () => {
  const camera = new PerspectiveCamera();
  const controls = { target: new Vector3(), enabled: true, update() {} } as unknown as OrbitControls;
  const view = new SurfaceCamera(camera, controls), eye = new Vector3(0,.742,0);
  view.setTerrainCeiling(20); view.configure(eye,12);
  view.transitionTo(eye,12,'orbital');
  for (let i=0;i<31;i++) {
    view.update(.1);
    if (camera.position.x !== 0 || camera.position.z !== 0) assert.ok(camera.position.y >= 23 - 1e-8);
  }
  assert.equal(view.isTransitioning,false);
  view.transitionTo(eye,12,'surface');
  for (let i=0;i<31;i++) {
    view.update(.1);
    if (camera.position.y < 23 - 1e-8) { assert.equal(camera.position.x,0); assert.equal(camera.position.z,0); }
  }
  assert.ok(camera.position.distanceTo(eye)<1e-8);
  view.configure(eye,12,'top');
  assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(new Vector3(0,-1,0))<1e-8);
});


test('zoomed map exit preserves ground-plane framing before camera flight', () => {
  const map = new OrthographicCamera(-40,40,20,-20,.001,2500), target = new Vector3(12,.742,-8);
  map.position.copy(target).add(new Vector3(0,60,0));
  for (const zoom of [.25,1,10,50]) {
    map.zoom = zoom;
    const fov = mapExitFov(map,target);
    const visibleHeight = 2 * map.position.distanceTo(target) * Math.tan(fov*Math.PI/360);
    assert.ok(Math.abs(visibleHeight - (map.top-map.bottom)/zoom)<1e-9);
    const camera = new PerspectiveCamera(fov); camera.position.copy(map.position);
    const controls = { target: target.clone(), enabled: false, update() {} } as unknown as OrbitControls;
    const view = new SurfaceCamera(camera,controls); view.setTerrainCeiling(20);
    view.transitionTo(target,12,'surface');
    assert.equal(camera.fov,fov);
    assert.deepEqual(camera.position,map.position);
  }
});
