/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Path, Point, Segment } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import { estimateCutTime } from './estimate';
import type { Move, Point3 } from './moves';
import { buildMoves } from './moves';
import { blockTime, planTime } from './planner';
import { buildTimeline, profileAt, sampleTimeline } from './timeline';

const seg = (start: Point, end: Point, bulge = 0): Segment => ({ type: bulge ? 'arc' : 'line', start, end, bulge });
const pt = (x: number, y: number): Point => ({ x, y });

const square: Path = [
  seg(pt(1, 1), pt(3, 1)),
  seg(pt(3, 1), pt(3, 3)),
  seg(pt(3, 3), pt(1, 3)),
  seg(pt(1, 3), pt(1, 1)),
];
/** Circle of radius 1 centered at (3, 3), as two semicircles. */
const circle: Path = [seg(pt(4, 3), pt(2, 3), 1), seg(pt(2, 3), pt(4, 3), 1)];

/** 0.75 in deep: one pass at 0.75 per pass, three at 0.25. */
const params = (overrides: Partial<MachineParams> = {}): MachineParams => ({
  ...DEFAULT_PARAMS,
  spoilboardPenetration: 0,
  depthPerPass: 0.75,
  ...overrides,
});

const jobs: [string, Move[], MachineParams][] = [
  ['a square', buildMoves([square], [true], params()), params()],
  ['a circle', buildMoves([circle], [true], params()), params()],
  [
    'a multi-pass job',
    buildMoves([square, circle], [true, true], params({ depthPerPass: 0.25 })),
    params({ depthPerPass: 0.25 }),
  ],
];

const near = (a: Point3, b: Point3, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
};

describe('profileAt', () => {
  // [length, v0, v1, vmax, a]
  const profiles: [string, number, number, number, number, number][] = [
    ['a rest-to-rest trapezoid', 20, 0, 0, 10, 10],
    ['a rest-to-rest triangle', 1, 0, 0, 10, 10],
    ['a trapezoid with entry and exit speeds', 11.5, 2, 4, 10, 10],
    ['a triangle with entry and exit speeds', 1, 2, 3, 10, 10],
    ['a cruise-only block', 5, 10, 10, 10, 10],
    ['a pure deceleration', 4.8, 10, 2, 10, 10],
  ];

  it.each(profiles)('starts at 0 and ends at the length at blockTime for %s', (_, L, v0, v1, vmax, a) => {
    const T = blockTime(L, v0, v1, vmax, a);
    expect(profileAt(L, v0, v1, vmax, a, 0)).toEqual({ distance: 0, speed: v0 });
    const end = profileAt(L, v0, v1, vmax, a, T);
    expect(end.distance).toBeCloseTo(L, 9);
    expect(end.speed).toBeCloseTo(v1, 9);
    expect(profileAt(L, v0, v1, vmax, a, T + 1)).toEqual({ distance: L, speed: v1 });
  });

  it.each(profiles)('is monotonic, within vmax, and consistent with its speed for %s', (_, L, v0, v1, vmax, a) => {
    const T = blockTime(L, v0, v1, vmax, a);
    const steps = 1000;
    const dt = T / steps;
    let prev = profileAt(L, v0, v1, vmax, a, 0);
    for (let k = 1; k <= steps; k++) {
      const cur = profileAt(L, v0, v1, vmax, a, k * dt);
      expect(cur.distance).toBeGreaterThanOrEqual(prev.distance);
      expect(cur.speed).toBeLessThanOrEqual(vmax + 1e-9);
      // Trapezoid rule on the speed matches the distance covered: exact within
      // a phase, off by at most a·dt² where a step straddles a phase change.
      const trapezoid = ((cur.speed + prev.speed) / 2) * dt;
      expect(Math.abs(cur.distance - prev.distance - trapezoid)).toBeLessThanOrEqual(a * dt * dt);
      prev = cur;
    }
  });

  it('reaches the analytic midpoints of a rest-to-rest trapezoid', () => {
    // 10 in/s at 10 in/s²: 1 s and 5 in to accelerate, 1 s cruising 10 in, 1 s and 5 in to stop.
    expect(profileAt(20, 0, 0, 10, 10, 0.5)).toEqual({ distance: 1.25, speed: 5 });
    expect(profileAt(20, 0, 0, 10, 10, 1.5)).toEqual({ distance: 10, speed: 10 });
    const decel = profileAt(20, 0, 0, 10, 10, 2.5);
    expect(decel.distance).toBeCloseTo(18.75, 12);
    expect(decel.speed).toBeCloseTo(5, 12);
  });
});

describe('buildTimeline', () => {
  it.each(jobs)('totals the same as the planner and the estimate for %s', (_, moves, p) => {
    const timeline = buildTimeline(moves, p);
    expect(timeline.total).toBeCloseTo(planTime(moves, p).total, 9);
    expect(timeline.total).toBeCloseTo(estimateCutTime(moves, p).total, 9);
    expect(timeline.blockStart[timeline.blocks.length]).toBe(timeline.total);
  });

  it.each(jobs)('starts each move where the previous moves end for %s', (_, moves, p) => {
    const { moveStart } = buildTimeline(moves, p);
    const { moveTimes } = planTime(moves, p);
    let t = 0;
    moves.forEach((_move, i) => {
      expect(moveStart[i]).toBeCloseTo(t, 9);
      t += moveTimes[i];
    });
  });

  it('gives a zero-length move the start of the move after it', () => {
    const a: Point3 = { x: 0, y: 0, z: 1 };
    const b: Point3 = { x: 5, y: 0, z: 1 };
    const moves: Move[] = [
      { kind: 'rapid', from: a, to: b },
      { kind: 'feed', from: b, to: b },
      { kind: 'rapid', from: b, to: a },
    ];
    const { moveStart, blockStart } = buildTimeline(moves, params());
    expect(moveStart[1]).toBe(blockStart[1]);
    expect(moveStart[2]).toBe(blockStart[1]);
  });
});

describe('sampleTimeline', () => {
  it.each(jobs)("is at each move's start point at its start time for %s", (_, moves, p) => {
    const timeline = buildTimeline(moves, p);
    moves.forEach((move, i) => {
      const s = sampleTimeline(timeline, timeline.moveStart[i]);
      near(s.position, move.from);
      expect(s.moveIndex).toBe(i);
      expect(timeline.blocks[s.block].move).toBe(i);
      expect(s.kind).toBe(move.kind);
    });
  });

  it.each(jobs)('is at rest at home before the start and after the end for %s', (_, moves, p) => {
    const timeline = buildTimeline(moves, p);
    const home = { x: 0, y: 0, z: p.safeHeight };
    for (const t of [-1, 0]) {
      const s = sampleTimeline(timeline, t);
      near(s.position, home);
      expect(s.speed).toBe(0);
      expect(s.moveIndex).toBe(0);
      expect(s.block).toBe(0);
    }
    for (const t of [timeline.total, timeline.total + 1]) {
      const s = sampleTimeline(timeline, t);
      expect(s.position).toEqual(home);
      expect(s.speed).toBe(0);
      expect(s.moveIndex).toBe(moves.length - 1);
      expect(s.block).toBe(timeline.blocks.length - 1);
    }
  });

  it.each(jobs)('moves continuously across block boundaries for %s', (_, moves, p) => {
    const timeline = buildTimeline(moves, p);
    const eps = 1e-9;
    for (let i = 1; i < timeline.blocks.length; i++) {
      const t = timeline.blockStart[i];
      const before = sampleTimeline(timeline, t - eps).position;
      const after = sampleTimeline(timeline, t + eps).position;
      expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(1e-6);
    }
  });

  it.each(jobs)("never exceeds a block's nominal speed for %s", (_, moves, p) => {
    const timeline = buildTimeline(moves, p);
    for (let k = 0; k <= 2000; k++) {
      const t = (timeline.total * k) / 2000;
      const s = sampleTimeline(timeline, t);
      const maxNominal = Math.max(...timeline.blocks.filter((b) => b.move === s.moveIndex).map((b) => b.vNom));
      expect(s.speed).toBeLessThanOrEqual(maxNominal + 1e-9);
    }
  });

  it('slows into a square corner', () => {
    const p = params();
    const timeline = buildTimeline(buildMoves([square], [true], p), p);
    // The first feed move ends at the square's first corner, (3, 1).
    const firstFeed = timeline.moves.findIndex((m) => m.kind === 'feed');
    const corner = timeline.moveStart[firstFeed + 1];
    const mid = (timeline.moveStart[firstFeed] + corner) / 2;
    expect(sampleTimeline(timeline, corner).speed).toBeLessThan(sampleTimeline(timeline, mid).speed);
  });

  it('samples an empty timeline as home, at rest', () => {
    const p = params();
    const timeline = buildTimeline([], p);
    expect(timeline.total).toBe(0);
    for (const t of [-1, 0, 1]) {
      expect(sampleTimeline(timeline, t)).toEqual({
        position: { x: 0, y: 0, z: p.safeHeight },
        moveIndex: -1,
        block: -1,
        kind: null,
        speed: 0,
      });
    }
  });
});
