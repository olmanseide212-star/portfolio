import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, lerp, computeTilt, computeMagneticOffset, computeScrollMetrics, shouldPlayIntro } from '../motion-math.js';

test('clamp and lerp stay within expected bounds', () => {
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(4, 0, 10), 4);
  assert.equal(lerp(0, 100, 0.25), 25);
});

test('computeTilt maps corners, center, out-of-bounds points and invalid rects safely', () => {
  const rect = { left: 100, top: 200, width: 400, height: 300 };
  const center = computeTilt(300, 350, rect);
  assert.deepEqual(center, { rx: 0, ry: 0, gx: 50, gy: 50, sx: 0, sy: 0, sheen: 50 });

  const topLeft = computeTilt(100, 200, rect);
  assert.equal(topLeft.ry, -9);
  assert.equal(topLeft.rx, 7);
  assert.equal(topLeft.gx, 0);
  assert.equal(topLeft.gy, 0);
  assert.equal(topLeft.sx, 26);
  assert.equal(topLeft.sy, 26);

  const farBottomRight = computeTilt(9999, 9999, rect);
  assert.equal(farBottomRight.ry, 9);
  assert.equal(farBottomRight.rx, -7);
  assert.equal(farBottomRight.gx, 100);
  assert.equal(farBottomRight.gy, 100);

  assert.deepEqual(computeTilt(50, 50, { left: 0, top: 0, width: 0, height: 100 }), center);
});

test('computeMagneticOffset centers at zero and caps displacement', () => {
  const rect = { left: 0, top: 0, width: 100, height: 40 };
  assert.deepEqual(computeMagneticOffset(50, 20, rect), { x: 0, y: 0 });
  const capped = computeMagneticOffset(500, -500, rect, { strength: 0.3, max: 7 });
  assert.deepEqual(capped, { x: 7, y: -7 });
  const subtle = computeMagneticOffset(60, 25, rect, { strength: 0.25, max: 8 });
  assert.deepEqual(subtle, { x: 2.5, y: 1.25 });
  assert.deepEqual(computeMagneticOffset(10, 10, null), { x: 0, y: 0 });
});

test('computeScrollMetrics handles top, middle, bottom and non-scrollable pages without NaN', () => {
  assert.deepEqual(computeScrollMetrics(0, 2000, 1000, 600), { progress: 0, heroRatio: 0 });
  assert.deepEqual(computeScrollMetrics(500, 2000, 1000, 500), { progress: 0.5, heroRatio: 1 });
  assert.deepEqual(computeScrollMetrics(1500, 2000, 1000, 500), { progress: 1, heroRatio: 1 });
  assert.deepEqual(computeScrollMetrics(0, 600, 1000, 0), { progress: 0, heroRatio: 0 });
  assert.deepEqual(computeScrollMetrics(-20, 2000, 1000, 500), { progress: 0, heroRatio: 0 });
});

test('shouldPlayIntro respects reduced-motion, session memory and explicit replay', () => {
  assert.equal(shouldPlayIntro({ reducedMotion: false, seenInSession: false }), true);
  assert.equal(shouldPlayIntro({ reducedMotion: false, seenInSession: true }), false);
  assert.equal(shouldPlayIntro({ reducedMotion: false, seenInSession: true, force: true }), true);
  assert.equal(shouldPlayIntro({ reducedMotion: true, seenInSession: false }), false);
  assert.equal(shouldPlayIntro({ reducedMotion: true, seenInSession: false, force: true }), false);
});
