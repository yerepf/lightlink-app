import * as T from 'three';
import { directionXYZ, lowerIndex, type Frame, type SiteData } from './data.js';
import type { HeightField } from './terrain.js';
import { SCENE_PALETTE } from './palette.js';

export interface PowerTelemetry {
  timestamp_ms: number;
  battery_pct: number;
  solar_watts: number;
  net_watts: number;
  temp_celsius: number;
  status_label: 'NOMINAL' | 'RESERVA' | 'CRÍTICO' | 'AGOTADA';
}
export const SHADOW_DISCHARGE_PER_HOUR = 2.8;

export function batteryIndicator(battery: number) {
  return battery > 40 ? { color: SCENE_PALETTE.ok, hz: .45 }
    : battery >= 15 ? { color: SCENE_PALETTE.warn, hz: 1 }
    : { color: SCENE_PALETTE.danger, hz: 2.5 };
}
function input(frame: Frame) {
  const sunny = frame.conditions.sun_visible;
  const factor = Math.max(.25, Math.sin(T.MathUtils.degToRad(frame.sun.elevation_deg)));
  return {
    solar: sunny ? 450 * factor : 0, net: sunny ? 450 * factor : -120,
    rate: sunny ? 4 + 3 * (factor - .25) / .75 : -SHADOW_DISCHARGE_PER_HOUR,
    target: sunny ? 45 : -180, tau: sunny ? 6 : 12,
  };
}
/** Illustrative model: initial temperature -20 C, thermal time constants 6/12 h.
 * Visibility conditions are held through each source interval. */
export function createPowerTelemetry(frames: readonly Frame[], initialTemperature = -20) {
  if (!frames.length) throw new Error('Timeline vacío');
  const times = Float64Array.from(frames, f => Date.parse(f.timestamp_utc));
  if (!Number.isFinite(initialTemperature) || times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]))) throw new Error('Telemetría: entradas inválidas');
  const inputs = frames.map(input);
  function row(i: number, timestamp: number, battery: number, temperature: number): PowerTelemetry {
    return { timestamp_ms: timestamp, battery_pct: battery, solar_watts: inputs[i].solar,
      net_watts: inputs[i].net, temp_celsius: temperature,
      status_label: battery <= 0 ? 'AGOTADA' : battery < 15 ? 'CRÍTICO' : battery <= 40 ? 'RESERVA' : 'NOMINAL' };
  }
  function advance(base: PowerTelemetry, i: number, time: number) {
    const hours = (time - times[i]) / 3600000, p = inputs[i];
    return { battery: T.MathUtils.clamp(base.battery_pct + p.rate * hours, 0, 100),
      temperature: p.target + (base.temp_celsius - p.target) * Math.exp(-hours / p.tau) };
  }
  const power_telemetry = [row(0, times[0], 85, initialTemperature)];
  for (let i = 1; i < frames.length; i++) {
    const next = advance(power_telemetry[i - 1], i - 1, times[i]);
    power_telemetry.push(row(i, times[i], next.battery, next.temperature));
  }
  return {
    power_telemetry,
    sample(timestamp: number): PowerTelemetry {
      if (!Number.isFinite(timestamp)) throw new Error('Fecha inválida');
      const time = T.MathUtils.clamp(timestamp, times[0], times[times.length - 1]);
      const i = lowerIndex(times, time), next = advance(power_telemetry[i], i, time);
      return row(i, time, next.battery, next.temperature);
    },
  };
}

/** Call once on the unexaggerated central DEM, never on procedural surroundings. */
export function addSlopeColors(geometry: T.BufferGeometry) {
  const real = geometry.clone(); real.computeVertexNormals();
  const normals = real.getAttribute('normal'), values = new Float32Array(normals.count * 3);
  const slopes = new Float32Array(normals.count);
  const colors = [new T.Color('#22c55e'), new T.Color('#eab308'), new T.Color('#ef4444')];
  for (let i = 0; i < normals.count; i++) {
    const angle = slopes[i] = T.MathUtils.radToDeg(Math.acos(T.MathUtils.clamp(normals.getY(i), -1, 1)));
    colors[angle < 10 ? 0 : angle <= 15 ? 1 : 2].toArray(values, i * 3);
  }
  geometry.setAttribute('color', new T.BufferAttribute(values, 3)); real.dispose();
  geometry.setAttribute('slopeDeg', new T.BufferAttribute(slopes, 1));
}

/** Uses actual timeline directions; does not invent an Earth figure-eight. */
export function createSkyPaths(frames: readonly Frame[], convergence: number) {
  const group = new T.Group(); group.name = 'analyticalSkyPaths';
  for (const body of ['sun', 'earth'] as const) {
    const positions = new Float32Array(frames.length * 3), direction = new T.Vector3();
    frames.forEach((frame, i) => {
      directionXYZ(frame[body].azimuth_deg + convergence, frame[body].elevation_deg, direction);
      direction.multiplyScalar(800).toArray(positions, i * 3);
    });
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    const material = body === 'sun'
      ? new T.LineDashedMaterial({ color: SCENE_PALETTE.sun, dashSize: 5, gapSize: 3, transparent: true, opacity: .65, depthWrite: false })
      : new T.LineBasicMaterial({ color: SCENE_PALETTE.earth, transparent: true, opacity: .55, depthWrite: false });
    const line = new T.Line(geometry, material); line.name = body;
    if (body === 'sun') line.computeLineDistances();
    group.add(line);
  }
  return group;
}
export function disposeSkyPaths(group?: T.Group) {
  group?.removeFromParent();
  group?.traverse(object => {
    if (object instanceof T.Line) {
      object.geometry.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose());
    }
  });
}

export interface ScienceCandidate { x: number; z: number; elevation_m: number }
/** Bottom decile + local depression + spatial separation. Not proof of PSR/ice.
 * Returns fewer than three candidates when the DEM does not justify more. */
export function findScienceCandidates(field: HeightField, metadata: SiteData['terrain_metadata']) {
  const sorted = Float32Array.from(field.values).sort(), cutoff = sorted[Math.floor((sorted.length - 1) * .1)];
  const range = metadata.max_elevation_m - metadata.min_elevation_m;
  if (range <= 0) return [] as ScienceCandidate[];
  const stride = Math.max(1, Math.floor(Math.min(field.width, field.height) / 128));
  const radius = Math.max(2, Math.floor(Math.min(field.width, field.height) * .015));
  const candidates: ScienceCandidate[] = [], size = metadata.patch_size_km;
  for (let y = radius; y < field.height - radius; y += stride) {
    for (let x = radius; x < field.width - radius; x += stride) {
      const h = field.values[y * field.width + x]; if (h > cutoff) continue;
      let rim = Infinity;
      for (let d = 0; d < 8; d++) {
        const angle = d * Math.PI / 4;
        rim = Math.min(rim, field.values[Math.round(y + Math.sin(angle) * radius) * field.width + Math.round(x + Math.cos(angle) * radius)]);
      }
      if ((rim - h) * range < 2) continue;
      const wx = (x / (field.width - 1) - .5) * size, wz = (y / (field.height - 1) - .5) * size;
      if (Math.hypot(wx, wz) < size * .03) continue;
      candidates.push({ x: wx, z: wz, elevation_m: metadata.min_elevation_m + h * range });
    }
  }
  candidates.sort((a, b) => a.elevation_m - b.elevation_m);
  const selected: ScienceCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.every(other => Math.hypot(candidate.x - other.x, candidate.z - other.z) > size * .12)) selected.push(candidate);
    if (selected.length === 3) break;
  }
  return selected;
}
export function createScienceMarkers(candidates: ScienceCandidate[]) {
  const group = new T.Group(); group.name = 'scienceCandidates';
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = SCENE_PALETTE.scienceLabelBackground; ctx.fillRect(0, 0, 1024, 160);
  ctx.textAlign = 'center'; ctx.fillStyle = SCENE_PALETTE.scienceLabelText; ctx.font = 'bold 38px system-ui';
  ctx.fillText('Zona PSR (Posible Hielo de Agua)', 512, 65);
  ctx.font = '28px system-ui'; ctx.fillText('Candidato topográfico · sin confirmar', 512, 119);
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  const geometry = new T.SphereGeometry(.002, 12, 8), material = new T.MeshBasicMaterial({ color: SCENE_PALETTE.scienceMarker });
  const labelMaterial = new T.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false });
  const markers = candidates.map(candidate => {
    const marker = new T.Group(); marker.position.set(candidate.x, 0, candidate.z);
    const beacon = new T.Mesh(geometry, material); beacon.position.y = .003;
    const label = new T.Sprite(labelMaterial); label.position.y = .012;
    marker.add(beacon, label); group.add(marker); return { marker, label };
  });
  const world = new T.Vector3();
  return {
    group,
    place(heightAt: (x: number, z: number) => number) {
      for (const { marker } of markers) marker.position.y = heightAt(marker.position.x, marker.position.z) + .0001;
    },
    update(camera: T.Camera) {
      for (const { marker, label } of markers) {
        marker.getWorldPosition(world);
        const width = T.MathUtils.clamp(camera.position.distanceTo(world) * .18, .02, .6);
        label.scale.set(width, width * 160 / 1024, 1);
      }
    },
    dispose() { group.removeFromParent(); geometry.dispose(); material.dispose(); labelMaterial.dispose(); texture.dispose(); },
  };
}
