import { el } from '../dom';
import { icon } from '../icons';

export interface SegmentItem {
  value: string;
  label: string;
  iconName?: string;
  description?: string;
}

export interface SegmentedControlOptions {
  label: string;
  items: SegmentItem[];
  value?: string;
  disabled?: boolean;
  signal?: AbortSignal;
  onChange?: (value: string) => void;
}

export class SegmentedControl {
  readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private value: string;
  private disabled: boolean;
  private readonly onChange?: (value: string) => void;

  constructor(options: SegmentedControlOptions) {
    this.value = options.value ?? options.items[0]?.value ?? '';
    this.disabled = !!options.disabled;
    this.onChange = options.onChange;

    this.root = el('div', {
      class: 'ui-segmented',
      role: 'radiogroup',
      'aria-label': options.label,
    });

    for (const item of options.items) {
      const iconSlot = el('span', { class: 'ui-segmented__icon', 'aria-hidden': 'true' });
      iconSlot.innerHTML = icon(item.iconName ?? 'view');
      const button = el(
        'button',
        {
          class: 'ui-segmented__item',
          type: 'button',
          role: 'radio',
          'data-value': item.value,
          'aria-checked': String(item.value === this.value),
          'aria-label': item.description ? `${item.label}. ${item.description}` : item.label,
          title: item.description,
          disabled: this.disabled,
        },
        iconSlot,
        el('span', { class: 'ui-segmented__label' }, item.label),
      );
      button.addEventListener(
        'click',
        () => {
          if (this.disabled) return;
          this.select(item.value, true);
        },
        { signal: options.signal },
      );
      this.buttons.push(button);
      this.root.append(button);
    }

    this.root.addEventListener(
      'keydown',
      event => this.onKeyDown(event as KeyboardEvent),
      { signal: options.signal },
    );
  }

  get current(): string {
    return this.value;
  }

  setValue(value: string): void {
    if (value === this.value) return;
    this.value = value;
    for (const button of this.buttons) {
      button.setAttribute('aria-checked', String(button.dataset.value === value));
    }
  }

  setDisabled(disabled: boolean): void {
    this.disabled = disabled;
    for (const button of this.buttons) button.disabled = disabled;
  }

  private select(value: string, emit: boolean): void {
    this.setValue(value);
    if (emit) this.onChange?.(value);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.disabled) return;
    const enabled = this.buttons.filter(button => !button.disabled);
    if (!enabled.length) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index < 0 ? enabled.length - 1 : (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = enabled[next];
    target.focus();
    this.select(target.dataset.value ?? '', true);
  }
}
