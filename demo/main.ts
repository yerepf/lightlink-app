import './ui/tokens.css';
import './ui/ui.css';
import { Vector3 } from 'three';
import { BackendClient, LunarEngine, decodeHeightmap16, createMockSite } from '../src/index';
import type { SiteData, TimeState } from '../src/data';
import { LiveClock } from '../src/LiveClock';
import { BackendError, customDateRange, validateCoordinates, type NewSite } from '../src/backend';
import { announce, el, formatSigned, formatUtc, isMobileViewport, setText, clamp } from './ui/dom';
import { icon } from './ui/icons';
import { AccordionSection } from './ui/components/AccordionSection';
import { Badge } from './ui/components/Badge';
import { Button } from './ui/components/Button';
import { InputField } from './ui/components/InputField';
import { ProgressBar } from './ui/components/ProgressBar';
import { SegmentedControl } from './ui/components/SegmentedControl';
import { Select } from './ui/components/Select';
import { Slider } from './ui/components/Slider';
import { Switch } from './ui/components/Switch';
import { CompassWidget } from './ui/CompassWidget';
import { TimelineWidget } from './ui/TimelineWidget';
import { headingFromDirection, trueHeading } from './ui/compassMath';

const uiEvents = new AbortController();
const signal = uiEvents.signal;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function listen<T extends EventTarget>(target: T, type: string, handler: EventListener, options: AddEventListenerOptions = {}): void {
  target.addEventListener(type, handler, { ...options, signal });
}

function setBadgeText(id: string, text: string, variant: 'neutral' | 'ok' | 'danger' | 'warning'): void {
  const node = byId(id);
  node.className = `ui-badge ui-badge--${variant}`;
  const label = node.querySelector('span:last-child');
  if (label) label.textContent = text;
}

function shortUtc(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toISOString().slice(5, 16).replace('T', ' ') + ' UTC';
}

const appShell = byId('app');
const viewport = byId('viewport');
const controlPanel = byId('control-panel');
const panelScroll = byId('panel-sections');
const panelToggle = byId<HTMLButtonElement>('panel-toggle');
const panelBackdrop = byId<HTMLElement>('panel-backdrop');
const statusPanel = byId('status-panel');
const statusToggle = byId<HTMLButtonElement>('status-toggle');
const statusSubtitle = byId('site-subtitle');
const perfOutput = byId('perf');
const toast = byId<HTMLElement>('toast');
const errorText = byId('error');
const retryButton = byId<HTMLButtonElement>('retry');

const api = new BackendClient();
const liveClock = new LiveClock();
const customRanges = new Map<string, ReturnType<typeof customDateRange>>();

let engine: LunarEngine | undefined;
let siteData: SiteData | undefined;
let request: AbortController | undefined;
let retryAction: () => Promise<void> = initialize;
let disposed = false;
let loading = true;
let currentTime = Date.now();
let lastSelection = '';
let lastHeight = '2';
let viewMode: 'surface' | 'orbital' | 'cinematic' | 'top' | 'globe' | 'lander' = 'surface';
let playbackRaf = 0;
let lastStatusPaint = 0;
let compassTimer = 0;
let perfTimer = 0;
let liveTimer = 0;

const forward = new Vector3();
const up = new Vector3();

const siteSelect = new Select({
  id: 'site',
  label: 'Sitio lunar',
  disabled: true,
  signal,
  onChange: () => void loadSelected(),
});
const heightSelect = new Select({
  id: 'height',
  label: 'Altura del observador',
  options: [
    { value: '2', label: '2 m' },
    { value: '5', label: '5 m (aproximación)' },
  ],
  value: '2',
  disabled: true,
  signal,
  onChange: () => void loadSelected(),
});
const siteDetail = el('p', { class: 'ui-note', id: 'detail' }, 'Selecciona un sitio para cargar terreno y efemérides.');
const loadProgress = el('p', { class: 'ui-note', id: 'load-progress', hidden: true });
const cancelLoad = new Button({
  label: 'Cancelar espera',
  variant: 'ghost',
  size: 'sm',
  block: true,
  signal,
  onClick: () => request?.abort(),
});
cancelLoad.root.id = 'cancel-load';
cancelLoad.root.hidden = true;

const siteSection = new AccordionSection({ id: 'section-site', title: 'Sitio lunar', iconName: 'site', open: true, signal });
siteSection.append(siteSelect.root, heightSelect.root, siteDetail, loadProgress, cancelLoad.root);

const viewControl = new SegmentedControl({
  label: 'Modo de vista',
  value: 'surface',
  signal,
  items: [
    { value: 'surface', label: 'Superficie', iconName: 'surface', description: 'Cámara fija a la altura del observador' },
    { value: 'lander', label: 'Lander', iconName: 'lander', description: 'Inspección del módulo de aterrizaje' },
    { value: 'globe', label: 'Globo', iconName: 'globe', description: 'Contexto global de la Luna' },
    { value: 'top', label: 'Mapa', iconName: 'top', description: 'Vista topográfica con norte arriba' },
    { value: 'cinematic', label: 'Cine', iconName: 'cinematic', description: 'Recorrido cinematográfico' },
    { value: 'orbital', label: 'Órbita', iconName: 'orbital', description: 'Vista orbital del terreno' },
  ],
  onChange: value => setView(value as typeof viewMode),
});
const cinematicPause = new Button({
  label: 'Pausar vuelo',
  variant: 'secondary',
  size: 'sm',
  iconName: 'pause',
  className: 'ui-btn--block',
  signal,
  onClick: () => {
    const paused = cinematicPause.root.getAttribute('aria-pressed') !== 'true';
    cinematicPause.setPressed(paused);
    cinematicPause.setLabel(paused ? 'Reanudar vuelo' : 'Pausar vuelo');
    engine?.setCinematicPaused(paused);
  },
});
cinematicPause.root.id = 'cinematic-pause';
cinematicPause.root.hidden = true;

const exaggeration = new Slider({
  id: 'exaggeration',
  label: 'Exageración del relieve',
  min: 1,
  max: 15,
  step: 1,
  value: 4,
  minLabel: '1×',
  maxLabel: '15×',
  format: value => `${value}×`,
  signal,
  onInput: value => engine?.setTerrainExaggeration(value),
});
const guidesSwitch = new Switch({
  id: 'guides',
  label: 'Guías de referencia',
  description: 'Rayo solar, observador y horizonte',
  signal,
  onChange: checked => engine?.setGuidesVisible(checked),
});
const effectsSwitch = new Switch({
  id: 'effects',
  label: 'Efectos visuales',
  description: 'Pulses RF, bloom e incidencia solar',
  checked: true,
  signal,
  onChange: checked => engine?.setVisualEffectsEnabled(checked),
});

const viewSection = new AccordionSection({ id: 'section-view', title: 'Vista y presentación', iconName: 'view', open: true, signal });
viewSection.append(viewControl.root, cinematicPause.root, exaggeration.root, guidesSwitch.root, effectsSwitch.root);

const slopeSwitch = new Switch({
  id: 'slope-hazard',
  label: 'Riesgo de pendiente',
  description: 'Colorea pendientes suaves, moderadas y altas',
  signal,
  onChange: checked => {
    engine?.setSlopeHazardEnabled(checked);
    slopeLegend.hidden = !checked;
    mapLegend.hidden = viewMode !== 'top' || checked;
  },
});
const skyPathsSwitch = new Switch({
  id: 'sky-paths',
  label: 'Trayectorias Sol–Tierra',
  description: 'Arcos analíticos sobre el cielo lunar',
  signal,
  onChange: checked => {
    engine?.setSkyPathsEnabled(checked);
    pathsLegend.hidden = !checked;
  },
});
function legendItem(dotClass: string, label: string): HTMLElement {
  return el('span', { class: 'ui-legend__item' }, el('span', { class: `ui-legend__dot ${dotClass}` }), label);
}
const slopeLegend = el(
  'div',
  { class: 'ui-legend', id: 'slope-legend', hidden: true },
  legendItem('ui-legend__dot--ok', 'Suave'),
  legendItem('ui-legend__dot--warning', 'Moderada'),
  legendItem('ui-legend__dot--danger', 'Alta'),
);
const pathsLegend = el(
  'div',
  { class: 'ui-legend', id: 'paths-legend', hidden: true },
  legendItem('ui-legend__dot--sun', 'Sol'),
  legendItem('ui-legend__dot--earth', 'Tierra'),
);
const mapLegend = el(
  'div',
  { class: 'ui-legend', id: 'map-legend', hidden: true },
  legendItem('ui-legend__dot--horizon', 'Norte arriba · mapa topográfico'),
);
const layersSection = new AccordionSection({ id: 'section-layers', title: 'Capas de análisis', iconName: 'layers', open: false, signal });
layersSection.append(slopeSwitch.root, slopeLegend, skyPathsSwitch.root, pathsLegend, mapLegend);

const coordinateName = new InputField({
  id: 'coordinate-name',
  label: 'Nombre del sitio',
  placeholder: 'Ej. Cráter Shackleton',
  maxlength: 120,
  required: true,
  autocomplete: 'off',
  signal,
  validate: value => {
    const name = value.trim();
    if (!name) return 'Escribe un nombre.';
    if (name.length > 120) return 'Máximo 120 caracteres.';
    return undefined;
  },
});
const coordinateLat = new InputField({
  id: 'coordinate-lat',
  label: 'Latitud',
  type: 'number',
  inputmode: 'decimal',
  step: 'any',
  min: -90,
  max: 90,
  placeholder: '−89.9',
  help: 'Grados, de −90 a 90.',
  signal,
  validate: value => {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number)) return 'Introduce una latitud válida.';
    if (number < -90 || number > 90) return 'La latitud debe estar entre −90 y 90.';
    return undefined;
  },
});
const coordinateLon = new InputField({
  id: 'coordinate-lon',
  label: 'Longitud',
  type: 'number',
  inputmode: 'decimal',
  step: 'any',
  min: -180,
  max: 360,
  placeholder: '0',
  help: 'Grados, de −180 a 360.',
  signal,
  validate: value => {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number)) return 'Introduce una longitud válida.';
    if (number < -180 || number > 360) return 'La longitud debe estar entre −180 y 360.';
    return undefined;
  },
});
coordinateName.root.classList.add('ui-form-grid__wide');
const coordinateSubmit = new Button({
  label: 'Registrar coordenadas',
  variant: 'primary',
  type: 'submit',
  iconName: 'coordinates',
  block: true,
  className: 'ui-form-grid__wide',
  signal,
});
const coordinateForm = el(
  'form',
  { class: 'ui-stack ui-stack--sm', id: 'coordinate-form', novalidate: true },
  el('div', { class: 'ui-form-grid' }, coordinateName.root, coordinateLat.root, coordinateLon.root),
  coordinateSubmit.root,
  el('p', { class: 'ui-note' }, 'La generación de un punto nuevo puede tardar hasta 4 minutos. La cobertura depende de los DEM disponibles.'),
);
const coordinatesSection = new AccordionSection({ id: 'section-coordinates', title: 'Nuevo punto', iconName: 'coordinates', open: false, signal });
coordinatesSection.append(coordinateForm);

const infoSection = new AccordionSection({ id: 'section-info', title: 'Información', iconName: 'info', open: false, signal });
const dataSource = el(
  'p',
  { class: 'ui-note', id: 'data-source' },
  'Terreno LOLA y efemérides JPL Horizons. Visualización geométrica; no certificada para planificación de vuelo.',
);
infoSection.append(
  el('p', { class: 'ui-note' }, 'Arrastra con el visor para orbitar. La línea de tiempo permite arrastrar para buscar, arrastrar el fondo para desplazar y usar la rueda para ampliar.'),
  el('p', { class: 'ui-note' }, 'Separación entre centros de píxeles, horizonte y co-visibilidad proceden del conjunto entregado por el backend. El modo simulado no usa datos científicos.'),
  dataSource,
);
panelScroll.append(siteSection.root, viewSection.root, layersSection.root, coordinatesSection.root, infoSection.root);

const statusHead = el(
  'div',
  { class: 'status-panel__head' },
  el(
    'div',
    {},
    el('h2', { class: 'status-panel__title' }, 'Estado de la misión'),
    el('p', { class: 'status-panel__sample', id: 'status-sample' }, 'Muestra horaria —'),
  ),
);
const statusClose = el('button', { class: 'icon-button status-panel__close', type: 'button', 'aria-label': 'Cerrar estado' });
statusClose.innerHTML = icon('close');
statusHead.append(statusClose);

const coValue = el('strong', { class: 'status-hero__value', id: 'co-visibility-value' }, '—');
const sunChip = new Badge({ text: 'Sol —', variant: 'neutral' });
const earthChip = new Badge({ text: 'Tierra —', variant: 'neutral' });
const coChip = new Badge({ text: 'Co-visibilidad —', variant: 'neutral' });
const statusChips = el('div', { class: 'status-chips', id: 'status-chips' }, sunChip.root, earthChip.root, coChip.root);
const statusHero = el(
  'div',
  { class: 'status-hero' },
  el('span', { class: 'status-hero__label' }, 'Co-visibilidad Sol–Tierra'),
  coValue,
  statusChips,
);

function metric(label: string, id: string, wide = false): { root: HTMLElement; value: HTMLElement } {
  const value = el('span', { class: 'status-metric__value', id }, '—');
  return {
    root: el('div', { class: `status-metric${wide ? ' status-metric--wide' : ''}` }, el('span', { class: 'status-metric__label' }, label), value),
    value,
  };
}
const sunMetric = metric('Sol · azimut / elevación', 'metric-sun');
const earthMetric = metric('Tierra · azimut / elevación', 'metric-earth');
const sampleMetric = metric('Punto de muestra', 'metric-sample');
const coverageMetric = metric('Cobertura temporal', 'metric-coverage', true);
const statusGrid = el('div', { class: 'status-grid' }, sunMetric.root, earthMetric.root, sampleMetric.root, coverageMetric.root);

const batteryBar = new ProgressBar({ label: 'Batería', value: 0 });
const powerTelemetry = el('p', { class: 'ui-mono text-muted', id: 'power-telemetry' }, 'Sin telemetría.');
const scienceStatus = el('p', { class: 'ui-note', id: 'science-status' }, 'Analizando candidatos topográficos…');
const energySection = el(
  'div',
  { class: 'status-section' },
  el('h3', { class: 'status-section__title' }, 'Energía y ciencia'),
  batteryBar.root,
  powerTelemetry,
  scienceStatus,
);

const beamStatus = el('p', { class: 'ui-note', id: 'beam-status' }, 'Diagnóstico visual pendiente.');
const diagnosticSection = el(
  'div',
  { class: 'status-section' },
  el('h3', { class: 'status-section__title' }, 'Diagnóstico visual'),
  beamStatus,
);

const statusSource = el('p', { class: 'ui-note' }, 'Fuente pendiente.');
const sourceSection = el(
  'div',
  { class: 'status-section' },
  el('h3', { class: 'status-section__title' }, 'Fuente de datos'),
  statusSource,
);

const statusBody = el('div', { class: 'status-panel__body' }, statusHero, statusGrid, energySection, diagnosticSection, sourceSection);
statusPanel.replaceChildren(statusHead, statusBody);

const compass = new CompassWidget(byId('compass-mount'), signal);
const timeline = new TimelineWidget(byId('timeline-mount'), {
  onSeek: ms => {
    liveClock.followNow = false;
    stopPlayback();
    updateAt(ms);
    refreshLive();
  },
  onPlay: rate => startPlayback(rate),
  onPause: () => {
    stopPlayback();
    refreshLive();
  },
  onLiveToggle: () => toggleLive(),
});

function setPanelOpen(open: boolean): void {
  controlPanel.dataset.open = String(open);
  appShell.classList.toggle('panel-collapsed', !open);
  panelToggle.setAttribute('aria-expanded', String(open));
  panelToggle.setAttribute('aria-label', open ? 'Ocultar controles' : 'Mostrar controles');
  panelBackdrop.hidden = !open || !isMobileViewport();
}

function setStatusOpen(open: boolean): void {
  statusPanel.dataset.open = String(open);
  statusToggle.setAttribute('aria-expanded', String(open));
  statusToggle.setAttribute('aria-label', open ? 'Ocultar estado y resultados' : 'Mostrar estado y resultados');
}

panelToggle.addEventListener('click', () => {
  setPanelOpen(controlPanel.dataset.open !== 'true');
}, { signal });
panelBackdrop.addEventListener('click', () => setPanelOpen(false), { signal });
statusToggle.addEventListener('click', () => {
  setStatusOpen(statusPanel.dataset.open !== 'true');
}, { signal });
statusClose.addEventListener('click', () => setStatusOpen(false), { signal });

setPanelOpen(!isMobileViewport());
setStatusOpen(!isMobileViewport());
const mobileQuery = window.matchMedia('(max-width: 720px)');
listen(mobileQuery, 'change', () => {
  setPanelOpen(!mobileQuery.matches);
  setStatusOpen(!mobileQuery.matches);
});

function sourceLabel(): string {
  return lastSelection === 'MOCK' ? 'SIMULADO' : 'Backend';
}

function setFormDisabled(disabled: boolean): void {
  siteSelect.setDisabled(disabled);
  heightSelect.setDisabled(disabled);
  for (const field of [coordinateName, coordinateLat, coordinateLon]) field.setDisabled(disabled);
  coordinateSubmit.setDisabled(disabled);
}

function setSourceCopy(mock: boolean): void {
  const text = mock
    ? 'Modo simulado: relieve, horizonte y efemérides ficticios para desarrollo sin API.'
    : 'Terreno LOLA y efemérides JPL Horizons del conjunto entregado por el equipo. Visualización geométrica; no certificada para planificación de vuelo.';
  setText(dataSource, text);
  setText(statusSource, text);
}

function hideToast(): void {
  toast.hidden = true;
  retryButton.hidden = true;
}

function showError(cause: unknown): void {
  const hints: Record<number, string> = {
    404: 'El registro puede haber expirado. Vuelve a registrar las coordenadas.',
    409: 'El servidor ya está procesando este punto. Espera antes de reintentar.',
    422: 'No hay cobertura suficiente para estas coordenadas o fechas. Prueba otro punto dentro de los DEM disponibles.',
    429: 'El servidor está procesando otro sitio. Espera y reintenta.',
    502: 'No se pudieron obtener las efemérides de Horizons. Reintenta más tarde.',
    503: 'El servidor necesita Redis, los DEM y el entorno Python para generar sitios nuevos.',
    504: 'La generación superó el tiempo máximo del servidor. Puedes reintentar.',
  };
  errorText.textContent = `${cause instanceof Error ? cause.message : String(cause)}. ${
    cause instanceof BackendError ? hints[cause.status] ?? 'Revisa los datos e intenta de nuevo.' : 'Comprueba la conexión e intenta de nuevo.'
  }`;
  retryButton.hidden = false;
  toast.hidden = false;
  announce('Error de carga. Revisa el aviso y reintenta.');
}

function updateCompass(): void {
  const state = engine?.getState();
  if (!state || !siteData) {
    compass.update(null);
    return;
  }
  let sceneHeading = 0;
  if (viewMode === 'top') {
    sceneHeading = 0;
  } else if (engine) {
    engine.camera.getWorldDirection(forward);
    up.copy(engine.camera.up).applyQuaternion(engine.camera.quaternion);
    sceneHeading = headingFromDirection(forward.x, forward.z, up.x, up.z);
  }
  const convergence = siteData.spatial?.grid_convergence_deg ?? 0;
  compass.update({
    headingDeg: trueHeading(sceneHeading, convergence),
    sun: {
      azimuth_deg: state.sun.azimuth_deg,
      elevation_deg: state.sun.elevation_deg,
      aboveHorizon: state.horizonEstimate.sun_visible,
      backendVisible: state.conditions.sun_visible,
    },
    earth: {
      azimuth_deg: state.earth.azimuth_deg,
      elevation_deg: state.earth.elevation_deg,
      aboveHorizon: state.horizonEstimate.earth_visible,
      backendVisible: state.conditions.earth_visible,
    },
  });
}

function updateBeamStatus(): void {
  if (!engine) return;
  const diagnostic = engine.visualDiagnostics;
  setText(
    beamStatus,
    diagnostic.dte === 'outside_visual_terrain'
      ? 'DTE bloqueado por el backend; sin impacto en el terreno visual. Pulsos e incidencia ilustrativos.'
      : diagnostic.dte === 'impact'
        ? `Impacto visual DTE a ${diagnostic.impactDistanceM?.toFixed(1)} m de la antena. Pulsos e incidencia ilustrativos.`
        : 'Pulsos RF e incidencia solar ilustrativos; no representan un presupuesto de enlace o potencia.',
  );
}

function updateStatus(state: TimeState): void {
  const conditions = state.conditions;
  const co = conditions.co_visibility;

  setText(coValue, co ? 'Sí' : 'No');
  coValue.classList.toggle('is-ok', co);
  sunChip.set(conditions.sun_visible ? 'Sol visible' : 'Sol oculto', conditions.sun_visible ? 'sun' : 'neutral');
  earthChip.set(conditions.earth_visible ? 'Tierra visible' : 'Tierra oculta', conditions.earth_visible ? 'earth' : 'neutral');
  coChip.set(co ? 'Co-visibilidad' : 'Sin co-visibilidad', co ? 'ok' : 'neutral');

  setText(sunMetric.value, `Az ${state.sun.azimuth_deg.toFixed(1)}° · El ${formatSigned(state.sun.elevation_deg)}°`);
  setText(earthMetric.value, `Az ${state.earth.azimuth_deg.toFixed(1)}° · El ${formatSigned(state.earth.elevation_deg)}°`);
  const sample = Date.parse(state.sampleTimestampUtc);
  setText(sampleMetric.value, Number.isFinite(sample) ? shortUtc(sample) : state.sampleTimestampUtc);
  const range = timeline.range;
  setText(coverageMetric.value, `${shortUtc(range.start)} — ${shortUtc(range.end)}`);
  setText(byId('status-sample'), `Muestra horaria ${Number.isFinite(sample) ? shortUtc(sample) : state.sampleTimestampUtc}`);

  setBadgeText('dte-badge', conditions.earth_visible ? 'DTE: activo' : 'DTE: bloqueado', conditions.earth_visible ? 'ok' : 'danger');

  const telemetry = engine?.getPowerTelemetry();
  batteryBar.setValue(telemetry?.battery_pct ?? 0);
  setText(
    powerTelemetry,
    telemetry
      ? `${telemetry.status_label} · ${telemetry.battery_pct.toFixed(1)}% · ${telemetry.net_watts.toFixed(0)} W netos · ${telemetry.temp_celsius.toFixed(1)} °C · Solar ${telemetry.solar_watts.toFixed(0)} W`
      : 'Sin telemetría.',
  );
  const count = engine?.getScienceCandidateCount() ?? 0;
  setText(
    scienceStatus,
    `${count} ${count === 1 ? 'candidato topográfico' : 'candidatos topográficos'} PSR. La profundidad no confirma sombra permanente ni hielo de agua.`,
  );
  updateBeamStatus();

  timeline.setSampleText(`Muestra ${state.sampleTimestampUtc}`);
  timeline.setStatus(
    `${sourceLabel()} (${state.sampleTimestampUtc}): Sol ${conditions.sun_visible ? 'visible' : 'oculto'} · Tierra ${conditions.earth_visible ? 'visible' : 'oculta'} · Co-visibilidad ${co ? 'sí' : 'no'}`,
  );
}

function updateAt(ms: number): void {
  if (!engine || !siteData) return;
  let state: TimeState;
  try {
    state = engine.setTime(ms);
  } catch {
    return;
  }
  currentTime = state.timestampMs;
  timeline.setTime(currentTime);
  updateStatus(state);
  updateCompass();
}

function refreshLive(): void {
  const now = Date.now();
  const available = liveClock.available(now);
  const active = !loading && liveClock.sample(now) !== null;
  timeline.setLiveState({ active, disabled: loading || liveClock.simulated || !available });

  if (loading) {
    setBadgeText('live-badge', 'Cargando', 'warning');
    timeline.setLiveStatus('Consultando cobertura temporal…');
  } else if (liveClock.simulated) {
    setBadgeText('live-badge', 'Simulado', 'warning');
    timeline.setLiveStatus('Simulación: el modo en vivo requiere efemérides reales.');
  } else if (!available) {
    setBadgeText('live-badge', 'Fuera de cobertura', 'neutral');
    timeline.setLiveStatus(`Sin cobertura para la hora actual. Datos disponibles: ${shortUtc(liveClock.start)} — ${shortUtc(liveClock.end)}.`);
  } else if (active) {
    setBadgeText('live-badge', 'En vivo', 'ok');
    timeline.setLiveStatus('En vivo · reloj del dispositivo (UTC) · Posiciones interpoladas; visibilidad de la muestra horaria.');
  } else {
    setBadgeText('live-badge', 'Manual', 'neutral');
    timeline.setLiveStatus('Exploración manual · Posiciones interpoladas; visibilidad de la muestra horaria.');
  }

  if (active) {
    currentTime = now;
    updateAt(now);
  }
}

function toggleLive(): void {
  if (loading || liveClock.simulated || !liveClock.available(Date.now())) return;
  stopPlayback();
  liveClock.followNow = !liveClock.followNow;
  refreshLive();
  announce(liveClock.followNow ? 'Modo en vivo activado.' : 'Modo en vivo pausado.');
}

function startPlayback(rate: number): void {
  if (!engine || !siteData) return;
  liveClock.followNow = false;
  refreshLive();
  stopPlayback();
  try {
    engine.play(rate);
  } catch (cause) {
    showError(cause);
    return;
  }
  timeline.setPlaying(true);
  lastStatusPaint = 0;
  announce('Reproducción iniciada.');
  playbackRaf = requestAnimationFrame(playbackFrame);
}

function stopPlayback(): void {
  engine?.pause();
  timeline.setPlaying(false);
  if (playbackRaf) cancelAnimationFrame(playbackRaf);
  playbackRaf = 0;
}

function playbackFrame(): void {
  playbackRaf = 0;
  if (!timeline.isPlaying) return;
  const state = engine?.getState();
  if (!state) {
    stopPlayback();
    return;
  }
  currentTime = state.timestampMs;
  timeline.setTime(currentTime);
  const now = performance.now();
  if (now - lastStatusPaint > 150) {
    lastStatusPaint = now;
    updateStatus(state);
    updateCompass();
  }
  const { start, end } = timeline.range;
  if (currentTime >= end - 1) {
    if (timeline.isLooping) {
      engine?.setTime(start);
      engine?.play(timeline.speedRate);
      updateAt(start);
    } else {
      stopPlayback();
      announce('Fin de la efeméride disponible.');
      refreshLive();
      return;
    }
  }
  playbackRaf = requestAnimationFrame(playbackFrame);
}

function setView(mode: typeof viewMode): void {
  viewMode = mode;
  viewControl.setValue(mode);
  engine?.setViewMode(mode);
  cinematicPause.root.hidden = mode !== 'cinematic';
  mapLegend.hidden = mode !== 'top' || slopeSwitch.isChecked;
  updateCompass();
}

function submitCoordinates(event: SubmitEvent): void {
  event.preventDefault();
  if (loading) return;
  const valid = [coordinateName, coordinateLat, coordinateLon].map(field => field.validateNow());
  if (valid.includes(false)) {
    const first = [coordinateName, coordinateLat, coordinateLon][valid.indexOf(false)];
    first.focus();
    return;
  }
  try {
    const input = validateCoordinates({
      name: coordinateName.value,
      latitude: coordinateLat.valueAsNumber,
      longitude: coordinateLon.valueAsNumber,
    });
    void loadSelected(input);
  } catch (cause) {
    showError(cause);
  }
}
coordinateForm.addEventListener('submit', event => submitCoordinates(event as SubmitEvent), { signal });

async function loadSelected(coordinates?: NewSite, selectedId = siteSelect.value): Promise<void> {
  stopPlayback();
  request?.abort();
  request = new AbortController();
  const active = request;
  let selected = selectedId;
  const selectedHeight = heightSelect.value;
  retryAction = () => loadSelected(coordinates, selected);
  loading = true;
  refreshLive();
  hideToast();
  setFormDisabled(true);
  cancelLoad.root.hidden = false;
  loadProgress.hidden = false;
  timeline.setEnabled(false);

  let phase = coordinates ? 'Registrando coordenadas' : 'Cargando sitio';
  const began = Date.now();
  const report = () => {
    loadProgress.textContent = `${phase} · ${Math.floor((Date.now() - began) / 1000)} s. La generación nueva puede tardar hasta 4 minutos.`;
  };
  report();
  const waiting = window.setInterval(report, 1000);
  timeline.setStatus(`Cargando ${selected}…`);

  try {
    if (coordinates) {
      const registered = await api.registerSite(coordinates, active.signal);
      if (disposed || active.signal.aborted) return;
      selected = registered.site_id;
      const exists = Array.from(siteSelect.select.options).some(option => option.value === selected);
      if (!exists) siteSelect.select.add(new Option(registered.name ?? selected, selected));
      siteSelect.setValue(selected);
      customRanges.set(selected, customDateRange(liveClock.followNow ? Date.now() : currentTime));
    }
    if (selected.startsWith('custom_') && !customRanges.has(selected)) {
      customRanges.set(selected, customDateRange(liveClock.followNow ? Date.now() : currentTime));
    }

    phase = selected.startsWith('custom_') ? 'Generando o recuperando terreno, horizonte y efemérides' : 'Descargando datos del sitio';
    report();
    if (!engine) throw new Error('El motor 3D no está disponible.');
    const mock = selected === 'MOCK' ? createMockSite() : undefined;
    const site = mock?.site ?? await api.loadSite(selected, Number(selectedHeight) as 2 | 5, active.signal, customRanges.get(selected));

    phase = 'Descargando heightmap de 16 bits';
    report();
    const field = mock?.field ?? await decodeHeightmap16(site.heightmap_url, active.signal);
    if (disposed || active.signal.aborted) return;

    phase = 'Construyendo terreno 3D';
    report();
    await engine.loadSite(site, field);
    engine.setObserverHeight(Number(selectedHeight));
    if (disposed || active.signal.aborted) return;

    siteData = site;
    const start = Date.parse(site.ephemeris_timeline[0].timestamp_utc);
    const end = Date.parse(site.ephemeris_timeline.at(-1)!.timestamp_utc);
    liveClock.configure(start, end, !!mock);
    currentTime = clamp(currentTime, start, end);
    timeline.configure(site.ephemeris_timeline, start, end);
    timeline.setTime(currentTime);
    lastSelection = selected;
    lastHeight = selectedHeight;

    const heightNote =
      selectedHeight === '5' && !selected.startsWith('custom_')
        ? ' A 5 m, el backend reutiliza las efemérides de 2 m como aproximación.'
        : '';
    setText(
      siteDetail,
      mock
        ? 'SIMULADO: parche de 20 × 20 km. Relieve, horizonte y estados ficticios para probar sin API.'
        : `${siteSelect.select.selectedOptions[0]?.textContent ?? selected} · PNG 16 bits · ${site.terrain_metadata.patch_size_km.toFixed(3)} km entre centros de píxeles · Observador a ${selectedHeight} m.${heightNote}`,
    );
    setSourceCopy(!!mock);
    setText(
      statusSubtitle,
      mock
        ? 'Modo simulado · Datos ficticios para desarrollo'
        : `${siteSelect.select.selectedOptions[0]?.textContent ?? selected} · ${site.terrain_metadata.patch_size_km.toFixed(1)} km · Observador a ${selectedHeight} m`,
    );
    heightSelect.select.options[1].textContent = selected.startsWith('custom_') ? '5 m' : '5 m (aproximación)';
    updateAt(currentTime);
  } catch (cause) {
    if (!disposed && request === active) {
      if (lastSelection) {
        siteSelect.setValue(lastSelection);
        heightSelect.setValue(lastHeight);
        if (engine?.getState() && siteData) updateAt(currentTime);
      }
      if (!active.signal.aborted) showError(cause);
      else {
        const message = 'Espera cancelada. El servidor podría continuar el cálculo; puedes volver a cargar el sitio.';
        loadProgress.textContent = message;
        timeline.setStatus(message);
        announce('Carga cancelada.');
      }
    }
  } finally {
    clearInterval(waiting);
    if (!disposed && request === active) {
      setFormDisabled(false);
      cancelLoad.root.hidden = true;
      loadProgress.hidden = !active.signal.aborted;
      loading = false;
      timeline.setEnabled(!!siteData);
      refreshLive();
    }
  }
}

async function initialize(): Promise<void> {
  hideToast();
  retryAction = initialize;
  try {
    if (!engine) engine = new LunarEngine(viewport, { decodeHeightmap: decodeHeightmap16 });
    if (!engine.getState()) {
      siteSelect.setOptions([{ value: 'MOCK', label: 'Demo sin API (simulado)' }], 'MOCK');
      await loadSelected(undefined, 'MOCK');
    }
    request?.abort();
    request = new AbortController();
    const catalog = await api.listSites(request.signal);
    if (disposed) return;
    const options = [
      { value: 'MOCK', label: 'Demo sin API (simulado)' },
      ...catalog.map(item => {
        const label = item.name ?? item.site_id;
        const pending = item.status === 'pending_data';
        return { value: item.site_id, label: pending ? `${label} (por generar)` : label, disabled: pending };
      }),
    ];
    const available = catalog.filter(item => item.status !== 'pending_data');
    if (!available.length) {
      siteSelect.setOptions(options, 'MOCK');
      siteSelect.setValue('MOCK');
      return;
    }
    const preferred = available.find(item => item.site_id === 'Site04')?.site_id ?? available[0].site_id;
    siteSelect.setOptions(options, preferred);
    await loadSelected(undefined, preferred);
  } catch (cause) {
    if (!disposed) {
      retryAction = initialize;
      timeline.setStatus(engine?.getState() ? 'Demo simulada disponible. No se pudo conectar con los datos reales.' : 'No se pudo conectar con los datos.');
      showError(cause);
    }
  }
}

retryButton.addEventListener('click', () => void retryAction(), { signal });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshLive();
}, { signal });

compassTimer = window.setInterval(updateCompass, 120);
perfTimer = window.setInterval(() => {
  if (!engine) return;
  setText(perfOutput, `${engine.stats.fps.toFixed(0)} FPS · ${engine.stats.frameMs.toFixed(1)} ms · ${engine.stats.drawCalls} draws`);
}, 1000);
liveTimer = window.setInterval(() => {
  if (!document.hidden) refreshLive();
}, 1000);

void initialize();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    request?.abort();
    window.clearInterval(compassTimer);
    window.clearInterval(perfTimer);
    window.clearInterval(liveTimer);
    if (playbackRaf) cancelAnimationFrame(playbackRaf);
    uiEvents.abort();
    compass.dispose();
    timeline.dispose();
    engine?.dispose();
  });
}
