/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { ViewBox } from './viewport';
import { fitBox, panBy, viewBoxAttr, zoomAt, zoomLimits } from './viewport';

const home: ViewBox = { x: -4, y: -4, w: 104, h: 56 };
const limits = zoomLimits(home);

/** Where a user-space point sits within the view, as fractions of its size. */
const fraction = (vb: ViewBox, p: { x: number; y: number }) => ({ fx: (p.x - vb.x) / vb.w, fy: (p.y - vb.y) / vb.h });

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed while zooming in and out', () => {
    const cursor = { x: 30, y: 12 };
    for (const factor of [0.5, 0.8, 1.25, 2]) {
      const vb = zoomAt(home, cursor, factor, limits);
      expect(vb.w).toBeCloseTo(home.w * factor, 9);
      expect(vb.h / vb.w).toBeCloseTo(home.h / home.w, 12);
      const before = fraction(home, cursor);
      const after = fraction(vb, cursor);
      expect(after.fx).toBeCloseTo(before.fx, 12);
      expect(after.fy).toBeCloseTo(before.fy, 12);
    }
  });

  it('clamps to the zoom limits, still about the cursor', () => {
    const cursor = { x: 80, y: 40 };
    const close = zoomAt(home, cursor, 1e-6, limits);
    expect(close.w).toBeCloseTo(limits.minW, 12);
    expect(fraction(close, cursor).fx).toBeCloseTo(fraction(home, cursor).fx, 12);
    expect(zoomAt(home, cursor, 1e6, limits).w).toBeCloseTo(limits.maxW, 9);
  });

  it('round-trips: zooming in then out by the inverse returns the view', () => {
    const cursor = { x: 10, y: 50 };
    const back = zoomAt(zoomAt(home, cursor, 0.4, limits), cursor, 2.5, limits);
    expect(back.x).toBeCloseTo(home.x, 9);
    expect(back.y).toBeCloseTo(home.y, 9);
    expect(back.w).toBeCloseTo(home.w, 9);
  });
});

describe('panBy', () => {
  it('moves the view opposite to the drag, in user units, keeping its size', () => {
    expect(panBy(home, 10, -5)).toEqual({ x: -14, y: 1, w: 104, h: 56 });
  });
});

describe('fitBox', () => {
  const bounds = { minX: 0, minY: 0, maxX: 96, maxY: 48 };

  it('grows the bounds by the margin', () => {
    expect(fitBox(bounds, 4)).toEqual(home);
  });

  it('widens a tall result to the aspect, centered', () => {
    const vb = fitBox(bounds, 4, 3);
    expect(vb.w / vb.h).toBeCloseTo(3, 12);
    expect(vb.h).toBeCloseTo(56, 12);
    expect(vb.x + vb.w / 2).toBeCloseTo(48, 12);
    expect(vb.y + vb.h / 2).toBeCloseTo(24, 12);
  });

  it('heightens a wide result to the aspect, centered', () => {
    const vb = fitBox(bounds, 4, 1);
    expect(vb.w).toBeCloseTo(104, 12);
    expect(vb.h).toBeCloseTo(104, 12);
    expect(vb.y + vb.h / 2).toBeCloseTo(24, 12);
  });
});

describe('viewBoxAttr', () => {
  it('formats x y w h', () => {
    expect(viewBoxAttr(home)).toBe('-4 -4 104 56');
  });
});
