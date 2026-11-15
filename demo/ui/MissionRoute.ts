import {
  AmbientLight, ArrowHelper, BufferGeometry, Color, DirectionalLight, Line, LineBasicMaterial,
  MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Scene, SphereGeometry,
  SRGBColorSpace, TextureLoader, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SiteCoordinates } from '../../src/backend';
import { el, svgEl } from './dom';
import { icon } from './icons';

export type MissionRouteSite = { id: string; label: string; coordinates?: SiteCoordinates };
const moonTexture = `${import.meta.env.BASE_URL}textures/moon_1024.jpg`;

function lunarPoint(site?: MissionRouteSite) {
  const coordinates = site?.coordinates;
  if (!coordinates || !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)) return undefined;
  const lat = MathUtils.degToRad(coordinates.latitude), lon = MathUtils.degToRad(coordinates.longitude);
  // Match SphereGeometry UVs to the texture's −180° to 180° longitude.
  return new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}

function trajectory(start: Vector3, end: Vector3) {
  const angle = start.angleTo(end);
  if (angle < 1e-7) return { angle, points: [] };
  const axis = new Vector3().crossVectors(start, end);
  if (axis.lengthSq() < 1e-14) axis.crossVectors(start, Math.abs(start.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0));
  axis.normalize();
  const lift = Math.min(.24, angle * .6);
  const points = Array.from({ length: 65 }, (_, index) => {
    const t = index / 64;
    return start.clone().applyAxisAngle(axis, t * angle).multiplyScalar(1.002 + lift * Math.sin(Math.PI * t));
  });
  return { angle, points };
}

export function createMissionRoute(start?: MissionRouteSite, end?: MissionRouteSite) {
  const badge = el('span', { class: 'mission-route__lander', 'aria-hidden': 'true' });
  badge.innerHTML = icon('lander');
  const destinationMarker = el('span', { class: 'mission-route__destination', 'aria-hidden': 'true' }, badge);
  const canvas = el('canvas', { 'aria-hidden': 'true' });
  const map = el('div', { class: 'mission-route__map' }, canvas, destinationMarker);
  const focus = el('button', { class: 'flight-button mission-route__focus', type: 'button', hidden: true }, 'Fit route');
  const hint = el('p', { class: 'mission-route__hint' }, 'Drag to rotate the Moon');
  map.append(focus, hint);
  const waypoint = (role: string, site: MissionRouteSite, style: string) => {
    const symbol = el('span', { 'aria-hidden': 'true', class: `mission-route__symbol mission-route__symbol--${style}` });
    if (style === 'end') symbol.innerHTML = icon('lander');
    return el('div', { class: 'mission-route__waypoint' }, symbol,
      el('div', {}, el('dt', {}, role), el('dd', {}, site.label)));
  };
  const direction = svgEl('svg', { viewBox: '0 0 24 16', 'aria-hidden': 'true' },
    svgEl('path', { d: 'M2 8h18m-5-5 5 5-5 5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
  const root = el('section', { class: 'mission-route', 'aria-label': 'Saved mission route' },
    map,
    el('div', { class: 'mission-route__sites' },
      start ? el('dl', {}, waypoint('Start site', start, 'start')) : null,
      start && end ? direction : null,
      end ? el('dl', {}, waypoint('Destination site', end, 'end')) : null),
  );
  const origin = lunarPoint(start);
  const destination = lunarPoint(end);
  const route = origin && destination ? trajectory(origin, destination) : undefined;
  const hasRoute = !!route?.points.length;
  const message = !end ? 'No destination selected.' : !origin || !destination ? 'Some site coordinates are unavailable.'
    : !hasRoute ? 'Both sites share the same coordinates.' : 'Illustrative path from start to destination.';
  root.append(el('p', { class: 'flight-dialog__intro' }, message));

  function mount() {
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true }); }
    catch {
      map.dataset.fallback = '';
      hint.textContent = '3D Moon view unavailable.';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, .01, 20);
    const center = route?.points[32]?.clone().normalize() ?? origin ?? destination ?? new Vector3(0, -.35, 1).normalize();
    const home = center.clone().multiplyScalar(4);
    camera.position.copy(home);
    camera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = .65;
    controls.update();
    const light = new DirectionalLight(0xf4efe1, 2.1);
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), center).normalize();
    light.position.copy(center).addScaledVector(right, -1.1).add(new Vector3(0, .45, 0));
    scene.add(light, new AmbientLight(0xd3dcdb, .48));

    let disposed = false;
    const texture = new TextureLoader().load(moonTexture, () => { if (!disposed) render(); });
    texture.colorSpace = SRGBColorSpace;
    const moonGeometry = new SphereGeometry(1, 96, 64);
    const moonMaterial = new MeshStandardMaterial({ map: texture, roughness: 1, color: new Color(0xd7d5ce) });
    scene.add(new Mesh(moonGeometry, moonMaterial));

    const markerGeometry = new SphereGeometry(1, 12, 8);
    const markerMaterial = new MeshBasicMaterial({ color: 0xffdb87 });
    const startMarker = new Mesh(markerGeometry, markerMaterial);
    if (origin) {
      startMarker.position.copy(origin).multiplyScalar(1.003);
      scene.add(startMarker);
    }
    const lineGeometry = new BufferGeometry();
    const lineMaterial = new LineBasicMaterial({ color: 0xffbb58 });
    let arrow: ArrowHelper | undefined;
    if (hasRoute && route) {
      const { points, angle } = route;
      scene.add(new Line(lineGeometry.setFromPoints(points), lineMaterial));
      const direction = points[42].clone().sub(points[38]).normalize();
      const arrowSize = Math.min(.14, angle * .24);
      arrow = new ArrowHelper(direction, points[38], arrowSize, 0xffbb58, arrowSize * .7, arrowSize * .55);
      scene.add(arrow);
    }
    const projected = new Vector3();
    let fitted = false;
    focus.hidden = !route || !hasRoute || route.angle >= .85;
    function render() {
      const width = map.clientWidth, height = map.clientHeight;
      if (!width || !height) return;
      const aspect = width / height;
      const extent = fitted && route ? Math.max(.012, route.angle * .82) : 1.19;
      const viewX = extent * Math.max(1, aspect);
      const viewY = extent * Math.max(1, 1 / aspect);
      camera.left = -viewX; camera.right = viewX; camera.top = viewY; camera.bottom = -viewY;
      camera.updateProjectionMatrix();
      startMarker.scale.setScalar(Math.max(.001, extent * .018));
      destinationMarker.classList.toggle('is-visible', !!destination && camera.position.dot(destination) > 1);
      if (destination) {
        projected.copy(destination).multiplyScalar(1.006).project(camera);
        destinationMarker.style.left = `${(projected.x + 1) * 50}%`;
        destinationMarker.style.top = `${(1 - projected.y) * 50}%`;
      }
      renderer.render(scene, camera);
    }
    const resize = new ResizeObserver(() => {
      renderer.setSize(map.clientWidth, map.clientHeight, false);
      render();
    });
    resize.observe(map);
    controls.addEventListener('change', render);
    focus.addEventListener('click', () => {
      fitted = !fitted;
      focus.textContent = fitted ? 'Show full Moon' : 'Fit route';
      camera.position.copy(home);
      controls.update();
      render();
    });
    return () => {
      disposed = true;
      resize.disconnect();
      controls.dispose();
      texture.dispose();
      moonMaterial.dispose();
      moonGeometry.dispose();
      markerMaterial.dispose();
      markerGeometry.dispose();
      lineMaterial.dispose();
      lineGeometry.dispose();
      arrow?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }
  return { root, mount };
}
