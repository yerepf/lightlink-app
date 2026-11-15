import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { directionXYZ, parseSite, Timeline, type TimeState } from './data.js';
import { type HeightField, type HeightDecoder } from './terrain.js';
import { decodeHeightmap16 } from './png16.js';
import { createTerrainLOD } from './terrainLOD.js';
import { SurfaceCamera, mapExitFov, type ViewMode } from './SurfaceCamera.js';
import { fitSolarShadow, linkColor } from './solar.js';
import { SCENE_PALETTE } from './palette.js';
import { createMoonBody } from './MoonBody.js';
import { TerrainQueries, meshHeightAt } from './TerrainQueries.js';
import { MissionEffects } from './MissionEffects.js';
import { LunarPostProcessing } from './LunarPostProcessing.js';
import { createLander } from './lander.js';
import { CelestialSky } from './CelestialSky.js';
import { createPowerTelemetry, createSkyPaths, disposeSkyPaths, findScienceCandidates, createScienceMarkers, type PowerTelemetry } from './analytics.js';

export interface EngineOptions {
  canvas?: HTMLCanvasElement;
  terrainSegments?: number;
  maxPixelRatio?: number;
  decodeHeightmap?: HeightDecoder;
}

/** Framework-independent local tangent scene. All scene distances are kilometres. */
export class LunarEngine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1000);
  readonly controls: OrbitControls;
  readonly mapCamera = new THREE.OrthographicCamera(-15,15,15,-15,.001,2500);
  private readonly mapControls: OrbitControls;
  private mapActive = false;
  private mapExtent = 15;
  private readonly skyScene = new THREE.Scene();
  private readonly skyCamera = new THREE.PerspectiveCamera(55,1,.1,2000);
  private moon?: ReturnType<typeof createMoonBody>;
  private readonly lander = createLander();
  private readonly mission = new MissionEffects();
  private readonly queries = new TerrainQueries();
  private readonly post: LunarPostProcessing;
  private effectsEnabled = true;
  private powerModel?: ReturnType<typeof createPowerTelemetry>;
  private currentPower?: PowerTelemetry;
  private skyPaths?: THREE.Group;
  private scienceMarkers?: ReturnType<typeof createScienceMarkers>;
  private slopesEnabled = false;
  private skyPathsEnabled = false;
  private scienceCount = 0;
  private readonly antennaOrigin = new THREE.Vector3();
  private readonly panelOrigin = new THREE.Vector3();
  private readonly earthWorld = new THREE.Vector3();
  private patchSize = 20;
  readonly visualDiagnostics = { dte: 'pending', impactDistanceM: null as number | null, raycastMs: 0 };
  private readonly centralBounds = new THREE.Box3();
  private root = new THREE.Group();
  private readonly observer = new THREE.Vector3();
  private readonly sunDirection = new THREE.Vector3();
  private readonly earthDirection = new THREE.Vector3();
  private readonly sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
  private readonly sky = new CelestialSky();
  private readonly guides = new THREE.Group();
  private readonly view: SurfaceCamera;
  private terrain?: ReturnType<typeof createTerrainLOD>;
  private centerY = 0;
  private observerHeight = 2;
  private exaggeration = 4;
  private readonly sunRay = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, SCENE_PALETTE.sun);
  private readonly observerMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: SCENE_PALETTE.ok }));
  private timeline?: Timeline;
  private radius = 15;
  private convergence = 0;
  private disposed = false;
  private request?: AbortController;
  private readonly resizeObserver: ResizeObserver;
  private readonly ownsCanvas: boolean;
  private playing = false;
  private rate = 3600;
  private lastFrame = 0;
  private elapsed = 0;
  private frames = 0;
  private readonly segments: number;
  readonly stats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };

  constructor(private readonly container: HTMLElement, private readonly options: EngineOptions = {}) {
    this.segments = options.terrainSegments ?? 512;
    if (!Number.isInteger(this.segments) || this.segments < 2 || this.segments % 2 !== 0 || this.segments > 1024) throw new Error('terrainSegments must be an even integer from 2 to 1024');
    if (options.maxPixelRatio !== undefined && (!Number.isFinite(options.maxPixelRatio) || options.maxPixelRatio <= 0)) throw new Error('Invalid maxPixelRatio');
    this.renderer = new THREE.WebGLRenderer({ canvas: options.canvas, antialias: true, powerPreference: 'high-performance' });
    this.ownsCanvas = !options.canvas;
    if (this.ownsCanvas) container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.scene.background = null; this.renderer.setClearColor(SCENE_PALETTE.space, 1);
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.autoUpdate = false; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sunLight.castShadow = true; this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.normalBias = 0.08; this.sunLight.shadow.bias = -0.0005;
    this.guides.visible = false; this.guides.add(this.sunRay, this.observerMarker);
    this.scene.add(this.root, this.sunLight, this.sunLight.target, new THREE.AmbientLight(0xffffff, 0.015), this.guides, this.lander.landerMesh, this.mission.group, this.mission.flare);
    this.skyScene.add(this.sky.group);
    this.renderer.autoClear = false; this.renderer.info.autoReset = false;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.mapCamera.up.set(0,0,-1);
    this.mapControls = new OrbitControls(this.mapCamera, this.renderer.domElement);
    this.mapControls.enabled = false; this.mapControls.enableRotate = false;
    this.mapControls.minZoom = .25; this.mapControls.maxZoom = 50;
    this.view = new SurfaceCamera(this.camera, this.controls);
    this.camera.position.set(15, 12, 15);
    this.post = new LunarPostProcessing(this.renderer,this.scene,this.camera,this.skyScene,this.skyCamera);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.render);
    this.setIndicatorsVisible(false);
  }

  /** Last request wins; failed loads preserve the last successfully loaded scene. */
  async loadSite(input: unknown, heightField?: HeightField): Promise<void> {
    this.assertAlive();
    const site = parseSite(input);
    this.request?.abort();
    const request = new AbortController(); this.request = request;
    const field = heightField ?? await (this.options.decodeHeightmap ?? decodeHeightmap16)(site.heightmap_url, request.signal);
    if (this.disposed || request.signal.aborted) throw new DOMException('Superseded load', 'AbortError');
    const terrain = createTerrainLOD(field, site.terrain_metadata, this.segments);
    terrain.setExaggeration(this.exaggeration);
    const next = terrain.group;
    const radius = site.terrain_metadata.patch_size_km * 0.7;
    const spatial = site.spatial;
    const observer = new THREE.Vector3(0, terrain.centerY + this.observerHeight / 1000, 0);
    const convergence = spatial?.grid_convergence_deg ?? 0;
    const points = site.horizon_mask.map(h => {
      const p = new THREE.Vector3(); directionXYZ(h.azimuth_deg + convergence, h.max_elevation_deg, p);
      return p.multiplyScalar(radius).add(observer);
    });
    const horizon = new THREE.Group();
    if (points.length > 1) horizon.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: SCENE_PALETTE.horizon, depthTest: false, transparent: true, opacity: 0.7 })));
    for (const child of [...this.guides.children]) if (child.userData.horizon) { this.guides.remove(child); this.release(child); }
    horizon.userData.horizon = true; this.guides.add(horizon);
    if (this.moon) { this.scene.remove(this.moon.mesh); this.moon.dispose(); }
    this.moon = createMoonBody(terrain.centerY); this.scene.add(this.moon.mesh);
    this.view.setGroundHeight(terrain.centerY);
    this.terrain?.disposeMaterials();
    this.terrain = terrain; this.centerY = terrain.centerY;
    this.scene.remove(this.root); this.release(this.root); this.root = next; this.scene.add(next);
    this.radius = radius; this.observer.copy(observer); this.convergence = convergence;
    this.patchSize = site.terrain_metadata.patch_size_km;
    this.observerMarker.position.copy(this.observer).add(new THREE.Vector3(0, radius * .015, 0)); this.observerMarker.scale.setScalar(radius * 0.004);
    this.sunRay.position.copy(this.observer);
    this.sunRay.setLength(radius, radius * 0.035, radius * 0.018);
    this.sunLight.target.position.copy(this.observer);
    const shadow = this.sunLight.shadow.camera;
    shadow.left = shadow.bottom = -radius; shadow.right = shadow.top = radius;
    shadow.near = .01; shadow.far = 400; shadow.updateProjectionMatrix();
    this.powerModel = createPowerTelemetry(site.ephemeris_timeline);
    disposeSkyPaths(this.skyPaths);
    this.skyPaths = createSkyPaths(site.ephemeris_timeline, convergence);
    this.skyPaths.visible = this.skyPathsEnabled; this.skyScene.add(this.skyPaths);
    this.scienceMarkers?.dispose();
    const candidates = findScienceCandidates(field, site.terrain_metadata);
    this.scienceCount = candidates.length;
    this.scienceMarkers = createScienceMarkers(candidates); this.scene.add(this.scienceMarkers.group);
    terrain.setSlopeHazard(this.slopesEnabled);
    this.refreshTerrainBounds();
    terrain.setTopographic(this.view.mode === 'top');
    this.mapActive = false;
    this.view.configure(this.observer, radius);
    this.timeline = new Timeline(site); this.playing = false;
    this.setIndicatorsVisible(true); this.setTime(this.timeline.times[0]);
  }

  /** Returns a borrowed state object; clone it if retaining it across calls. */
  setTime(timestampMs: number): TimeState {
    this.assertAlive();
    if (!this.timeline) throw new Error('Load a site before setting time');
    const state = this.timeline.sample(timestampMs);
    this.currentPower = this.powerModel?.sample(state.timestampMs);
    if (this.currentPower) this.lander.setBattery(this.currentPower.battery_pct);
    directionXYZ(state.sun.azimuth_deg + this.convergence, state.sun.elevation_deg, this.sunDirection);
    directionXYZ(state.earth.azimuth_deg + this.convergence, state.earth.elevation_deg, this.earthDirection);
    this.sky.update(this.sunDirection, this.earthDirection, new THREE.Vector3());
    this.sunLight.position.copy(this.sunDirection).multiplyScalar(180).add(this.observer);
    this.sunRay.setDirection(this.sunDirection);
    this.sunRay.setColor(state.conditions.sun_visible ? SCENE_PALETTE.sun : SCENE_PALETTE.sunDim);
    this.observerMarker.material.color.setHex(linkColor(state.conditions.earth_visible));
    this.lander.setConditions(state.conditions); this.lander.track(this.earthDirection);
    this.lander.origin(this.antennaOrigin); this.lander.panelTarget(this.panelOrigin);
    this.earthWorld.copy(this.earthDirection).multiplyScalar(800).add(this.observer);
    const started=performance.now();
    this.mission.setState(this.antennaOrigin,this.earthWorld,this.sunDirection,this.panelOrigin,state.conditions,this.queries,[this.root.children[1],...(this.moon?[this.moon.mesh]:[])]);
    this.visualDiagnostics.raycastMs=performance.now()-started;
    this.visualDiagnostics.dte=state.conditions.earth_visible?'connected':this.mission.hit?'impact':'outside_visual_terrain';
    this.visualDiagnostics.impactDistanceM=this.mission.hit?this.mission.hit.distanceTo(this.antennaOrigin)*1000:null;
    fitSolarShadow(this.sunLight, this.centralBounds); this.renderer.shadowMap.needsUpdate = true;
    return state;
  }

  setViewMode(mode: ViewMode): void {
    this.assertAlive();
    if (this.mapActive) {
      this.camera.position.copy(this.mapCamera.position); this.camera.quaternion.copy(this.mapCamera.quaternion);
      this.camera.fov = mapExitFov(this.mapCamera, this.mapControls.target); this.camera.updateProjectionMatrix();
    }
    this.mapActive = false; this.mapControls.enabled = false;
    this.terrain?.setTopographic(mode === 'top');
    this.view.transitionTo(this.observer, this.radius, mode, !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  private refreshTerrainBounds(): void {
    if (!this.terrain) return;
    this.centralBounds.setFromObject(this.terrain.group.children[0]);
    this.view.setTerrainCeiling(new THREE.Box3().setFromObject(this.terrain.group).max.y);
    const geometry=(this.root.children[0] as THREE.Mesh).geometry;
    this.queries.rebuild(geometry,this.segments);
    const heightAt=(x:number,z:number)=>meshHeightAt(geometry,this.patchSize,this.segments,x,z);
    this.scienceMarkers?.place(heightAt);
    this.lander.place(this.centerY,heightAt); this.mission.projectRing(heightAt);
    this.root.updateMatrixWorld(true); this.moon?.mesh.updateMatrixWorld(true);
    const dx=heightAt(.001,0)-heightAt(-.001,0),dz=heightAt(0,.001)-heightAt(0,-.001);
    const downhill=new THREE.Vector3(-dx,0,-dz);
    if(downhill.lengthSq()<1e-12)downhill.set(1,0,1);
    downhill.normalize().multiplyScalar(.012);
    this.lander.panelTarget(this.panelOrigin);
    downhill.y=Math.max(heightAt(downhill.x,downhill.z)+.003,this.panelOrigin.y+.008);
    this.view.setInspectionPose(downhill,this.panelOrigin);
  }
  setVisualEffectsEnabled(enabled:boolean):void { this.effectsEnabled=enabled; this.post.enabled=enabled; }
  getPowerTelemetry(): PowerTelemetry | undefined { return this.currentPower ? { ...this.currentPower } : undefined; }
  getScienceCandidateCount(): number { return this.scienceCount; }
  setSlopeHazardEnabled(enabled: boolean): void { this.slopesEnabled = enabled; this.terrain?.setSlopeHazard(enabled); }
  setSkyPathsEnabled(enabled: boolean): void { this.skyPathsEnabled = enabled; if (this.skyPaths) this.skyPaths.visible = enabled; }
  setCinematicPaused(paused: boolean): void { this.view.cinematicPaused = paused; }
  setGuidesVisible(visible: boolean): void { this.guides.visible = visible; }
  setObserverHeight(metres: number): void {
    if (!Number.isFinite(metres) || metres <= 0) throw new Error('Invalid observer height');
    const delta = (metres - this.observerHeight) / 1000; this.observerHeight = metres;
    this.observer.set(0, this.centerY + metres / 1000, 0);
    for (const child of this.guides.children) if (child.userData.horizon) child.position.y += delta;
    this.observerMarker.position.copy(this.observer).add(new THREE.Vector3(0, this.radius * .015, 0)); this.sunRay.position.copy(this.observer);
    this.sunLight.target.position.copy(this.observer);
    this.mapActive = false; this.view.configure(this.observer, this.radius);
    if (this.timeline) this.setTime(this.timeline.state.timestampMs);
  }
  setTerrainExaggeration(value: number): void {
    if (!Number.isFinite(value) || value < 1 || value > 15) throw new Error('Terrain exaggeration must be 1–15');
    this.exaggeration = value; this.terrain?.setExaggeration(value);
    this.refreshTerrainBounds();
    if (this.timeline) this.setTime(this.timeline.state.timestampMs);
    if (this.view.isTransitioning) this.view.transitionTo(this.observer, this.radius, this.view.mode);
    else if (this.view.mode === 'top' || this.view.mode === 'lander') { this.mapActive = false; this.view.configure(this.observer, this.radius); }
  }

  play(simulationSecondsPerSecond = 3600): void {
    this.assertAlive();
    if (!this.timeline) throw new Error('Load a site before playback');
    if (!Number.isFinite(simulationSecondsPerSecond)) throw new Error('Invalid playback rate');
    this.rate = simulationSecondsPerSecond; this.playing = true; this.lastFrame = 0;
  }
  pause(): void { this.playing = false; }
  getState(): TimeState | undefined { return this.timeline ? structuredClone(this.timeline.state) : undefined; }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.maxPixelRatio ?? 1.5));
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
    this.camera.aspect = Math.max(width, 1) / Math.max(height, 1); this.camera.updateProjectionMatrix();
    this.resizeMap();
    this.post.resize(Math.max(width,1),Math.max(height,1),this.renderer.getPixelRatio());
  }
  private resizeMap(): void {
    this.mapCamera.left = -this.mapExtent * this.camera.aspect; this.mapCamera.right = this.mapExtent * this.camera.aspect;
    this.mapCamera.top = this.mapExtent; this.mapCamera.bottom = -this.mapExtent; this.mapCamera.updateProjectionMatrix();
  }
  private readonly render = (now: number): void => {
    const realDelta = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    const delta = Math.min(realDelta, .1);
    this.lastFrame = now;
    if (document.hidden || !this.container.clientWidth || !this.container.clientHeight) return;
    if (this.playing && this.timeline) {
      const state = this.setTime(this.timeline.state.timestampMs + delta * this.rate * 1000);
      const times = this.timeline.times;
      if ((this.rate >= 0 && state.timestampMs === times[times.length - 1]) || (this.rate < 0 && state.timestampMs === times[0])) this.pause();
    }
    this.view.update(delta);
    if(this.view.mode==='lander'&&!this.view.isTransitioning&&this.terrain){
      const geometry=(this.root.children[0] as THREE.Mesh).geometry;
      const floor=meshHeightAt(geometry,this.patchSize,this.segments,this.camera.position.x,this.camera.position.z)+.0006;
      if(this.camera.position.y<floor){this.camera.position.y=floor;this.camera.lookAt(this.controls.target);}
    }
    const top = this.view.mode === 'top' && !this.view.isTransitioning;
    if (top && !this.mapActive) {
      this.mapCamera.position.copy(this.camera.position); this.mapCamera.quaternion.copy(this.camera.quaternion); this.mapCamera.up.set(0,0,-1);
      this.mapExtent = (this.camera.position.y - this.observer.y) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
      this.mapCamera.zoom = 1; this.resizeMap(); this.mapControls.target.copy(this.observer); this.mapActive = true;
    }
    this.mapControls.enabled = top; if (top) this.mapControls.update();
    // The fixed surface eye can be inside the chassis at the 2 m preset.
    // Hide only the enclosing model there; antenna tracking and effects stay active.
    this.lander.landerMesh.visible = !!this.timeline && (this.view.mode !== 'surface' || this.view.isTransitioning);
    this.lander.update(now/1000,this.earthDirection);
    this.mission.group.visible=this.effectsEnabled&&!!this.timeline;
    this.mission.update(now/1000,top?this.mapCamera:this.camera,this.sunDirection,this.effectsEnabled&&!top&&!!this.timeline);
    const activeCamera = top ? this.mapCamera : this.camera;
    this.scienceMarkers?.update(activeCamera);
    if (!top) {
      const near = Math.max(.00001, Math.min(10,this.camera.position.distanceTo(this.observer)*.001));
      if (Math.abs(near-this.camera.near)>this.camera.near*.05) { this.camera.near=near; this.camera.updateProjectionMatrix(); }
    }
    this.renderer.info.reset();
    this.skyCamera.quaternion.copy(activeCamera.quaternion); this.skyCamera.fov=this.camera.fov;
    this.skyCamera.aspect=this.camera.aspect; this.skyCamera.updateProjectionMatrix();
    this.post.render(activeCamera,top,delta);
    this.elapsed += realDelta; this.frames++;
    if (this.elapsed >= 0.5) {
      this.stats.fps = this.frames / this.elapsed; this.stats.frameMs = 1000 * this.elapsed / this.frames;
      this.stats.drawCalls = this.renderer.info.render.calls; this.stats.triangles = this.renderer.info.render.triangles;
      this.elapsed = 0; this.frames = 0;
    }
  };
  private setIndicatorsVisible(visible: boolean): void {
    for (const o of [this.sky.group, this.sunRay, this.observerMarker]) o.visible = visible;
  }
  private assertAlive(): void { if (this.disposed) throw new Error('Engine has been disposed'); }
  private release(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.request?.abort(); this.renderer.setAnimationLoop(null);
    disposeSkyPaths(this.skyPaths); this.scienceMarkers?.dispose();
    this.post.dispose(); this.queries.dispose(); this.lander.dispose(); this.mission.dispose();
    this.moon?.dispose(); this.release(this.skyScene); this.skyScene.clear(); this.terrain?.disposeMaterials(); this.mapControls.dispose(); this.sky.dispose(); this.sunLight.shadow.dispose(); this.resizeObserver.disconnect(); this.controls.dispose(); this.release(this.scene); this.scene.clear(); this.renderer.dispose();
    if (this.ownsCanvas) this.renderer.domElement.remove();
  }
}
