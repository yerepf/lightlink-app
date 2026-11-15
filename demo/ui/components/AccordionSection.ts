import { el, setText, type Child } from '../dom';
import { icon } from '../icons';

export interface AccordionOptions {
  id: string;
  title: string;
  iconName?: string;
  open?: boolean;
  badge?: string;
  signal?: AbortSignal;
  onToggle?: (open: boolean) => void;
}

export class AccordionSection {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly badgeSlot: HTMLElement;
  private open: boolean;

  constructor(options: AccordionOptions) {
    this.open = options.open ?? true;
    const bodyId = `${options.id}-body`;

    const iconSlot = el('span', { class: 'ui-accordion__icon', 'aria-hidden': 'true' });
    iconSlot.innerHTML = icon(options.iconName ?? 'info');

    this.badgeSlot = el('span', { class: 'ui-accordion__badge' });
    if (options.badge) this.setBadge(options.badge);

    const chevron = el('span', { class: 'ui-accordion__chevron', 'aria-hidden': 'true' });
    chevron.innerHTML = icon('chevron');

    this.trigger = el(
      'button',
      {
        class: 'ui-accordion__trigger',
        type: 'button',
        'aria-expanded': String(this.open),
        'aria-controls': bodyId,
      },
      iconSlot,
      el('span', { class: 'ui-accordion__title' }, options.title),
      this.badgeSlot,
      chevron,
    );

    this.body = el('div', {
      class: 'ui-accordion__body',
      id: bodyId,
      hidden: !this.open,
    });

    this.root = el('section', { class: 'ui-accordion' }, this.trigger, this.body);

    this.trigger.addEventListener(
      'click',
      () => {
        this.setOpen(!this.open);
        options.onToggle?.(this.open);
      },
      { signal: options.signal },
    );
  }

  append(...children: Child[]): void {
    this.body.append(
      ...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false),
    );
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.trigger.setAttribute('aria-expanded', String(open));
    this.body.hidden = !open;
  }

  setBadge(text: string | null): void {
    setText(this.badgeSlot, text ?? '');
    this.badgeSlot.hidden = !text;
  }
}
