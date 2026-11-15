import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Frame } from '../src/data';
import {
  headingFromDirection,
  normalizeAz,
  polarPoint,
  relativeBearing,
  trueHeading,
} from '../demo/ui/compassMath';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  buildVisibilityRuns,
  clampRange,
  computeTicks,
  formatDuration,
  formatTickLabel,
  medianSampleInterval,
  panRange,
  ratioFor,
  stepTime,
  timeAtRatio,
  zoomRange,
} from '../demo/ui/timelineMath';

const START = Date.UTC(2026, 10, 14);

function frame(hour: number, sun: boolean, earth: boolean): Frame {
  return {
    timestamp_utc: new Date(START + hour * HOUR_MS).toISOString(),
    sun: { azimuth_deg: 0, elevation_deg: 10 },
    earth: { azimuth_deg: 90, elevation_deg: 10 },
    conditions: { sun_visible: sun, earth_visible: earth, co_visibility: sun && earth },
  };
}

test('compass headings map scene east and fall back to camera up when looking straight down', () => {
  assert.equal(headingFromDirection(0, -1), 0);
  assert.equal(headingFromDirection(1, 0), 90);
  assert.equal(headingFromDirection(0, 1), 180);
  assert.equal(headingFromDirection(-1, 0), 270);
  assert.equal(headingFromDirection(0, -1, 0, -1), 0);
  assert.equal(headingFromDirection(0, 0, 0, 0), 0);
  assert.equal(normalizeAz(-10), 350);
  assert.equal(relativeBearing(10, 350), 20);
  assert.equal(trueHeading(100, 12), 88);
});

test('polar points start at north and rotate clockwise', () => {
  const north = polarPoint(10, 0);
  const east = polarPoint(10, 90);
  assert.ok(Math.abs(north.x) < 1e-12);
  assert.ok(Math.abs(north.y + 10) < 1e-12);
  assert.ok(Math.abs(east.x - 10) < 1e-12);
  assert.ok(Math.abs(east.y) < 1e-12);
});

test('visibility runs merge identical adjacent backend samples', () => {
  const runs = buildVisibilityRuns([frame(0, true, false), frame(1, true, false), frame(2, false, true), frame(3, false, true)]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0], { start: START, end: START + 2 * HOUR_MS, sun: true, earth: false, co: false });
  assert.deepEqual(runs[1], { start: START + 2 * HOUR_MS, end: START + 3 * HOUR_MS, sun: false, earth: true, co: false });
  assert.deepEqual(buildVisibilityRuns([frame(0, true, true), frame(1, true, true)])[0].co, true);
});

test('ticks adapt to width and labels stay deterministic in UTC', () => {
  const ticks = computeTicks(START, START + DAY_MS, 800);
  assert.equal(ticks.step, 6 * HOUR_MS);
  assert.ok(ticks.major.length >= 4);
  assert.ok(ticks.minor.length > ticks.major.length);
  assert.ok(ticks.major.every(tick => tick.ratio >= 0 && tick.ratio <= 1));
  assert.match(formatTickLabel(START + 12 * HOUR_MS, 6 * HOUR_MS), /12:00 UTC$/);
  assert.equal(formatTickLabel(START + 12 * HOUR_MS, DAY_MS), '14 Nov · 12:00');
  assert.equal(formatTickLabel(START, 7 * DAY_MS), '14 Nov 2026');
});

test('time ratios clamp to the visible interval', () => {
  assert.equal(ratioFor(START + 6 * HOUR_MS, START, START + 12 * HOUR_MS), 0.5);
  assert.equal(ratioFor(START - 1, START, START + 12 * HOUR_MS), 0);
  assert.equal(ratioFor(START + 13 * HOUR_MS, START, START + 12 * HOUR_MS), 1);
  assert.equal(timeAtRatio(START, START + 12 * HOUR_MS, 0.25), START + 3 * HOUR_MS);
});

test('zoom and pan keep the view inside the full ephemeris', () => {
  const fullStart = START;
  const fullEnd = START + DAY_MS;
  assert.deepEqual(zoomRange(fullStart, fullEnd, fullStart, fullEnd, 0.5, 0.5, HOUR_MS), {
    start: fullStart + 6 * HOUR_MS,
    end: fullStart + 18 * HOUR_MS,
  });
  assert.deepEqual(zoomRange(fullStart, fullEnd, fullStart, fullEnd, 0, 0.5, HOUR_MS), {
    start: fullStart,
    end: fullStart + 12 * HOUR_MS,
  });
  assert.deepEqual(zoomRange(fullStart, fullEnd, fullStart, fullEnd, 0.5, 4, HOUR_MS), {
    start: fullStart,
    end: fullEnd,
  });
  assert.deepEqual(panRange(fullStart + 6 * HOUR_MS, fullStart + 18 * HOUR_MS, HOUR_MS, fullStart, fullEnd), {
    start: fullStart + 7 * HOUR_MS,
    end: fullStart + 19 * HOUR_MS,
  });
  assert.deepEqual(panRange(fullStart + 6 * HOUR_MS, fullStart + 18 * HOUR_MS, -100 * HOUR_MS, fullStart, fullEnd), {
    start: fullStart,
    end: fullStart + 12 * HOUR_MS,
  });
  assert.deepEqual(clampRange(fullStart + 20 * HOUR_MS, fullStart + 32 * HOUR_MS, fullStart, fullEnd), {
    start: fullStart + 12 * HOUR_MS,
    end: fullEnd,
  });
});

test('sample stepping uses the median cadence and stops at the edges', () => {
  const frames = [frame(0, true, true), frame(2, true, true), frame(3, false, true), frame(5, false, true)];
  const interval = medianSampleInterval(frames);
  assert.equal(interval, 2 * HOUR_MS);
  assert.equal(medianSampleInterval([]), HOUR_MS);
  assert.equal(stepTime(START + 5 * HOUR_MS, 1, START, START + 6 * HOUR_MS, interval), START + 6 * HOUR_MS);
  assert.equal(stepTime(START, -1, START, START + 6 * HOUR_MS, interval), START);
  assert.equal(formatDuration(30 * MINUTE_MS), '30 min');
  assert.equal(formatDuration(2 * HOUR_MS), '2.0 h');
  assert.equal(formatDuration(3 * DAY_MS), '3.0 d');
});
