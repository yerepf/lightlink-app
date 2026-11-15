const recordings = import.meta.glob<string>('../audio/alba-*.mp3', { eager: true, query: '?url', import: 'default' });

export class ExplorerAudio {
  private readonly music = new Audio(`${import.meta.env.BASE_URL}audio/lunar-orbit.mp3`);
  private readonly effects = {
    transmission: new Audio(`${import.meta.env.BASE_URL}audio/transmission.mp3`),
    confirmed: new Audio(`${import.meta.env.BASE_URL}audio/confirmed.mp3`),
  };
  private recording?: HTMLAudioElement;
  enabled = false;

  constructor(private readonly speaking: (active: boolean) => void, private readonly unavailable: () => void) {
    this.music.loop = true;
    this.music.preload = 'none';
    this.music.volume = .22;
    for (const effect of Object.values(this.effects)) {
      effect.preload = 'none';
      effect.volume = .32;
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.resume();
    else this.pause();
  }

  resume() {
    if (this.enabled && !document.hidden) void this.music.play().catch(() => undefined);
  }

  pause() {
    this.music.pause();
    for (const effect of Object.values(this.effects)) effect.pause();
    this.stopVoice();
  }

  play(effect: keyof ExplorerAudio['effects']) {
    if (!this.enabled || document.hidden) return;
    const sound = this.effects[effect];
    sound.currentTime = 0;
    void sound.play().catch(() => undefined);
  }

  narrate(passage: number) {
    if (!this.enabled || document.hidden) return;
    this.stopVoice();
    const source = recordings[`../audio/alba-${passage}.mp3`];
    if (!source) {
      this.unavailable();
      return;
    }
    const recording = new Audio(source);
    this.recording = recording;
    recording.onplaying = () => { if (this.recording === recording) this.beginVoice(); };
    recording.onended = () => { if (this.recording === recording) this.finishVoice(); };
    const failed = () => {
      if (this.recording !== recording) return;
      this.stopVoice();
      this.unavailable();
    };
    recording.onerror = failed;
    void recording.play().catch(failed);
  }

  stopVoice() {
    const recording = this.recording;
    this.finishVoice();
    recording?.pause();
  }

  private beginVoice() {
    this.music.volume = .08;
    this.speaking(true);
  }

  private finishVoice() {
    this.recording = undefined;
    this.music.volume = .22;
    this.speaking(false);
  }
}
