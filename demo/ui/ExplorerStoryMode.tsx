import { SHADOW_DISCHARGE_PER_HOUR } from '../../src/analytics';
import { visibilitySummary } from '../../src/missionMetrics';
import type { Frame } from '../../src/data';
import { el } from './dom';

type Step = 1 | 2 | 3 | 4 | 5 | 6;
const titles = ['¿Dónde estamos?', 'Alunizaje en peligro', 'Luz y señal', '¿Cuánto dura la misión?', 'De dónde salen los datos', 'Compara antes de aterrizar'];
const narration = [
  'Estamos en el polo sur lunar. Buscamos hielo de agua en cráteres que quedan en sombra y crestas con luz casi constante. El Sol puede alimentar los paneles; tener a la Tierra a la vista permite intentar un enlace directo.',
  'El módulo quedó en rojo, en una ladera de más de 15°. Activa el reubicador y elige un vértice verde, de menos de 10°, para estabilizarlo.',
  'Al mover el módulo, recalculamos el horizonte de 360° con el relieve local. Arrastra la línea de tiempo hasta encontrar una muestra con Sol visible y el enlace a Tierra en verde.',
  'Mira cuánto dura la ventana que encontraste. La batería es simulada y, en este modelo, el módulo en sombra se enfría hacia −180 °C. Si el experimento necesita ocho horas seguidas de luz y señal, ¿alcanza esta ventana?',
  'LOLA, el altímetro láser de la NASA, mide el relieve. JPL Horizons calcula las posiciones del Sol y la Tierra. Como la Luna casi no tiene atmósfera, el modelo trata la luz como un rayo recto.',
  'Un buen planificador nunca se queda con una sola opción. Compara tu posición con otro sitio del polo sur y revisa cuál ofrece más horas de co-visibilidad.',
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
  private readonly root: HTMLElement;
  private readonly title = el('h2', { id: 'story-title', tabindex: -1 });
  private readonly label = el('p', { class: 'story__progress' });
  private readonly copy = el('p', { class: 'story__copy' });
  private readonly content = el('div', { class: 'story__content' });
  private readonly feedback = el('p', { class: 'story__feedback', role: 'status' });
  private readonly cursor = el('p', { class: 'story__cursor', 'aria-live': 'off', hidden: true });
  private readonly actions = el('div', { class: 'story__actions' });

  constructor(mount: HTMLElement, private readonly callbacks: {
    enter(step: Step): void;
    relocate(): void;
    compare(): void;
    retry(): void;
    planner(): void;
  }) {
    this.root = el('section', { class: 'flight-panel story', hidden: true, 'aria-labelledby': 'story-title' },
      el('div', { class: 'story__head' },
        el('img', { class: 'story__avatar', src: `${import.meta.env.BASE_URL}art/start-astronaut.webp`, alt: '', width: 60, height: 60 }),
        el('div', {}, this.label, this.title)),
      this.copy, this.content, this.feedback, this.cursor, this.actions);
    mount.append(this.root);
  }

  get step() { return this.root.hidden || this.done ? 0 : this.storyStep; }
  start() { this.root.hidden = false; this.done = false; this.go(1); }
  close() { this.root.hidden = true; }
  setBusy(busy: boolean) { this.busy = busy; this.render(); }
  setFailure() { this.failed = true; this.busy = false; this.render(); }
  rotated() { if (this.step === 1 && !this.busy && !this.failed && !this.ready) this.unlock('Orientación completada.'); }
  landing(slope: number) { if (this.step === 2) this.unlock(`Alunizaje seguro · ${slope.toFixed(1)}°.`); }
  relocationActive(active: boolean) {
    const button = this.actions.querySelector<HTMLButtonElement>('[data-story-relocate]');
    if (button) { button.textContent = active ? 'Salir del reubicador' : 'Activar reubicador'; button.setAttribute('aria-pressed', String(active)); }
    this.cursor.hidden = !active || this.step !== 2;
  }
  cursorReadout(copy: string, safe?: boolean) {
    this.cursor.textContent = copy;
    this.cursor.dataset.safe = safe === undefined ? '' : String(safe);
  }
  message(note: string) { this.note = note; this.feedback.textContent = note; }
  setNoWindow(value: boolean) { this.noWindow = value; this.render(); }
  seek(frames: readonly Frame[], time: number, batteryPct: number | undefined) {
    if (this.step !== 3 || this.noWindow) return;
    const window = visibilitySummary(frames).windows.find(w => w.condition === 'co_visibility' && w.start <= time && time <= w.end);
    this.duration = window?.hours ?? 0;
    this.shadowHours = (batteryPct ?? 0) / SHADOW_DISCHARGE_PER_HOUR;
    if (!this.ready) this.unlock('Ventana confirmada · Sol y Tierra visibles.');
  }

  compared(recommendation: string) {
    if (this.step !== 6) return;
    this.comparison = recommendation;
    this.unlock('Comparación completada. Vuelve a la misión para recibir tu insignia.');
  }

  private unlock(note: string) { this.ready = true; this.note = note; this.render(); }
  private go(step: Step) {
    this.storyStep = step; this.ready = step === 5; this.note = ''; this.failed = false; this.noWindow = false;
    this.answered = false; this.comparison = '';
    this.callbacks.enter(step);
    this.render(); this.title.focus({ preventScroll: true });
  }
  private button(text: string, fn: () => void, primary = false, disabled = false) {
    const button = el('button', { class: `flight-button${primary ? ' flight-button--primary' : ''}`, type: 'button', disabled }, text);
    button.addEventListener('click', fn);
    return button;
  }
  private render() {
    const step = this.storyStep;
    const focused = document.activeElement instanceof HTMLButtonElement && this.actions.contains(document.activeElement) ? document.activeElement.textContent : null;
    this.label.textContent = this.done ? 'Insignia de campaña' : `Misión ${step} de 6`;
    this.title.textContent = this.done ? 'Planificador Lunar Certificado' : titles[step - 1];
    this.copy.textContent = this.done ? 'Completaste las seis misiones. Tu insignia reconoce el recorrido de aprendizaje.' : narration[step - 1];
    this.content.replaceChildren(); this.actions.replaceChildren();
    this.feedback.textContent = this.done ? this.comparison : this.failed ? 'No se pudo preparar la misión. Reintenta la carga.' : this.busy ? 'Preparando el terreno lunar…' : this.note;

    if (this.done) { this.actions.append(this.button('Abrir Mission Planner', this.callbacks.planner, true)); return; }
    if (this.failed) { this.actions.append(this.button('Reintentar', this.callbacks.retry, true)); return; }
    if (this.busy) return;
    if (step === 1 && !this.ready) this.actions.append(this.button('Entendido, ¡empecemos!', () => this.go(2), true));
    else {
      if (step === 2 && !this.ready) {
        const relocate = this.button('Activar reubicador', this.callbacks.relocate, true);
        relocate.dataset.storyRelocate = ''; relocate.setAttribute('aria-pressed', 'false'); this.actions.append(relocate);
      }
      if (step === 3 && this.noWindow) this.actions.append(this.button('Elegir otra zona verde', () => this.go(2), true));
      if (step === 4) {
        this.content.append(el('dl', { class: 'story__readings' },
          el('div', {}, el('dt', {}, 'Luz y señal seguidas'), el('dd', {}, `${this.duration.toFixed(1)} h`)),
          el('div', {}, el('dt', {}, 'Autonomía en sombra'), el('dd', {}, `≈ ${this.shadowHours.toFixed(1)} h`))));
        if (!this.answered) for (const [label, yes] of [['Sí, alcanza', true], ['No, falta tiempo', false]] as const) {
          this.actions.append(this.button(label, () => {
            this.answered = true;
            this.unlock(`${yes === (this.duration >= 8) ? 'Correcto.' : 'Revisa la duración.'} ${this.duration >= 8 ? 'La ventana cubre las 8 h requeridas.' : 'La ventana dura menos de 8 h.'} La autonomía por sí sola no mantiene la señal.`);
            this.actions.querySelector('button')?.focus();
          }));
        }
      }
      if (step === 5) this.content.append(el('div', { class: 'story__sources' },
        el('a', { href: 'https://science.nasa.gov/mission/lro/lola/', target: '_blank', rel: 'noopener' }, 'NASA · LOLA'),
        el('a', { href: 'https://ssd.jpl.nasa.gov/horizons/', target: '_blank', rel: 'noopener' }, 'JPL · Horizons')));
      if (step === 6) this.actions.append(this.button('Abrir comparador', this.callbacks.compare, !this.ready));
      this.actions.append(this.button(step === 6 ? 'Recibir insignia' : 'Siguiente', () => {
        if (step === 6) { this.done = true; this.render(); this.title.focus(); }
        else this.go((step + 1) as Step);
      }, this.ready, !this.ready));
    }
    if (focused) Array.from(this.actions.querySelectorAll('button')).find(b => b.textContent === focused && !b.disabled)?.focus({ preventScroll: true });
  }
}
