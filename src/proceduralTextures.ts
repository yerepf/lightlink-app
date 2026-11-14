import * as T from 'three';
/** Keep non-emitting surfaces below the HDR bloom threshold without a second terrain draw. */
export function keepBelowBloom(material: T.Material): void {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(0.80));');
  };
  material.customProgramCacheKey = () => 'surface-bloom-cap-v1';
}
export function canvasTexture(paint: (ctx: CanvasRenderingContext2D, size: number) => void, size=256): T.CanvasTexture {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas textures unavailable');paint(ctx,size);
  return new T.CanvasTexture(canvas);
}
export function glowTexture(ring=false) {
  return canvasTexture((ctx,size)=>{
    const g=ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
    if(ring){g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.65,'rgba(255,255,255,0)');g.addColorStop(.74,'rgba(255,255,255,.22)');g.addColorStop(.82,'rgba(255,255,255,0)');}
    else {g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.12,'rgba(255,255,255,.65)');g.addColorStop(.4,'rgba(255,255,255,.1)');}
    g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,size,size);
  });
}
export function panelTexture() {
  const texture=canvasTexture((ctx,size)=>{
    ctx.fillStyle='#07162c';ctx.fillRect(0,0,size,size);
    ctx.strokeStyle='#295780';ctx.lineWidth=2;
    for(let i=0;i<=8;i++){const p=i*size/8;ctx.beginPath();ctx.moveTo(p,0);ctx.lineTo(p,size);ctx.moveTo(0,p);ctx.lineTo(size,p);ctx.stroke();}
    ctx.strokeStyle='#6987a0';ctx.lineWidth=.6;
    for(let i=0;i<=32;i++){ctx.beginPath();ctx.moveTo(i*size/32,0);ctx.lineTo(i*size/32,size);ctx.stroke();}
  });texture.colorSpace=T.SRGBColorSpace;return texture;
}
export function regolithTexture(patchKm:number): T.CanvasTexture | null {
  if(typeof document==='undefined')return null;
  const texture=canvasTexture((ctx,size)=>{
    const image=ctx.createImageData(size,size);let seed=90210;
    for(let i=0;i<image.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const v=80+(seed>>>24)*.55;image.data[i]=image.data[i+1]=image.data[i+2]=v;image.data[i+3]=255;}ctx.putImageData(image,0,0);
  });texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(patchKm/.002,patchKm/.002);texture.anisotropy=4;return texture;
}
