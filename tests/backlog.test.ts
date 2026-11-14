import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Box3, DirectionalLight, Vector3} from 'three';
import {createMockSite} from '../src/mock.js';
import {parseSite, Timeline} from '../src/data.js';
import {fitSolarShadow, linkColor} from '../src/solar.js';

test('offline fixture is a valid 20km terrain with both DTE states',()=>{
  const {site,field}=createMockSite();
  assert.equal(parseSite(site).terrain_metadata.patch_size_km,20);
  assert.ok(field.values.every(v=>v>=0&&v<=1));
  const timeline=new Timeline(site);
  const states=timeline.times.map(t=>Number(timeline.sample(t).conditions.earth_visible));
  assert.ok(states.includes(0)&&states.includes(1));
  assert.equal(linkColor(true),0x65ed91);assert.equal(linkColor(false),0xff5d65);
});
test('solar shadow frustum includes all terrain corners for grazing directions',()=>{
  const bounds=new Box3(new Vector3(-8,-2,-8),new Vector3(8,30,8));
  for(const direction of [new Vector3(1,.001,0),new Vector3(-1,.05,1),new Vector3(0,1,0)]) {
    const light=new DirectionalLight();light.position.copy(direction.normalize().multiplyScalar(180));
    fitSolarShadow(light,bounds);light.shadow.updateMatrices(light);
    for(const x of [-8,8])for(const y of [-2,30])for(const z of [-8,8]) {
      const p=new Vector3(x,y,z).project(light.shadow.camera);
      assert.ok(Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&Math.abs(p.z)<=1,`${p.toArray()}`);
    }
  }
});
