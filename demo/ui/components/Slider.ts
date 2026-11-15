import { el } from '../dom';

export interface SliderOptions {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  minLabel?: string;
  maxLabel?: string;
  format?: (value: number) => string;
  disabled?: boolean;
  signal?: AbortSignal;
  onInput?: (value: number) => void;
}

export class Slider {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly valueOutput: HTMLOutputElement;
  private readonly format: (value: number) => string;

  constructor(options: SliderOptions) {
    this.format = options.format ?? (value => String(value));
    this.valueOutput = el('output', {
      class: 'ui-slider__value',
      for: options.id,
    });
    this.valueOutput.value = this.format(options.value);

    this.input = el('input', {
      id: options.id,
      type: 'range',
      min: options.min,
      max: options.max,
      step: options.step,
      value: options.value,
      disabled: options.disabled,
      'aria-label': options.label,
    });

    const head = el(
      'div',
      { class: 'ui-slider__head' },
      el('span', { class: 'ui-slider__label' }, options.label),
      this.valueOutput,
    );

    this.root = el('div', { class: 'ui-slider' }, head, this.input);

    if (options.minLabel || options.maxLabel) {
      this.root.append(
        el(
          'div',
          { class: 'ui-slider__scale' },
          el('span', {}, options.minLabel ?? ''),
          el('span', {}, options.maxLabel ?? ''),
        ),
      );
    }

    this.input.addEventListener(
      'input',
      () => {
        this.valueOutput.value = this.format(this.input.valueAsNumber);
        options.onInput?.(this.input.valueAsNumber);
      },
      { signal: options.signal },
    );
  }

  get value(): number {
    return this.input.valueAsNumber;
  }

  setValue(value: number, emit = false): void {
    this.input.value = String(value);
    this.valueOutput.value = this.format(value);
    if (emit) this.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
  }
}
