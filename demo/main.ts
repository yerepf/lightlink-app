import { Vector3 } from 'three';
import { LunarEngine, createMockSite } from '../src/index';
import type { LandingPoint } from '../src/LunarEngine';
import type { SiteData, TimeState } from '../src/data';
import { coverage } from '../src/missionMetrics';
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
import { ApiClient, OFFLINE_SITES, TRAINING_SITE, type SiteAsset } from './apiClient';
import { ExplorerStoryMode } from './ui/ExplorerStoryMode';
import { SiteComparator } from './ui/SiteComparator';
import { angleChart, downloadAnalysis } from './ui/MissionAnalysis';

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
const modeSwitch = byId<HTMLAnchorElement>('mode-switch');
const storyReset = byId<HTMLButtonElement>('story-reset');
const compareOpen = byId<HTMLButtonElement>('compare-open');
const relocateFeedback = byId('relocate-feedback');

const api = new ApiClient();
const liveClock = new LiveClock();
const customRanges = new Map<string, ReturnType<typeof customDateRange>>();

let engine: LunarEngine | undefined;
let siteData: SiteData | undefined;
let activeAsset: SiteAsset | undefined;
let landing: LandingPoint | undefined;
let mode: 'explorer' | 'planner' | undefined;
let relocating = false;
let catalogOffline = false;
let campaignRun = 0;
let catalogRequest: AbortController | undefined;
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
  onChange: setSlopeOverlay,
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
  legendItem('ui-legend__dot--ok', '< 10°'),
  legendItem('ui-legend__dot--warning', '10–15°'),
  legendItem('ui-legend__dot--danger', '> 15°'),
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
const relocateButton = new Button({ label: 'Activar reubicador', variant: 'secondary', block: true, signal, onClick: () => setRelocating(!relocating) });
relocateButton.root.id = 'relocate-toggle';
relocateButton.setPressed(false);
siteSection.append(relocateButton.root);

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

const angularChart = el('div', { id: 'angular-chart' });
const analysis = el('div', { class: 'status-section' }, el('h3', { class: 'status-section__title' }, 'Elevación y horizonte'), angularChart,
  el('div', { class: 'mission-exports' }, ...(['csv', 'json'] as const).map(format => {
    const exportButton = el('button', { class: 'flight-button', type: 'button' }, `Exportar ${format.toUpperCase()}`);
    listen(exportButton, 'click', () => { if (siteData) downloadAnalysis(format, siteData, landing ? `local_dem_${activeAsset?.origin ?? 'unknown'}` : activeAsset?.origin ?? 'unknown', landing); });
    return exportButton;
  })));
const statusBody = el('div', { class: 'status-panel__body' }, statusHero, statusGrid, analysis, energySection, diagnosticSection, sourceSection);
statusPanel.replaceChildren(statusHead, statusBody);

const compass = new CompassWidget(byId('compass-mount'), signal);
const timeline = new TimelineWidget(byId('timeline-mount'), {
  onSeek: ms => {
    liveClock.followNow = false;
    stopPlayback();
    updateAt(ms);
    refreshLive();
    const state = engine?.getState();
    if (siteData && state?.conditions.co_visibility) story.seek(siteData.ephemeris_timeline, state.timestampMs, engine?.getPowerTelemetry()?.battery_pct);
  },
  onPlay: rate => startPlayback(rate),
  onPause: () => {
    stopPlayback();
    refreshLive();
  },
  onLiveToggle: () => toggleLive(),
});

const story = new ExplorerStoryMode(byId('story-mount'), {
  enter: enterStoryStep,
  relocate: () => { setRelocating(!relocating); story.message(''); },
  compare: openComparator,
  retry: restartStory,
  planner: () => { location.hash = '#mision'; },
});

const comparator = new SiteComparator(appShell, async (id, abort) => {
  if (id === '@current' && activeAsset && siteData) return { ...activeAsset, site: siteData, origin: landing && activeAsset.origin !== 'mock' ? 'local' : activeAsset.origin };
  if (id === 'MOCK') return { ...createMockSite(), origin: 'mock' };
  if (id.startsWith('custom_') && !customRanges.has(id)) customRanges.set(id, customDateRange(currentTime));
  return api.loadSite(id, Number(lastHeight) as 2 | 5, abort, customRanges.get(id), mode === 'explorer' || catalogOffline);
}, recommendation => story.compared(recommendation));

listen(compareOpen, 'click', openComparator);
listen(storyReset, 'click', restartStory);

function setPanelOpen(open: boolean): void {
  controlPanel.dataset.open = String(open);
  controlPanel.inert = !open;
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
setStatusOpen(false);
const mobileQuery = window.matchMedia('(max-width: 720px)');
listen(mobileQuery, 'change', () => {
  setPanelOpen(mode !== 'explorer' && !mobileQuery.matches);
  setStatusOpen(false);
});

function sourceLabel(): string {
  if (activeAsset?.origin === 'mock') return landing ? 'SIMULADO · horizonte local' : 'SIMULADO';
  if (landing) return `Horizonte local · ${activeAsset?.origin === 'bundled' ? 'copia local' : 'efemérides del sitio base'}`;
  return activeAsset?.origin === 'bundled' ? 'Copia local' : 'Backend';
}

function setFormDisabled(disabled: boolean): void {
  siteSelect.setDisabled(disabled);
  heightSelect.setDisabled(disabled);
  for (const field of [coordinateName, coordinateLat, coordinateLon]) field.setDisabled(disabled);
  coordinateSubmit.setDisabled(disabled);
  relocateButton.setDisabled(disabled || !siteData);
  compareOpen.disabled = disabled || !siteData;
}

function setSourceCopy(mock: boolean): void {
  const original = mock
    ? 'Modo simulado: relieve, horizonte y efemérides ficticios para desarrollo sin API.'
    : 'Terreno LOLA y efemérides JPL Horizons del conjunto entregado por el equipo. Visualización geométrica; no certificada para planificación de vuelo.';
  const text = `${original}${landing ? ' En el punto reubicado se estima el horizonte dentro del DEM y se reutilizan los ángulos del sitio base.' : ''}`;
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
      ? 'DTE bloqueado según el horizonte; sin impacto en el terreno visual. Pulsos e incidencia ilustrativos.'
      : diagnostic.dte === 'impact'
        ? `Impacto visual DTE a ${diagnostic.impactDistanceM?.toFixed(1)} m de la antena. Pulsos e incidencia ilustrativos.`
        : 'Pulsos RF e incidencia solar ilustrativos; no representan un presupuesto de enlace o potencia.',
  );
}

function updateStatus(state: TimeState): void {
  const conditions = state.conditions;
  setText(byId('hud-utc'), new Date(state.timestampMs).toISOString().slice(11, 19));
  setText(byId('hud-date'), new Date(state.timestampMs).toISOString().slice(0, 10));
  setText(byId('hud-sun'), conditions.sun_visible ? 'Visible' : 'Oculto');
  setText(byId('hud-earth'), conditions.earth_visible ? 'Enlace directo' : 'Enlace bloqueado');
  setText(byId('hud-sun-angle'), `Elevación ${formatSigned(state.sun.elevation_deg)}°`);
  setText(byId('hud-earth-angle'), `Elevación ${formatSigned(state.earth.elevation_deg)}°`);
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
  setText(byId('status-sample'), `${sourceLabel()} · ${Number.isFinite(sample) ? shortUtc(sample) : state.sampleTimestampUtc}`);

  setBadgeText('dte-badge', conditions.earth_visible ? 'DTE: activo' : 'DTE: bloqueado', conditions.earth_visible ? 'ok' : 'danger');

  const telemetry = engine?.getPowerTelemetry();
  setText(byId('hud-battery'), telemetry ? `${telemetry.battery_pct.toFixed(1)}%` : '—');
  byId<HTMLProgressElement>('hud-battery-bar').value = telemetry?.battery_pct ?? 0;
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
  timeline.setLiveState({ active, disabled: mode === 'explorer' || loading || liveClock.simulated || !available });

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
  if (mode === 'explorer' || loading || liveClock.simulated || !liveClock.available(Date.now())) return;
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

function setSlopeOverlay(checked: boolean) {
  slopeSwitch.setChecked(checked);
  engine?.setSlopeHazardEnabled(checked);
  slopeLegend.hidden = !checked;
  mapLegend.hidden = viewMode !== 'top' || checked;
}

function setRelocating(enabled: boolean) {
  relocating = enabled && !loading && !!siteData;
  relocateButton.setPressed(relocating);
  relocateButton.setLabel(relocating ? 'Salir del reubicador' : 'Activar reubicador');
  viewport.classList.toggle('is-relocating', relocating);
  viewport.tabIndex = relocating ? 0 : -1;
  relocateFeedback.hidden = !relocating;
  story.relocationActive(relocating);
  keyboardPoint = undefined;
  pointerPosition = undefined;
  delete relocateFeedback.dataset.safe;
  if (!relocating) { engine?.previewLandingPoint(); return; }
  setSlopeOverlay(true);
  if (viewMode !== 'top' && viewMode !== 'orbital') setView('top');
  if (isMobileViewport()) setPanelOpen(false);
  const tip = 'Elige un vértice verde · flechas y Enter con teclado';
  relocateFeedback.textContent = tip;
  story.cursorReadout(isMobileViewport() ? 'Toca un vértice verde del mapa.' : tip);
  viewport.focus({ preventScroll: true });
}

function applyLanding(point: LandingPoint) {
  if (!engine) return;
  const start = performance.now();
  stopPlayback();
  liveClock.followNow = false;
  siteData = engine.relocate(point);
  landing = point;
  const { start: from, end } = coverage(siteData.ephemeris_timeline);
  timeline.configure(siteData.ephemeris_timeline, from, end);
  angularChart.replaceChildren(angleChart(siteData));
  setSourceCopy(activeAsset?.origin === 'mock');
  statusSubtitle.textContent = `${lastSelection} · X ${point.x.toFixed(3)} km · Z ${point.z.toFixed(3)} km · ${point.slopeDeg.toFixed(1)}°`;
  updateAt(currentTime); refreshLive();
  announce(`Módulo en X ${point.x.toFixed(3)} km, Z ${point.z.toFixed(3)} km. Pendiente ${point.slopeDeg.toFixed(1)}°. Horizonte recalculado en ${Math.round(performance.now() - start)} ms.`);
}

function hoverLanding(x: number, y: number) {
  const point = engine?.pickLandingPoint(x, y);
  engine?.previewLandingPoint(point);
  const safe = point ? point.slopeDeg < 10 : undefined;
  const label = point ? `${point.slopeDeg.toFixed(1)}° · ${safe ? 'Zona verde' : 'Zona de riesgo'}` : 'Apunta dentro del mapa de pendientes';
  relocateFeedback.textContent = label;
  relocateFeedback.dataset.safe = safe === undefined ? '' : String(safe);
  story.cursorReadout(label, safe);
  return point;
}

function pickLanding(x: number, y: number) {
  const point = hoverLanding(x, y);
  if (!point) return;
  if (story.step === 2 && point.slopeDeg >= 10) { story.message(`Pendiente de ${point.slopeDeg.toFixed(1)}°. Prueba una zona verde de menos de 10°.`); return; }
  try {
    applyLanding(point);
    setRelocating(false);
    story.landing(point.slopeDeg);
    if (story.step === 2) byId('story-mount').querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    else relocateButton.root.focus({ preventScroll: true });
  } catch (error) { showError(error); }
}

let gesture: { id: number; x: number; y: number; rotation: number[]; moved: boolean } | undefined;
let keyboardPoint: { x: number; y: number } | undefined;
let cursorFrame = 0;
let pointerPosition: { x: number; y: number } | undefined;
listen(viewport, 'pointerdown', event => {
  const e = event as PointerEvent;
  if (!e.isPrimary || e.button !== 0) return;
  gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, rotation: engine?.camera.quaternion.toArray() ?? [], moved: false };
});
listen(viewport, 'pointermove', event => {
  const e = event as PointerEvent;
  if (gesture?.id === e.pointerId && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 5) gesture.moved = true;
  if (!relocating || e.pointerType === 'touch') return;
  pointerPosition = { x: e.clientX, y: e.clientY };
  if (!cursorFrame) cursorFrame = requestAnimationFrame(() => {
    cursorFrame = 0;
    if (relocating && pointerPosition) hoverLanding(pointerPosition.x, pointerPosition.y);
  });
});
listen(viewport, 'pointerup', event => {
  const e = event as PointerEvent;
  if (!gesture || gesture.id !== e.pointerId) return;
  const { moved, rotation } = gesture; gesture = undefined;
  if (moved && engine?.camera.quaternion.toArray().some((v, i) => Math.abs(v - rotation[i]) > .001)) story.rotated();
  if (!moved && relocating) pickLanding(e.clientX, e.clientY);
});
listen(viewport, 'pointercancel', () => { gesture = undefined; });
listen(viewport, 'pointerleave', () => { pointerPosition = undefined; engine?.previewLandingPoint(); });
listen(viewport, 'keydown', event => {
  if (!relocating) return;
  const e = event as KeyboardEvent;
  if (e.key === 'Escape') {
    e.preventDefault(); setRelocating(false);
    if (story.step === 2) { story.message(''); byId('story-mount').querySelector<HTMLButtonElement>('[data-story-relocate]')?.focus(); }
    else relocateButton.root.focus();
    return;
  }
  const rect = viewport.getBoundingClientRect();
  keyboardPoint ??= { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickLanding(keyboardPoint.x, keyboardPoint.y); return; }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  keyboardPoint.x = clamp(keyboardPoint.x + (e.key === 'ArrowLeft' ? -12 : e.key === 'ArrowRight' ? 12 : 0), rect.left + 1, rect.right - 1);
  keyboardPoint.y = clamp(keyboardPoint.y + (e.key === 'ArrowUp' ? -12 : e.key === 'ArrowDown' ? 12 : 0), rect.top + 1, rect.bottom - 1);
  const point = hoverLanding(keyboardPoint.x, keyboardPoint.y);
  announce(point ? `${point.slopeDeg.toFixed(1)} grados. ${point.slopeDeg < 10 ? 'Zona verde.' : 'Zona de riesgo.'}` : 'Fuera del mapa de pendientes.');
});

function openComparator() {
  if (!siteData || loading) return;
  const current = { id: '@current', label: `${lastSelection === 'MOCK' ? 'Demo simulada' : lastSelection}${landing ? ' · reubicado' : ' · activo'}` };
  const choices = [current, ...Array.from(siteSelect.select.options)
    .filter(option => option.value && !option.disabled && (option.value !== 'MOCK' || lastSelection === 'MOCK'))
    .map(option => ({ id: option.value, label: option.textContent ?? option.value }))];
  comparator.open(choices, lastSelection === 'Site01' ? 'Site07' : 'Site01');
}

function enterStoryStep(step: 1 | 2 | 3 | 4 | 5 | 6) {
  appShell.dataset.storyStep = String(step);
  if (step === 1) { void prepareStory(); return; }
  if (step === 2) {
    setSlopeOverlay(true); setView('top');
    const hazard = engine?.findHazard();
    if (!hazard) { story.setFailure(); return; }
    applyLanding(hazard);
  }
  if (step === 3 && siteData) {
    setSlopeOverlay(false); setView('surface');
    const { start } = coverage(siteData.ephemeris_timeline);
    updateAt(start);
    const any = siteData.ephemeris_timeline.some(frame => frame.conditions.co_visibility);
    story.setNoWindow(!any);
    if (!any) story.message('Este vértice no tiene luz y señal simultáneas durante la cobertura. Prueba otra zona verde.');
  }
  if (step === 6) queueMicrotask(openComparator);
}

async function prepareStory() {
  const run = ++campaignRun;
  story.setBusy(true);
  liveClock.followNow = false;
  setSlopeOverlay(false);
  setView('orbital');
  setRelocating(false);
  heightSelect.setValue('2'); siteSelect.setValue(TRAINING_SITE);
  const loaded = await loadSelected(undefined, TRAINING_SITE, true);
  if (mode !== 'explorer' || campaignRun !== run) return;
  if (loaded) {
    const frames = siteData!.ephemeris_timeline;
    const brightest = frames.reduce((best, frame) => frame.sun.elevation_deg > best.sun.elevation_deg ? frame : best);
    currentTime = Date.parse(brightest.timestamp_utc);
    updateAt(currentTime); story.setBusy(false);
  } else story.setFailure();
}

function restartStory() {
  if (mode !== 'explorer') return;
  comparator.close(); story.start();
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

async function loadSelected(coordinates?: NewSite, selectedId = siteSelect.value, preferBundled = catalogOffline): Promise<boolean> {
  stopPlayback();
  setRelocating(false);
  request?.abort();
  request = new AbortController();
  const active = request;
  let selected = selectedId;
  const selectedHeight = heightSelect.value;
  retryAction = async () => { await loadSelected(coordinates, selected, preferBundled); };
  loading = true;
  refreshLive();
  hideToast();
  setFormDisabled(true);
  cancelLoad.root.hidden = false;
  loadProgress.hidden = false;
  timeline.setEnabled(false);

  let phase = coordinates ? 'Registrando coordenadas' : 'Cargando sitio';
  let keepProgress = false;
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
      if (disposed || active.signal.aborted) return false;
      selected = registered.site_id;
      const exists = Array.from(siteSelect.select.options).some(option => option.value === selected);
      if (!exists) siteSelect.select.add(new Option(registered.name ?? selected, selected));
      if (registered.status === 'pending_data') {
        const option = Array.from(siteSelect.select.options).find(item => item.value === selected)!;
        option.textContent = `${registered.name ?? selected} (por generar)`; option.disabled = true;
        const message = `El backend registró ${registered.name ?? selected}. El sitio todavía no tiene terreno ni efemérides para analizar.`;
        loadProgress.textContent = message;
        keepProgress = true;
        announce(message);
        return true;
      }
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
    const asset: SiteAsset = mock ? { ...mock, origin: 'mock' } : await api.loadSite(selected, Number(selectedHeight) as 2 | 5, active.signal, customRanges.get(selected), preferBundled);
    const { site, field } = asset;
    if (disposed || active.signal.aborted) return false;

    phase = 'Construyendo terreno 3D';
    report();
    await engine.loadSite(site, field);
    engine.setObserverHeight(Number(selectedHeight));
    if (disposed || active.signal.aborted) return false;

    siteData = site;
    activeAsset = asset;
    landing = undefined;
    const start = Date.parse(site.ephemeris_timeline[0].timestamp_utc);
    const end = Date.parse(site.ephemeris_timeline.at(-1)!.timestamp_utc);
    liveClock.configure(start, end, !!mock);
    currentTime = clamp(currentTime, start, end);
    timeline.configure(site.ephemeris_timeline, start, end);
    timeline.setTime(currentTime);
    lastSelection = selected;
    lastHeight = selectedHeight;
    angularChart.replaceChildren(angleChart(site));

    const heightNote =
      selectedHeight === '5' && !selected.startsWith('custom_')
        ? ' A 5 m, el backend reutiliza las efemérides de 2 m como aproximación.'
        : '';
    setText(
      siteDetail,
      mock
        ? 'SIMULADO: parche de 20 × 20 km. Relieve, horizonte y estados ficticios para probar sin API.'
        : `${selected} · ${sourceLabel()} · PNG de 16 bits · Parche de ${site.terrain_metadata.patch_size_km.toFixed(3)} km · Observador a ${selectedHeight} m.${heightNote}`,
    );
    setSourceCopy(!!mock);
    setText(
      statusSubtitle,
      mock
        ? 'Modo simulado · Datos ficticios para desarrollo'
        : `${selected} · ${sourceLabel()} · ${site.terrain_metadata.patch_size_km.toFixed(1)} km · Observador a ${selectedHeight} m`,
    );
    heightSelect.select.options[1].textContent = selected.startsWith('custom_') ? '5 m' : '5 m (aproximación)';
    updateAt(currentTime);
    return true;
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
    return false;
  } finally {
    clearInterval(waiting);
    if (!disposed && request === active) {
      setFormDisabled(false);
      cancelLoad.root.hidden = true;
      loadProgress.hidden = !active.signal.aborted && !keepProgress;
      loading = false;
      timeline.setEnabled(!!siteData);
      refreshLive();
    }
  }
}

const bundledOptions = [
  ...OFFLINE_SITES.map(site_id => ({ value: site_id, label: site_id })),
  { value: 'MOCK', label: 'Demo sin API (simulado)' },
];

async function fetchCatalog(): Promise<void> {
  catalogRequest?.abort();
  const active = catalogRequest = new AbortController();
  try {
    const { sites, offline } = await api.listSites(active.signal);
    if (disposed || active.signal.aborted) return;
    catalogOffline = offline;
    const previous = siteSelect.value || TRAINING_SITE;
    const options = sites.map(item => {
      const label = item.name ?? item.site_id;
      const pending = item.status === 'pending_data';
      return { value: item.site_id, label: pending ? `${label} (por generar)` : label, disabled: pending };
    });
    for (const option of Array.from(siteSelect.select.options)) if (customRanges.has(option.value) && !options.some(r => r.value === option.value)) {
      options.push({ value: option.value, label: option.textContent ?? option.value, disabled: option.disabled });
    }
    siteSelect.setOptions([...options, bundledOptions.at(-1)!], previous);
  } catch {
    if (!active.signal.aborted) catalogOffline = true;
  }
}

async function initialize(): Promise<void> {
  if (!engine) engine = new LunarEngine(viewport);
  if (!siteSelect.value) siteSelect.setOptions(bundledOptions, TRAINING_SITE);
  void fetchCatalog();
  if (!await loadSelected(undefined, TRAINING_SITE) && mode === 'planner' && !siteData && !loading && !disposed) {
    siteSelect.setValue('MOCK'); await loadSelected(undefined, 'MOCK');
  }
}

export function setMode(next: 'explorer' | 'planner') {
  if (mode === next) return;
  if (!engine) engine = new LunarEngine(viewport);
  if (!siteSelect.value) siteSelect.setOptions(bundledOptions, TRAINING_SITE);
  mode = next;
  appShell.dataset.mode = mode;
  byId('mission-title').textContent = next === 'explorer' ? 'Lunar Co-Visibility Explorer' : 'Mission Planner';
  modeSwitch.href = next === 'explorer' ? '#mision' : '#explorador';
  modeSwitch.textContent = next === 'explorer' ? 'Mission Planner' : 'Explorador';
  storyReset.hidden = next !== 'explorer';
  setPanelOpen(next === 'planner' && !isMobileViewport());
  setStatusOpen(false);
  setRelocating(false);
  comparator.close();
  if (next === 'explorer') {
    if (!catalogRequest) void fetchCatalog();
    story.start();
  } else {
    story.close();
    if (!siteData && !request) void initialize();
    else if (!siteData && !loading) void initialize();
    else if (siteData && !loading) void fetchCatalog();
    refreshLive();
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    request?.abort();
    catalogRequest?.abort(); comparator.close();
    if (cursorFrame) cancelAnimationFrame(cursorFrame);
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
