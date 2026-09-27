/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  MAX_SPEED,
  MIN_SPEED,
  PLAYBACK_SPEEDS,
  SPEED_STEP_OCTAVES,
  clampSpeed,
  formatSpeed,
  speedFromSlider,
} from './playbackSpeed';

describe('speedFromSlider', () => {
  it('snaps to a nearby detent', () => {
    expect(speedFromSlider(Math.log2(1.03))).toBe(1);
    expect(speedFromSlider(Math.log2(48))).toBe(50);
    expect(speedFromSlider(0)).toBe(1);
  });

  it('rounds between detents to two significant digits', () => {
    expect(speedFromSlider(Math.log2(3.3))).toBe(3.3);
    expect(speedFromSlider(Math.log2(31.7))).toBe(32);
  });

  it('lets one keyboard step move off every detent, both ways', () => {
    for (const d of PLAYBACK_SPEEDS) {
      if (d < MAX_SPEED) expect(speedFromSlider(Math.log2(d) + SPEED_STEP_OCTAVES)).toBeGreaterThan(d);
      if (d > MIN_SPEED) expect(speedFromSlider(Math.log2(d) - SPEED_STEP_OCTAVES)).toBeLessThan(d);
    }
  });

  it('walks the whole range by keyboard steps without getting stuck', () => {
    for (const [start, end, dir] of [
      [MIN_SPEED, MAX_SPEED, 1],
      [MAX_SPEED, MIN_SPEED, -1],
    ] as const) {
      let speed: number = start;
      let steps = 0;
      while (speed !== end) {
        const next = speedFromSlider(Math.log2(speed) + dir * SPEED_STEP_OCTAVES);
        expect(dir * (next - speed)).toBeGreaterThan(0);
        speed = next;
        expect(++steps).toBeLessThan(200);
      }
    }
  });

  it('clamps to the range', () => {
    expect(speedFromSlider(-10)).toBe(MIN_SPEED);
    expect(speedFromSlider(20)).toBe(MAX_SPEED);
    expect(clampSpeed(1000)).toBe(MAX_SPEED);
    expect(clampSpeed(0.01)).toBe(MIN_SPEED);
  });
});

describe('formatSpeed', () => {
  it('drops trailing zeros', () => {
    expect(formatSpeed(0.25)).toBe('0.25');
    expect(formatSpeed(1)).toBe('1');
    expect(formatSpeed(1.5)).toBe('1.5');
    expect(formatSpeed(12)).toBe('12');
    expect(formatSpeed(350)).toBe('350');
  });
});
