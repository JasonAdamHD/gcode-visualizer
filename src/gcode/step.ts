/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Move } from '../toolpath/moves';

/**
 * For each of `lineCount` source lines, the index of the first move made
 * by that line or any later one, or −1 when no move follows. Clicking a
 * line without motion (a comment, an M-code) then jumps to the next line
 * that moves. Relies on `sourceLine` never decreasing along `moves`, which
 * holds for parsed programs.
 */
export function firstMoveByLine(moves: Move[], lineCount: number): Int32Array {
  const first = new Int32Array(lineCount).fill(-1);
  let next = -1;
  let m = moves.length - 1;
  for (let line = lineCount - 1; line >= 0; line--) {
    while (m >= 0 && (moves[m].sourceLine ?? -1) >= line) next = m--;
    first[line] = next;
  }
  return first;
}
