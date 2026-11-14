/** Wall-clock playback is permitted only inside real ephemeris coverage. */
export class LiveClock {
  followNow = true;
  start = NaN;
  end = NaN;
  simulated = true;
  configure(start: number, end: number, simulated: boolean): void {
    this.start = start; this.end = end; this.simulated = simulated;
  }
  available(now: number): boolean {
    return !this.simulated && Number.isFinite(now) && now >= this.start && now <= this.end;
  }
  sample(now: number): number | null {
    return this.followNow && this.available(now) ? now : null;
  }
}
