import { clamp, el, setText } from '../dom';

export type ProgressVariant = 'ok' | 'warning' | 'danger';

export interface ProgressBarOptions {
  label: string;
  value?: number;
  variant?: ProgressVariant;
}

export class ProgressBar {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly valueOutput: HTMLElement;
  private readonly labelSlot: HTMLElement;

  constructor(options: ProgressBarOptions) {
    this.labelSlot = el('span', {}, options.label);
    this.valueOutput = el('span', { class: 'ui-progress__value' });
    this.fill = el('div', { class: 'ui-progress__fill' });
    const track = el('div', { class: 'ui-progress__track' }, this.fill);
    this.root = el(
      'div',
      {
        class: 'ui-progress',
        role: 'progressbar',
        'aria-label': options.label,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'data-variant': options.variant ?? 'ok',
      },
      el('div', { class: 'ui-progress__head' }, this.labelSlot, this.valueOutput),
      track,
    );
    this.setValue(options.value ?? 0, options.variant);
  }

  setValue(value: number, variant?: ProgressVariant): void {
    const safe = clamp(Number.isFinite(value) ? value : 0, 0, 100);
    this.fill.style.width = `${safe}%`;
    this.valueOutput.textContent = `${safe.toFixed(1)}%`;
    this.root.setAttribute('aria-valuenow', safe.toFixed(1));
    this.root.setAttribute('aria-valuetext', `${safe.toFixed(1)} por ciento`);
    this.root.dataset.variant = variant ?? (safe > 40 ? 'ok' : safe >= 15 ? 'warning' : 'danger');
  }

  setLabel(label: string): void {
    setText(this.labelSlot, label);
    this.root.setAttribute('aria-label', label);
  }
}
