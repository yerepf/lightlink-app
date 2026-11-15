import { el, type Child } from '../dom';

export interface PanelOptions {
  label?: string;
  className?: string;
}

export class Panel {
  readonly root: HTMLElement;
  readonly body: HTMLElement;

  constructor(options: PanelOptions = {}) {
    this.root = el('section', {
      class: ['ui-panel', options.className].filter(Boolean).join(' '),
      'aria-label': options.label,
    });
    this.body = el('div', { class: 'ui-panel__body' });
    this.root.append(this.body);
  }

  append(...children: Child[]): void {
    this.body.append(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
  }
}
