/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { parseGcode, sourceLines } from './parse';
import { firstMoveByLine } from './step';

const start = { point: { x: 0, y: 0, z: 5 }, units: 'mm' as const };

describe('sourceLines', () => {
  it('numbers lines like the parser, dropping CRs and one trailing newline', () => {
    expect(sourceLines('')).toEqual([]);
    expect(sourceLines('G0 X1\r\n(c)\r\n')).toEqual(['G0 X1', '(c)']);
    expect(sourceLines('a\n\nb')).toEqual(['a', '', 'b']);
    const text = 'G21\r\n\r\nG0 X1\r\n';
    expect(sourceLines(text)).toHaveLength(parseGcode(text, start).lineCount);
  });
});

describe('firstMoveByLine', () => {
  it('maps each line to its first move, or the next line that moves', () => {
    const lines = ['G21 F100', '(comment)', 'G0 X10', 'G2 X10 Y0 I-10', 'M5', 'G0 Z10', 'M30'];
    const { moves } = parseGcode(lines.join('\n'), start);
    // Moves: 0 = G0 X10 (line 2), 1-2 = full-circle halves (line 3), 3 = G0 Z10 (line 5).
    expect(Array.from(firstMoveByLine(moves, lines.length))).toEqual([0, 0, 0, 1, 3, 3, -1]);
  });

  it('is all −1 without moves', () => {
    expect(Array.from(firstMoveByLine([], 3))).toEqual([-1, -1, -1]);
  });
});
