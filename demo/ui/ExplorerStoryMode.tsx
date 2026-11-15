import { SHADOW_DISCHARGE_PER_HOUR } from '../../src/analytics';
import { visibilitySummary } from '../../src/missionMetrics';
import type { Frame } from '../../src/data';
import { el } from './dom';
import { ExplorerAudio } from './ExplorerAudio';

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const poses = ['explorer-astronaut', 'explorer-astronaut-explain', 'explorer-astronaut-point', 'explorer-astronaut-think',
  'explorer-astronaut-scan', 'explorer-astronaut-compare', 'explorer-astronaut-salute'];
const titles = ['Welcome to the lunar south pole', 'A landing on the wrong slope', 'Find light and signal', 'Can we run the experiment?', 'How we know what we see', 'Compare before you commit'];
const narration = [
  'Look around. The ridges here can catch sunlight for long stretches, while craters that stay dark may hold water ice. We need a place where the Sun can power our lander and Earth is in sight for a direct link.',
  'Our lander is on a slope steeper than 15 degrees. See the red marker? Activate relocation and pick a green point where the slope is under 10 degrees.',
  'Moving the lander changed what rises above its horizon. Scrub the timeline until the Sun and Earth are visible at the same time. Look for the green band on the co-visibility row.',
  'How long can we work? In this simulation, the lander cools toward minus 180 degrees Celsius in shadow. Our experiment needs eight straight hours of light and signal. Does the window you found give us enough time?',
  'NASA mapped this terrain with a laser altimeter called LOLA. JPL Horizons gives us the positions of the Sun and Earth. With almost no lunar atmosphere, we can model light traveling in a straight line.',
  'Before we commit to this landing site, let’s see what the alternatives offer. Compare your position with another site at the south pole and see which has more hours of co-visibility.',
];

export class ExplorerStoryMode {
  private storyStep: Step = 1;
  private ready = false;
  private done = false;
  private busy = false;
  private failed = false;
  private noWindow = false;
  private answered = false;
  private duration = 0;
  private shadowHours = 0;
  private comparison = '';
  private note = '';
  private pose = 0;
  private preloaded = false;
  private readonly root: HTMLElement;
  private readonly portrait = el('img', { alt: '', width: 720, height: 868 });
  private readonly title = el('h2', { id: 'story-title', tabindex: -1 });
  private readonly label = el('p', { class: 'story__progress' });
  private readonly copy = el('p', { class: 'story__copy' });
  private readonly content = el('div', { class: 'story__content' });
  private readonly feedback = el('p', { class: 'story__feedback', role: 'status' });
  private readonly cursor = el('p', { class: 'story__cursor', 'aria-live': 'off', hidden: true });
  private readonly actions = el('div', { class: 'story__actions' });
  private readonly sound = el('button', { class: 'story__audio', type: 'button', 'aria-label': 'Mission audio', 'aria-pressed': 'false' }, 'Audio off');
  private readonly replay = el('button', { class: 'story__audio', type: 'button' }, 'Replay voice');
  private readonly voiceStatus = el('p', { class: 'story__feedback', role: 'status' });
  private readonly audio = new ExplorerAudio(active => { this.root.dataset.speaking = String(active); }, () => {
    this.voiceStatus.textContent = 'English narration is unavailable on this device. The full dialogue is on screen.';
  });

  constructor(mount: HTMLElement, private readonly callbacks: {
    enter(step: Step): void;
    relocate(): void;
    compare(): void;
    retry(): void;
    planner(): void;
  }) {
    this.root = el('section', { class: 'story', hidden: true, 'aria-labelledby': 'story-title' },
      el('div', { class: 'story__portrait' }, this.portrait),
      el('div', { class: 'flight-panel story__panel' },
        el('header', { class: 'story__head' }, el('span', { class: 'story__speaker' }, 'Astronaut'),
          el('div', { class: 'story__audio-controls' }, this.sound, this.replay)),
        this.label, this.title, this.copy, this.content, this.feedback, this.cursor, this.actions, this.voiceStatus));
    this.sound.addEventListener('click', () => {
      this.audio.setEnabled(!this.audio.enabled);
      this.updateAudioControls();
      if (this.audio.enabled) this.speak();
    });
    this.replay.addEventListener('click', () => { this.showPose((this.pose + 1) % poses.length); this.speak(); });
    this.updateAudioControls();
    mount.append(this.root);
  }

  get step() { return this.root.hidden || this.done ? 0 : this.storyStep; }
  start() {
    this.root.hidden = false;
    this.done = false;
    this.go(1);
    if (!this.preloaded) {
      this.preloaded = true;
      for (let i = 1; i < poses.length; i++) new Image().src = this.poseUrl(i);
    }
  }
  private poseUrl(index: number) { return `${import.meta.env.BASE_URL}art/${poses[index]}.webp`; }
  private showPose(index: number) { this.pose = index; this.portrait.src = this.poseUrl(index); }
  close() { this.root.hidden = true; this.audio.pause(); }
  setPageVisible(visible: boolean) {
    if (visible && !this.root.hidden) this.audio.resume();
    else this.audio.pause();
  }
  private updateAudioControls() {
    this.sound.textContent = this.audio.enabled ? 'Audio on' : 'Audio off';
    this.sound.setAttribute('aria-pressed', String(this.audio.enabled));
    this.replay.disabled = !this.audio.enabled || this.busy || this.failed;
  }
  private speak() {
    this.voiceStatus.textContent = '';
    this.audio.narrate(this.done ? 7 : this.storyStep, this.copy.textContent?.replaceAll('JPL', 'J P L') ?? '');
  }
  setBusy(busy: boolean) {
    this.busy = busy;
    if (busy) this.audio.stopVoice();
    this.render();
    if (!busy) this.speak();
  }
  setFailure() { this.failed = true; this.busy = false; this.render(); }
  rotated() { if (this.step === 1 && !this.busy && !this.failed && !this.ready) this.unlock('Orientation complete.'); }
  landing(slope: number) { if (this.step === 2) this.unlock(`Landing secured · ${slope.toFixed(1)}°.`); }
  relocationActive(active: boolean) {
    const button = this.actions.querySelector<HTMLButtonElement>('[data-story-relocate]');
    if (button) { button.textContent = active ? 'Exit relocation' : 'Activate relocation'; button.setAttribute('aria-pressed', String(active)); }
    this.cursor.hidden = !active || this.step !== 2;
  }
  cursorReadout(copy: string, safe?: boolean) {
    this.cursor.textContent = copy;
    this.cursor.dataset.safe = safe === undefined ? '' : String(safe);
  }
  message(note: string) { this.note = note; this.feedback.textContent = note; }
  setNoWindow(value: boolean) { this.noWindow = value; this.render(); }
  seek(frames: readonly Frame[], time: number, coVisible: boolean, batteryPct: number | undefined) {
    if (this.step !== 3 || this.noWindow) return;
    if (!coVisible) {
      if (this.ready) { this.ready = false; this.note = ''; this.render(); }
      return;
    }
    const window = visibilitySummary(frames).windows.find(w => w.condition === 'co_visibility' && w.start <= time && time <= w.end);
    this.duration = window?.hours ?? 0;
    this.shadowHours = (batteryPct ?? 0) / SHADOW_DISCHARGE_PER_HOUR;
    if (!this.ready) this.unlock('');
  }

  compared(recommendation: string) {
    if (this.step !== 6) return;
    this.comparison = recommendation;
    this.unlock('Comparison complete. Return to the mission to claim your badge.');
  }

  private unlock(note: string) {
    if (!this.ready) this.audio.play('confirmed');
    this.ready = true; this.note = note; this.render();
  }
  private go(step: Step) {
    this.storyStep = step; this.ready = step === 5; this.note = ''; this.failed = false; this.noWindow = false;
    this.answered = false; this.comparison = '';
    const nextPose = step - 1;
    this.showPose(step !== 1 && this.pose === nextPose ? (nextPose + 1) % poses.length : nextPose);
    this.callbacks.enter(step);
    this.render(); this.title.focus({ preventScroll: true });
    if (!this.busy && !this.failed) {
      this.audio.play('transmission');
      this.speak();
    }
  }
  private button(text: string, fn: () => void, primary = false, disabled = false) {
    const button = el('button', { class: `flight-button${primary ? ' flight-button--primary' : ''}`, type: 'button', disabled }, text);
    button.addEventListener('click', fn);
    return button;
  }
  private render() {
    const step = this.storyStep;
    const focused = document.activeElement instanceof HTMLButtonElement && this.actions.contains(document.activeElement) ? document.activeElement.textContent : null;
    this.label.textContent = this.done ? 'Campaign badge' : `Mission ${step} of 6`;
    this.title.textContent = this.done ? 'Certified Lunar Planner' : titles[step - 1];
    this.copy.textContent = this.done ? 'You completed all six missions. You’ve earned your lunar planning badge. I’ll see you on the next mission.' : narration[step - 1];
    this.content.replaceChildren(); this.actions.replaceChildren();
    this.feedback.textContent = this.done ? this.comparison : this.failed ? 'The mission could not load. Try again.' : this.busy ? 'Preparing lunar terrain…' : this.note;
    this.updateAudioControls();

    if (this.done) { this.actions.append(this.button('Open Mission Planner', this.callbacks.planner, true)); return; }
    if (this.failed) { this.actions.append(this.button('Retry', this.callbacks.retry, true)); return; }
    if (this.busy) return;
    if (step === 1 && !this.ready) this.actions.append(this.button('Let’s begin', () => this.go(2), true));
    else {
      if (step === 2 && !this.ready) {
        const relocate = this.button('Activate relocation', this.callbacks.relocate, true);
        relocate.dataset.storyRelocate = ''; relocate.setAttribute('aria-pressed', 'false'); this.actions.append(relocate);
      }
      if (step === 3 && this.noWindow) this.actions.append(this.button('Choose another green point', () => this.go(2), true));
      if (step === 4) {
        this.content.append(el('dl', { class: 'story__readings' },
          el('div', {}, el('dt', {}, 'Continuous light and signal'), el('dd', {}, `${this.duration.toFixed(1)} h`)),
          el('div', {}, el('dt', {}, 'Battery life in shadow'), el('dd', {}, `≈ ${this.shadowHours.toFixed(1)} h`))));
        if (!this.answered) for (const [label, yes] of [['Yes, enough time', true], ['No, too little time', false]] as const) {
          this.actions.append(this.button(label, () => {
            this.answered = true;
            this.unlock(`${yes === (this.duration >= 8) ? 'That’s right.' : 'Check the duration again.'} ${this.duration >= 8 ? 'The window covers the required eight hours.' : 'The window is shorter than eight hours.'} A charged battery alone cannot keep Earth in sight.`);
            this.actions.querySelector('button')?.focus();
          }));
        }
      }
      if (step === 5) this.content.append(el('div', { class: 'story__sources' },
        el('a', { href: 'https://science.nasa.gov/mission/lro/lola/', target: '_blank', rel: 'noopener' }, 'NASA · LOLA'),
        el('a', { href: 'https://ssd.jpl.nasa.gov/horizons/', target: '_blank', rel: 'noopener' }, 'JPL · Horizons')));
      if (step === 6) this.actions.append(this.button('Open comparison', this.callbacks.compare, !this.ready));
      this.actions.append(this.button(step === 6 ? 'Claim badge' : 'Continue', () => {
        if (step === 6) { this.done = true; this.showPose(this.pose === poses.length - 1 ? 0 : poses.length - 1); this.render(); this.title.focus(); this.audio.play('confirmed'); this.speak(); }
        else this.go((step + 1) as Step);
      }, this.ready, !this.ready));
    }
    if (focused) Array.from(this.actions.querySelectorAll('button')).find(b => b.textContent === focused && !b.disabled)?.focus({ preventScroll: true });
  }
}
