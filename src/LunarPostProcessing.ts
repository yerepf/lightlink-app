import { Camera, Scene, Vector2, WebGLRenderer, WebGLRenderTarget, ACESFilmicToneMapping } from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
class SkyRenderPass extends RenderPass {
  override render(renderer:WebGLRenderer,write:WebGLRenderTarget,read:WebGLRenderTarget,delta:number,mask:boolean){
    const enabled=renderer.shadowMap.enabled;renderer.shadowMap.enabled=false;
    try{super.render(renderer,write,read,delta,mask);}finally{renderer.shadowMap.enabled=enabled;}
  }
}
/** HDR radiance selection: ordinary surfaces are capped below 0.85, emitters exceed it. */
export class LunarPostProcessing {
  readonly composer:EffectComposer;
  readonly bloom=new UnrealBloomPass(new Vector2(1,1),.45,.4,.85);
  private readonly sky:SkyRenderPass;private readonly world:RenderPass;private readonly output=new OutputPass();
  enabled=true;
  constructor(renderer:WebGLRenderer,scene:Scene,camera:Camera,skyScene:Scene,skyCamera:Camera){
    renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1;
    this.composer=new EffectComposer(renderer);
    this.sky=new SkyRenderPass(skyScene,skyCamera);this.world=new RenderPass(scene,camera);this.world.clear=false;this.world.clearDepth=true;
    this.composer.addPass(this.sky);this.composer.addPass(this.world);this.composer.addPass(this.bloom);this.composer.addPass(this.output);
  }
  resize(width:number,height:number,ratio:number){
    const pixelRatio=Math.min(ratio,1.25);this.composer.setPixelRatio(pixelRatio);this.composer.setSize(width,height);
    // Bloom starts at half the already bounded resolution; built-in mip chain reduces further.
    this.bloom.setSize(Math.max(1,width*pixelRatio*.5),Math.max(1,height*pixelRatio*.5));
  }
  render(camera:Camera,top:boolean,delta:number){this.world.camera=camera;this.sky.enabled=!top;this.world.clear=top;this.bloom.enabled=this.enabled&&!top;this.composer.render(delta);}
  dispose(){this.bloom.dispose();this.output.dispose();this.composer.dispose();}
}
