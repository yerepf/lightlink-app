import { coverage, HOUR, visibilitySummary, type TimeRange } from '../../src/missionMetrics';
import { safeTerrainPercent } from '../../src/relocation';
import type { SiteAsset } from '../apiClient';
import { el } from './dom';

type Choice = { id: string; label: string };
const number = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const source = { remote: 'API', bundled: 'Copia local', mock: 'Simulado', local: 'Horizonte local' };
const control = (label: string, input: HTMLElement) => el('label', { class: 'compare__field' }, label, input);

export class SiteComparator {
  private readonly heading = el('h2', { id: 'compare-title' }, 'Comparar sitios');
  private readonly closeButton = el('button', { class: 'flight-button', type: 'button' }, 'Cerrar');
  private readonly a = el('select', { id: 'compare-site-a' });
  private readonly b = el('select', { id: 'compare-site-b' });
  private readonly dates = el('input', { type: 'checkbox' });
  private readonly startA = el('input', { type: 'datetime-local', step: 3600 });
  private readonly startB = el('input', { type: 'datetime-local', step: 3600 });
  private readonly hours = el('input', { type: 'number', min: 1, max: 1464, step: 1, value: 24 });
  private readonly message = el('p', { role: 'status', class: 'compare__message' });
  private readonly results = el('div', { class: 'compare__results' });
  private readonly dialog = el('dialog', { class: 'flight-panel flight-dialog', 'aria-labelledby': 'compare-title' });
  private readonly safePercent = new WeakMap<SiteAsset['field'], number>();
  private abort?: AbortController;
  private cache = new Map<string, Promise<SiteAsset>>();
  private assets?: [SiteAsset, SiteAsset];

  constructor(mount: HTMLElement, private readonly load: (id: string, signal: AbortSignal) => Promise<SiteAsset>, private readonly compared: (recommendation: string) => void) {
    const dateFields = el('div', { class: 'compare__dates', hidden: true }, control('Inicio A (UTC)', this.startA), control('Inicio B (UTC)', this.startB), control('Duración de cada ventana (h)', this.hours));
    this.dialog.append(el('header', { class: 'flight-dialog__head' }, this.heading, this.closeButton),
      el('p', { class: 'flight-dialog__intro' }, 'Compara luz solar y línea de vista directa a la Tierra (DTE) durante ventanas de igual duración.'),
      el('div', { class: 'compare__choices' }, control('Sitio A', this.a), control('Sitio B', this.b)),
      el('label', { class: 'compare__toggle' }, this.dates, 'Elegir dos fechas UTC'), dateFields,
      this.message, this.results);
    mount.append(this.dialog);
    this.closeButton.addEventListener('click', () => this.close());
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.abort?.abort(); });
    for (const select of [this.a, this.b]) select.addEventListener('change', () => void this.refresh());
    this.dates.addEventListener('change', () => { dateFields.hidden = !this.dates.checked; this.render(); });
    for (const input of [this.startA, this.startB, this.hours]) input.addEventListener('input', () => this.render());
  }

  open(choices: Choice[], alternative: string) {
    this.a.replaceChildren(...choices.map(({ id, label }) => new Option(label, id)));
    this.b.replaceChildren(...choices.map(({ id, label }) => new Option(label, id)));
    this.b.value = choices.some(choice => choice.id === alternative) ? alternative : choices[1]?.id ?? choices[0]?.id ?? '';
    for (const input of [this.startA, this.startB]) input.value = '';
    this.dates.checked = false; this.dates.dispatchEvent(new Event('change'));
    if (!this.dialog.open) this.dialog.showModal();
    void this.refresh();
  }

  close() { this.abort?.abort(); if (this.dialog.open) this.dialog.close(); }

  private async refresh() {
    this.abort?.abort();
    const { signal } = this.abort = new AbortController();
    this.cache.clear(); this.assets = undefined; this.results.replaceChildren();
    this.message.textContent = 'Cargando datos de los dos sitios…';
    const get = (id: string) => {
      if (!this.cache.has(id)) this.cache.set(id, this.load(id, signal));
      return this.cache.get(id)!;
    };
    try {
      const assets = await Promise.all([get(this.a.value), get(this.b.value)]);
      if (signal.aborted) return;
      this.assets = assets;
      [this.startA, this.startB].forEach((input, i) => {
        const start = coverage(assets[i].site.ephemeris_timeline).start;
        input.value = new Date(start).toISOString().slice(0, 16);
      });
      this.render();
    } catch (error) {
      if (signal.aborted) return;
      this.message.textContent = error instanceof Error ? error.message : 'No se pudieron cargar los sitios.';
      const retry = el('button', { class: 'flight-button', type: 'button' }, 'Reintentar carga');
      retry.addEventListener('click', () => void this.refresh()); this.results.append(retry);
    }
  }

  private render() {
    if (!this.assets) return;
    this.results.replaceChildren();
    const frames = this.assets.map(asset => asset.site.ephemeris_timeline);
    const limits = frames.map(coverage);
    const overlap = { start: Math.max(limits[0].start, limits[1].start), end: Math.min(limits[0].end, limits[1].end) };
    const ranges: TimeRange[] = this.dates.checked ? [this.startA, this.startB].map(input => {
      const start = Date.parse(input.value + 'Z'); return { start, end: start + this.hours.valueAsNumber * HOUR };
    }) : [overlap, overlap];
    if (this.dates.checked && !this.hours.validity.valid) { this.message.textContent = 'Introduce una duración entera dentro del rango permitido.'; return; }
    if (ranges.some((range, i) => !Number.isFinite(range.end) || !(range.end > range.start) || range.start < limits[i].start || range.end > limits[i].end)) {
      this.message.textContent = this.dates.checked
        ? `Cada ventana debe quedar dentro de su cobertura: A ${utc(limits[0].start)} — ${utc(limits[0].end)}; B ${utc(limits[1].start)} — ${utc(limits[1].end)}.`
        : 'Los sitios no tienen cobertura común. Elige dos fechas UTC y una duración que quepa en ambas coberturas.';
      return;
    }
    const totals = frames.map((data, i) => visibilitySummary(data, ranges[i]).totals);
    const labels = [this.a, this.b].map(select => select.selectedOptions[0]?.text ?? 'Sitio');
    const row = (label: string, values: string[], featured = false) => el('tr', { class: featured ? 'compare__highlight' : '' },
      el('th', { scope: 'row' }, label), ...values.map(value => el('td', {}, value)));
    const percent = this.assets.map(({ field, site }) => {
      if (!this.safePercent.has(field)) this.safePercent.set(field, safeTerrainPercent(field, site.terrain_metadata));
      return this.safePercent.get(field)!;
    });
    const table = el('table', { class: 'compare__table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Indicador'), ...labels.map((label, i) => el('th', { scope: 'col' }, `${i ? 'B' : 'A'} · ${label}`, el('small', {}, source[this.assets![i].origin]))))),
      el('tbody', {}, row('Sol visible', totals.map(t => `${number.format(t.sun_visible)} h`)),
        row('Tierra visible (DTE)', totals.map(t => `${number.format(t.earth_visible)} h`)),
        row('Co-visibilidad', totals.map(t => `${number.format(t.co_visibility)} h`), true),
        row('Terreno < 10°', percent.map(p => Number.isFinite(p) ? `${number.format(p)} %` : 'Sin datos')),
        row('Ventana', ranges.map(r => `${utc(r.start)} — ${utc(r.end)}`))));
    const delta = totals[0].co_visibility - totals[1].co_visibility;
    const comparable = (this.assets[0].origin === 'mock') === (this.assets[1].origin === 'mock');
    const recommendation = !comparable ? 'Sin recomendación: una de las series es simulada.' : Math.abs(delta) < .000001
      ? 'Empate en horas de co-visibilidad.' : `Opción ${delta > 0 ? 'A' : 'B'} · ${labels[delta > 0 ? 0 : 1]} ofrece ${number.format(Math.abs(delta))} h más de co-visibilidad.`;
    this.message.textContent = '';
    this.results.append(table, el('p', { class: 'compare__recommendation', role: 'status' }, recommendation),
      el('p', { class: 'compare__fineprint' }, 'El porcentaje de pendiente corresponde a todo el parche DEM. El horizonte local no incluye relieve fuera del parche. DTE indica visibilidad geométrica.'));
    const sameSelection = this.a.value === this.b.value && ranges[0].start === ranges[1].start;
    if (comparable && !sameSelection) this.compared(recommendation);
  }
}
