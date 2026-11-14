import * as T from 'three';
/** Distant sky rendered in the same depth buffer so terrain occludes celestial bodies. */
export class CelestialSky {
  readonly group = new T.Group();
  readonly sun = new T.Mesh(new T.SphereGeometry(3.72, 32, 24), new T.MeshBasicMaterial({ color: 0xfff5df, toneMapped: false }));
  private readonly earthMaterial: T.ShaderMaterial;
  readonly earth: T.Mesh;
  private readonly glow: T.Sprite;
  private readonly textures: T.Texture[] = [];
  constructor() {
    const map = new T.TextureLoader().load('/textures/earth_atmos_2048.jpg');
    map.colorSpace = T.SRGBColorSpace; this.textures.push(map);
    this.earthMaterial = new T.ShaderMaterial({
      uniforms: { map: { value: map }, sunDirection: { value: new T.Vector3(0, 1, 0) } },
      vertexShader: `varying vec2 vUv; varying vec3 n; varying vec3 p; void main(){vUv=uv; n=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.); p=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: `uniform sampler2D map; uniform vec3 sunDirection; varying vec2 vUv; varying vec3 n; varying vec3 p; void main(){vec3 normal=normalize(n); float light=max(dot(normal,sunDirection),0.); vec3 color=texture2D(map,vUv).rgb*(light*1.4+.002); float rim=pow(1.-max(dot(normal,normalize(cameraPosition-p)),0.),4.); color+=vec3(.08,.3,.75)*rim*smoothstep(-.12,.3,dot(normal,sunDirection))*.45; gl_FragColor=vec4(min(color,vec3(.8)),1.);\n #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }`,
    });
    // 2.5 degree apparent diameter at R=800.
    this.earth = new T.Mesh(new T.SphereGeometry(800 * Math.tan(T.MathUtils.degToRad(1.25)), 64, 48), this.earthMaterial);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!, gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,250,225,1)'); gradient.addColorStop(.12, 'rgba(255,237,180,.65)'); gradient.addColorStop(.35, 'rgba(255,212,130,.12)'); gradient.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const glowMap = new T.CanvasTexture(canvas); this.textures.push(glowMap);
    this.glow = new T.Sprite(new T.SpriteMaterial({ map: glowMap, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false })); this.glow.scale.set(46, 46, 1);
    this.sun.material.color.multiplyScalar(3);
    this.group.add(this.sun, this.earth, this.glow);
    let seed = 12345;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let band = 0; band < 3; band++) {
      const positions: number[] = [], colors: number[] = [];
      for (let i = 0; i < 1200; i++) {
        const y = random() * 2 - 1, az = random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
        positions.push(1200 * r * Math.cos(az), 1200 * y, 1200 * r * Math.sin(az));
        const b = .25 + random() * .65; colors.push(b * .9, b * .94, b);
      }
      const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
      this.group.add(new T.Points(geometry, new T.PointsMaterial({ size: .8 + band * .65, sizeAttenuation: false, vertexColors: true, depthWrite: false })));
    }
  }
  update(sun: T.Vector3, earth: T.Vector3, observer: T.Vector3) {
    this.sun.position.copy(sun).multiplyScalar(800).add(observer);
    this.glow.position.copy(this.sun.position);
    this.earth.position.copy(earth).multiplyScalar(800).add(observer);
    this.earth.lookAt(observer);
    this.earthMaterial.uniforms.sunDirection.value.copy(sun);
  }
  dispose() { this.textures.forEach(texture => texture.dispose()); }
}
