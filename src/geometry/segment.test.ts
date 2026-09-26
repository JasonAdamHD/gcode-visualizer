/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Path, Point, Segment } from './segment';
import {
  arcFromBulge,
  bulgeFromDrag,
  distance,
  isPathClosed,
  pathLength,
  pathToSvgPath,
  pointsEqual,
  sagittaPoint,
  segmentHandlePoint,
  segmentPathData,
} from './segment';

const line = (start: Point, end: Point, bulge = 0): Segment => ({ type: 'line', start, end, bulge });

const square: Path = [
  line({ x: 0, y: 0 }, { x: 10, y: 0 }),
  line({ x: 10, y: 0 }, { x: 10, y: 10 }),
  line({ x: 10, y: 10 }, { x: 0, y: 10 }),
  line({ x: 0, y: 10 }, { x: 0, y: 0 }),
];

describe('distance / pointsEqual', () => {
  it('computes Euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('treats points within epsilon as equal', () => {
    expect(pointsEqual({ x: 1, y: 1 }, { x: 1 + 1e-9, y: 1 })).toBe(true);
    expect(pointsEqual({ x: 1, y: 1 }, { x: 1.1, y: 1 })).toBe(false);
    expect(pointsEqual({ x: 1, y: 1 }, { x: 1.1, y: 1 }, 0.2)).toBe(true);
  });
});

describe('arcFromBulge', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 0 };

  it('returns null for zero bulge or a degenerate chord', () => {
    expect(arcFromBulge(start, end, 0)).toBeNull();
    expect(arcFromBulge(start, start, 1)).toBeNull();
  });

  it('bulge 1 is a CCW semicircle centered on the chord midpoint', () => {
    const arc = arcFromBulge(start, end, 1)!;
    expect(arc.radius).toBeCloseTo(5);
    expect(arc.theta).toBeCloseTo(Math.PI);
    expect(arc.center.x).toBeCloseTo(5);
    expect(arc.center.y).toBeCloseTo(0);
    expect(arc.sweep).toBe(true);
    expect(arc.largeArc).toBe(false);
  });

  it('negative bulge flips the sweep direction', () => {
    const arc = arcFromBulge(start, end, -1)!;
    expect(arc.theta).toBeCloseTo(-Math.PI);
    expect(arc.sweep).toBe(false);
  });

  it('bulge above 1 produces a large arc', () => {
    expect(arcFromBulge(start, end, 2)!.largeArc).toBe(true);
  });

  it('places the center opposite the bow for a minor arc and on the same side for a major arc', () => {
    // Positive bulge on a +X chord bows toward -Y.
    expect(arcFromBulge(start, end, 0.5)!.center.y).toBeGreaterThan(0);
    expect(arcFromBulge(start, end, 2)!.center.y).toBeLessThan(0);
    expect(arcFromBulge(start, end, -0.5)!.center.y).toBeLessThan(0);
  });

  it('start and end both lie on the resulting circle', () => {
    const arc = arcFromBulge(start, end, 0.4)!;
    expect(distance(arc.center, start)).toBeCloseTo(arc.radius);
    expect(distance(arc.center, end)).toBeCloseTo(arc.radius);
  });
});

describe('sagittaPoint / bulgeFromDrag', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 10, y: 0 };

  it('positive bulge on a +X chord bows toward -Y (clockwise perpendicular)', () => {
    const p = sagittaPoint(start, end, 1);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(-5);
  });

  it('bulgeFromDrag inverts sagittaPoint', () => {
    for (const bulge of [-1.5, -0.3, 0.25, 1, 2]) {
      expect(bulgeFromDrag(start, end, sagittaPoint(start, end, bulge))).toBeCloseTo(bulge);
    }
  });

  it('sagitta point lies on the arc', () => {
    for (const bulge of [-2, -0.6, 0.6, 1, 2]) {
      const arc = arcFromBulge(start, end, bulge)!;
      expect(distance(arc.center, sagittaPoint(start, end, bulge))).toBeCloseTo(arc.radius);
    }
  });

  it('returns 0 for a degenerate chord', () => {
    expect(bulgeFromDrag(start, start, { x: 5, y: 5 })).toBe(0);
  });
});

describe('segmentHandlePoint', () => {
  it('is the chord midpoint for a straight segment', () => {
    expect(segmentHandlePoint(line({ x: 0, y: 0 }, { x: 10, y: 4 }))).toEqual({ x: 5, y: 2 });
  });

  it('is the sagitta point for an arc', () => {
    const p = segmentHandlePoint(line({ x: 0, y: 0 }, { x: 10, y: 0 }, 1));
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(-5);
  });
});

describe('SVG path data', () => {
  it('emits L for lines and A for arcs', () => {
    expect(segmentPathData(line({ x: 0, y: 0 }, { x: 10, y: 0 }))).toBe('L 10 0');
    expect(segmentPathData(line({ x: 0, y: 0 }, { x: 10, y: 0 }, 1))).toBe('A 5 5 0 0 1 10 0');
  });

  it('builds a full path starting with M', () => {
    expect(pathToSvgPath([])).toBe('');
    expect(pathToSvgPath(square.slice(0, 2))).toBe('M 0 0 L 10 0 L 10 10');
  });
});

describe('isPathClosed', () => {
  it('requires at least three segments', () => {
    expect(isPathClosed([line({ x: 0, y: 0 }, { x: 1, y: 0 }), line({ x: 1, y: 0 }, { x: 0, y: 0 })])).toBe(false);
  });

  it('detects a closed loop and rejects an open chain', () => {
    expect(isPathClosed(square)).toBe(true);
    expect(isPathClosed(square.slice(0, 3))).toBe(false);
  });
});

describe('pathLength', () => {
  it('sums straight segments', () => {
    expect(pathLength(square)).toBeCloseTo(40);
  });

  it('uses arc length for bulged segments', () => {
    expect(pathLength([line({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)])).toBeCloseTo(5 * Math.PI);
  });
});
