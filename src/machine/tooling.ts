/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Which bit cuts each move. A drawing is cut with the params' bit; a
// program changes tools with T/M6, and each tool number is looked up in
// the tool library. Moves before the first tool change, and tool numbers
// the library does not have, use the params' bit.
import type { Move } from '../toolpath/moves';
import type { MachineParams, Units } from './params';
import { unitFactor } from './params';
import type { ToolLibrary } from './tools';

export type Bit = MachineParams['bit'];

/**
 * The bits a job cuts with: `bits[0]` is the params' bit (the fallback),
 * `numbers[i]` is the tool number of `bits[i]` (null for the fallback),
 * and `ofMove[m]` is the index of move `m`'s bit.
 */
export type Tooling = {
  bits: Bit[];
  numbers: (number | null)[];
  ofMove: Uint16Array;
};

/** Every move cut with `bit` (a drawing, or a program without tool changes). */
export function singleTooling(moveCount: number, bit: Bit): Tooling {
  return { bits: [bit], numbers: [null], ofMove: new Uint16Array(moveCount) };
}

/** The bit that cuts move `m`. */
export function bitOfMove(tooling: Tooling, m: number): Bit {
  return tooling.bits[tooling.ofMove[m] ?? 0];
}

/** The smallest and largest diameters among the bits that cut something. */
export function diameterRange(tooling: Tooling): { min: number; max: number } {
  const used = new Set(tooling.ofMove);
  if (used.size === 0) used.add(0);
  const diameters = [...used].map((i) => tooling.bits[i].diameter);
  return { min: Math.min(...diameters), max: Math.max(...diameters) };
}

/**
 * The tooling for a program's `moves` (their `tool` numbers) in `units`:
 * each tool number found in `library` becomes that tool's bit, converted
 * from the tool's units. Also lists tool numbers the library does not
 * have, with the first source line that uses each, for a diagnostic.
 */
export function programTooling(
  moves: readonly Move[],
  library: ToolLibrary,
  fallback: Bit,
  units: Units
): { tooling: Tooling; unknown: { number: number; line: number }[] } {
  const tooling: Tooling = { bits: [fallback], numbers: [null], ofMove: new Uint16Array(moves.length) };
  const indexOf = new Map<number, number>();
  const unknown: { number: number; line: number }[] = [];
  moves.forEach((move, m) => {
    const n = move.tool;
    if (n === undefined) return;
    let index = indexOf.get(n);
    if (index === undefined) {
      const tool = library.tools.find((t) => t.number === n);
      if (tool) {
        const f = unitFactor(tool.units, units);
        tooling.bits.push({
          diameter: tool.diameter * f,
          shape: tool.shape,
          flute: tool.flute.kind === 'compression' ? { kind: 'compression', upcutLength: tool.flute.upcutLength * f } : tool.flute,
          fluteCount: tool.fluteCount,
        });
        tooling.numbers.push(n);
        index = tooling.bits.length - 1;
      } else {
        unknown.push({ number: n, line: move.sourceLine ?? 0 });
        index = 0;
      }
      indexOf.set(n, index);
    }
    tooling.ofMove[m] = index;
  });
  return { tooling, unknown };
}
