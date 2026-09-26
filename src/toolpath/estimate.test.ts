/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Path, Point, Segment } from '../geometry/segment';
import { pathLength } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import { estimateCutTime, formatDuration } from './estimate';
import { PLUNGE_CLEARANCE_IN, buildMoves } from './moves';

const seg = (start: Point, end: Point, bulge = 0): Segment => ({ type: bulge ? 'arc' : 'line', start, end, bulge });

/** 2×2 square at (1,1) with one bowed edge. */
const loop: Path = [
  seg({ x: 1, y: 1 }, { x: 3, y: 1 }),
  seg({ x: 3, y: 1 }, { x: 3, y: 3 }, 0.4),
  seg({ x: 3, y: 3 }, { x: 1, y: 3 }),
  seg({ x: 1, y: 3 }, { x: 1, y: 1 }),
];

/** 0.75 in deep in 3 passes. */
const params: MachineParams = { ...DEFAULT_PARAMS, spoilboardPenetration: 0, depthPerPass: 0.25 };

describe('estimateCutTime', () => {
  it('converges to the analytic sum with huge acceleration and junction deviation', () => {
    const fast = { ...params, acceleration: 1e10, junctionDeviation: 1e3 };
    const est = estimateCutTime(buildMoves([loop], [true], fast), fast);
    const seconds = (length: number, ratePerMin: number) => (length / ratePerMin) * 60;
    const safe = fast.safeHeight;
    const c = PLUNGE_CLEARANCE_IN;
    const L = pathLength(loop);
    const cutting = seconds(3 * L, fast.feedRate);
    // Closed loop: one clearance-to-surface plunge, then straight down through all passes.
    const plunging = seconds(c + 0.75, fast.plungeRate);
    const rapids = seconds(2 * Math.hypot(1, 1), fast.rapidRateXY) + seconds(safe - c, fast.rapidRateZ);
    const retracts = seconds(safe + 0.75, fast.rapidRateZ);
    expect(est.cutting).toBeCloseTo(cutting, 3);
    expect(est.plunging).toBeCloseTo(plunging, 3);
    expect(est.rapids).toBeCloseTo(rapids, 3);
    expect(est.retracts).toBeCloseTo(retracts, 3);
    expect(est.total).toBeCloseTo(cutting + plunging + rapids + retracts, 3);
    expect(est.cornerLoss).toBeCloseTo(0, 3);
    expect(est.cutLength).toBeCloseTo(3 * L, 9);
    expect(est.passes).toBe(3);
  });

  it('breaks the total into buckets that sum to it, with a positive corner loss', () => {
    const est = estimateCutTime(buildMoves([loop], [true], params), params);
    expect(est.cutting + est.plunging + est.rapids + est.retracts).toBeCloseTo(est.total, 9);
    expect(est.cornerLoss).toBeGreaterThan(0);
    expect(est.cornerLoss).toBeLessThan(est.total);
  });

  it('takes less time with fewer passes', () => {
    const three = estimateCutTime(buildMoves([loop], [true], params), params);
    const onePass = { ...params, depthPerPass: 1 };
    const one = estimateCutTime(buildMoves([loop], [true], onePass), onePass);
    expect(one.passes).toBe(1);
    expect(one.total).toBeLessThan(three.total);
  });

  it('loses more time to corners on a square than on a circle of equal length', () => {
    const side = 2;
    const r = (4 * side) / (2 * Math.PI);
    const circle: Path = [seg({ x: 5 + r, y: 5 }, { x: 5 - r, y: 5 }, 1), seg({ x: 5 - r, y: 5 }, { x: 5 + r, y: 5 }, 1)];
    const squareLoop: Path = [
      seg({ x: 1, y: 1 }, { x: 3, y: 1 }),
      seg({ x: 3, y: 1 }, { x: 3, y: 3 }),
      seg({ x: 3, y: 3 }, { x: 1, y: 3 }),
      seg({ x: 1, y: 3 }, { x: 1, y: 1 }),
    ];
    const cut = (path: Path) => {
      const moves = buildMoves([path], [true], params).filter((m) => m.kind === 'feed');
      return estimateCutTime(moves, params);
    };
    expect(cut(squareLoop).cornerLoss).toBeGreaterThan(cut(circle).cornerLoss);
  });

  it('is all zero for no moves', () => {
    expect(estimateCutTime([], params)).toEqual({
      total: 0,
      cutting: 0,
      plunging: 0,
      rapids: 0,
      retracts: 0,
      cornerLoss: 0,
      passes: 0,
      cutLength: 0,
    });
  });
});

describe('formatDuration', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3725)).toBe('1h 02m 05s');
    expect(formatDuration(192)).toBe('3m 12s');
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59.6)).toBe('1m 00s');
  });
});
