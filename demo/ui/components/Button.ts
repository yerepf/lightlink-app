import { el } from '../dom';
import { icon } from '../icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  iconName?: string;
  disabled?: boolean;
  pressed?: boolean;
  block?: boolean;
  ariaLabel?: string;
  className?: string;
  signal?: AbortSignal;
  onClick?: (event: MouseEvent) => void;
}

export class Button {
  readonly root: HTMLButtonElement;
  private readonly iconSlot: HTMLElement;
  private readonly labelSlot: HTMLElement;
  private readonly iconName?: string;
  private loading = false;

  constructor(options: ButtonOptions) {
    this.iconName = options.iconName;
    this.iconSlot = el('span', { class: 'ui-btn__icon', 'aria-hidden': 'true' });
    if (options.iconName) this.iconSlot.innerHTML = icon(options.iconName);
    this.labelSlot = el('span', { class: 'ui-btn__label' }, options.label);

    const classes = ['ui-btn', `ui-btn--${options.variant ?? 'secondary'}`];
    if (options.size === 'sm') classes.push('ui-btn--sm');
    if (options.block) classes.push('ui-btn--block');
    if (options.className) classes.push(options.className);

    this.root = el(
      'button',
      {
        class: classes.join(' '),
        type: options.type ?? 'button',
        disabled: options.disabled,
        'aria-label': options.ariaLabel,
        'aria-pressed': options.pressed === undefined ? undefined : String(options.pressed),
      },
      this.iconSlot,
      this.labelSlot,
    );

    this.root.addEventListener('click', event => options.onClick?.(event), { signal: options.signal });
  }

  setLabel(label: string): void {
    this.labelSlot.textContent = label;
  }

  setLoading(loading: boolean): void {
    if (this.loading === loading) return;
    this.loading = loading;
    this.root.classList.toggle('is-loading', loading);
    if (loading) {
      this.root.disabled = true;
      this.iconSlot.innerHTML = '<span class="ui-spinner" aria-hidden="true"></span>';
    } else {
      this.root.disabled = false;
      this.iconSlot.innerHTML = this.iconName ? icon(this.iconName) : '';
    }
  }

  setDisabled(disabled: boolean): void {
    if (this.loading) return;
    this.root.disabled = disabled;
  }

  setPressed(pressed: boolean): void {
    this.root.setAttribute('aria-pressed', String(pressed));
  }
}
