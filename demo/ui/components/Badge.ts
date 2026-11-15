import { el, setText } from '../dom';

export type BadgeVariant = 'neutral' | 'ok' | 'danger' | 'warning' | 'sun' | 'earth' | 'horizon';

export interface BadgeOptions {
  text: string;
  variant?: BadgeVariant;
  dot?: boolean;
  ariaLive?: 'polite' | 'off';
}

export class Badge {
  readonly root: HTMLElement;
  private readonly textSlot: HTMLElement;

  constructor(options: BadgeOptions) {
    this.textSlot = el('span', {}, options.text);
    this.root = el(
      'span',
      {
        class: `ui-badge ui-badge--${options.variant ?? 'neutral'}`,
        'aria-live': options.ariaLive,
      },
      options.dot === false ? null : el('span', { class: 'ui-badge__dot', 'aria-hidden': 'true' }),
      this.textSlot,
    );
  }

  set(text: string, variant: BadgeVariant = 'neutral'): void {
    setText(this.textSlot, text);
    this.root.className = `ui-badge ui-badge--${variant}`;
  }

  setVariant(variant: BadgeVariant): void {
    this.root.className = `ui-badge ui-badge--${variant}`;
  }

  setText(text: string): void {
    setText(this.textSlot, text);
  }
}
