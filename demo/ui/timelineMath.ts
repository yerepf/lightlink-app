import type { Frame } from '../../src/data.js';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface VisibilityRun {
  start: number;
  end: number;
  sun: boolean;
  earth: boolean;
  co: boolean;
}

export interface TimelineTick {
  time: number;
  ratio: number;
  major: boolean;
}

export interface TickSet {
  major: TimelineTick[];
  minor: TimelineTick[];
  step: number;
  span: number;
}

const STEP_CANDIDATES = [
  MINUTE_MS,
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
  2 * DAY_MS,
  7 * DAY_MS,
  14 * DAY_MS,
  30 * DAY_MS,
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

export function formatUtcClock(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function formatUtcDate(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]}`;
}

export function formatTickLabel(ms: number, span: number): string {
  if (span <= 12 * HOUR_MS) return `${formatUtcClock(ms)} UTC`;
  if (span <= 3 * DAY_MS) return `${formatUtcDate(ms)} · ${formatUtcClock(ms)}`;
  const date = new Date(ms);
  return `${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function buildVisibilityRuns(frames: readonly Frame[]): VisibilityRun[] {
  const runs: VisibilityRun[] = [];
  for (let index = 0; index < frames.length - 1; index++) {
    const start = Date.parse(frames[index].timestamp_utc);
    const end = Date.parse(frames[index + 1].timestamp_utc);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const { sun_visible: sun, earth_visible: earth } = frames[index].conditions;
    const previous = runs[runs.length - 1];
    if (previous && previous.end === start && previous.sun === sun && previous.earth === earth) {
      previous.end = end;
      previous.co = sun && earth;
    } else {
      runs.push({ start, end, sun, earth, co: sun && earth });
    }
  }
  return runs;
}

export function computeTicks(start: number, end: number, width: number): TickSet {
  const span = Math.max(1, end - start);
  const maxMajors = Math.max(2, Math.floor(Math.max(1, width) / 110));
  let step = STEP_CANDIDATES[STEP_CANDIDATES.length - 1];
  for (const candidate of STEP_CANDIDATES) {
    if (span / candidate <= maxMajors) {
      step = candidate;
      break;
    }
  }
  const minorStep = step / 5;
  const major: TimelineTick[] = [];
  const minor: TimelineTick[] = [];

  const first = Math.ceil(start / minorStep) * minorStep;
  for (let time = first; time <= end + 0.5; time += minorStep) {
    const ratio = (time - start) / span;
    if (ratio < 0 || ratio > 1) continue;
    const tick = { time, ratio, major: Math.abs(time / step - Math.round(time / step)) < 0.000001 };
    if (tick.major) major.push(tick);
    else minor.push(tick);
  }

  return { major, minor, step, span };
}

export function ratioFor(time: number, start: number, end: number): number {
  if (!Number.isFinite(time) || end <= start) return 0;
  return Math.min(1, Math.max(0, (time - start) / (end - start)));
}

export function timeAtRatio(start: number, end: number, ratio: number): number {
  return start + (end - start) * Math.min(1, Math.max(0, ratio));
}

export function clampRange(start: number, end: number, fullStart: number, fullEnd: number): { start: number; end: number } {
  const fullSpan = Math.max(1, fullEnd - fullStart);
  const span = Math.min(fullSpan, Math.max(1, end - start));
  const nextStart = Math.min(fullEnd - span, Math.max(fullStart, start));
  return { start: nextStart, end: nextStart + span };
}

export function zoomRange(
  start: number,
  end: number,
  fullStart: number,
  fullEnd: number,
  anchorRatio: number,
  factor: number,
  minSpan = HOUR_MS,
): { start: number; end: number } {
  const fullSpan = Math.max(1, fullEnd - fullStart);
  const span = Math.max(1, end - start);
  const nextSpan = Math.min(fullSpan, Math.max(Math.min(minSpan, fullSpan), span * factor));
  const anchor = start + span * Math.min(1, Math.max(0, anchorRatio));
  const nextStart = anchor - nextSpan * anchorRatio;
  return clampRange(nextStart, nextStart + nextSpan, fullStart, fullEnd);
}

export function panRange(start: number, end: number, deltaMs: number, fullStart: number, fullEnd: number): { start: number; end: number } {
  return clampRange(start + deltaMs, end + deltaMs, fullStart, fullEnd);
}

export function medianSampleInterval(frames: readonly Frame[]): number {
  if (frames.length < 2) return HOUR_MS;
  const intervals: number[] = [];
  for (let index = 1; index < frames.length; index++) {
    const interval = Date.parse(frames[index].timestamp_utc) - Date.parse(frames[index - 1].timestamp_utc);
    if (Number.isFinite(interval) && interval > 0) intervals.push(interval);
  }
  if (!intervals.length) return HOUR_MS;
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)];
}

export function stepTime(current: number, direction: -1 | 1, start: number, end: number, interval: number): number {
  return Math.min(end, Math.max(start, current + direction * interval));
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 min';
  const hours = ms / HOUR_MS;
  if (hours < 1) return `${Math.round(ms / MINUTE_MS)} min`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${(ms / DAY_MS).toFixed(1)} d`;
}
