import { BackendClient, LunarEngine, decodeHeightmap16, createMockSite } from '../src/index';
import { LiveClock } from '../src/LiveClock';
import { BackendError, customDateRange, validateCoordinates, type NewSite } from '../src/backend';

const time = document.querySelector<HTMLInputElement>('#time')!;
time.step = String(1 / 3600); // One second, expressed in timeline hours.
const timestamp = document.querySelector<HTMLOutputElement>('#timestamp')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const error = document.querySelector<HTMLParagraphElement>('#error')!;
const sites = document.querySelector<HTMLSelectElement>('#site')!;
const height = document.querySelector<HTMLSelectElement>('#height')!;
const detail = document.querySelector<HTMLParagraphElement>('#detail')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
const api = new BackendClient();
let engine: LunarEngine | undefined;
let request: AbortController | undefined;
let start = 0;
let currentTime = Date.now();
const liveClock = new LiveClock();
const liveButton = document.querySelector<HTMLButtonElement>('#live')!;
const liveStatus = document.querySelector<HTMLElement>('#live-status')!;
let loading = true;
let lastSelection = '';
let lastHeight = '2';
let disposed = false;
const coordinateForm = document.querySelector<HTMLFormElement>('#coordinate-form')!;
const coordinateFields = document.querySelector<HTMLFieldSetElement>('#coordinate-fields')!;
const progress = document.querySelector<HTMLElement>('#load-progress')!;
const cancelLoad = document.querySelector<HTMLButtonElement>('#cancel-load')!;
const customRanges = new Map<string, ReturnType<typeof customDateRange>>();
let retryAction: () => Promise<void> = initialize;

function update(at = start + Number(time.value) * 3600000) {
  if (!engine) return;
  const state = engine.setTime(at);
  currentTime = state.timestampMs;
  updatePowerHUD();
  timestamp.value = new Date(currentTime).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  updateVisualDiagnostic();
  const c = state.conditions;
  const dte = document.querySelector<HTMLOutputElement>('#dte')!;
  dte.value = c.earth_visible ? 'DTE: enlace activo' : 'DTE: enlace bloqueado';
  dte.style.color = c.earth_visible ? '#65ed91' : '#ff5d65';
  const source = lastSelection === 'MOCK' ? 'SIMULADO' : 'Backend';
  status.textContent = `${source} (${state.sampleTimestampUtc}): Sol ${c.sun_visible ? 'visible' : 'oculto'} · Tierra ${c.earth_visible ? 'visible' : 'oculta'} · Co-visibilidad ${c.co_visibility ? 'sí' : 'no'}`;
}

function refreshLive() {
  const now = Date.now();
  const available = liveClock.available(now);
  const active = !loading && liveClock.sample(now) !== null;
  liveButton.disabled = loading || !available;
  liveButton.setAttribute('aria-pressed', String(active));
  liveButton.textContent = active ? 'Pausar en vivo' : 'En vivo';
  const coverage = Number.isFinite(liveClock.start)
    ? `${new Date(liveClock.start).toISOString()} — ${new Date(liveClock.end).toISOString()}` : '';
  liveStatus.textContent = loading ? 'Consultando cobertura temporal…'
    : liveClock.simulated ? 'Simulación: el modo en vivo requiere efemérides reales.'
    : !available ? `Sin cobertura para la hora actual. Datos disponibles: ${coverage}.`
    : `${active ? 'En vivo · reloj del dispositivo (UTC)' : 'Exploración manual'} · Posiciones interpoladas; visibilidad de la muestra horaria del backend.`;
  if (active) {
    time.value = String((now - start) / 3600000);
    update(now);
  }
}
function manualTime() { liveClock.followNow = false; update(); refreshLive(); }
function toggleLive() { liveClock.followNow = !liveClock.followNow; refreshLive(); }
function resumeClock() { if (!document.hidden) refreshLive(); }

function showError(cause: unknown) {
  error.hidden = false; retry.hidden = false;
  const hints: Record<number, string> = {
    404: 'El registro puede haber expirado. Vuelve a registrar las coordenadas.',
    409: 'El servidor ya está procesando este punto. Espera antes de reintentar.',
    422: 'No hay cobertura suficiente para estas coordenadas o fechas. Prueba otro punto dentro de los DEM disponibles.',
    429: 'El servidor está procesando otro sitio. Espera y reintenta.',
    502: 'No se pudieron obtener las efemérides de Horizons. Reintenta más tarde.',
    503: 'El servidor necesita Redis, los DEM y el entorno Python para generar sitios nuevos.',
    504: 'La generación superó el tiempo máximo del servidor. Puedes reintentar.',
  };
  error.textContent = `${cause instanceof Error ? cause.message : String(cause)}. ${cause instanceof BackendError ? hints[cause.status] ?? 'Revisa los datos e intenta de nuevo.' : 'Comprueba la conexión e intenta de nuevo.'}`;
}

async function loadSelected(coordinates?: NewSite, selectedId = sites.value) {
  request?.abort(); request = new AbortController();
  const active = request;
  let selected = selectedId;
  const selectedHeight = height.value;
  retryAction = () => loadSelected(coordinates, selected);
  loading = true; refreshLive();
  time.disabled = true; sites.disabled = true; height.disabled = true;
  coordinateFields.disabled = true;
  progress.hidden = false; cancelLoad.hidden = false;
  let phase = coordinates ? 'Registrando coordenadas' : 'Cargando sitio';
  const began = Date.now();
  const report = () => { progress.textContent = `${phase} · ${Math.floor((Date.now() - began) / 1000)} s. La generación nueva puede tardar hasta 4 minutos.`; };
  report();
  const waiting = window.setInterval(report, 1000);
  error.hidden = true; retry.hidden = true; status.textContent = `Cargando ${selected}…`;
  try {
    if (coordinates) {
      const registered = await api.registerSite(coordinates, active.signal);
      if (disposed || active.signal.aborted) return;
      selected = registered.site_id;
      let option = Array.from(sites.options).find(option => option.value === selected);
      if (!option) { option = new Option(registered.name ?? selected, selected); sites.add(option); }
      option.disabled = false; sites.value = selected;
      customRanges.set(selected, customDateRange(liveClock.followNow ? Date.now() : currentTime));
    }
    if (selected.startsWith('custom_') && !customRanges.has(selected)) customRanges.set(selected, customDateRange(liveClock.followNow ? Date.now() : currentTime));
    phase = selected.startsWith('custom_') ? 'Generando o recuperando terreno, horizonte y efemérides' : 'Descargando datos del sitio'; report();
    const mock = selected === 'MOCK' ? createMockSite() : undefined;
    const site = mock?.site ?? await api.loadSite(selected, Number(selectedHeight) as 2 | 5, active.signal, customRanges.get(selected));
    phase = 'Descargando heightmap de 16 bits'; report();
    const field = mock?.field ?? await decodeHeightmap16(site.heightmap_url, active.signal);
    if (disposed || active.signal.aborted) return;
    phase = 'Construyendo terreno 3D'; report();
    await engine!.loadSite(site, field);
    engine!.setObserverHeight(Number(selectedHeight));
    if (disposed || active.signal.aborted) return;
    start = Date.parse(site.ephemeris_timeline[0].timestamp_utc);
    const end = Date.parse(site.ephemeris_timeline.at(-1)!.timestamp_utc);
    liveClock.configure(start, end, !!mock);
    time.max = String((end - start) / 3600000);
    time.value = String((Math.min(end, Math.max(start, currentTime)) - start) / 3600000);
    time.disabled = false; lastSelection = selected; lastHeight = selectedHeight;
    detail.textContent = mock ? 'SIMULADO: parche de 20 x 20 km. Relieve, horizonte y estados ficticios para probar sin API.' : `${sites.selectedOptions[0]?.textContent ?? selected} · PNG 16 bits · ${site.terrain_metadata.patch_size_km.toFixed(3)} km entre centros de píxeles · Observador a ${selectedHeight} m. ${selectedHeight === '5' && !selected.startsWith('custom_') ? 'A 5 m, el backend reutiliza las efemérides de 2 m como aproximación.' : ''}`;
    document.querySelector<HTMLElement>('#data-source')!.textContent = mock
      ? 'Modo simulado: relieve, horizonte y efemerides ficticios para desarrollo sin API.'
      : 'Terreno LOLA y efemerides JPL Horizons del conjunto entregado por el equipo. Visualizacion geometrica; no certificada para planificacion de vuelo.';
    update();
  } catch (cause) {
    if (!disposed && request === active) {
      if (lastSelection) { sites.value = lastSelection; height.value = lastHeight; time.disabled = false; update(); }
      else status.textContent = 'No se pudo cargar el sitio.';
      if (!active.signal.aborted) showError(cause);
      else { progress.textContent = 'Espera cancelada. El servidor podría continuar el cálculo; puedes volver a cargar el sitio.'; }
    }
  } finally {
    clearInterval(waiting);
    if (!disposed && request === active) {
      if (active.signal.aborted && lastSelection) { sites.value = lastSelection; height.value = lastHeight; time.disabled = false; }
      sites.disabled = false; height.disabled = false; coordinateFields.disabled = false;
      height.options[1].textContent = lastSelection.startsWith('custom_') ? '5 m' : '5 m (aproximación)';
      cancelLoad.hidden = true; progress.hidden = !active.signal.aborted;
      loading = false; refreshLive();
    }
  }
}

async function initialize() {
  retry.hidden = true; error.hidden = true;
  try {
    if (!engine) engine = new LunarEngine(document.querySelector<HTMLElement>('#viewport')!, { decodeHeightmap: decodeHeightmap16 });
    if (!engine.getState()) {
      sites.replaceChildren(new Option('Demo sin API (simulado)', 'MOCK')); sites.value = 'MOCK';
      await loadSelected();
    }
    request?.abort(); request = new AbortController();
    const catalog = await api.listSites(request.signal);
    if (disposed) return;
    sites.replaceChildren(new Option('Demo sin API (simulado)', 'MOCK'));
    for (const item of catalog) {
      const label = item.name ?? item.site_id;
      const option = new Option(item.status === 'pending_data' ? `${label} (por generar)` : label, item.site_id);
      sites.add(option);
    }
    const available = catalog.find(s => s.status !== 'pending_data');
    if (!available) { sites.value = 'MOCK'; return; }
    sites.value = catalog.find(s => s.site_id === 'Site04' && s.status !== 'pending_data')?.site_id ?? available.site_id;
    await loadSelected();
  } catch (cause) { if (!disposed) { retryAction = initialize; status.textContent = engine?.getState() ? 'Demo simulada disponible. No se pudo conectar con los datos reales.' : 'No se pudo conectar con los datos.'; showError(cause); } }
}

time.addEventListener('input', manualTime);
liveButton.addEventListener('click', toggleLive);
document.addEventListener('visibilitychange', resumeClock);
const liveTimer = window.setInterval(() => { if (!document.hidden) refreshLive(); }, 1000);
function selectSite() { void loadSelected(); }
function retryLoad() { void retryAction(); }
function cancelWaiting() { request?.abort(); }
function submitCoordinates(event: SubmitEvent) {
  event.preventDefault();
  if (loading || !coordinateForm.reportValidity()) return;
  try {
    const input = validateCoordinates({
      name: document.querySelector<HTMLInputElement>('#coordinate-name')!.value,
      latitude: document.querySelector<HTMLInputElement>('#coordinate-lat')!.valueAsNumber,
      longitude: document.querySelector<HTMLInputElement>('#coordinate-lon')!.valueAsNumber,
    });
    void loadSelected(input);
  } catch (cause) { showError(cause); }
}
sites.addEventListener('change', selectSite);
height.addEventListener('change', selectSite);
retry.addEventListener('click', retryLoad);
cancelLoad.addEventListener('click', cancelWaiting);
coordinateForm.addEventListener('submit', submitCoordinates);
void initialize();

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true; request?.abort();
  clearInterval(liveTimer); liveButton.removeEventListener('click', toggleLive);
  document.removeEventListener('visibilitychange', resumeClock);
  time.removeEventListener('input', manualTime); sites.removeEventListener('change', selectSite);
  height.removeEventListener('change', selectSite); retry.removeEventListener('click', retryLoad);
  cancelLoad.removeEventListener('click', cancelWaiting); coordinateForm.removeEventListener('submit', submitCoordinates);
  engine?.dispose();
});

const view = document.querySelector<HTMLSelectElement>('#view')!;
const exaggeration = document.querySelector<HTMLInputElement>('#exaggeration')!;
const guides = document.querySelector<HTMLInputElement>('#guides')!;
const uiEvents = new AbortController();
document.querySelector<HTMLInputElement>('#slope-hazard')!.addEventListener('change', event => {
  const enabled = (event.target as HTMLInputElement).checked;
  engine?.setSlopeHazardEnabled(enabled);
  document.querySelector<HTMLElement>('#slope-legend')!.hidden = !enabled;
  document.querySelector<HTMLElement>('#map-legend')!.hidden = view.value !== 'top' || enabled;
}, { signal: uiEvents.signal });
document.querySelector<HTMLInputElement>('#sky-paths')!.addEventListener('change', event => {
  const enabled = (event.target as HTMLInputElement).checked;
  engine?.setSkyPathsEnabled(enabled);
  document.querySelector<HTMLElement>('#paths-legend')!.hidden = !enabled;
}, { signal: uiEvents.signal });
function updatePowerHUD() {
  const telemetry = engine?.getPowerTelemetry(); if (!telemetry) return;
  const bar = document.querySelector<HTMLProgressElement>('#battery-bar')!;
  bar.value = telemetry.battery_pct;
  bar.style.accentColor = telemetry.battery_pct > 40 ? '#22c55e' : telemetry.battery_pct >= 15 ? '#eab308' : '#ef4444';
  document.querySelector<HTMLOutputElement>('#battery-value')!.value = `${telemetry.battery_pct.toFixed(1)}%`;
  document.querySelector<HTMLOutputElement>('#power-telemetry')!.value = `${telemetry.status_label} · ${telemetry.battery_pct.toFixed(1)}% · ${telemetry.net_watts.toFixed(0)} W netos · ${telemetry.temp_celsius.toFixed(1)} °C · Solar ${telemetry.solar_watts.toFixed(0)} W`;
  const count = engine!.getScienceCandidateCount();
  document.querySelector<HTMLElement>('#science-status')!.textContent = `${count} ${count === 1 ? 'candidato topográfico' : 'candidatos topográficos'} PSR. La profundidad no confirma sombra permanente ni hielo de agua.`;
}
const cinematicPause = document.querySelector<HTMLButtonElement>('#cinematic-pause')!;
let cinematicPaused = false;
view.addEventListener('change', () => {
  engine?.setViewMode(view.value as 'surface' | 'orbital' | 'cinematic' | 'top' | 'globe' | 'lander');
  cinematicPause.hidden = view.value !== 'cinematic';
  document.querySelector<HTMLElement>('#map-legend')!.hidden = view.value !== 'top' || document.querySelector<HTMLInputElement>('#slope-hazard')!.checked;
}, { signal: uiEvents.signal });
cinematicPause.addEventListener('click', () => {
  cinematicPaused = !cinematicPaused;
  engine?.setCinematicPaused(cinematicPaused);
  cinematicPause.textContent = cinematicPaused ? 'Reanudar vuelo' : 'Pausar vuelo';
  cinematicPause.setAttribute('aria-pressed', String(cinematicPaused));
}, { signal: uiEvents.signal });
exaggeration.addEventListener('input', () => {
  document.querySelector<HTMLOutputElement>('#exaggeration-value')!.value = `${exaggeration.value}×`;
  engine?.setTerrainExaggeration(Number(exaggeration.value));
  updateVisualDiagnostic();
}, { signal: uiEvents.signal });
guides.addEventListener('change', () => engine?.setGuidesVisible(guides.checked), { signal: uiEvents.signal });
if (import.meta.hot) import.meta.hot.dispose(() => uiEvents.abort());

document.querySelector<HTMLInputElement>('#effects')!.addEventListener('change', event => engine?.setVisualEffectsEnabled((event.target as HTMLInputElement).checked), {signal:uiEvents.signal});
function updateVisualDiagnostic() {
  if (!engine) return;
  const diagnostic=engine.visualDiagnostics;
  document.querySelector<HTMLElement>('#beam-status')!.textContent = diagnostic.dte==='outside_visual_terrain'
    ? 'DTE bloqueado por el backend; sin impacto en el terreno visual. Pulsos e incidencia ilustrativos.'
    : diagnostic.dte==='impact' ? `Impacto visual DTE a ${diagnostic.impactDistanceM?.toFixed(1)} m de la antena. Pulsos e incidencia ilustrativos.`
    : 'Pulsos RF e incidencia solar ilustrativos; no representan un presupuesto de enlace o potencia.';
}
const performanceTimer = window.setInterval(() => {
  if (!engine) return;
  updatePowerHUD();
  updateVisualDiagnostic();
  document.querySelector<HTMLOutputElement>('#performance')!.value = `${engine.stats.fps.toFixed(0)} FPS | ${engine.stats.frameMs.toFixed(1)} ms | ${engine.stats.drawCalls} draws`;
}, 1000);
if (import.meta.hot) import.meta.hot.dispose(() => clearInterval(performanceTimer));
