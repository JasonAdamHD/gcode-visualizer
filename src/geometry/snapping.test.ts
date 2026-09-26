/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Path } from './segment';
import { constrainToAxis, findSnapPoint, niceGridSpacing, snapToGrid, snapToNothing } from './snapping';

describe('niceGridSpacing', () => {
  it('rounds to 1/2/5 x 10^n based on the smaller sheet dimension', () => {
    expect(niceGridSpacing(100, 200)).toBe(5);
    expect(niceGridSpacing(48, 96)).toBe(2);
    expect(niceGridSpacing(20, 20)).toBe(1);
    expect(niceGridSpacing(2000, 1000)).toBe(50);
  });

  it('honors targetDivisions', () => {
    expect(niceGridSpacing(100, 100, 10)).toBe(10);
  });
});

describe('snapToGrid', () => {
  it('rounds each coordinate to the nearest grid line', () => {
    expect(snapToGrid({ x: 7.4, y: 12.6 }, 5)).toEqual({ x: 5, y: 15 });
  });
});

describe('findSnapPoint', () => {
  const path: Path = [{ type: 'line', start: { x: 0, y: 0 }, end: { x: 10.3, y: 0.2 }, bulge: 0 }];

  it('prefers an existing endpoint over the grid', () => {
    const result = findSnapPoint({ x: 10.1, y: 0.1 }, path, 1, 0.5);
    expect(result).toEqual({ point: { x: 10.3, y: 0.2 }, snapped: true, type: 'endpoint' });
  });

  it('snaps to the path start as well as segment ends', () => {
    expect(findSnapPoint({ x: 0.2, y: 0.2 }, path, 1, 0.5).point).toEqual({ x: 0, y: 0 });
  });

  it('falls back to the grid when no endpoint is in tolerance', () => {
    const result = findSnapPoint({ x: 4.9, y: 5.1 }, path, 1, 0.5);
    expect(result).toEqual({ point: { x: 5, y: 5 }, snapped: true, type: 'grid' });
  });

  it('snaps to the grid on an empty path', () => {
    expect(findSnapPoint({ x: 2.1, y: 2.9 }, [], 1, 0.5).type).toBe('grid');
  });

  it('returns the raw candidate when nothing is within tolerance', () => {
    const candidate = { x: 4.5, y: 5.5 };
    expect(findSnapPoint(candidate, path, 1, 0.1)).toEqual({ point: candidate, snapped: false, type: 'none' });
  });
});

describe('constrainToAxis', () => {
  const reference = { x: 1, y: 1 };

  it('locks to horizontal when the X delta dominates', () => {
    expect(constrainToAxis(reference, { x: 8, y: 3 })).toEqual({ point: { x: 8, y: 1 }, snapped: true, type: 'axis' });
  });

  it('locks to vertical when the Y delta dominates', () => {
    expect(constrainToAxis(reference, { x: 2, y: -6 })).toEqual({ point: { x: 1, y: -6 }, snapped: true, type: 'axis' });
  });
});

describe('snapToNothing', () => {
  it('returns a copy of the candidate, unsnapped', () => {
    const candidate = { x: 3.3, y: 4.4 };
    const result = snapToNothing(candidate);
    expect(result).toEqual({ point: candidate, snapped: false, type: 'no-snap' });
    expect(result.point).not.toBe(candidate);
  });
});
