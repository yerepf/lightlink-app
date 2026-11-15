import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Mesh, MeshBasicMaterial, DoubleSide, Raycaster, Vector3, Texture} from 'three';
import {buildTerrain} from '../src/terrain.js';
import {TerrainQueries,meshHeightAt} from '../src/TerrainQueries.js';
import {createLander} from '../src/lander.js';
import {tacticalColor,MissionEffects} from '../src/MissionEffects.js';

test('terrain sampler matches actual triangle intersections, not bilinear approximation',()=>{
  const {geometry}=buildTerrain({width:2,height:2,values:new Float32Array([0,.2,.4,1])},{patch_size_km:2,min_elevation_m:0,max_elevation_m:1000},2);
  const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));
  for(const [x,z] of [[-.7,-.6],[-.2,.3],[.7,.8],[.8,-.6]]){
    const ray=new Raycaster(new Vector3(x,5,z),new Vector3(0,-1,0));
    const expected=ray.intersectObject(mesh)[0].point.y;
    assert.ok(Math.abs(meshHeightAt(geometry,2,2,x,z)-expected)<1e-6);
  }
});
test('tiled DTE raycaster hits the same first mountain and updates after terrain edits',()=>{
  const {geometry}=buildTerrain({width:3,height:3,values:new Float32Array([0,.5,0,0,1,0,0,.5,0])},{patch_size_km:2,min_elevation_m:0,max_elevation_m:1000},64);
  const queries=new TerrainQueries();queries.rebuild(geometry,64);
  const origin=new Vector3(-.9,.35,0),direction=new Vector3(1,0,0);
  const mesh=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));
  const expected=new Raycaster(origin,direction,.000001,10).intersectObject(mesh)[0];
  assert.ok(queries.firstHit(origin,direction,[],10)!.point.distanceTo(expected.point)<1e-6);
  assert.equal(queries.firstHit(new Vector3(0,2,0),new Vector3(0,1,0)),null);
  const p=geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,0);queries.rebuild(geometry,64);
  assert.equal(queries.firstHit(origin,direction,[],10),null);queries.dispose();
});
test('tactical state colors use authoritative condition combinations',()=>{
  assert.equal(tacticalColor({sun_visible:true,earth_visible:true,co_visibility:true}),0xa8b99a);
  assert.equal(tacticalColor({sun_visible:false,earth_visible:true,co_visibility:false}),0xe8a93c);
  assert.equal(tacticalColor({sun_visible:true,earth_visible:false,co_visibility:false}),0xe8a93c);
  assert.equal(tacticalColor({sun_visible:false,earth_visible:false,co_visibility:false}),0xd9694f);
});


test('lander feet sit on sloped ground, antenna tracks Earth and panels follow backend state',()=>{
  const lander=createLander(new Texture()),centerY=.742;
  const height=(x:number,z:number)=>centerY+x*.7-z*.2;
  lander.place(centerY,height);
  assert.deepEqual(lander.landerMesh.position,new Vector3(0,centerY,0));
  lander.landerMesh.traverse(object=>{
    if(object.name==='landingFoot'){
      const bottom=object.localToWorld(new Vector3(0,-.00006,0));
      assert.ok(Math.abs(bottom.y-height(bottom.x,bottom.z))<1e-9);
    }
  });
  const direction=new Vector3(.2,.3,-.8).normalize();lander.track(direction);
  const actual=new Vector3(0,0,1).applyQuaternion(lander.antenna.quaternion);
  assert.ok(actual.distanceTo(direction)<1e-9);
  for(const visible of [true,false]){
    const state=Object.freeze({sun_visible:visible,earth_visible:true,co_visibility:visible});lander.setConditions(state);lander.update(5,direction);
    const cell=(lander.panels[0].children[1] as Mesh).material as import('three').MeshStandardMaterial;
    assert.equal(cell.emissiveIntensity>0,visible);
  }
  assert.ok(lander.origin(new Vector3()).y>centerY);lander.dispose();
});


test('DTE beam starts at antenna, terminates at actual hit, and never invents impact',()=>{
  const {geometry}=buildTerrain({width:3,height:3,values:new Float32Array([0,.5,0,0,1,0,0,.5,0])},{patch_size_km:2,min_elevation_m:0,max_elevation_m:1000},64);
  const queries=new TerrainQueries();queries.rebuild(geometry,64);
  const mission=new MissionEffects({glow:new Texture(),halo:new Texture(),opticalRing:new Texture()});
  const origin=new Vector3(-.9,.35,0),earth=new Vector3(5,.35,0),sun=new Vector3(0,1,0);
  for(const connected of [false,true]){
    const conditions=Object.freeze({sun_visible:true,earth_visible:connected,co_visibility:connected});
    mission.setState(origin,earth,sun,new Vector3(),conditions,queries,[]);mission.group.updateMatrixWorld(true);
    const beam=mission.group.children[0];
    assert.ok(beam.localToWorld(new Vector3(0,-.5,0)).distanceTo(origin)<1e-9);
    assert.ok(beam.localToWorld(new Vector3(0,.5,0)).distanceTo(connected?earth:mission.hit!)<1e-9);
    assert.equal(mission.hit===null,connected);
  }
  mission.setState(new Vector3(0,2,0),new Vector3(5,2,0),sun,new Vector3(),{sun_visible:false,earth_visible:false,co_visibility:false},queries,[]);
  assert.equal(mission.hit,null);queries.dispose();mission.dispose();
});
