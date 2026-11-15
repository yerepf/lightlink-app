import { el, svgEl, setText } from './dom';
import { Tooltip } from './components/Tooltip';
import { normalizeAz, polarPoint, relativeBearing } from './compassMath';

export interface CompassBody {
  azimuth_deg: number;
  elevation_deg: number;
  aboveHorizon: boolean;
  backendVisible: boolean;
}

export interface CompassState {
  headingDeg: number;
  sun: CompassBody;
  earth: CompassBody;
}

const CENTER = 60;
const BODY_RADIUS = 33;
const NORTH_RADIUS = 45;

export class CompassWidget {
  readonly root: HTMLElement;
  private readonly ticks: SVGGElement;
  private readonly north: SVGGElement;
  private readonly sun: SVGGElement;
  private readonly earth: SVGGElement;
  private readonly meta: HTMLElement;
  private readonly tooltip: Tooltip;
  private readonly sunLabel: string;
  private readonly earthLabel: string;

  constructor(mount: HTMLElement, signal?: AbortSignal) {
    mount.replaceChildren();
    this.tooltip = new Tooltip();
    this.sunLabel = 'Sun';
    this.earthLabel = 'Earth';

    this.ticks = svgEl('g', { class: 'compass__ticks', 'aria-hidden': 'true' });
    for (let i = 0; i < 36; i++) {
      const major = i % 9 === 0;
      const length = major ? 6 : 3;
      this.ticks.append(
        svgEl('line', {
          class: `compass__tick${major ? ' compass__tick--major' : ''}`,
          x1: CENTER,
          y1: 8,
          x2: CENTER,
          y2: 8 + length,
          transform: `rotate(${i * 10} ${CENTER} ${CENTER})`,
        }),
      );
    }

    const northBackground = svgEl('circle', {
      class: 'compass__north-bg',
      cx: 0,
      cy: 0,
      r: 7,
    });
    const northText = svgEl('text', {
      class: 'compass__north-text',
      x: 0,
      y: 0,
    }, 'N');
    this.north = svgEl('g', { class: 'compass__north' }, northBackground, northText);

    this.sun = this.createBody('sun', 'Sun');
    this.earth = this.createBody('earth', 'Earth');

    const arrow = svgEl('path', {
      class: 'compass__arrow',
      d: 'M60 40 L67 59 L60 55.5 L53 59 Z',
    });
    const center = svgEl('circle', { class: 'compass__center', cx: CENTER, cy: CENTER, r: 2.6 });

    const dial = svgEl(
      'svg',
      {
        class: 'compass__dial',
        viewBox: '0 0 120 120',
        role: 'img',
        'aria-label': 'Compass showing north, the Sun and Earth',
      },
      svgEl('circle', { class: 'compass__ring', cx: CENTER, cy: CENTER, r: 52 }),
      svgEl('circle', { class: 'compass__ring-inner', cx: CENTER, cy: CENTER, r: 41 }),
      this.ticks,
      this.north,
      this.sun,
      this.earth,
      arrow,
      center,
    );

    this.meta = el('div', { class: 'compass__meta', 'aria-live': 'off' }, 'HDG —');
    const legend = el(
      'div',
      { class: 'compass__legend' },
      el('span', { class: 'compass__legend-item' }, el('span', { class: 'compass__legend-dot compass__legend-dot--sun' }), 'Sun'),
      el('span', { class: 'compass__legend-item' }, el('span', { class: 'compass__legend-dot compass__legend-dot--earth' }), 'Earth'),
      el('span', { class: 'compass__legend-item' }, 'N'),
    );

    this.root = el('div', { class: 'compass is-empty' }, dial, legend, this.meta);
    mount.append(this.root);

    this.bindBody(this.sun, this.sunLabel, signal);
    this.bindBody(this.earth, this.earthLabel, signal);
  }

  update(state: CompassState | null): void {
    this.lastState = state;
    if (!state) {
      this.root.classList.add('is-empty');
      setText(this.meta, 'HDG —');
      this.sun.style.display = 'none';
      this.earth.style.display = 'none';
      this.north.style.display = 'none';
      this.tooltip.hide();
      return;
    }
    this.root.classList.remove('is-empty');
    this.sun.style.display = '';
    this.earth.style.display = '';
    this.north.style.display = '';

    const heading = normalizeAz(state.headingDeg);
    this.ticks.setAttribute('transform', `rotate(${-heading} ${CENTER} ${CENTER})`);

    const northBearing = relativeBearing(0, heading);
    this.place(this.north, NORTH_RADIUS, northBearing);

    this.placeBody(this.sun, state.sun, heading);
    this.placeBody(this.earth, state.earth, heading);

    setText(this.meta, `HDG ${heading.toFixed(0).padStart(3, '0')}°`);
  }

  dispose(): void {
    this.tooltip.dispose();
    this.root.remove();
  }

  private createBody(kind: 'sun' | 'earth', label: string): SVGGElement {
    const halo = svgEl('circle', { class: `compass__halo compass__halo--${kind}`, cx: 0, cy: 0, r: 7 });
    const dot = svgEl('circle', { class: `compass__dot compass__dot--${kind}`, cx: 0, cy: 0, r: 4.3 });
    return svgEl(
      'g',
      {
        class: 'compass__body',
        tabindex: 0,
        role: 'img',
        'aria-label': label,
        'data-body': kind,
      },
      halo,
      dot,
    );
  }

  private place(node: SVGGElement, radius: number, bearing: number): void {
    const point = polarPoint(radius, bearing);
    node.setAttribute('transform', `translate(${(CENTER + point.x).toFixed(2)} ${(CENTER + point.y).toFixed(2)})`);
  }

  private placeBody(node: SVGGElement, body: CompassBody, heading: number): void {
    const bearing = relativeBearing(body.azimuth_deg, heading);
    this.place(node, BODY_RADIUS, bearing);
    node.classList.toggle('is-below', !body.aboveHorizon);
    node.classList.toggle('is-visible', body.aboveHorizon);
    const name = node === this.sun ? this.sunLabel : this.earthLabel;
    const status = body.aboveHorizon ? 'above the estimated horizon' : 'below the estimated horizon';
    node.setAttribute(
      'aria-label',
      `${name}. Azimuth ${body.azimuth_deg.toFixed(1)} degrees, elevation ${body.elevation_deg.toFixed(1)} degrees. ${status}.`,
    );
  }

  private bindBody(node: SVGGElement, name: string, signal?: AbortSignal): void {
    const show = () => {
      const body = node === this.sun ? this.lastState?.sun : this.lastState?.earth;
      if (!body) return;
      const status = body.aboveHorizon ? 'Above the estimated horizon' : 'Below the estimated horizon';
      const backend = body.backendVisible ? 'visible' : 'obscured';
      this.tooltip.show(
        node,
        `${name}\nAz ${body.azimuth_deg.toFixed(1)}° · El ${body.elevation_deg.toFixed(1)}°\n${status}\nMuestra backend: ${backend}`,
      );
    };
    const hide = () => this.tooltip.hide();
    node.addEventListener('mouseenter', show, { signal });
    node.addEventListener('mouseleave', hide, { signal });
    node.addEventListener('focus', show, { signal });
    node.addEventListener('blur', hide, { signal });
    node.addEventListener('touchstart', show, { signal, passive: true });
    node.addEventListener('touchend', hide, { signal, passive: true });
  }

  private lastState: CompassState | null = null;
}
