import type { Conditions, Frame } from './data.js';

export const HOUR = 3_600_000;
export const CONDITION_KEYS = ['sun_visible', 'earth_visible', 'co_visibility'] as const;
export type ConditionKey = keyof Conditions;
export type TimeRange = { start: number; end: number };

export function coverage(frames: readonly Frame[]): TimeRange {
  return { start: Date.parse(frames[0]?.timestamp_utc), end: Date.parse(frames.at(-1)?.timestamp_utc ?? '') };
}

export function visibilitySummary(frames: readonly Frame[], range = coverage(frames)) {
  const windows: { condition: ConditionKey; start: number; end: number; hours: number }[] = [];
  const totals = { sun_visible: 0, earth_visible: 0, co_visibility: 0 };
  for (const key of CONDITION_KEYS) {
    let last: typeof windows[number] | undefined;
    for (let i = 0; i < frames.length - 1; i++) {
      const start = Math.max(range.start, Date.parse(frames[i].timestamp_utc));
      const end = Math.min(range.end, Date.parse(frames[i + 1].timestamp_utc));
      if (end <= start || !frames[i].conditions[key]) continue;
      if (last?.end === start) { last.end = end; last.hours = (end - last.start) / HOUR; }
      else { last = { condition: key, start, end, hours: (end - start) / HOUR }; windows.push(last); }
      totals[key] += (end - start) / HOUR;
    }
  }
  return { totals, windows };
}
