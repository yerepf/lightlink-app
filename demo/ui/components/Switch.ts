import { el } from '../dom';

export interface SwitchOptions {
  id: string;
  label: string;
  description?: string;
  checked?: boolean;
  disabled?: boolean;
  signal?: AbortSignal;
  onChange?: (checked: boolean) => void;
}

export class Switch {
  readonly root: HTMLButtonElement;
  private checked: boolean;
  private disabled: boolean;

  constructor(options: SwitchOptions) {
    this.checked = !!options.checked;
    this.disabled = !!options.disabled;
    const thumb = el('span', { class: 'ui-switch__thumb', 'aria-hidden': 'true' });
    const track = el('span', { class: 'ui-switch__track', 'aria-hidden': 'true' }, thumb);
    const copy = el(
      'span',
      { class: 'ui-switch__copy' },
      el('span', { class: 'ui-switch__label' }, options.label),
      options.description ? el('span', { class: 'ui-switch__description' }, options.description) : null,
    );
    this.root = el(
      'button',
      {
        class: 'ui-switch',
        type: 'button',
        id: options.id,
        role: 'switch',
        'aria-checked': String(this.checked),
        disabled: this.disabled,
      },
      copy,
      track,
    );
    this.root.addEventListener(
      'click',
      () => {
        if (this.disabled) return;
        this.setChecked(!this.checked);
        options.onChange?.(this.checked);
      },
      { signal: options.signal },
    );
  }

  get isChecked(): boolean {
    return this.checked;
  }

  setChecked(checked: boolean): void {
    this.checked = checked;
    this.root.setAttribute('aria-checked', String(checked));
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    this.root.disabled = disabled;
  }
}
