const recordings = import.meta.glob<string>('../audio/astronaut-*.mp3', { eager: true, query: '?url', import: 'default' });

export class ExplorerAudio {
  private readonly music = new Audio(`${import.meta.env.BASE_URL}audio/lunar-orbit.mp3`);
  private readonly effects = {
    transmission: new Audio(`${import.meta.env.BASE_URL}audio/transmission.mp3`),
    confirmed: new Audio(`${import.meta.env.BASE_URL}audio/confirmed.mp3`),
  };
  private recording?: HTMLAudioElement;
  private speech?: SpeechSynthesisUtterance;
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

  narrate(chapter: number, text: string) {
    if (!this.enabled || document.hidden || !text) return;
    this.stopVoice();
    const source = recordings[`../audio/astronaut-${chapter}.mp3`];
    if (!source) {
      this.speakWithBrowser(text);
      return;
    }
    const recording = new Audio(source);
    this.recording = recording;
    recording.onplaying = () => { if (this.recording === recording) this.beginVoice(); };
    recording.onended = () => { if (this.recording === recording) this.finishVoice(); };
    const fallback = () => {
      if (this.recording !== recording) return;
      this.finishVoice();
      this.speakWithBrowser(text);
    };
    recording.onerror = fallback;
    void recording.play().catch(fallback);
  }

  private speakWithBrowser(text: string) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      this.unavailable();
      return;
    }
    const voice = new SpeechSynthesisUtterance(text);
    voice.lang = 'en-US';
    voice.rate = .92;
    voice.volume = .9;
    const voices = window.speechSynthesis.getVoices().filter(candidate => /^en(?:-|$)/i.test(candidate.lang));
    voice.voice = voices.find(candidate => /natural|neural/i.test(candidate.name) && /^en-US$/i.test(candidate.lang))
      ?? voices.find(candidate => candidate.localService && /^en-US$/i.test(candidate.lang))
      ?? voices[0] ?? null;
    voice.onstart = () => {
      if (this.speech !== voice) return;
      this.beginVoice();
    };
    voice.onend = () => { if (this.speech === voice) this.finishVoice(); };
    voice.onerror = event => {
      if (this.speech !== voice) return;
      this.finishVoice();
      if (event.error !== 'canceled' && event.error !== 'interrupted') this.unavailable();
    };
    this.speech = voice;
    window.speechSynthesis.speak(voice);
  }

  stopVoice() {
    const speech = this.speech;
    const recording = this.recording;
    this.finishVoice();
    recording?.pause();
    if (speech) window.speechSynthesis.cancel();
  }

  private beginVoice() {
    this.music.volume = .08;
    this.speaking(true);
  }

  private finishVoice() {
    this.speech = undefined;
    this.recording = undefined;
    this.music.volume = .22;
    this.speaking(false);
  }
}
