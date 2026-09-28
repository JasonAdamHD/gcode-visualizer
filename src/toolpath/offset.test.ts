/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Path, Point, Segment } from '../geometry/segment';
import { distance, pathLength } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import {
  compensationRadius,
  defaultCutSide,
  effectiveCutSide,
  offsetPath,
  pathToPolyline,
  polylineToPath,
  sheetBoundsWarning,
  toolpathBounds,
} from './offset';
import { computeToolpath } from './toolpath';

const seg = (start: Point, end: Point, bulge = 0): Segment => ({
  type: bulge ? 'arc' : 'line',
  start,
  end,
  bulge,
});

/** Closed polygon through `points` (no repeated closing point). */
const polygon = (points: [number, number][]): Path =>
  points.map(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return seg({ x, y }, { x: nx, y: ny });
  });

const reversed = (path: Path): Path =>
  path
    .slice()
    .reverse()
    .map((s) => seg(s.end, s.start, -(s.bulge ?? 0)));

/** Signed area (CCW positive) of a closed loop, arcs included. */
const area = (loop: Path) => pathToPolyline(loop, true).area();

const squareCcw = polygon([
  [1, 1],
  [3, 1],
  [3, 3],
  [1, 3],
]);

describe('cut side', () => {
  it('defaults to outside for closed and on for open paths', () => {
    expect(defaultCutSide(true)).toBe('outside');
    expect(defaultCutSide(false)).toBe('on');
  });

  it('maps sides that do not fit the path to its default', () => {
    expect(effectiveCutSide('inside', false)).toBe('on');
    expect(effectiveCutSide('outside', false)).toBe('on');
    expect(effectiveCutSide('left', true)).toBe('outside');
    expect(effectiveCutSide('right', true)).toBe('outside');
    expect(effectiveCutSide('inside', true)).toBe('inside');
    expect(effectiveCutSide('right', false)).toBe('right');
    expect(effectiveCutSide('on', true)).toBe('on');
    expect(effectiveCutSide('on', false)).toBe('on');
  });
});

describe('pathToPolyline / polylineToPath', () => {
  it('round-trips a closed path with arcs without repeating the closing vertex', () => {
    const path: Path = [
      seg({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.3),
      seg({ x: 4, y: 0 }, { x: 4, y: 2 }),
      seg({ x: 4, y: 2 }, { x: 0, y: 0 }, -0.5),
    ];
    const pline = pathToPolyline(path, true);
    expect(pline.isClosed).toBe(true);
    expect(pline.vertexCount).toBe(3);
    expect(pline.at(2).bulge).toBe(-0.5);
    expect(polylineToPath(pline)).toEqual(path);
  });

  it('round-trips an open path with arcs, adding a bulge-0 end vertex', () => {
    const path: Path = [seg({ x: 0, y: 0 }, { x: 2, y: 1 }, 0.4), seg({ x: 2, y: 1 }, { x: 5, y: 1 })];
    const pline = pathToPolyline(path, false);
    expect(pline.isClosed).toBe(false);
    expect(pline.vertexCount).toBe(3);
    expect(pline.at(2)).toMatchObject({ x: 5, y: 1, bulge: 0 });
    expect(polylineToPath(pline)).toEqual(path);
  });
});

describe('offsetPath', () => {
  const r = 0.25;

  it('offsets a square outward with rounded corners, running CW', () => {
    const { loops, warning } = offsetPath(squareCcw, true, 'outside', r);
    expect(warning).toBeUndefined();
    expect(loops).toHaveLength(1);
    const [loop] = loops;
    const arcs = loop.filter((s) => s.bulge);
    expect(loop).toHaveLength(8);
    expect(arcs).toHaveLength(4);
    for (const arc of arcs) expect(arc.bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 9);
    expect(pathLength(loop)).toBeCloseTo(8 + 2 * Math.PI * r, 9);
    expect(area(loop)).toBeLessThan(0);
  });

  it('offsets a square inward with sharp corners, running CCW', () => {
    const { loops } = offsetPath(squareCcw, true, 'inside', r);
    expect(loops).toHaveLength(1);
    const [loop] = loops;
    expect(loop.every((s) => !s.bulge)).toBe(true);
    expect(pathLength(loop)).toBeCloseTo(6, 9);
    expect(area(loop)).toBeCloseTo(1.5 * 1.5, 9);
  });

  it('gives the same result whether the square was drawn CW or CCW', () => {
    const squareCw = reversed(squareCcw);
    expect(area(squareCw)).toBeLessThan(0);
    for (const side of ['outside', 'inside'] as const) {
      const a = offsetPath(squareCcw, true, side, r).loops;
      const b = offsetPath(squareCw, true, side, r).loops;
      expect(b).toHaveLength(a.length);
      expect(pathLength(b[0])).toBeCloseTo(pathLength(a[0]), 9);
      expect(area(b[0])).toBeCloseTo(area(a[0]), 9);
    }
  });

  it('keeps a circle a circle, growing or shrinking its radius', () => {
    const R = 2;
    const circle: Path = [seg({ x: R, y: 0 }, { x: -R, y: 0 }, 1), seg({ x: -R, y: 0 }, { x: R, y: 0 }, 1)];
    for (const [side, expected] of [
      ['outside', R + r],
      ['inside', R - r],
    ] as const) {
      const { loops } = offsetPath(circle, true, side, r);
      expect(loops).toHaveLength(1);
      const [loop] = loops;
      expect(loop.every((s) => Math.abs(s.bulge ?? 0) > 0)).toBe(true);
      for (const s of loop) expect(distance(s.start, { x: 0, y: 0 })).toBeCloseTo(expected, 9);
      expect(pathLength(loop)).toBeCloseTo(2 * Math.PI * expected, 9);
    }
  });

  it('returns no loops and a warning when the bit is too big for an inside cut', () => {
    const { loops, warning } = offsetPath(squareCcw, true, 'inside', 1.5);
    expect(loops).toEqual([]);
    expect(warning).toBe('Bit is too large for this inside cut');
  });

  it('splits a dumbbell into two loops when the bridge is narrower than the bit', () => {
    const dumbbell = polygon([
      [0, 0],
      [4, 0],
      [4, 1.8],
      [6, 1.8],
      [6, 0],
      [10, 0],
      [10, 4],
      [6, 4],
      [6, 2.2],
      [4, 2.2],
      [4, 4],
      [0, 4],
    ]);
    const { loops } = offsetPath(dumbbell, true, 'inside', 0.5);
    expect(loops).toHaveLength(2);
    // Each lobe is its 3x3 inset square plus a small bump where the cutter
    // rounds the reflex corners at the mouth of the bridge.
    for (const loop of loops) {
      expect(pathLength(loop)).toBeGreaterThan(12);
      expect(pathLength(loop)).toBeLessThan(12.1);
      expect(area(loop)).toBeGreaterThan(9);
    }
    expect(pathLength(loops[0])).toBeCloseTo(pathLength(loops[1]), 9);
  });

  it('offsets an open line to +Y for left and -Y for right (Y-up)', () => {
    const lineRight: Path = [seg({ x: 0, y: 0 }, { x: 4, y: 0 })];
    const left = offsetPath(lineRight, false, 'left', r).loops;
    expect(left).toHaveLength(1);
    expect(left[0][0].start).toEqual({ x: 0, y: r });
    expect(left[0][0].end).toEqual({ x: 4, y: r });

    // A right cut is reversed so the kept edge stays on the cutter's right (climb).
    const right = offsetPath(lineRight, false, 'right', r).loops;
    expect(right[0][0].start).toEqual({ x: 4, y: -r });
    expect(right[0][0].end).toEqual({ x: 0, y: -r });
  });

  it('returns the path unchanged for an on-line cut', () => {
    expect(offsetPath(squareCcw, true, 'on', r)).toEqual({ loops: [squareCcw], closed: [true] });
  });

  it('reports per-loop closure when a self-intersecting closed path offsets into open pieces', () => {
    const bowtie = polygon([
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
    ]);
    const { loops, closed } = offsetPath(bowtie, true, 'outside', r);
    expect(closed).toHaveLength(loops.length);
    expect(closed).toContain(false);
    for (const [i, loop] of loops.entries()) {
      const joined = distance(loop[0].start, loop[loop.length - 1].end) < 1e-9;
      expect(joined).toBe(closed[i]);
    }
    const bounds = toolpathBounds(loops, closed);
    expect(bounds).not.toBeNull();
  });
});

describe('compensationRadius', () => {
  const withBit = (diameter: number, shape: MachineParams['bit']['shape'], thickness: number): MachineParams => ({
    ...DEFAULT_PARAMS,
    sheet: { ...DEFAULT_PARAMS.sheet, thickness },
    bit: { diameter, shape, flute: { kind: 'up' }, fluteCount: 2 },
    spoilboardPenetration: 0,
  });

  it('is D/2 for a flat end mill', () => {
    expect(compensationRadius(withBit(0.25, { kind: 'flat' }, 0.75))).toBe(0.125);
  });

  it('is D/2 for a ball end cutting at least D/2 deep, else the crossing circle', () => {
    expect(compensationRadius(withBit(0.5, { kind: 'ball' }, 0.75))).toBe(0.25);
    // depth 0.1 into a 0.5 ball: sqrt(0.1 * 0.4) = 0.2
    expect(compensationRadius(withBit(0.5, { kind: 'ball' }, 0.1))).toBeCloseTo(0.2, 12);
  });

  it('is depth * tan(angle/2) for a shallow V-bit, capped at D/2 when deep', () => {
    const vbit = { kind: 'vbit', includedAngleDeg: 90 } as const;
    expect(compensationRadius(withBit(1, vbit, 0.2))).toBeCloseTo(0.2, 12);
    expect(compensationRadius(withBit(1, vbit, 0.75))).toBe(0.5);
  });

  it('includes spoilboard penetration in the depth', () => {
    const params = { ...withBit(1, { kind: 'vbit', includedAngleDeg: 90 }, 0.2), spoilboardPenetration: 0.05 };
    expect(compensationRadius(params)).toBeCloseTo(0.25, 12);
  });
});

describe('toolpath bounds', () => {
  it('includes arc bulges in the bounds', () => {
    const circle: Path = [seg({ x: 1, y: 0 }, { x: -1, y: 0 }, 1), seg({ x: -1, y: 0 }, { x: 1, y: 0 }, 1)];
    const b = toolpathBounds([circle], [true])!;
    expect(b.minX).toBeCloseTo(-1, 9);
    expect(b.maxX).toBeCloseTo(1, 9);
    expect(b.minY).toBeCloseTo(-1, 9);
    expect(b.maxY).toBeCloseTo(1, 9);
  });

  it('warns only when the toolpath leaves the sheet', () => {
    const sheet = { x: 10, y: 10 };
    expect(sheetBoundsWarning({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, sheet)).toBeUndefined();
    expect(sheetBoundsWarning({ minX: -0.1, minY: 0, maxX: 5, maxY: 5 }, sheet)).toBeDefined();
    expect(sheetBoundsWarning(null, sheet)).toBeUndefined();
  });
});

describe('computeToolpath', () => {
  const params: MachineParams = { ...DEFAULT_PARAMS, sheet: { x: 10, y: 10, thickness: 0.75 } };

  it('returns an empty toolpath with no warnings for empty input', () => {
    const tp = computeToolpath([], false, 'on', params);
    expect(tp).toMatchObject({ loops: [], length: 0, warnings: [] });
  });

  it('offsets by the compensation radius and totals the length', () => {
    const tp = computeToolpath(squareCcw, true, 'outside', params);
    expect(tp.radius).toBe(0.125);
    expect(tp.closed).toEqual([true]);
    expect(tp.length).toBeCloseTo(8 + 2 * Math.PI * 0.125, 9);
    expect(tp.warnings).toEqual([]);
  });

  it('warns when an outside cut crosses the sheet edge', () => {
    const atEdge = polygon([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
    const tp = computeToolpath(atEdge, true, 'outside', params);
    expect(tp.warnings).toEqual(['Toolpath extends past the sheet edge']);
    expect(computeToolpath(atEdge, true, 'inside', params).warnings).toEqual([]);
  });
});
