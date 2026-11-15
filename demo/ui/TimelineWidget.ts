import type { Frame } from '../../src/data.js';
import { el, setText, svgEl, clamp } from './dom';
import { formatUtc } from './dom';
import { icon } from './icons';
import {
  HOUR_MS,
  MINUTE_MS,
  buildVisibilityRuns,
  clampRange,
  computeTicks,
  formatTickLabel,
  medianSampleInterval,
  panRange,
  ratioFor,
  stepTime,
  timeAtRatio,
  zoomRange,
  type VisibilityRun,
} from './timelineMath';

export interface TimelineCallbacks {
  onSeek(ms: number): void;
  onPlay(rate: number): void;
  onPause(): void;
  onLiveToggle(): void;
}

export interface LiveState {
  active: boolean;
  disabled: boolean;
}

const SPEEDS = [1, 10, 100, 1000, 10000];

export class TimelineWidget {
  readonly root: HTMLElement;
  private readonly callbacks: TimelineCallbacks;
  private readonly events = new AbortController();
  private readonly resizeObserver: ResizeObserver;

  private readonly stepBackButton: HTMLButtonElement;
  private readonly playButton: HTMLButtonElement;
  private readonly stepForwardButton: HTMLButtonElement;
  private readonly loopButton: HTMLButtonElement;
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly liveButton: HTMLButtonElement;
  private readonly utcOutput: HTMLElement;
  private readonly sampleOutput: HTMLElement;
  private readonly ruler: HTMLElement;
  private readonly lanes: Record<'sun' | 'earth' | 'co', HTMLElement>;
  private readonly ticksSvg: SVGSVGElement;
  private readonly playhead: HTMLElement;
  private readonly hover: HTMLElement;
  private readonly hoverLabel: HTMLElement;
  private readonly statusOutput: HTMLElement;
  private readonly liveStatusOutput: HTMLElement;

  private frames: readonly Frame[] = [];
  private runs: VisibilityRun[] = [];
  private start = 0;
  private end = 0;
  private current = 0;
  private viewStart = 0;
  private viewEnd = 0;
  private interval = HOUR_MS;
  private minSpan = HOUR_MS;
  private speed = 100;
  private looping = false;
  private playing = false;
  private enabled = false;
  private liveActive = false;
  private liveDisabled = true;
  private pointerMode: 'idle' | 'pending' | 'scrub' | 'pan' = 'idle';
  private pointerId = -1;
  private pointerStartX = 0;
  private pointerStartView = 0;
  private pointerStartEnd = 0;

  constructor(mount: HTMLElement, callbacks: TimelineCallbacks) {
    this.callbacks = callbacks;
    mount.replaceChildren();

    this.stepBackButton = this.transportButton('stepBack', 'Previous sample');
    this.playButton = this.transportButton('play', 'Play');
    this.playButton.classList.add('transport-btn--play');
    this.stepForwardButton = this.transportButton('stepForward', 'Next sample');
    this.loopButton = this.transportButton('loop', 'Loop');
    this.loopButton.classList.add('transport-btn--loop');
    this.loopButton.setAttribute('aria-pressed', 'false');

    const speeds = el('div', { class: 'timeline__speeds', role: 'group', 'aria-label': 'Playback speed' });
    for (const speed of SPEEDS) {
      const button = el('button', {
        class: 'speed-btn',
        type: 'button',
        'data-speed': speed,
        'aria-pressed': String(speed === this.speed),
        'aria-label': `${speed} times`,
      }, `${speed}×`);
      button.addEventListener('click', () => this.setSpeed(speed), { signal: this.events.signal });
      this.speedButtons.push(button);
      speeds.append(button);
    }

    this.utcOutput = el('output', { class: 'timeline__utc', 'aria-live': 'off' }, 'Loading data…');
    this.sampleOutput = el('span', { class: 'timeline__sample' }, '');
    const readout = el('div', { class: 'timeline__readout' }, this.utcOutput, this.sampleOutput);

    this.liveButton = el('button', {
      class: 'ui-btn ui-btn--secondary timeline__live',
      type: 'button',
      'aria-pressed': 'false',
      disabled: true,
    }, 'Live');
    this.liveButton.addEventListener('click', () => this.callbacks.onLiveToggle(), { signal: this.events.signal });

    const top = el(
      'div',
      { class: 'timeline__top' },
      el('div', { class: 'timeline__transport' }, this.stepBackButton, this.playButton, this.stepForwardButton, this.loopButton, speeds),
      readout,
      this.liveButton,
    );

    this.lanes = {
      sun: el('div', { class: 'timeline__lane', 'data-lane': 'sun' }),
      earth: el('div', { class: 'timeline__lane', 'data-lane': 'earth' }),
      co: el('div', { class: 'timeline__lane', 'data-lane': 'co' }),
    };
    const laneGroup = el('div', { class: 'timeline__lanes', 'aria-hidden': 'true' }, this.lanes.sun, this.lanes.earth, this.lanes.co);

    this.ticksSvg = svgEl('svg', { class: 'timeline__ticks', 'aria-hidden': 'true' });
    this.playhead = el(
      'div',
      { class: 'timeline__playhead', 'aria-hidden': 'true' },
      el('span', { class: 'timeline__handle' }),
    );
    this.hoverLabel = el('span', { class: 'timeline__hover-label' });
    this.hover = el('div', { class: 'timeline__hover', hidden: true }, this.hoverLabel);

    this.ruler = el(
      'div',
      {
        class: 'timeline__ruler',
        role: 'slider',
        tabindex: 0,
        'aria-label': 'Timeline position',
        'aria-valuemin': '0',
        'aria-valuemax': '0',
        'aria-valuenow': '0',
        'aria-disabled': 'true',
      },
      laneGroup,
      this.ticksSvg,
      this.hover,
      this.playhead,
    );

    this.statusOutput = el('p', { class: 'timeline__status', role: 'status' }, 'Preparing terrain…');
    this.liveStatusOutput = el('p', { class: 'timeline__live-status', id: 'live-status' }, 'Checking time coverage…');
    const bottom = el(
      'div',
      { class: 'timeline__bottom' },
      el(
        'div',
        { class: 'timeline__legend', 'aria-hidden': 'true' },
        this.legendItem('sun', 'Sun'),
        this.legendItem('earth', 'Earth'),
        this.legendItem('co', 'Co-visibility'),
      ),
      this.statusOutput,
      this.liveStatusOutput,
    );

    this.root = el('section', { class: 'timeline is-disabled', 'aria-label': 'Lunar timeline' }, top, this.ruler, bottom);
    mount.append(this.root);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.renderTicks());
    this.resizeObserver.observe(this.ruler);
    this.setPlaying(false);
    this.setEnabled(false);
    this.render();
  }

  configure(frames: readonly Frame[], start: number, end: number): void {
    this.frames = frames;
    this.start = start;
    this.end = Math.max(start + MINUTE_MS, end);
    this.current = clamp(this.current || start, start, this.end);
    this.viewStart = this.start;
    this.viewEnd = this.end;
    this.interval = medianSampleInterval(frames);
    const fullSpan = this.end - this.start;
    this.minSpan = Math.max(5 * MINUTE_MS, Math.min(HOUR_MS, fullSpan / 8));
    this.runs = buildVisibilityRuns(frames);
    this.ruler.setAttribute('aria-valuemin', String(Math.round(this.start)));
    this.ruler.setAttribute('aria-valuemax', String(Math.round(this.end)));
    this.setEnabled(true);
    this.render();
  }

  setTime(ms: number): void {
    if (!Number.isFinite(ms)) return;
    this.current = clamp(ms, this.start, this.end);
    this.ensureVisible();
    this.render();
  }

  setSampleText(text: string): void {
    setText(this.sampleOutput, text);
  }

  setStatus(text: string): void {
    setText(this.statusOutput, text);
  }

  setLiveState(state: LiveState): void {
    this.liveActive = state.active;
    this.liveDisabled = state.disabled;
    this.liveButton.textContent = state.active ? 'Pause live' : 'Live';
    this.liveButton.setAttribute('aria-pressed', String(state.active));
    this.liveButton.disabled = !this.enabled || state.disabled;
  }

  setLiveStatus(text: string): void {
    setText(this.liveStatusOutput, text);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.playButton.innerHTML = icon(playing ? 'pause' : 'play');
    this.playButton.setAttribute('aria-label', playing ? 'Pause playback' : 'Play');
    this.playButton.setAttribute('title', playing ? 'Pause' : 'Play');
    this.root.classList.toggle('is-playing', playing);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.classList.toggle('is-disabled', !enabled);
    this.ruler.setAttribute('aria-disabled', String(!enabled));
    for (const button of [this.stepBackButton, this.stepForwardButton, this.loopButton, ...this.speedButtons]) {
      button.disabled = !enabled;
    }
    this.playButton.disabled = !enabled;
    this.liveButton.disabled = !enabled || this.liveDisabled;
    if (!enabled) this.setPlaying(false);
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get isLooping(): boolean {
    return this.looping;
  }

  get speedRate(): number {
    return this.speed;
  }

  get time(): number {
    return this.current;
  }

  get range(): { start: number; end: number } {
    return { start: this.start, end: this.end };
  }

  dispose(): void {
    this.events.abort();
    this.resizeObserver.disconnect();
    this.root.remove();
  }

  private transportButton(iconName: string, label: string): HTMLButtonElement {
    const button = el('button', {
      class: 'transport-btn',
      type: 'button',
      'aria-label': label,
      title: label,
    });
    button.innerHTML = icon(iconName);
    return button;
  }

  private legendItem(kind: 'sun' | 'earth' | 'co', label: string): HTMLElement {
    return el(
      'span',
      { class: 'timeline__legend-item' },
      el('span', { class: `timeline__legend-dot timeline__legend-dot--${kind}` }),
      label,
    );
  }

  private bindEvents(): void {
    const signal = this.events.signal;
    this.stepBackButton.addEventListener('click', () => this.step(-1), { signal });
    this.stepForwardButton.addEventListener('click', () => this.step(1), { signal });
    this.playButton.addEventListener('click', () => {
      if (!this.enabled) return;
      if (this.playing) {
        this.setPlaying(false);
        this.callbacks.onPause();
      } else {
        this.setPlaying(true);
        this.callbacks.onPlay(this.speed);
      }
    }, { signal });
    this.loopButton.addEventListener('click', () => {
      this.looping = !this.looping;
      this.loopButton.setAttribute('aria-pressed', String(this.looping));
      this.loopButton.setAttribute('aria-label', this.looping ? 'Turn loop off' : 'Turn loop on');
    }, { signal });

    this.ruler.addEventListener('pointerdown', event => this.onPointerDown(event), { signal });
    this.ruler.addEventListener('pointermove', event => this.onPointerMove(event), { signal });
    this.ruler.addEventListener('pointerup', event => this.onPointerUp(event), { signal });
    this.ruler.addEventListener('pointercancel', event => this.onPointerUp(event), { signal });
    this.ruler.addEventListener('pointerleave', () => {
      if (this.pointerMode === 'idle') this.hover.hidden = true;
    }, { signal });
    this.ruler.addEventListener('wheel', event => this.onWheel(event), { signal, passive: false });
    this.ruler.addEventListener('dblclick', () => this.resetView(), { signal });
    this.ruler.addEventListener('keydown', event => this.onKeyDown(event), { signal });
  }

  private step(direction: -1 | 1): void {
    if (!this.enabled) return;
    if (this.playing) {
      this.setPlaying(false);
      this.callbacks.onPause();
    }
    const target = stepTime(this.current, direction, this.start, this.end, this.interval);
    this.setTime(target);
    this.callbacks.onSeek(target);
  }

  private onPointerDown(event: PointerEvent): void {
    if (!this.enabled) return;
    if (event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.pointerStartX = event.clientX;
    this.pointerStartView = this.viewStart;
    this.pointerStartEnd = this.viewEnd;
    const target = event.target as Element;
    this.pointerMode = target.closest('.timeline__playhead') ? 'scrub' : 'pending';
    this.ruler.setPointerCapture(event.pointerId);
    if (this.pointerMode === 'scrub') this.seekFromClientX(event.clientX);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.enabled) return;
    if (this.pointerMode === 'idle' || this.pointerMode === 'pending') {
      this.updateHover(event.clientX);
    }
    if (this.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - this.pointerStartX;
    if (this.pointerMode === 'pending' && Math.abs(deltaX) > 4) {
      this.pointerMode = 'pan';
      this.ruler.classList.add('is-dragging');
    }
    if (this.pointerMode === 'scrub') {
      this.seekFromClientX(event.clientX);
    } else if (this.pointerMode === 'pan') {
      const width = Math.max(1, this.ruler.clientWidth);
      const span = this.pointerStartEnd - this.pointerStartView;
      const next = panRange(
        this.pointerStartView,
        this.pointerStartEnd,
        -(deltaX / width) * span,
        this.start,
        this.end,
      );
      this.viewStart = next.start;
      this.viewEnd = next.end;
      this.render();
    }
  }

  private onPointerUp(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    if (this.pointerMode === 'pending') this.seekFromClientX(event.clientX);
    if (this.ruler.hasPointerCapture(event.pointerId)) this.ruler.releasePointerCapture(event.pointerId);
    this.pointerMode = 'idle';
    this.pointerId = -1;
    this.ruler.classList.remove('is-dragging');
  }

  private onWheel(event: WheelEvent): void {
    if (!this.enabled) return;
    event.preventDefault();
    const rect = this.ruler.getBoundingClientRect();
    const anchor = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const factor = event.deltaY > 0 ? 1.25 : 0.8;
    const next = zoomRange(this.viewStart, this.viewEnd, this.start, this.end, anchor, factor, this.minSpan);
    this.viewStart = next.start;
    this.viewEnd = next.end;
    this.render();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.enabled) return;
    let target: number | null = null;
    if (event.key === 'ArrowLeft') target = stepTime(this.current, -1, this.start, this.end, this.interval * (event.shiftKey ? 10 : 1));
    else if (event.key === 'ArrowRight') target = stepTime(this.current, 1, this.start, this.end, this.interval * (event.shiftKey ? 10 : 1));
    else if (event.key === 'Home') target = this.start;
    else if (event.key === 'End') target = this.end;
    else if (event.key === '+' || event.key === '=' || event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const factor = event.key === 'PageUp' || event.key === '+' || event.key === '=' ? 0.8 : 1.25;
      const anchor = ratioFor(this.current, this.viewStart, this.viewEnd);
      const next = zoomRange(this.viewStart, this.viewEnd, this.start, this.end, anchor, factor, this.minSpan);
      this.viewStart = next.start;
      this.viewEnd = next.end;
      this.render();
      return;
    }
    if (target === null) return;
    event.preventDefault();
    this.setTime(target);
    this.callbacks.onSeek(target);
  }

  private seekFromClientX(clientX: number): void {
    const rect = this.ruler.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const target = timeAtRatio(this.viewStart, this.viewEnd, ratio);
    this.setTime(target);
    this.callbacks.onSeek(target);
  }

  private updateHover(clientX: number): void {
    const rect = this.ruler.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) {
      this.hover.hidden = true;
      return;
    }
    const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const time = timeAtRatio(this.viewStart, this.viewEnd, ratio);
    this.hover.hidden = false;
    this.hover.style.left = `${ratio * 100}%`;
    this.hoverLabel.textContent = formatUtc(time);
  }

  private setSpeed(speed: number): void {
    if (!this.enabled) return;
    this.speed = speed;
    for (const button of this.speedButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed));
    }
    if (this.playing) this.callbacks.onPlay(speed);
  }

  private resetView(): void {
    this.viewStart = this.start;
    this.viewEnd = this.end;
    this.render();
  }

  private ensureVisible(): void {
    if (this.current >= this.viewStart && this.current <= this.viewEnd) return;
    const span = Math.max(this.minSpan, this.viewEnd - this.viewStart);
    const next = clampRange(this.current - span / 2, this.current + span / 2, this.start, this.end);
    this.viewStart = next.start;
    this.viewEnd = next.end;
  }

  private render(): void {
    this.renderBands();
    this.renderTicks();
    this.renderPlayhead();
    setText(this.utcOutput, formatUtc(this.current));
    this.ruler.setAttribute('aria-valuenow', String(Math.round(this.current)));
    this.ruler.setAttribute('aria-valuetext', formatUtc(this.current));
  }

  private renderBands(): void {
    const span = Math.max(1, this.viewEnd - this.viewStart);
    for (const kind of ['sun', 'earth', 'co'] as const) {
      const lane = this.lanes[kind];
      lane.replaceChildren();
      if (!this.runs.length) continue;
      for (const run of this.runs) {
        if (!run[kind]) continue;
        const start = Math.max(run.start, this.viewStart);
        const end = Math.min(run.end, this.viewEnd);
        if (end <= start) continue;
        const left = ((start - this.viewStart) / span) * 100;
        const width = ((end - start) / span) * 100;
        lane.append(
          el('div', {
            class: `timeline__band timeline__band--${kind}`,
            style: `left:${left}%;width:${width}%`,
          }),
        );
      }
    }
  }

  private renderTicks(): void {
    const width = this.ruler.clientWidth;
    const height = this.ruler.clientHeight;
    if (width < 2 || height < 2) return;
    this.ticksSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.ticksSvg.setAttribute('width', String(width));
    this.ticksSvg.setAttribute('height', String(height));
    this.ticksSvg.replaceChildren();

    const ticks = computeTicks(this.viewStart, this.viewEnd, width);
    const baseY = Math.max(20, height - 22);
    for (const tick of ticks.minor) {
      const x = tick.ratio * width;
      this.ticksSvg.append(
        svgEl('line', {
          class: 'timeline-tick',
          x1: x,
          y1: baseY,
          x2: x,
          y2: baseY + 5,
        }),
      );
    }
    for (const tick of ticks.major) {
      const x = tick.ratio * width;
      this.ticksSvg.append(
        svgEl('line', {
          class: 'timeline-tick timeline-tick--major',
          x1: x,
          y1: baseY - 2,
          x2: x,
          y2: baseY + 8,
        }),
      );
      const anchor = tick.ratio < 0.03 ? 'start' : tick.ratio > 0.97 ? 'end' : 'middle';
      this.ticksSvg.append(
        svgEl(
          'text',
          {
            class: 'timeline-tick__label',
            x,
            y: Math.min(height - 3, baseY + 19),
            'text-anchor': anchor,
          },
          formatTickLabel(tick.time, ticks.span),
        ),
      );
    }
  }

  private renderPlayhead(): void {
    const ratio = ratioFor(this.current, this.viewStart, this.viewEnd);
    const visible = this.current >= this.viewStart && this.current <= this.viewEnd && !this.lanes.co.hidden;
    this.playhead.style.display = visible ? '' : 'none';
    this.playhead.style.left = `${ratio * 100}%`;
  }
}
