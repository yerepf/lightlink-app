import { Vector3 } from 'three';
import { LunarEngine } from '../src/index';
import type { LandingPoint } from '../src/LunarEngine';
import type { ViewMode } from '../src/SurfaceCamera';
import type { SiteData, TimeState } from '../src/data';
import { coverage, HOUR } from '../src/missionMetrics';
import { LiveClock } from '../src/LiveClock';
import { BackendError, customDateRange, validateCoordinates, type NewSite, type SiteRange } from '../src/backend';
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
import { API_BASE, ApiClient, OFFLINE_SITES, TRAINING_SITE, type SiteAsset } from './apiClient';
import { PlannerApi, type Mission } from './plannerApi';
import { PlannerMissions } from './ui/PlannerMissions';
import type { MissionRouteSite } from './ui/MissionRoute';
import { ExplorerStoryMode } from './ui/ExplorerStoryMode';
import { SiteComparator } from './ui/SiteComparator';
import { LaunchDelay } from './ui/LaunchDelay';
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
const plannerTools = byId('planner-tools');
const activeMissionName = byId('active-mission-name');
const moveLander = byId<HTMLButtonElement>('move-lander');
const openMissions = byId<HTMLButtonElement>('open-missions');
const openLaunchDelay = byId<HTMLButtonElement>('open-launch-delay');

const accounts = new PlannerApi(API_BASE);
const api = new ApiClient(() => accounts.token);
const liveClock = new LiveClock();
const customRanges = new Map<string, ReturnType<typeof customDateRange>>();

let engine: LunarEngine | undefined;
let siteData: SiteData | undefined;
let activeAsset: SiteAsset | undefined;
let landing: LandingPoint | undefined;
let mode: 'explorer' | 'planner' | undefined;
let relocating = false;
let activeMission: Mission | undefined;
let plannerSiteOptions: MissionRouteSite[] = [];
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
let viewMode: ViewMode = 'surface';
let relocationDisplay: { view: ViewMode; slope: boolean } | undefined;
let playbackRaf = 0;
let lastStatusPaint = 0;
let compassTimer = 0;
let perfTimer = 0;
let liveTimer = 0;

const forward = new Vector3();
const up = new Vector3();

const siteSelect = new Select({
  id: 'site',
  label: 'Lunar site',
  disabled: true,
  signal,
  onChange: () => void loadSelected(),
});
const heightSelect = new Select({
  id: 'height',
  label: 'Observer height',
  options: [
    { value: '2', label: '2 m' },
    { value: '5', label: '5 m (approximate)' },
  ],
  value: '2',
  disabled: true,
  signal,
  onChange: () => void loadSelected(),
});
const siteDetail = el('p', { class: 'ui-note', id: 'detail' }, 'Select a site to load terrain and ephemerides.');
const loadProgress = el('p', { class: 'ui-note', id: 'load-progress', hidden: true });
const cancelLoad = new Button({
  label: 'Cancel loading',
  variant: 'ghost',
  size: 'sm',
  block: true,
  signal,
  onClick: () => request?.abort(),
});
cancelLoad.root.id = 'cancel-load';
cancelLoad.root.hidden = true;

const siteSection = new AccordionSection({ id: 'section-site', title: 'Lunar site', iconName: 'site', open: true, signal });
siteSection.append(siteSelect.root, heightSelect.root, siteDetail, loadProgress, cancelLoad.root);

const viewControl = new SegmentedControl({
  label: 'Camera view',
  value: 'surface',
  signal,
  items: [
    { value: 'surface', label: 'Surface', iconName: 'surface', description: 'Fixed camera at observer height' },
    { value: 'lander', label: 'Lander', iconName: 'lander', description: 'Inspect the lander' },
    { value: 'globe', label: 'Globe', iconName: 'globe', description: 'View the whole Moon' },
    { value: 'top', label: 'Map', iconName: 'top', description: 'North-up topographic view' },
    { value: 'cinematic', label: 'Flyover', iconName: 'cinematic', description: 'Cinematic flyover' },
    { value: 'orbital', label: 'Orbit', iconName: 'orbital', description: 'Orbital view of the terrain' },
  ],
  onChange: value => setView(value as typeof viewMode),
});
const cinematicPause = new Button({
  label: 'Pause flyover',
  variant: 'secondary',
  size: 'sm',
  iconName: 'pause',
  className: 'ui-btn--block',
  signal,
  onClick: () => {
    const paused = cinematicPause.root.getAttribute('aria-pressed') !== 'true';
    cinematicPause.setPressed(paused);
    cinematicPause.setLabel(paused ? 'Resume flyover' : 'Pause flyover');
    engine?.setCinematicPaused(paused);
  },
});
cinematicPause.root.id = 'cinematic-pause';
cinematicPause.root.hidden = true;

const exaggeration = new Slider({
  id: 'exaggeration',
  label: 'Terrain exaggeration',
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
  label: 'Reference guides',
  description: 'Sun ray, observer and horizon',
  signal,
  onChange: checked => engine?.setGuidesVisible(checked),
});
const effectsSwitch = new Switch({
  id: 'effects',
  label: 'Visual effects',
  description: 'RF pulses, bloom and solar incidence',
  checked: true,
  signal,
  onChange: checked => engine?.setVisualEffectsEnabled(checked),
});

const viewSection = new AccordionSection({ id: 'section-view', title: 'View and display', iconName: 'view', open: true, signal });
viewSection.append(viewControl.root, cinematicPause.root, exaggeration.root, guidesSwitch.root, effectsSwitch.root);

const slopeSwitch = new Switch({
  id: 'slope-hazard',
  label: 'Slope hazards',
  description: 'Color-code gentle, moderate and steep slopes',
  signal,
  onChange: setSlopeOverlay,
});
const skyPathsSwitch = new Switch({
  id: 'sky-paths',
  label: 'Sun and Earth paths',
  description: 'Calculated arcs across the lunar sky',
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
  legendItem('ui-legend__dot--sun', 'Sun'),
  legendItem('ui-legend__dot--earth', 'Earth'),
);
const mapLegend = el(
  'div',
  { class: 'ui-legend', id: 'map-legend', hidden: true },
  legendItem('ui-legend__dot--horizon', 'North up · topographic map'),
);
const layersSection = new AccordionSection({ id: 'section-layers', title: 'Analysis layers', iconName: 'layers', open: false, signal });
layersSection.append(slopeSwitch.root, slopeLegend, skyPathsSwitch.root, pathsLegend, mapLegend);
const relocateButton = new Button({ label: 'Activate relocation', variant: 'secondary', block: true, signal, onClick: () => setRelocating(!relocating) });
relocateButton.root.id = 'relocate-toggle';
relocateButton.setPressed(false);
siteSection.append(relocateButton.root);

const coordinateName = new InputField({
  id: 'coordinate-name',
  label: 'Site name',
  placeholder: 'e.g. Shackleton Crater',
  maxlength: 120,
  required: true,
  autocomplete: 'off',
  signal,
  validate: value => {
    const name = value.trim();
    if (!name) return 'Enter a name.';
    if (name.length > 120) return 'Use 120 characters or fewer.';
    return undefined;
  },
});
const coordinateLat = new InputField({
  id: 'coordinate-lat',
  label: 'Latitude',
  type: 'number',
  inputmode: 'decimal',
  step: 'any',
  min: -90,
  max: 90,
  placeholder: '−89.9',
  help: 'Degrees, from −90 to 90.',
  signal,
  validate: value => {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number)) return 'Enter a valid latitude.';
    if (number < -90 || number > 90) return 'Latitude must be between −90 and 90.';
    return undefined;
  },
});
const coordinateLon = new InputField({
  id: 'coordinate-lon',
  label: 'Longitude',
  type: 'number',
  inputmode: 'decimal',
  step: 'any',
  min: -180,
  max: 360,
  placeholder: '0',
  help: 'Degrees, from −180 to 360.',
  signal,
  validate: value => {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number)) return 'Enter a valid longitude.';
    if (number < -180 || number > 360) return 'Longitude must be between −180 and 360.';
    return undefined;
  },
});
coordinateName.root.classList.add('ui-form-grid__wide');
const coordinateSubmit = new Button({
  label: 'Register coordinates',
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
  el('p', { class: 'ui-note' }, 'Creating a new site can take up to four minutes. Coverage depends on the available elevation models.'),
);
const coordinatesSection = new AccordionSection({ id: 'section-coordinates', title: 'New site', iconName: 'coordinates', open: false, signal });
coordinatesSection.append(coordinateForm);

const infoSection = new AccordionSection({ id: 'section-info', title: 'Information', iconName: 'info', open: false, signal });
const dataSource = el(
  'p',
  { class: 'ui-note', id: 'data-source' },
  'LOLA terrain and JPL Horizons ephemerides. Geometric visualization for exploratory planning.',
);
infoSection.append(
  el('p', { class: 'ui-note' }, 'Drag the view to orbit. Drag the playhead to scrub, drag the timeline background to pan, or scroll to zoom.'),
  el('p', { class: 'ui-note' }, 'Pixel spacing, horizon and co-visibility come from the mission dataset. The simulation uses synthetic data.'),
  dataSource,
);
panelScroll.append(siteSection.root, viewSection.root, layersSection.root, coordinatesSection.root, infoSection.root);

const statusHead = el(
  'div',
  { class: 'status-panel__head' },
  el(
    'div',
    {},
    el('h2', { class: 'status-panel__title' }, 'Mission status'),
    el('p', { class: 'status-panel__sample', id: 'status-sample' }, 'Hourly sample —'),
  ),
);
const statusClose = el('button', { class: 'icon-button status-panel__close', type: 'button', 'aria-label': 'Close status panel' });
statusClose.innerHTML = icon('close');
statusHead.append(statusClose);

const coValue = el('strong', { class: 'status-hero__value', id: 'co-visibility-value' }, '—');
const sunChip = new Badge({ text: 'Sun —', variant: 'neutral' });
const earthChip = new Badge({ text: 'Earth —', variant: 'neutral' });
const coChip = new Badge({ text: 'Co-visibility —', variant: 'neutral' });
const statusChips = el('div', { class: 'status-chips', id: 'status-chips' }, sunChip.root, earthChip.root, coChip.root);
const statusHero = el(
  'div',
  { class: 'status-hero' },
  el('span', { class: 'status-hero__label' }, 'Sun–Earth co-visibility'),
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
const sunMetric = metric('Sun · azimuth / elevation', 'metric-sun');
const earthMetric = metric('Earth · azimuth / elevation', 'metric-earth');
const sampleMetric = metric('Sample time', 'metric-sample');
const coverageMetric = metric('Time coverage', 'metric-coverage', true);
const statusGrid = el('div', { class: 'status-grid' }, sunMetric.root, earthMetric.root, sampleMetric.root, coverageMetric.root);

const batteryBar = new ProgressBar({ label: 'Battery', value: 0 });
const powerStatus = { NOMINAL: 'Nominal', RESERVA: 'Reserve', CRÍTICO: 'Critical', AGOTADA: 'Depleted' };
const powerTelemetry = el('p', { class: 'ui-mono text-muted', id: 'power-telemetry' }, 'No telemetry.');
const scienceStatus = el('p', { class: 'ui-note', id: 'science-status' }, 'Analyzing terrain candidates…');
const energySection = el(
  'div',
  { class: 'status-section' },
  el('h3', { class: 'status-section__title' }, 'Power and science'),
  batteryBar.root,
  powerTelemetry,
  scienceStatus,
);

const beamStatus = el('p', { class: 'ui-note', id: 'beam-status' }, 'Awaiting visual diagnostics.');
const diagnosticSection = el(
  'div',
  { class: 'status-section' },
  el('h3', { class: 'status-section__title' }, 'Visual diagnostics'),
  beamStatus,
);

const statusSource = el('p', { class: 'ui-note' }, 'Awaiting data source.');
const sourceSection = el(
  'div',
  { class: 'status-section' },
  el('h3', { class: 'status-section__title' }, 'Data source'),
  statusSource,
);

const angularChart = el('div', { id: 'angular-chart' });
const analysis = el('div', { class: 'status-section' }, el('h3', { class: 'status-section__title' }, 'Elevation and horizon'), angularChart,
  el('div', { class: 'mission-exports' }, ...(['csv', 'json'] as const).map(format => {
    const exportButton = el('button', { class: 'flight-button', type: 'button' }, `Export ${format.toUpperCase()}`);
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
    if (siteData && state && story.step === 3 && timeline.root.dataset.coGuide) {
      timeline.setCoVisibilityGuide(state.conditions.co_visibility ? 'confirmed' : 'outside');
      story.seek(siteData.ephemeris_timeline, state.timestampMs, state.conditions.co_visibility, engine?.getPowerTelemetry()?.battery_pct);
    }
  },
  onPlay: rate => startPlayback(rate),
  onPause: () => {
    stopPlayback();
    refreshLive();
  },
  onLiveToggle: () => toggleLive(),
});
const storyTimelineSize = new ResizeObserver(() => {
  appShell.style.setProperty('--story-timeline-height', `${timeline.root.getBoundingClientRect().height}px`);
});
storyTimelineSize.observe(timeline.root);

const story = new ExplorerStoryMode(byId('story-mount'), {
  enter: enterStoryStep,
  relocate: () => { setRelocating(!relocating); story.message(''); },
  compare: openComparator,
  retry: restartStory,
  planner: () => { location.hash = '#planner'; },
});

const comparator = new SiteComparator(appShell, async (id, abort) => {
  if (id === '@current' && activeAsset && siteData) return { ...activeAsset, site: siteData, origin: landing ? 'local' : activeAsset.origin };
  if (id.startsWith('custom_') && !customRanges.has(id)) customRanges.set(id, customDateRange(currentTime));
  return api.loadSite(id, Number(lastHeight) as 2 | 5, abort, selectedRange(id), mode === 'explorer' || catalogOffline);
}, recommendation => story.compared(recommendation));
const launchDelay = new LaunchDelay(appShell, api);

function compareLaunchDelay(mission = activeMission) {
  const sites = new Map<string, MissionRouteSite>(bundledOptions.map(site => [site.value, { id: site.value, label: site.label }]));
  for (const site of plannerSiteOptions) sites.set(site.id, site);
  for (const id of mission?.site_ids ?? []) {
    sites.set(id, { id, label: mission?.sites?.find(site => site.site_id === id)?.name ?? sites.get(id)?.label ?? id });
  }
  const missionStart = Date.parse(mission?.start_utc ?? '');
  const missionEnd = Date.parse(mission?.end_utc ?? '');
  const start = Number.isFinite(missionStart) ? missionStart : Math.floor(currentTime / HOUR) * HOUR;
  const duration = Number.isFinite(missionEnd - missionStart) ? Math.floor((missionEnd - missionStart) / HOUR) : 24;
  launchDelay.open({ sites: [...sites.values()], plannedSite: mission?.site_ids[0] ?? (lastSelection || TRAINING_SITE),
    start, hours: Math.max(1, duration), height: Number(mission?.observer_height_m ?? lastHeight) === 5 ? 5 : 2,
    mission: mission?.name });
}

const missions = new PlannerMissions(accounts, appShell, {
  sites: () => plannerSiteOptions.length ? [...plannerSiteOptions] : Array.from(siteSelect.select.options).filter(option => !option.disabled)
    .map(option => ({ id: option.value, label: option.text })),
  draft: () => {
    const range = siteData ? coverage(siteData.ephemeris_timeline) : undefined;
    const useRange = range && range.end - range.start >= 3600000 && range.end - range.start <= 62 * 86400000;
    const dates = useRange ? { start_utc: new Date(range.start).toISOString(), end_utc: new Date(range.end).toISOString() } : customDateRange(currentTime);
    return { ...dates, site_ids: [lastSelection || TRAINING_SITE], observer_height_m: Number(lastHeight) };
  },
  sessionChanged: () => {
    if (!accounts.token) {
      customRanges.clear();
      if (activeMission || lastSelection.startsWith('custom_') || siteSelect.value.startsWith('custom_')) leaveMission(true);
    }
    void fetchCatalog();
  },
  activeMission: () => activeMission,
  openMission: activateMission,
  compareLaunchDelay,
  leaveMission: () => leaveMission(),
});

listen(compareOpen, 'click', openComparator);
listen(storyReset, 'click', restartStory);
listen(openMissions, 'click', () => missions.open());
listen(openLaunchDelay, 'click', () => compareLaunchDelay());
listen(moveLander, 'click', () => { setStatusOpen(false); setRelocating(!relocating); });

function setPanelOpen(open: boolean): void {
  controlPanel.dataset.open = String(open);
  controlPanel.inert = !open;
  appShell.classList.toggle('panel-collapsed', !open);
  panelToggle.setAttribute('aria-expanded', String(open));
  panelToggle.setAttribute('aria-label', open ? 'Hide controls' : 'Show controls');
  panelBackdrop.hidden = !open || !isMobileViewport();
}

function setStatusOpen(open: boolean): void {
  statusPanel.dataset.open = String(open);
  statusToggle.setAttribute('aria-expanded', String(open));
  statusToggle.setAttribute('aria-label', open ? 'Hide status and results' : 'Show status and results');
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
  if (landing) return `Local horizon · ${activeAsset?.origin === 'bundled' ? 'local copy' : 'base-site ephemerides'}`;
  return activeAsset?.origin === 'bundled' ? 'Local copy' : 'Backend';
}

function setFormDisabled(disabled: boolean): void {
  siteSelect.setDisabled(disabled);
  heightSelect.setDisabled(disabled || !!activeMission);
  for (const field of [coordinateName, coordinateLat, coordinateLon]) field.setDisabled(disabled || !!activeMission);
  coordinateSubmit.setDisabled(disabled || !!activeMission);
  relocateButton.setDisabled(disabled || !siteData);
  moveLander.disabled = disabled || !siteData;
  compareOpen.disabled = disabled || !siteData;
}

function setSourceCopy(): void {
  const original = 'LOLA terrain and JPL Horizons ephemerides from the mission dataset. Geometric visualization for exploratory planning.';
  const text = `${original}${landing ? ' The relocated site uses a horizon estimated from the local elevation model and angles from the base site.' : ''}`;
  setText(dataSource, text);
  setText(statusSource, text);
}

function hideToast(): void {
  toast.hidden = true;
  retryButton.hidden = true;
}

function showError(cause: unknown): void {
  const hints: Record<number, string> = {
    404: 'The registration may have expired. Register the coordinates again.',
    409: 'The server is already processing this site. Wait a moment and try again.',
    422: 'These coordinates or dates lack coverage. Try another site or time window.',
    429: 'The server is processing another site. Wait a moment and try again.',
    502: 'Horizons ephemerides are unavailable. Try again later.',
    503: 'Site generation is unavailable on this server.',
    504: 'Site generation timed out. Try again.',
  };
  errorText.textContent = cause instanceof BackendError
    ? hints[cause.status] ?? `The server returned HTTP ${cause.status}. Check your inputs and try again.`
    : 'Mission data could not load. Check your connection and try again.';
  console.error('Mission data load failed', cause);
  retryButton.hidden = false;
  toast.hidden = false;
  announce('Could not load mission data. Check the error and try again.');
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
      ? 'The horizon blocks DTE, with no impact in the rendered terrain. Pulses and incidence are illustrative.'
      : diagnostic.dte === 'impact'
        ? `Rendered DTE impact at ${diagnostic.impactDistanceM?.toFixed(1)} m from the antenna. Pulses and incidence are illustrative.`
        : 'RF pulses and solar incidence are illustrative. Use a separate model for link and power budgets.',
  );
}

function updateStatus(state: TimeState): void {
  const conditions = state.conditions;
  setText(byId('hud-utc'), new Date(state.timestampMs).toISOString().slice(11, 19));
  setText(byId('hud-date'), new Date(state.timestampMs).toISOString().slice(0, 10));
  setText(byId('hud-sun'), conditions.sun_visible ? 'Visible' : 'Obscured');
  setText(byId('hud-earth'), conditions.earth_visible ? 'Direct link' : 'Link blocked');
  setText(byId('hud-sun-angle'), `Elevation ${formatSigned(state.sun.elevation_deg)}°`);
  setText(byId('hud-earth-angle'), `Elevation ${formatSigned(state.earth.elevation_deg)}°`);
  const co = conditions.co_visibility;

  setText(coValue, co ? 'Yes' : 'No');
  coValue.classList.toggle('is-ok', co);
  sunChip.set(conditions.sun_visible ? 'Sun visible' : 'Sun obscured', conditions.sun_visible ? 'sun' : 'neutral');
  earthChip.set(conditions.earth_visible ? 'Earth visible' : 'Earth obscured', conditions.earth_visible ? 'earth' : 'neutral');
  coChip.set(co ? 'Co-visibility' : 'No co-visibility', co ? 'ok' : 'neutral');

  setText(sunMetric.value, `Az ${state.sun.azimuth_deg.toFixed(1)}° · El ${formatSigned(state.sun.elevation_deg)}°`);
  setText(earthMetric.value, `Az ${state.earth.azimuth_deg.toFixed(1)}° · El ${formatSigned(state.earth.elevation_deg)}°`);
  const sample = Date.parse(state.sampleTimestampUtc);
  setText(sampleMetric.value, Number.isFinite(sample) ? shortUtc(sample) : state.sampleTimestampUtc);
  const range = timeline.range;
  setText(coverageMetric.value, `${shortUtc(range.start)} — ${shortUtc(range.end)}`);
  setText(byId('status-sample'), `${sourceLabel()} · ${Number.isFinite(sample) ? shortUtc(sample) : state.sampleTimestampUtc}`);

  setBadgeText('dte-badge', conditions.earth_visible ? 'DTE: active' : 'DTE: blocked', conditions.earth_visible ? 'ok' : 'danger');

  const telemetry = engine?.getPowerTelemetry();
  setText(byId('hud-battery'), telemetry ? `${telemetry.battery_pct.toFixed(1)}%` : '—');
  byId<HTMLProgressElement>('hud-battery-bar').value = telemetry?.battery_pct ?? 0;
  batteryBar.setValue(telemetry?.battery_pct ?? 0);
  setText(
    powerTelemetry,
    telemetry
      ? `${powerStatus[telemetry.status_label]} · ${telemetry.battery_pct.toFixed(1)}% · ${telemetry.net_watts.toFixed(0)} W net · ${telemetry.temp_celsius.toFixed(1)} °C · Solar ${telemetry.solar_watts.toFixed(0)} W`
      : 'No telemetry.',
  );
  const count = engine?.getScienceCandidateCount() ?? 0;
  setText(
    scienceStatus,
    `${count} ${count === 1 ? 'terrain candidate' : 'terrain candidates'} PSR. Depth alone cannot confirm permanent shadow or water ice.`,
  );
  updateBeamStatus();

  timeline.setSampleText(`Sample ${state.sampleTimestampUtc}`);
  timeline.setStatus(
    `${sourceLabel()} (${state.sampleTimestampUtc}): Sun ${conditions.sun_visible ? 'visible' : 'obscured'} · Earth ${conditions.earth_visible ? 'visible' : 'obscured'} · Co-visibility ${co ? 'yes' : 'no'}`,
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
    setBadgeText('live-badge', 'Loading', 'warning');
    timeline.setLiveStatus('Checking time coverage…');
  } else if (liveClock.simulated) {
    setBadgeText('live-badge', 'Simulated', 'warning');
    timeline.setLiveStatus('Live mode requires observed ephemerides.');
  } else if (!available) {
    setBadgeText('live-badge', 'Outside coverage', 'neutral');
    timeline.setLiveStatus(`No coverage for the current time. Available data: ${shortUtc(liveClock.start)} — ${shortUtc(liveClock.end)}.`);
  } else if (active) {
    setBadgeText('live-badge', 'Live', 'ok');
    timeline.setLiveStatus('Live · device clock (UTC) · Interpolated positions and hourly visibility samples.');
  } else {
    setBadgeText('live-badge', 'Manual', 'neutral');
    timeline.setLiveStatus('Manual · interpolated positions and hourly visibility samples.');
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
  announce(liveClock.followNow ? 'Live mode enabled.' : 'Live mode paused.');
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
  announce('Playback started.');
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
      announce('End of available ephemerides.');
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
  const next = enabled && !loading && !!siteData;
  if (next && !relocating) relocationDisplay = { view: viewMode, slope: slopeSwitch.isChecked };
  relocating = next;
  relocateButton.setPressed(relocating);
  relocateButton.setLabel(relocating ? 'Exit relocation' : 'Activate relocation');
  moveLander.textContent = relocating ? 'Cancel move' : 'Move lander';
  moveLander.setAttribute('aria-pressed', String(relocating));
  viewport.classList.toggle('is-relocating', relocating);
  viewport.tabIndex = relocating ? 0 : -1;
  relocateFeedback.hidden = !relocating;
  activeMissionName.hidden = relocating || !activeMission;
  story.relocationActive(relocating);
  keyboardPoint = undefined;
  pointerPosition = undefined;
  delete relocateFeedback.dataset.safe;
  if (!relocating) {
    engine?.previewLandingPoint();
    const previous = relocationDisplay;
    relocationDisplay = undefined;
    if (previous) {
      if (slopeSwitch.isChecked !== previous.slope) setSlopeOverlay(previous.slope);
      if (viewMode !== previous.view) setView(previous.view);
    }
    return;
  }
  setSlopeOverlay(true);
  if (viewMode !== 'top') setView('top');
  if (isMobileViewport()) setPanelOpen(false);
  const tip = 'Choose a green point · arrow keys and Enter';
  relocateFeedback.textContent = isMobileViewport() ? 'Tap a point on the map' : 'Select a point on the map · arrows and Enter also work';
  story.cursorReadout(isMobileViewport() ? 'Tap a green point on the map.' : tip);
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
  setSourceCopy();
  statusSubtitle.textContent = `${lastSelection} · X ${point.x.toFixed(3)} km · Z ${point.z.toFixed(3)} km · ${point.slopeDeg.toFixed(1)}°`;
  updateAt(currentTime); refreshLive();
  announce(`Lander at X ${point.x.toFixed(3)} km, Z ${point.z.toFixed(3)} km. Slope ${point.slopeDeg.toFixed(1)}°. Horizon recalculated in ${Math.round(performance.now() - start)} ms.`);
}

function hoverLanding(x: number, y: number) {
  const point = engine?.pickLandingPoint(x, y);
  engine?.previewLandingPoint(point);
  const safe = point ? point.slopeDeg < 10 : undefined;
  const label = point ? `${point.slopeDeg.toFixed(1)}° · ${safe ? 'Safe slope' : 'Unsafe slope'}` : 'Point inside the slope map';
  relocateFeedback.textContent = label;
  relocateFeedback.dataset.safe = safe === undefined ? '' : String(safe);
  story.cursorReadout(label, safe);
  return point;
}

function pickLanding(x: number, y: number) {
  const point = hoverLanding(x, y);
  if (!point) return;
  if (story.step === 2 && point.slopeDeg >= 10) { story.message(`Slope of ${point.slopeDeg.toFixed(1)}°. Try a green point under 10°.`); return; }
  try {
    applyLanding(point);
    setRelocating(false);
    if (story.step === 2) {
      setSlopeOverlay(false);
      setView('surface');
    }
    story.landing(point.slopeDeg);
    if (story.step === 2) byId('story-mount').querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    else if (mode === 'planner') moveLander.focus({ preventScroll: true });
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
    else if (mode === 'planner') moveLander.focus();
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
  announce(point ? `${point.slopeDeg.toFixed(1)} degrees. ${point.slopeDeg < 10 ? 'Safe slope.' : 'Unsafe slope.'}` : 'Outside the slope map.');
});

function openComparator() {
  if (!siteData || loading) return;
  const current = { id: '@current', label: `${lastSelection}${landing ? ' · relocated' : ' · active'}` };
  const choices = [current, ...Array.from(siteSelect.select.options)
    .filter(option => option.value && !option.disabled)
    .map(option => ({ id: option.value, label: option.textContent ?? option.value }))];
  comparator.open(choices, lastSelection === 'Site01' ? 'Site07' : 'Site01');
}

function enterStoryStep(step: 1 | 2 | 3 | 4 | 5 | 6) {
  appShell.dataset.storyStep = String(step);
  timeline.setCoVisibilityGuide(null);
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
    if (any) timeline.setCoVisibilityGuide('choose');
    story.setNoWindow(!any);
    if (!any) story.message('This point has no overlapping light and signal in the available data. Try another green point.');
  }
  if (step === 6) queueMicrotask(openComparator);
}

async function prepareStory() {
  const run = ++campaignRun;
  story.setBusy(true);
  liveClock.followNow = false;
  setRelocating(false);
  setSlopeOverlay(false);
  setView('orbital');
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
  campaignRun++;
  comparator.close();
  setRelocating(false);
  setSlopeOverlay(false);
  timeline.setCoVisibilityGuide(null);
  appShell.dataset.storyStep = '0';
  story.start();
}

function submitCoordinates(event: SubmitEvent): void {
  event.preventDefault();
  if (loading || activeMission) return;
  if (!accounts.token) { missions.open(); return; }
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

  let phase = coordinates ? 'Registering coordinates' : 'Loading site';
  const began = Date.now();
  const report = () => {
    loadProgress.textContent = `${phase} · ${Math.floor((Date.now() - began) / 1000)} s. A new site can take up to four minutes.`;
  };
  report();
  const waiting = window.setInterval(report, 1000);
  timeline.setStatus(`Loading ${selected}…`);

  try {
    if (coordinates) {
      const registered = await api.registerSite(coordinates, active.signal);
      if (disposed || active.signal.aborted) return false;
      selected = registered.site_id;
      const exists = Array.from(siteSelect.select.options).some(option => option.value === selected);
      if (!exists) siteSelect.select.add(new Option(registered.name ?? selected, selected));
      if (!plannerSiteOptions.some(site => site.id === selected)) plannerSiteOptions.push({ id: selected, label: registered.name ?? selected, coordinates: registered.coordinates });
      siteSelect.setValue(selected);
      customRanges.set(selected, customDateRange(liveClock.followNow ? Date.now() : currentTime));
    }
    if (selected.startsWith('custom_') && !customRanges.has(selected)) {
      customRanges.set(selected, customDateRange(liveClock.followNow ? Date.now() : currentTime));
    }

    phase = selected.startsWith('custom_') ? 'Preparing terrain, horizon and ephemerides' : 'Downloading site data';
    report();
    if (!engine) throw new Error('The 3D engine is unavailable.');
    const asset = await api.loadSite(selected, Number(selectedHeight) as 2 | 5, active.signal, selectedRange(selected), preferBundled);
    const { site, field } = asset;
    if (disposed || active.signal.aborted) return false;

    phase = 'Building 3D terrain';
    report();
    await engine.loadSite(site, field);
    engine.setObserverHeight(Number(selectedHeight));
    if (disposed || active.signal.aborted) return false;

    siteData = site;
    activeAsset = asset;
    appShell.classList.remove('clearing-private-site');
    landing = undefined;
    const start = Date.parse(site.ephemeris_timeline[0].timestamp_utc);
    const end = Date.parse(site.ephemeris_timeline.at(-1)!.timestamp_utc);
    liveClock.configure(start, end, false);
    currentTime = clamp(currentTime, start, end);
    timeline.configure(site.ephemeris_timeline, start, end);
    timeline.setTime(currentTime);
    lastSelection = selected;
    lastHeight = selectedHeight;
    angularChart.replaceChildren(angleChart(site));

    const heightNote =
      selectedHeight === '5' && !selected.startsWith('custom_')
        ? ' The 5 m model approximates positions using the 2 m ephemerides.'
        : '';
    setText(
      siteDetail,
      `${selected} · ${sourceLabel()} · 16-bit PNG · Patch size ${site.terrain_metadata.patch_size_km.toFixed(3)} km · Observer at ${selectedHeight} m.${heightNote}`,
    );
    setSourceCopy();
    setText(
      statusSubtitle,
      `${selected} · ${sourceLabel()} · ${site.terrain_metadata.patch_size_km.toFixed(1)} km · Observer at ${selectedHeight} m`,
    );
    heightSelect.select.options[1].textContent = selected.startsWith('custom_') ? '5 m' : '5 m (approximate)';
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
        const message = 'Canceled. The server may still finish processing. You can try loading the site again.';
        loadProgress.textContent = message;
        timeline.setStatus(message);
        announce('Loading canceled.');
      }
    }
    return false;
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

const bundledOptions = OFFLINE_SITES.map(site_id => ({ value: site_id, label: site_id }));

async function fetchCatalog(): Promise<void> {
  if (activeMission && mode === 'planner') return;
  catalogRequest?.abort();
  const active = catalogRequest = new AbortController();
  try {
    const [{ sites, offline }, saved] = await Promise.all([
      api.listSites(active.signal),
      mode === 'planner' ? api.listSavedSites(active.signal).catch(() => []) : Promise.resolve([]),
    ]);
    if (disposed || active.signal.aborted) return;
    catalogOffline = offline;
    const previous = siteSelect.value || TRAINING_SITE;
    const options = [...sites, ...saved.filter(item => !sites.some(site => site.site_id === item.site_id))].map(item => {
      const label = item.name ?? item.site_id;
      const pending = item.status === 'pending_data';
      return { value: item.site_id, label: pending ? `${label} (awaiting data)` : label, disabled: pending, coordinates: item.coordinates };
    });
    for (const option of Array.from(siteSelect.select.options)) if (mode === 'planner' && accounts.token && customRanges.has(option.value) && !options.some(r => r.value === option.value)) {
      options.push({ value: option.value, label: option.textContent ?? option.value, disabled: option.disabled,
        coordinates: plannerSiteOptions.find(site => site.id === option.value)?.coordinates });
    }
    if (mode === 'planner') plannerSiteOptions = options.filter(option => !option.disabled)
      .map(option => ({ id: option.value, label: option.label, coordinates: option.coordinates }));
    siteSelect.setOptions(options, previous);
  } catch {
    if (!active.signal.aborted) catalogOffline = true;
  }
}

function selectedRange(id: string): SiteRange | undefined {
  if (mode === 'planner' && activeMission?.site_ids.includes(id)) {
    return { start_utc: activeMission.start_utc, end_utc: activeMission.end_utc, step_hours: activeMission.step_hours ?? 1 };
  }
  return customRanges.get(id);
}

function setActiveMission(mission?: Mission) {
  activeMission = mission;
  activeMissionName.textContent = mission?.name ?? '';
  activeMissionName.title = mission?.name ?? '';
  activeMissionName.hidden = !mission;
  openMissions.title = mission ? `Active mission: ${mission.name}` : '';
}

async function activateMission(mission: Mission) {
  if (mode !== 'planner' || !accounts.token) return;
  catalogRequest?.abort();
  const previous = {
    mission: activeMission,
    options: Array.from(siteSelect.select.options, option => ({ value: option.value, label: option.text, disabled: option.disabled })),
    site: siteSelect.value,
    height: heightSelect.value,
    time: currentTime,
    followNow: liveClock.followNow,
  };
  setActiveMission(mission);
  siteSelect.setOptions(mission.site_ids.map(id => ({ value: id, label: mission.sites?.find(site => site.site_id === id)?.name ?? id })), mission.site_ids[0]);
  heightSelect.setValue(String(mission.observer_height_m ?? 2));
  liveClock.followNow = false;
  currentTime = Date.parse(mission.start_utc);
  announce(`Loading ${mission.name}.`);
  if (await loadSelected(undefined, mission.site_ids[0], false) || activeMission !== mission) return;
  setActiveMission(previous.mission);
  siteSelect.setOptions(previous.options, previous.site);
  heightSelect.setValue(previous.height);
  updateAt(previous.time);
  liveClock.followNow = previous.followNow;
  setFormDisabled(false);
  refreshLive();
  // Reload the mission scope and its range if the user retries from the toast.
  retryAction = () => activateMission(mission);
}

function leaveMission(discardSite = false) {
  setActiveMission();
  siteSelect.setOptions(bundledOptions, TRAINING_SITE);
  if (discardSite) {
    plannerSiteOptions = [];
    appShell.classList.add('clearing-private-site');
    siteData = undefined; activeAsset = undefined; landing = undefined; lastSelection = '';
    siteDetail.textContent = 'Loading a public site…';
    statusSubtitle.textContent = 'Loading a public site…';
    setStatusOpen(false); comparator.close();
  }
  if (mode === 'planner') {
    void loadSelected(undefined, TRAINING_SITE, discardSite);
    void fetchCatalog();
  }
}

async function initialize(): Promise<void> {
  if (!engine) engine = new LunarEngine(viewport);
  if (!siteSelect.value) siteSelect.setOptions(bundledOptions, TRAINING_SITE);
  void fetchCatalog();
  await loadSelected(undefined, TRAINING_SITE);
}

export function setMode(next: 'explorer' | 'planner') {
  if (mode === next) return;
  if (!engine) engine = new LunarEngine(viewport);
  if (!siteSelect.value) siteSelect.setOptions(bundledOptions, TRAINING_SITE);
  mode = next;
  appShell.dataset.mode = mode;
  byId('mission-title').textContent = next === 'explorer' ? 'Lunar Co-Visibility Explorer' : 'Mission Planner';
  modeSwitch.href = next === 'explorer' ? '#planner' : '#explorer';
  modeSwitch.textContent = next === 'explorer' ? 'Mission Planner' : 'Explorer';
  storyReset.hidden = next !== 'explorer';
  plannerTools.hidden = next !== 'planner';
  setPanelOpen(next === 'planner' && !isMobileViewport());
  setStatusOpen(false);
  setRelocating(false);
  comparator.close();
  launchDelay.close();
  if (next === 'explorer') {
    missions.close();
    if (activeMission) leaveMission();
    if (!catalogRequest) void fetchCatalog();
    restartStory();
  } else {
    story.close();
    timeline.setCoVisibilityGuide(null);
    if (!siteData && !request) void initialize();
    else if (!siteData && !loading) void initialize();
    else if (siteData && !loading) void fetchCatalog();
    refreshLive();
  }
}

export function setExplorerVisibility(visible: boolean) {
  story.setPageVisible(visible && !appShell.hidden && !document.hidden);
  if (appShell.hidden) { missions.close(); launchDelay.close(); }
}

retryButton.addEventListener('click', () => void retryAction(), { signal });
document.addEventListener('visibilitychange', () => {
  setExplorerVisibility(mode === 'explorer');
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
    catalogRequest?.abort(); comparator.close(); story.close(); missions.close(); launchDelay.close();
    storyTimelineSize.disconnect();
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
