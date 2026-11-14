import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveClock } from '../src/LiveClock';

test('live clock preserves seconds and rejects extrapolation, invalid clocks and simulated data', () => {
  const clock = new LiveClock();
  clock.configure(1000, 10000, false);
  assert.equal(clock.sample(2345), 2345);
  assert.equal(clock.sample(1000), 1000);
  assert.equal(clock.sample(10000), 10000);
  for (const time of [999, 10001, NaN, Infinity]) assert.equal(clock.sample(time), null);
  clock.configure(1000, 10000, true);
  assert.equal(clock.sample(2345), null);
});
test('manual exploration survives site changes; live resumes from actual wall clock, not elapsed ticks', () => {
  const clock = new LiveClock();
  clock.configure(0, 10000, false);
  clock.followNow = false;
  clock.configure(0, 20000, false);
  assert.equal(clock.sample(12345), null);
  clock.followNow = true;
  assert.equal(clock.sample(12345), 12345);
  assert.equal(clock.sample(19876), 19876);
  assert.equal(clock.sample(20001), null);
});
