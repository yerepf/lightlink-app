export class ExplorerAudio {
  private readonly music = new Audio(`${import.meta.env.BASE_URL}audio/lunar-orbit.mp3`);
  private readonly effects = {
    transmission: new Audio(`${import.meta.env.BASE_URL}audio/transmission.mp3`),
    confirmed: new Audio(`${import.meta.env.BASE_URL}audio/confirmed.mp3`),
  };
  private speech?: SpeechSynthesisUtterance;
  private cancelVoiceWait?: () => void;
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

  narrate(text: string) {
    if (!this.enabled || document.hidden || !text) return;
    this.stopVoice();
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      this.unavailable();
      return;
    }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    if (voices.length) { this.speak(text, voices); return; }
    // The native voice list may still be loading when audio is enabled.
    const readVoices = () => {
      this.cancelVoiceWait?.();
      this.speak(text, synth.getVoices());
    };
    const timeout = window.setTimeout(readVoices, 1000);
    synth.addEventListener('voiceschanged', readVoices, { once: true });
    this.cancelVoiceWait = () => {
      window.clearTimeout(timeout);
      synth.removeEventListener('voiceschanged', readVoices);
      this.cancelVoiceWait = undefined;
    };
  }

  private speak(text: string, available: SpeechSynthesisVoice[]) {
    const voices = available.filter(candidate => /^en(?:-|$)/i.test(candidate.lang));
    const female = /\b(female|aria|jenny|michelle|zira|samantha|ava|allison|susan|victoria|karen|moira|kate|sonia)\b/i;
    const selected = voices.find(candidate => female.test(candidate.name) && /^en-US$/i.test(candidate.lang))
      ?? voices.find(candidate => female.test(candidate.name));
    if (!selected) { this.unavailable(); return; }
    const voice = new SpeechSynthesisUtterance(text);
    voice.voice = selected;
    voice.lang = selected.lang;
    voice.rate = .92;
    voice.volume = .9;
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
    this.cancelVoiceWait?.();
    const speech = this.speech;
    this.finishVoice();
    if (speech) window.speechSynthesis.cancel();
  }

  private beginVoice() {
    this.music.volume = .08;
    this.speaking(true);
  }

  private finishVoice() {
    this.speech = undefined;
    this.music.volume = .22;
    this.speaking(false);
  }
}
