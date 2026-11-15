import { el } from '../dom';

let tooltipId = 0;

export class Tooltip {
  readonly root: HTMLElement;
  private readonly id: string;
  private currentTarget?: Element;

  constructor(host: HTMLElement = document.body) {
    this.id = `ui-tooltip-${++tooltipId}`;
    this.root = el('div', {
      class: 'ui-tooltip',
      id: this.id,
      role: 'tooltip',
      hidden: true,
    });
    host.append(this.root);
  }

  show(target: Element, text: string): void {
    if (!text) {
      this.hide();
      return;
    }
    this.currentTarget = target;
    this.root.textContent = text;
    this.root.hidden = false;
    this.root.classList.add('is-visible');
    this.position(target);

    if (target instanceof HTMLElement || target instanceof SVGElement) {
      target.setAttribute('aria-describedby', this.id);
    }
  }

  hide(): void {
    if (this.currentTarget) {
      this.currentTarget.removeAttribute('aria-describedby');
      this.currentTarget = undefined;
    }
    this.root.classList.remove('is-visible');
    this.root.hidden = true;
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }

  private position(target: Element): void {
    const rect = target.getBoundingClientRect();
    const tooltipRect = this.root.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
    let top = rect.top - tooltipRect.height - 8;
    if (top < 8) top = rect.bottom + 8;
    left = Math.min(window.innerWidth - tooltipRect.width - 8, Math.max(8, left));
    top = Math.min(window.innerHeight - tooltipRect.height - 8, Math.max(8, top));
    this.root.style.left = `${left}px`;
    this.root.style.top = `${top}px`;
  }
}
