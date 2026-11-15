import * as T from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import type { Conditions } from './data.js';
import { glowTexture } from './proceduralTextures.js';
import { TerrainQueries } from './TerrainQueries.js';
import { SCENE_PALETTE } from './palette.js';
const UP=new T.Vector3(0,1,0);
export function tacticalColor(c:Conditions){return c.co_visibility?SCENE_PALETTE.ok:c.sun_visible||c.earth_visible?SCENE_PALETTE.warn:SCENE_PALETTE.danger;}
export class MissionEffects {
  readonly group=new T.Group();
  readonly flare=new Lensflare();
  readonly beamMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,
    uniforms:{time:{value:0},color:{value:new T.Color(SCENE_PALETTE.ok).multiplyScalar(3)}},
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform float time;uniform vec3 color;varying vec2 vUv;void main(){float phase=fract(vUv.y*24.-time*.8);float pulse=pow(max(0.,1.-abs(phase-.5)*2.),7.);gl_FragColor=vec4(color,.10+.65*pulse);}`,
  });
  private readonly beam=new T.Mesh(new T.CylinderGeometry(1,1,1,8,1,true),this.beamMaterial);
  private readonly core=new T.Mesh(new T.CylinderGeometry(1,1,1,6,1,true),new T.MeshBasicMaterial({color:SCENE_PALETTE.ok,transparent:true,opacity:.55,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));
  private readonly glow:T.Texture;
  private readonly impact:T.Sprite;
  private readonly solar=new T.Mesh(new T.CylinderGeometry(.0035,.0008,1,16,1,true),new T.MeshBasicMaterial({color:SCENE_PALETTE.sun,opacity:.06,transparent:true,blending:T.AdditiveBlending,depthWrite:false,side:T.DoubleSide}));
  private readonly ring=new T.LineSegments(new T.BufferGeometry(),new T.LineBasicMaterial({color:SCENE_PALETTE.warn,transparent:true,opacity:.8,depthWrite:false}));
  private readonly direction=new T.Vector3();private readonly end=new T.Vector3();private readonly origin=new T.Vector3();
  private beamLength=1;
  private readonly halo:T.Texture;private readonly opticalRing:T.Texture;
  hit:T.Vector3|null=null;
  constructor(textures?:{glow:T.Texture;halo:T.Texture;opticalRing:T.Texture}){
    this.glow=textures?.glow??glowTexture();this.halo=textures?.halo??glowTexture();this.opticalRing=textures?.opticalRing??glowTexture(true);
    this.impact=new T.Sprite(new T.SpriteMaterial({map:this.glow,color:SCENE_PALETTE.danger,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));
    this.group.add(this.beam,this.core,this.impact,this.solar,this.ring);this.impact.visible=false;this.impact.material.color.multiplyScalar(6);
    this.flare.addElement(new LensflareElement(this.halo,180,0,new T.Color(.65,.55,.4)));
    this.flare.addElement(new LensflareElement(this.opticalRing,95,.35,new T.Color(.12,.18,.22)));
    this.flare.addElement(new LensflareElement(this.halo,38,.65,new T.Color(.15,.12,.08)));
  }
  projectRing(heightAt:(x:number,z:number)=>number, originX=0, originZ=0){
    const p:number[]=[];const point=(a:number,r:number)=>{const x=originX+Math.sin(a)*r,z=originZ-Math.cos(a)*r;p.push(x,heightAt(x,z)+.00002,z);};
    for(let i=0;i<256;i++){point(i/256*Math.PI*2,.007);point((i+1)/256*Math.PI*2,.007);}
    for(let i=0;i<72;i++){const a=i/72*Math.PI*2;point(a,.007);point(a,i%6===0?.008:.0074);}
    this.ring.geometry.dispose();this.ring.geometry=new T.BufferGeometry();this.ring.geometry.setAttribute('position',new T.Float32BufferAttribute(p,3));this.ring.geometry.computeBoundingSphere();
  }
  setState(origin:T.Vector3,earthPosition:T.Vector3,sun:T.Vector3,panels:T.Vector3,c:Conditions,queries:TerrainQueries,extras:T.Object3D[]){
    this.origin.copy(origin);this.direction.subVectors(earthPosition,origin).normalize();
    this.end.copy(earthPosition);this.hit=null;
    if(!c.earth_visible){const hit=queries.firstHit(origin,this.direction,extras,origin.distanceTo(earthPosition));if(hit){this.hit=hit.point.clone();this.end.copy(hit.point);}}
    this.beamLength=Math.max(.000001,origin.distanceTo(this.end));
    for(const mesh of [this.beam,this.core]){mesh.position.copy(origin).add(this.end).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(UP,this.direction);mesh.scale.set(.00006,this.beamLength,.00006);}
    const color=c.earth_visible?SCENE_PALETTE.ok:SCENE_PALETTE.danger;
    this.beamMaterial.uniforms.color.value.setHex(color).multiplyScalar(c.earth_visible?3:6);
    this.core.material.color.setHex(color).multiplyScalar(c.earth_visible?3:6);
    this.impact.visible=this.hit!==null;if(this.hit)this.impact.position.copy(this.hit).addScaledVector(this.direction,-.00002);
    this.ring.material.color.setHex(tacticalColor(c));
    this.solar.visible=c.sun_visible;this.solar.position.copy(panels).addScaledVector(sun,.006);this.solar.quaternion.setFromUnitVectors(UP,sun);this.solar.scale.y=.012;
  }
  update(seconds:number,camera:T.Camera,sun:T.Vector3,showFlare:boolean){
    this.beamMaterial.uniforms.time.value=seconds;
    // Minimum visual width, bounded to avoid a giant laser in the global view.
    const width=T.MathUtils.clamp(camera.position.distanceTo(this.origin)*.0008,.000035,.003);
    this.beam.scale.set(width,this.beamLength,width);this.core.scale.set(width*.24,this.beamLength,width*.24);
    this.impact.scale.setScalar(T.MathUtils.clamp(camera.position.distanceTo(this.end)*.002,.0006,.02));
    this.flare.visible=showFlare;this.flare.position.copy(camera.position).addScaledVector(sun,10000);
  }
  dispose(){this.flare.dispose();this.glow.dispose();this.halo.dispose();this.opticalRing.dispose();}
}
