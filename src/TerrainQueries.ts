import * as T from 'three';
/** Exact sampling of PlaneGeometry's triangles, in the existing kilometre frame. */
export function meshHeightAt(geometry:T.BufferGeometry,size:number,segments:number,x:number,z:number):number {
  const gx=T.MathUtils.clamp((x/size+.5)*segments,0,segments),gz=T.MathUtils.clamp((z/size+.5)*segments,0,segments);
  const col=Math.min(Math.floor(gx),segments-1),row=Math.min(Math.floor(gz),segments-1),tx=gx-col,tz=gz-row,p=geometry.attributes.position;
  const a=row*(segments+1)+col,h00=p.getY(a),h10=p.getY(a+1),h01=p.getY(a+segments+1),h11=p.getY(a+segments+2);
  return tx+tz<=1 ? h00+(h10-h00)*tx+(h01-h00)*tz : h11+(h01-h11)*(1-tx)+(h10-h11)*(1-tz);
}
/** Exact collision triangles, spatially tiled so a ray does not visit all 524k triangles. */
export class TerrainQueries {
  private tiles:T.Mesh[]=[];
  private readonly material=new T.MeshBasicMaterial({side:T.DoubleSide});
  private readonly ray=new T.Raycaster();
  rebuild(geometry:T.BufferGeometry,segments:number) {
    for(const mesh of this.tiles)mesh.geometry.dispose();this.tiles=[];
    const source=geometry.attributes.position,step=32;
    for(let row=0;row<segments;row+=step)for(let col=0;col<segments;col+=step){
      const nx=Math.min(step,segments-col),nz=Math.min(step,segments-row),points:number[]=[],indices:number[]=[];
      for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const i=(row+z)*(segments+1)+col+x;points.push(source.getX(i),source.getY(i),source.getZ(i));}
      for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){const a=z*(nx+1)+x,b=a+nx+1;indices.push(a,b,a+1,b,b+1,a+1);}
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points,3));g.setIndex(indices);g.computeBoundingBox();g.computeBoundingSphere();
      this.tiles.push(new T.Mesh(g,this.material));
    }
  }
  firstHit(origin:T.Vector3,direction:T.Vector3,extras:T.Object3D[]=[],far=800):T.Intersection|null {
    this.ray.set(origin,direction);this.ray.near=.000001;this.ray.far=far;
    const hits=this.ray.intersectObjects([...this.tiles,...extras],false);return hits[0]??null;
  }
  dispose(){for(const m of this.tiles)m.geometry.dispose();this.material.dispose();this.tiles=[];}
}
