import { BackendError, type SiteRange } from '../../src/backend';
import { coverage, HOUR, visibilitySummary, type TimeRange } from '../../src/missionMetrics';
import type { ApiClient } from '../apiClient';
import { el } from './dom';

type SiteChoice = { id: string; label: string };
type Setup = { sites: SiteChoice[]; plannedSite: string; start: number; hours: number; height: 2 | 5; mission?: string };
type Profile = Awaited<ReturnType<ApiClient['loadVisibilityProfile']>>;
type Summary = ReturnType<typeof visibilitySummary>;
type Result = { summary: Summary; source: string } | { reason: string };
const maximumHours = 62 * 24;
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const utcInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const utc = (ms: number) => utcInput(ms).replace('T', ' ') + ' UTC';
const utcHour = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const field = (label: string, input: HTMLElement) => el('label', { class: 'compare__field' }, label, input);

function siteRange({ start, end }: TimeRange): SiteRange {
  return { start_utc: utcHour(start), end_utc: utcHour(end), step_hours: 1 };
}

async function evaluate(profile: Promise<Profile>, range: TimeRange): Promise<Result> {
  try {
    const { site, source } = await profile;
    const frames = site.ephemeris_timeline;
    const limits = coverage(frames);
    if (range.start < limits.start || range.end > limits.end) {
      return { reason: `Coverage is ${utc(limits.start)} to ${utc(limits.end)}.` };
    }
    return { summary: visibilitySummary(frames, range), source };
  } catch (cause) {
    if (cause instanceof BackendError && cause.status === 422) return { reason: 'The site has no data for this window.' };
    return { reason: 'Could not load site data. Run the comparison again or choose another site.' };
  }
}

export class LaunchDelay {
  private readonly dialog = el('dialog', { class: 'flight-panel flight-dialog launch-delay', 'aria-labelledby': 'launch-delay-title' });
  private readonly context = el('p', { class: 'launch-delay__mission', hidden: true });
  private readonly planned = el('select', { required: true });
  private readonly alternate = el('select', { required: true });
  private readonly start = el('input', { type: 'datetime-local', step: 3600, required: true });
  private readonly delay = el('input', { type: 'number', min: 1, step: 1, value: 24, required: true });
  private readonly duration = el('input', { type: 'number', min: 1, max: maximumHours, step: 1, required: true });
  private readonly submit = el('button', { class: 'flight-button flight-button--primary', type: 'submit' }, 'Compare delay');
  private readonly status = el('p', { class: 'compare__message', role: 'status' });
  private readonly results = el('div', { class: 'launch-delay__results' });
  private request?: AbortController;
  private height: 2 | 5 = 2;

  constructor(mount: HTMLElement, private readonly api: ApiClient) {
    const close = el('button', { class: 'flight-button', type: 'button' }, 'Close');
    const form = el('form', { class: 'launch-delay__form' },
      el('div', { class: 'compare__choices' }, field('Planned site', this.planned), field('Alternate site', this.alternate)),
      el('div', { class: 'compare__dates launch-delay__dates' }, field('Planned window start (UTC)', this.start),
        field('Launch delay (h)', this.delay), field('Window duration (h)', this.duration)),
      el('div', { class: 'planner-dialog__actions' }, this.submit));
    this.dialog.append(el('header', { class: 'flight-dialog__head' }, el('h2', { id: 'launch-delay-title' }, 'Launch delay'), close),
      this.context, el('p', { class: 'flight-dialog__intro' },
        'Assume the launch delay shifts the lunar observation window by the same amount. Compare staying at the planned site with switching sites.'),
      form, this.status, this.results);
    mount.append(this.dialog);
    close.addEventListener('click', () => this.close());
    this.dialog.addEventListener('close', () => { if (!this.dialog.open) this.request?.abort(); });
    this.planned.addEventListener('change', () => { this.updateAlternates(); this.resetResults(); });
    form.addEventListener('input', () => { this.request?.abort(); this.resetResults(); });
    form.addEventListener('submit', event => { event.preventDefault(); void this.compare(); });
  }

  open(setup: Setup) {
    this.request?.abort();
    this.height = setup.height;
    this.context.textContent = setup.mission ? `Mission · ${setup.mission}` : '';
    this.context.hidden = !setup.mission;
    for (const select of [this.planned, this.alternate]) {
      select.replaceChildren(...setup.sites.map(site => new Option(site.label, site.id)));
    }
    if (setup.sites.some(site => site.id === setup.plannedSite)) this.planned.value = setup.plannedSite;
    this.updateAlternates();
    this.start.value = utcInput(setup.start);
    this.delay.value = '24';
    this.duration.value = String(Math.min(maximumHours, setup.hours));
    this.resetResults();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close() { this.request?.abort(); if (this.dialog.open) this.dialog.close(); }

  private updateAlternates() {
    const alternatives = Array.from(this.alternate.options);
    for (const option of alternatives) option.disabled = option.value === this.planned.value;
    if (this.alternate.value === this.planned.value) {
      this.alternate.value = alternatives.find(option => !option.disabled)?.value ?? '';
    }
  }

  private resetResults() {
    this.results.replaceChildren();
    this.results.removeAttribute('aria-busy');
    this.submit.disabled = !this.alternate.value;
    this.status.textContent = this.submit.disabled ? 'At least two available sites are needed for a comparison.' : '';
  }

  private async compare() {
    const planned = this.planned.value, alternate = this.alternate.value;
    const start = Date.parse(this.start.value + 'Z');
    const delay = this.delay.valueAsNumber;
    const duration = this.duration.valueAsNumber * HOUR;
    const delayedStart = start + delay * HOUR;
    const original = { start, end: start + duration };
    const delayed = { start: delayedStart, end: delayedStart + duration };
    const formattedYear = new Date(delayed.end).getUTCFullYear();
    if (!planned || !alternate || planned === alternate || start % HOUR !== 0 || !Number.isInteger(delay) ||
        delay < 1 || !Number.isFinite(formattedYear) || formattedYear > 9999 || duration < HOUR || duration > maximumHours * HOUR) {
      this.status.textContent = 'Choose distinct sites, a UTC start on the hour, and valid whole-hour durations.';
      return;
    }
    this.request?.abort();
    const { signal } = this.request = new AbortController();
    this.results.replaceChildren();
    this.results.setAttribute('aria-busy', 'true');
    this.submit.disabled = true;
    this.status.textContent = 'Checking visibility for the planned and delayed windows…';
    const load = (id: string, range: TimeRange) => this.api.loadVisibilityProfile(id, this.height, signal,
      id.startsWith('custom_') ? siteRange(range) : undefined);
    const privateSite = planned.startsWith('custom_');
    const plannedProfile = load(planned, original);
    const baseline = evaluate(plannedProfile, original);
    const staying = !privateSite ? evaluate(plannedProfile, delayed) : baseline.then(() => {
      signal.throwIfAborted();
      return evaluate(load(planned, delayed), delayed);
    });
    const switching = evaluate(load(alternate, delayed), delayed);
    const results = await Promise.all([baseline, staying, switching]).catch(() => undefined);
    if (signal.aborted || !results) return;
    this.submit.disabled = false;
    this.results.removeAttribute('aria-busy');
    const available = results.filter(result => 'summary' in result).length;
    this.status.textContent = available === results.length ? 'Comparison ready.'
      : available > 0 ? 'Comparison ready. Some options have unavailable data.' : 'No site data is available for these windows.';
    this.render(original, delayed, delay, results);
  }

  private render(original: TimeRange, delayed: TimeRange, delay: number, results: Result[]) {
    const planned = this.planned.selectedOptions[0].text, alternate = this.alternate.selectedOptions[0].text;
    const measure = (label: string, value: (summary: Summary) => number, highlight = false) =>
      el('tr', { class: highlight ? 'compare__highlight' : '' }, el('th', { scope: 'row' }, label),
        ...results.map(result => el('td', {}, 'summary' in result ? `${number.format(value(result.summary))} h` : '—')));
    const labels = ['On schedule', 'Delayed · stay', 'Delayed · switch'];
    const table = el('table', { class: 'compare__table launch-delay__table', 'aria-label': 'Launch delay comparison' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Visibility'),
        ...labels.map((label, i) => el('th', { scope: 'col' }, label, el('small', {}, i < 2 ? planned : alternate),
          'source' in results[i] ? el('small', {}, results[i].source) : null)))),
      el('tbody', {}, measure('Sun visible', summary => summary.totals.sun_visible),
        measure('Earth visible (DTE)', summary => summary.totals.earth_visible),
        measure('Co-visibility', summary => summary.totals.co_visibility, true),
        measure('Longest co-visibility window', summary => summary.windows.reduce((max, window) =>
          window.condition === 'co_visibility' ? Math.max(max, window.hours) : max, 0))));
    const windowLabel = (label: string, range: TimeRange) => el('div', {}, el('dt', {}, label),
      el('dd', {}, utc(range.start), ' – ', utc(range.end)));
    this.results.replaceChildren(
      el('dl', { class: 'launch-delay__windows' }, windowLabel('Planned window', original), windowLabel(`Delayed window (+${number.format(delay)} h)`, delayed)),
      table);
    const [baseline, staying, switching] = results;
    if ('summary' in staying && 'summary' in switching) {
      const difference = switching.summary.totals.co_visibility - staying.summary.totals.co_visibility;
      const winner = difference > 0 ? alternate : planned;
      this.results.append(el('p', { class: 'compare__recommendation' }, Math.abs(difference) < 1e-6
        ? 'Both sites have the same co-visibility after the delay.'
        : `${winner} has ${number.format(Math.abs(difference))} more hours of co-visibility after the delay.`));
    }
    if ('summary' in baseline && 'summary' in staying) {
      const change = staying.summary.totals.co_visibility - baseline.summary.totals.co_visibility;
      this.results.append(el('p', { class: 'compare__fineprint' }, Math.abs(change) < 1e-6
        ? `${planned} has the same co-visibility on schedule and after the delay.`
        : `${planned} ${change > 0 ? 'gains' : 'loses'} ${number.format(Math.abs(change))} hours of co-visibility after the delay.`));
    }
    for (const [i, result] of results.entries()) {
      if ('reason' in result) this.results.append(el('p', { class: 'compare__fineprint' }, `${labels[i]} · ${i < 2 ? planned : alternate} · ${result.reason}`));
    }
    this.results.append(el('p', { class: 'compare__fineprint' }, 'DTE measures geometric line of sight. Co-visibility requires both sunlight and DTE.'));
  }
}
