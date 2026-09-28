/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Move } from '../toolpath/moves';
import { DEFAULT_PARAMS } from './params';
import { bitOfMove, diameterRange, programTooling, singleTooling } from './tooling';
import type { ToolLibrary } from './tools';

const p = (x: number) => ({ x, y: 0, z: -1 });
const move = (tool: number | undefined, line: number): Move => ({ kind: 'feed', from: p(line), to: p(line + 1), sourceLine: line, tool });
const library: ToolLibrary = {
  version: 1,
  tools: [
    {
      id: 'a',
      number: 2,
      name: '6 mm down-cut',
      units: 'mm',
      diameter: 6.35,
      shape: { kind: 'flat' },
      flute: { kind: 'down' },
      fluteCount: 2,
      updatedAt: 0,
    },
    {
      id: 'b',
      number: 3,
      name: 'V',
      units: 'in',
      diameter: 0.5,
      shape: { kind: 'vbit', includedAngleDeg: 60 },
      flute: { kind: 'compression', upcutLength: 0.125 },
      fluteCount: 3,
      updatedAt: 0,
    },
  ],
};
const fallback = DEFAULT_PARAMS.bit;

describe('programTooling', () => {
  const moves = [move(undefined, 0), move(2, 1), move(3, 2), move(9, 3), move(2, 4), move(9, 5)];
  const { tooling, unknown } = programTooling(moves, library, fallback, 'in');

  it('gives each move the bit of its tool number, converted into the job units', () => {
    expect(bitOfMove(tooling, 0)).toBe(fallback);
    expect(bitOfMove(tooling, 1)).toEqual({
      diameter: expect.closeTo(0.25, 12),
      shape: { kind: 'flat' },
      flute: { kind: 'down' },
      fluteCount: 2,
    });
    expect(bitOfMove(tooling, 2)).toEqual({
      diameter: 0.5,
      shape: { kind: 'vbit', includedAngleDeg: 60 },
      flute: { kind: 'compression', upcutLength: 0.125 },
      fluteCount: 3,
    });
    // One entry per tool, however often it is used.
    expect(tooling.bits).toHaveLength(3);
    expect(tooling.numbers).toEqual([null, 2, 3]);
    expect(tooling.ofMove[4]).toBe(tooling.ofMove[1]);
  });

  it('cuts with the fallback bit for unknown tools and lists each once at its first line', () => {
    expect(bitOfMove(tooling, 3)).toBe(fallback);
    expect(unknown).toEqual([{ number: 9, line: 3 }]);
  });

  it('converts inch tools for a millimeter job', () => {
    const mm = programTooling([move(3, 0)], library, fallback, 'mm').tooling;
    expect(bitOfMove(mm, 0).diameter).toBeCloseTo(12.7, 12);
  });
});

describe('diameterRange and singleTooling', () => {
  it('spans the bits that cut something', () => {
    const { tooling } = programTooling([move(2, 0), move(3, 1)], library, fallback, 'in');
    // The fallback 1/4" cuts nothing here; the 6.35 mm (0.25") and 0.5" bits do.
    expect(diameterRange(tooling)).toEqual({ min: expect.closeTo(0.25, 12), max: 0.5 });
    expect(diameterRange(singleTooling(3, fallback))).toEqual({ min: 0.25, max: 0.25 });
    expect(diameterRange(singleTooling(0, fallback))).toEqual({ min: 0.25, max: 0.25 });
  });
});
