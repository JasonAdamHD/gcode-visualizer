/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Move, Point3 } from '../toolpath/moves';

/**
 * Scales moves by `factor` (e.g. `unitFactor(program.units, params.units)`):
 * positions and `feedRate`; bulges are dimensionless and kept. Returns the
 * same array for a factor of 1, so a memo downstream stays stable.
 */
export function scaleMoves(moves: Move[], factor: number): Move[] {
  if (factor === 1) return moves;
  const scale = (p: Point3): Point3 => ({ x: p.x * factor, y: p.y * factor, z: p.z * factor });
  return moves.map((move) => {
    const scaled: Move = { ...move, from: scale(move.from), to: scale(move.to) };
    if (move.feedRate !== undefined) scaled.feedRate = move.feedRate * factor;
    return scaled;
  });
}
