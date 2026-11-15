import { el } from '../dom';

export interface InputFieldOptions {
  id: string;
  label: string;
  type?: 'text' | 'number';
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number | string;
  inputmode?: 'text' | 'decimal' | 'numeric';
  autocomplete?: string;
  maxlength?: number;
  help?: string;
  signal?: AbortSignal;
  validate?: (value: string, field: InputField) => string | undefined;
}

export class InputField {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly hint?: HTMLElement;
  private readonly errorSlot: HTMLElement;
  private readonly validate?: (value: string, field: InputField) => string | undefined;
  private errored = false;

  constructor(options: InputFieldOptions) {
    this.validate = options.validate;
    this.input = el('input', {
      class: 'ui-input',
      id: options.id,
      type: options.type ?? 'text',
      placeholder: options.placeholder,
      required: options.required,
      min: options.min,
      max: options.max,
      step: options.step,
      inputmode: options.inputmode,
      autocomplete: options.autocomplete,
      maxlength: options.maxlength,
      'aria-describedby': options.help ? `${options.id}-hint` : undefined,
    });

    const label = el('label', { class: 'ui-field__label', for: options.id }, options.label);
    this.hint = options.help ? el('span', { class: 'ui-field__hint', id: `${options.id}-hint` }, options.help) : undefined;
    this.errorSlot = el('span', { class: 'ui-field__error', id: `${options.id}-error`, hidden: true });
    this.root = el('div', { class: 'ui-field' }, label, this.input, this.hint, this.errorSlot);

    this.input.addEventListener('blur', () => this.validateNow(), { signal: options.signal });
    this.input.addEventListener(
      'input',
      () => {
        if (this.errored) this.validateNow();
      },
      { signal: options.signal },
    );
  }

  get value(): string {
    return this.input.value;
  }

  get valueAsNumber(): number {
    return this.input.valueAsNumber;
  }

  setValue(value: string | number): void {
    this.input.value = String(value);
  }

  setDisabled(disabled: boolean): void {
    this.input.disabled = disabled;
  }

  focus(): void {
    this.input.focus();
  }

  setError(message: string | undefined): void {
    this.errored = !!message;
    this.root.classList.toggle('is-invalid', !!message);
    this.input.setAttribute('aria-invalid', message ? 'true' : 'false');
    this.errorSlot.textContent = message ?? '';
    this.errorSlot.hidden = !message;
    if (message) {
      this.input.setAttribute('aria-describedby', `${this.input.id}-error`);
    } else if (this.hint) {
      this.input.setAttribute('aria-describedby', `${this.input.id}-hint`);
    } else {
      this.input.removeAttribute('aria-describedby');
    }
  }

  validateNow(): boolean {
    const message = this.validate?.(this.input.value, this);
    this.setError(message);
    return !message;
  }
}
