import * as T from 'three';
import {keepBelowBloom,panelTexture} from './proceduralTextures.js';
import type {Conditions} from './data.js';
import { batteryIndicator } from './analytics.js';
import { SCENE_PALETTE } from './palette.js';
const UP=new T.Vector3(0,1,0),FORWARD=new T.Vector3(0,0,1);
export function createLander(panelMap?: T.Texture) {
  const landerMesh=new T.Group();landerMesh.name='landerMesh';
  const chassis=new T.Group();landerMesh.add(chassis);
  const gold=new T.MeshStandardMaterial({color:0xd4af37,metalness:.9,roughness:.25});
  const white=new T.MeshStandardMaterial({color:0xd9dadd,metalness:.35,roughness:.5});
  const dark=new T.MeshStandardMaterial({color:0x202631,metalness:.75,roughness:.4});
  const map=panelMap??panelTexture(),cells=new T.MeshStandardMaterial({map,emissiveMap:map,emissive:0x326bff,emissiveIntensity:0,roughness:.36,metalness:.25});
  [gold,white,dark,cells].forEach(keepBelowBloom);
  function add(g:T.BufferGeometry,m:T.Material,p:T.Vector3,parent:T.Group=chassis){const mesh=new T.Mesh(g,m);mesh.position.copy(p);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  add(new T.CylinderGeometry(.0015,.00175,.002,8),gold,new T.Vector3());
  add(new T.CylinderGeometry(.0016,.0016,.00015,8),white,new T.Vector3(0,.00108,0));
  add(new T.CylinderGeometry(.0018,.0018,.00014,8),dark,new T.Vector3(0,-.00105,0));
  add(new T.BoxGeometry(.0017,.0008,.0013),white,new T.Vector3(0,.00155,0));
  add(new T.CylinderGeometry(.00045,.0002,.0007,16),dark,new T.Vector3(0,-.00145,0));
  for(let i=0;i<8;i++){const a=i*Math.PI/4;const rib=add(new T.BoxGeometry(.00009,.0021,.00009),white,new T.Vector3(Math.sin(a)*.00158,0,Math.cos(a)*.00158));rib.rotation.y=a;}
  const panels:T.Group[]=[];
  for(const side of [-1,1]){
    const hinge=new T.Group();hinge.position.set(side*.0016,.00065,0);chassis.add(hinge);panels.push(hinge);
    add(new T.BoxGeometry(.003,.00009,.0019),dark,new T.Vector3(side*.0017,0,0),hinge);
    add(new T.BoxGeometry(.00285,.000025,.00175),cells,new T.Vector3(side*.0017,.00006,0),hinge);
    add(new T.CylinderGeometry(.00008,.00008,.0012,8),white,new T.Vector3(side*.00035,-.00035,0),hinge).rotation.z=side*.75;
  }
  const dishPivot=new T.Group();dishPivot.position.set(0,.0027,0);chassis.add(dishPivot);
  add(new T.CylinderGeometry(.00012,.00012,.0008,8),dark,new T.Vector3(0,.00225,0));
  const profile:T.Vector2[]=[];for(let i=0;i<=16;i++){const r=i/16*.00075;profile.push(new T.Vector2(r,r*r/(4*.00045)));}
  const dish=new T.Mesh(new T.LatheGeometry(profile,32),new T.MeshStandardMaterial({color:0xe2e6ea,metalness:.7,roughness:.3,side:T.DoubleSide}));
  keepBelowBloom(dish.material);dish.rotation.x=Math.PI/2;dishPivot.add(dish);
  const emitter=new T.Object3D();emitter.position.z=.00045;dishPivot.add(emitter);
  add(new T.CylinderGeometry(.00004,.00004,.00045,6),dark,new T.Vector3(0,0,.000225),dishPivot).rotation.x=Math.PI/2;
  add(new T.SphereGeometry(.0001,12,8),white,new T.Vector3(0,0,.00045),dishPivot);
  const beaconMaterial=new T.MeshBasicMaterial({color:new T.Color(SCENE_PALETTE.ok).multiplyScalar(3),toneMapped:false});
  add(new T.SphereGeometry(.00012,12,8),beaconMaterial,new T.Vector3(.0008,.0022,0));
  const legs:Array<{foot:T.Mesh;strut:T.Mesh;side:number}>=[];
  for(let i=0;i<4;i++){
    const a=i*Math.PI/2+Math.PI/4;
    const foot=add(new T.CylinderGeometry(.00055,.00062,.00012,16),white,new T.Vector3(Math.cos(a)*.0032,0,Math.sin(a)*.0032),landerMesh);
    foot.name='landingFoot';
    const strut=add(new T.CylinderGeometry(.0001,.00013,1,8),white,new T.Vector3(),landerMesh);legs.push({foot,strut,side:a});
  }
  let batteryPct=85;
  let powered=false;const target=new T.Vector3();const start=new T.Vector3(),delta=new T.Vector3();
  return {
    landerMesh,antenna:dishPivot,emitter,panels,
    setBattery(percent:number){batteryPct=T.MathUtils.clamp(percent,0,100);},
    place(centerY:number,heightAt:(x:number,z:number)=>number){
      landerMesh.position.set(0,centerY,0);
      let high=0;for(const {foot,side} of legs){
        const x=Math.cos(side)*.0032,z=Math.sin(side)*.0032,e=.00005;
        const normal=new T.Vector3(-(heightAt(x+e,z)-heightAt(x-e,z))/(2*e),1,-(heightAt(x,z+e)-heightAt(x,z-e))/(2*e)).normalize();
        foot.position.set(x,heightAt(x,z)-centerY,z).addScaledVector(normal,.00006);foot.quaternion.setFromUnitVectors(UP,normal);high=Math.max(high,foot.position.y);
      }
      chassis.position.y=high+.0028;
      for(const {foot,strut,side} of legs){start.set(Math.cos(side)*.0014,chassis.position.y-.0007,Math.sin(side)*.0014);delta.subVectors(foot.position,start);strut.position.copy(start).add(foot.position).multiplyScalar(.5);strut.scale.y=delta.length();strut.quaternion.setFromUnitVectors(UP,delta.normalize());}
      landerMesh.updateMatrixWorld(true);
    },
    setConditions(c:Conditions){powered=c.sun_visible;cells.emissiveIntensity=powered?.16:0;},
    track(earth:T.Vector3){dishPivot.quaternion.setFromUnitVectors(FORWARD,earth);landerMesh.updateMatrixWorld(true);},
    update(seconds:number,earth:T.Vector3){
      dishPivot.quaternion.setFromUnitVectors(FORWARD,earth);
      const indicator=batteryIndicator(batteryPct);
      const wave=.5+.5*Math.sin(seconds*Math.PI*2*indicator.hz);
      beaconMaterial.color.setHex(indicator.color).multiplyScalar(.8+3*(batteryPct<15?wave**4:wave));
      cells.emissiveIntensity=powered?.12+.04*Math.sin(seconds*.7):0;
    },
    origin(out:T.Vector3){return emitter.getWorldPosition(out);},
    panelTarget(out:T.Vector3){chassis.getWorldPosition(target);return out.copy(target).add(new T.Vector3(0,.0007,0));},
    dispose(){map.dispose();},
  };
}
