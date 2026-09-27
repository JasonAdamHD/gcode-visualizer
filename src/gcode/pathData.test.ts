/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Move, Point3 } from '../toolpath/moves';
import { moveBounds, moveKindPaths } from './pathData';

const p = (x: number, y: number, z = 0): Point3 => ({ x, y, z });

describe('moveKindPaths', () => {
  it('chains continuous moves of a kind into one subpath', () => {
    const moves: Move[] = [
      { kind: 'feed', from: p(0, 0), to: p(10, 0) },
      { kind: 'feed', from: p(10, 0), to: p(10, 10) },
    ];
    expect(moveKindPaths(moves).feed).toBe('M 0 0 L 10 0 L 10 10');
  });

  it('starts a new subpath where a kind resumes elsewhere', () => {
    const moves: Move[] = [
      { kind: 'feed', from: p(0, 0), to: p(1, 0) },
      { kind: 'rapid', from: p(1, 0, 1), to: p(5, 5, 1) },
      { kind: 'feed', from: p(5, 5), to: p(6, 5) },
    ];
    const paths = moveKindPaths(moves);
    expect(paths.feed).toBe('M 0 0 L 1 0 M 5 5 L 6 5');
    expect(paths.rapid).toBe('M 1 0 L 5 5');
  });

  it('draws arcs with the bulge convention', () => {
    const paths = moveKindPaths([{ kind: 'feed', from: p(10, 0), to: p(-10, 0), bulge: 1 }]);
    expect(paths.feed).toBe('M 10 0 A 10 10 0 0 1 -10 0');
  });

  it('marks plunges and retracts as dots and leaves out Z-only feeds and rapids', () => {
    const moves: Move[] = [
      { kind: 'rapid', from: p(3, 4, 5), to: p(3, 4, 1) },
      { kind: 'plunge', from: p(3, 4, 1), to: p(3, 4, -1) },
      { kind: 'feed', from: p(3, 4, -1), to: p(3, 4, -0.5) },
      { kind: 'retract', from: p(3, 4, -0.5), to: p(3, 4, 5) },
    ];
    expect(moveKindPaths(moves)).toEqual({ feed: '', rapid: '', plunge: 'M 3 4 h 0', retract: 'M 3 4 h 0' });
  });
});

describe('moveBounds', () => {
  it('is null for no moves', () => {
    expect(moveBounds([])).toBeNull();
  });

  it('covers straight move endpoints, including negative coordinates', () => {
    expect(moveBounds([{ kind: 'rapid', from: p(0, 0), to: p(-5, 20) }])).toEqual({ minX: -5, minY: 0, maxX: 0, maxY: 20 });
  });

  it('includes the extreme points an arc sweeps through', () => {
    // CCW half circle from (10, 0) to (-10, 0) over the top: reaches Y 10.
    const top = moveBounds([{ kind: 'feed', from: p(10, 0), to: p(-10, 0), bulge: 1 }])!;
    expect(top.maxY).toBeCloseTo(10, 12);
    expect(top.minY).toBeCloseTo(0, 12);
    // The CW one goes under instead.
    const bottom = moveBounds([{ kind: 'feed', from: p(10, 0), to: p(-10, 0), bulge: -1 }])!;
    expect(bottom.minY).toBeCloseTo(-10, 12);
    expect(bottom.maxY).toBeCloseTo(0, 12);
  });

  it('leaves out extremes a minor arc does not reach', () => {
    // CCW quarter from (10, 0) to (0, 10): bounds are just the endpoints.
    const b = moveBounds([{ kind: 'feed', from: p(10, 0), to: p(0, 10), bulge: Math.tan(Math.PI / 8) }])!;
    expect(b.minX).toBeCloseTo(0, 12);
    expect(b.maxX).toBeCloseTo(10, 12);
    expect(b.maxY).toBeCloseTo(10, 12);
  });
});
