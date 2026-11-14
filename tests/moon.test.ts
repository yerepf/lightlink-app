import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Mesh,PerspectiveCamera} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {buildMoonBody, MOON_RADIUS_KM, LOCAL_RADIUS_KM} from '../src/MoonBody.js';
import {createTerrainLOD} from '../src/terrainLOD.js';
import {SurfaceCamera} from '../src/SurfaceCamera.js';

test('whole Moon is spherical, outward-facing and welded to local ring at every exaggeration',()=>{
  const terrain=createTerrainLOD({width:2,height:2,values:new Float32Array([0,.3,.7,1])},{patch_size_km:16,min_elevation_m:-2000,max_elevation_m:3000},8);
  const body=buildMoonBody(terrain.centerY),p=body.attributes.position;
  const center=new Vector3(0,terrain.centerY-MOON_RADIUS_KM,0);
  for(let i=0;i<p.count;i+=31) assert.ok(Math.abs(new Vector3().fromBufferAttribute(p,i).distanceTo(center)-MOON_RADIUS_KM)<.0003);
  for(const factor of [1,4,15]) {
    terrain.setExaggeration(factor);
    const outer=(terrain.group.children[1] as Mesh).geometry.attributes.position;
    for(let col=0;col<128;col++) {
      const local=new Vector3().fromBufferAttribute(outer,outer.count-128+col);
      const global=new Vector3().fromBufferAttribute(p,col);
      assert.ok(local.distanceTo(global)<.00001,`seam ${col} at ${factor}: ${local.distanceTo(global)}`);
      assert.ok(Math.abs(Math.hypot(local.x,local.z)-LOCAL_RADIUS_KM)<.00001);
    }
  }
  for(let i=0;i<body.index!.count;i+=6) {
    const a=new Vector3().fromBufferAttribute(p,body.index!.getX(i));
    const b=new Vector3().fromBufferAttribute(p,body.index!.getX(i+1));
    const c=new Vector3().fromBufferAttribute(p,body.index!.getX(i+2));
    assert.ok(b.sub(a).cross(c.sub(a)).dot(a.clone().sub(center))>=-1e-6);
  }
});
test('return from far-side globe view stays outside the lunar sphere',()=>{
  const camera=new PerspectiveCamera(55,1),controls={target:new Vector3(),enabled:true,update(){}} as unknown as OrbitControls;
  const view=new SurfaceCamera(camera,controls),eye=new Vector3(0,.502,0),center=new Vector3(0,.5-MOON_RADIUS_KM,0);
  view.setGroundHeight(.5);view.setTerrainCeiling(30);view.configure(eye,12,'globe');
  assert.equal(camera.far,30000);assert.ok(controls.minDistance>MOON_RADIUS_KM);
  camera.position.copy(center).add(new Vector3(0,-4000,0));
  view.transitionTo(eye,12,'surface');
  for(let i=0;i<31;i++) {view.update(.1);assert.ok(camera.position.distanceTo(center)>=MOON_RADIUS_KM-.000001);}
  assert.ok(camera.position.distanceTo(eye)<1e-8);
});

test('interrupting a far-side return retains a spherical route for every preset',()=>{
  for(const mode of ['orbital','top','cinematic','surface'] as const) {
    const camera=new PerspectiveCamera(55,1),controls={target:new Vector3(),enabled:true,update(){}} as unknown as OrbitControls;
    const view=new SurfaceCamera(camera,controls),eye=new Vector3(0,.502,0),center=new Vector3(0,.5-MOON_RADIUS_KM,0);
    view.setGroundHeight(.5);view.setTerrainCeiling(30);view.configure(eye,12,'globe');
    camera.position.copy(center).add(new Vector3(0,-4000,0));
    view.transitionTo(eye,12,'surface');view.update(.2);
    view.transitionTo(eye,12,mode);
    for(let i=0;i<31;i++){view.update(.1);assert.ok(camera.position.distanceTo(center)>=MOON_RADIUS_KM-.000001,mode);}
  }
});
