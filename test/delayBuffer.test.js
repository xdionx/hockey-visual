import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushSnapshot, trimSnapshots, pickSnapshot, clampDelay, delayLabel } from '../src/delayBuffer.js';

const build = () => {
  const l = [];
  pushSnapshot(l, { g: 0 }, 1000);
  pushSnapshot(l, { g: 0 }, 6000); // same as before: stored once
  pushSnapshot(l, { g: 1 }, 11000);
  pushSnapshot(l, { g: 2 }, 16000);
  return l;
};

test('identical refreshes are stored once', () => {
  assert.equal(build().length, 3);
});

test('no delay shows the newest refresh', () => {
  assert.deepEqual(pickSnapshot(build(), 0, 20000).data, { g: 2 });
});

test('a delay shows the refresh that was current at now minus the delay', () => {
  const l = build();
  assert.deepEqual(pickSnapshot(l, 5000, 20000).data, { g: 1 }); // 15000 -> the 11000 refresh
  assert.deepEqual(pickSnapshot(l, 4000, 20000).data, { g: 2 }); // 16000 exactly
  assert.deepEqual(pickSnapshot(l, 10000, 20000).data, { g: 0 }); // 10000 -> still the first
  assert.equal(pickSnapshot(l, 10000, 20000).waitMs, 0);
});

test('not enough history yet: the oldest refresh stays up and says how long until the delay is reached', () => {
  const p = pickSnapshot(build(), 40000, 20000); // target -20000, oldest at 1000
  assert.deepEqual(p.data, { g: 0 });
  assert.equal(p.waitMs, 21000);
  assert.equal(pickSnapshot([], 5000, 1), null);
});

test('trim keeps the refresh in force at the cutoff', () => {
  const l = trimSnapshots(build(), 20000, 6000); // cutoff 14000: keep 11000 (in force) and 16000
  assert.deepEqual(l.map((x) => x.t), [11000, 16000]);
  assert.deepEqual(pickSnapshot(l, 6000, 20000).data, { g: 1 });
});

test('delays are whole seconds from 0 to 180', () => {
  assert.equal(clampDelay('40'), 40);
  assert.equal(clampDelay(null), 0);
  assert.equal(clampDelay(-5), 0);
  assert.equal(clampDelay(999), 180);
  assert.equal(delayLabel(45), '45s');
  assert.equal(delayLabel(90), '1:30');
});
