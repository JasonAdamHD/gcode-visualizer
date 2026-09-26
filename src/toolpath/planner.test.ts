/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import type { Move, Point3 } from './moves';
import { arcChordCount, blockTime, junctionSpeed, linearize, planTime } from './planner';

/** Inch params with feed 600 in/min (10 in/s) and acceleration 10 in/s². */
const params = (overrides: Partial<MachineParams> = {}): MachineParams => ({
  ...DEFAULT_PARAMS,
  feedRate: 600,
  acceleration: 10,
  junctionDeviation: 0.01,
  ...overrides,
});

const p = (x: number, y: number, z = 0): Point3 => ({ x, y, z });
const feed = (from: Point3, to: Point3, bulge?: number): Move =>
  bulge ? { kind: 'feed', from, to, bulge } : { kind: 'feed', from, to };

describe('planTime: straight lines', () => {
  it('times a rest-to-rest line that reaches cruise as L/v + v/a', () => {
    const { total, moveTimes } = planTime([feed(p(0, 0), p(20, 0))], params());
    expect(total).toBeCloseTo(20 / 10 + 10 / 10, 12);
    expect(moveTimes).toEqual([total]);
  });

  it('times a short line that never reaches cruise as 2·sqrt(L/a)', () => {
    expect(planTime([feed(p(0, 0), p(1, 0))], params()).total).toBeCloseTo(2 * Math.sqrt(1 / 10), 12);
  });

  it('times a line split into two collinear blocks the same as the whole line', () => {
    const whole = planTime([feed(p(0, 0), p(7, 0))], params()).total;
    const split = planTime([feed(p(0, 0), p(3, 0)), feed(p(3, 0), p(7, 0))], params()).total;
    expect(split).toBeCloseTo(whole, 12);
  });

  it('stops fully at a 90° corner when the junction deviation is 0', () => {
    const corner = [feed(p(0, 0), p(5, 0)), feed(p(5, 0), p(5, 3))];
    const t = planTime(corner, params({ junctionDeviation: 0 })).total;
    const separate =
      planTime([feed(p(0, 0), p(5, 0))], params()).total + planTime([feed(p(5, 0), p(5, 3))], params()).total;
    expect(t).toBeCloseTo(separate, 12);
  });

  it('corners faster with a larger junction deviation', () => {
    const corner = [feed(p(0, 0), p(5, 0)), feed(p(5, 0), p(5, 3))];
    const stop = planTime(corner, params({ junctionDeviation: 0 })).total;
    const tight = planTime(corner, params({ junctionDeviation: 0.001 })).total;
    const loose = planTime(corner, params({ junctionDeviation: 0.05 })).total;
    expect(tight).toBeLessThan(stop);
    expect(loose).toBeLessThan(tight);
  });

  it('limits a Z rapid to the Z rapid rate and an XY rapid to the XY rate', () => {
    const fast = params({ acceleration: 1e12 });
    const z = planTime([{ kind: 'rapid', from: p(0, 0, 1), to: p(0, 0, 0) }], fast).total;
    const xy = planTime([{ kind: 'rapid', from: p(0, 0, 1), to: p(10, 0, 1) }], fast).total;
    expect(z).toBeCloseTo(1 / (fast.rapidRateZ / 60), 5);
    expect(xy).toBeCloseTo(10 / (fast.rapidRateXY / 60), 5);
  });
});

describe('junctionSpeed', () => {
  it('matches the GRBL formula at a 90° corner', () => {
    // cosθ = 0, so s = sqrt(0.5) and v² = 10 · 0.01 · s / (1 − s) ≈ 0.2414.
    expect(junctionSpeed(p(1, 0), p(0, 1), 10, 0.01)).toBeCloseTo(Math.sqrt(0.24142135623730953), 12);
  });

  it('is 0 for a reversal and unlimited straight ahead', () => {
    expect(junctionSpeed(p(1, 0), p(-1, 0), 10, 0.01)).toBe(0);
    expect(junctionSpeed(p(1, 0), p(1, 0), 10, 0.01)).toBe(Infinity);
  });
});

describe('blockTime', () => {
  it('handles non-zero entry and exit speeds', () => {
    // 2 -> 10 in/s over 4.8 (0.8 s), cruise 2.5 (0.25 s), 10 -> 4 over 4.2 (0.6 s).
    expect(blockTime(11.5, 2, 4, 10, 10)).toBeCloseTo(0.8 + 0.25 + 0.6, 12);
  });
});

describe('arcs', () => {
  const semicircle = (r: number): Move => feed(p(r, 0), p(-r, 0), 1);

  it('splits arcs into chords within the tolerance', () => {
    expect(arcChordCount(1, Math.PI, 2)).toBe(1);
    const n = arcChordCount(1, Math.PI, 0.001);
    // The sagitta of one chord must not exceed the tolerance.
    expect(1 - Math.cos(Math.PI / n / 2)).toBeLessThanOrEqual(0.001 + 1e-15);
    expect(linearize([semicircle(1)], params())).toHaveLength(arcChordCount(1, Math.PI, 0.002 / 25.4));
  });

  it('takes at least L/v, approaching it as acceleration grows', () => {
    const L = Math.PI * 2;
    const v = 10;
    expect(planTime([semicircle(2)], params()).total).toBeGreaterThan(L / v);
    expect(planTime([semicircle(2)], params({ acceleration: 1e9 })).total).toBeCloseTo(L / v, 3);
  });

  it('takes longer around a tighter arc of the same length', () => {
    // Both arcs are π long: a semicircle of radius 1 vs a quarter circle of radius 2.
    const slow = params({ acceleration: 2, junctionDeviation: 0.0001 }); // small enough that chord junctions bind
    const tight = planTime([semicircle(1)], slow).total;
    const wide = planTime([feed(p(2, 0), p(0, 2), Math.tan(Math.PI / 8))], slow).total;
    expect(tight).toBeGreaterThan(wide);
  });
});
