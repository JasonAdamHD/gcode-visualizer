/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { unitFactor } from '../machine/params';
import type { Move } from '../toolpath/moves';
import { scaleMoves } from './scale';

const moves: Move[] = [
  { kind: 'rapid', from: { x: 0, y: 0, z: 1 }, to: { x: 1, y: 2, z: 1 }, sourceLine: 3 },
  { kind: 'feed', from: { x: 1, y: 2, z: -0.5 }, to: { x: 3, y: 2, z: -0.5 }, bulge: 0.4, sourceLine: 4, feedRate: 60 },
];

describe('scaleMoves', () => {
  it('scales positions and feed rates, keeping bulge, kind and source line', () => {
    const [rapid, feed] = scaleMoves(moves, 25.4);
    expect(rapid).toEqual({ kind: 'rapid', from: { x: 0, y: 0, z: 25.4 }, to: { x: 25.4, y: 50.8, z: 25.4 }, sourceLine: 3 });
    expect(feed.bulge).toBe(0.4);
    expect(feed.sourceLine).toBe(4);
    expect(feed.feedRate).toBeCloseTo(1524, 12);
    expect(feed.to.x).toBeCloseTo(76.2, 12);
  });

  it('round-trips in → mm → in', () => {
    const back = scaleMoves(scaleMoves(moves, unitFactor('in', 'mm')), unitFactor('mm', 'in'));
    back.forEach((m, i) => {
      expect(m.to.x).toBeCloseTo(moves[i].to.x, 12);
      expect(m.from.z).toBeCloseTo(moves[i].from.z, 12);
      expect(m.feedRate ?? 0).toBeCloseTo(moves[i].feedRate ?? 0, 12);
    });
  });

  it('returns the same array for a factor of 1', () => {
    expect(scaleMoves(moves, 1)).toBe(moves);
  });
});
