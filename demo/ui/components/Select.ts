import { el } from '../dom';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptions {
  id: string;
  label: string;
  options?: SelectOption[];
  value?: string;
  disabled?: boolean;
  signal?: AbortSignal;
  onChange?: (value: string) => void;
}

export class Select {
  readonly root: HTMLElement;
  readonly select: HTMLSelectElement;
  private readonly label: HTMLLabelElement;

  constructor(options: SelectOptions) {
    this.label = el('label', { class: 'ui-field__label', for: options.id }, options.label);
    this.select = el('select', {
      class: 'ui-select',
      id: options.id,
      disabled: options.disabled,
    });
    this.root = el('div', { class: 'ui-field' }, this.label, this.select);
    if (options.options) this.setOptions(options.options, options.value);
    this.select.addEventListener(
      'change',
      () => options.onChange?.(this.select.value),
      { signal: options.signal },
    );
  }

  get value(): string {
    return this.select.value;
  }

  setOptions(options: SelectOption[], value?: string): void {
    const next = options.map(option => {
      const node = new Option(option.label, option.value);
      node.disabled = !!option.disabled;
      return node;
    });
    this.select.replaceChildren(...next);
    if (value !== undefined) this.select.value = value;
    if (!this.select.value && next.length) this.select.selectedIndex = 0;
  }

  setValue(value: string): void {
    this.select.value = value;
  }

  setDisabled(disabled: boolean): void {
    this.select.disabled = disabled;
  }

  setLabel(text: string): void {
    this.label.textContent = text;
  }
}
