/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Path, Point } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import { buildMoves } from '../toolpath/moves';
import { analyzeProgram } from './analyze';
import type { DiagnosticCode } from './diagnostics';
import { parseGcode } from './parse';

/** A 100 × 50 mm sheet, 10 mm thick, 0.5 mm spoilboard penetration: the floor is Z −10.5. */
const params: MachineParams = {
  ...DEFAULT_PARAMS,
  units: 'mm',
  sheet: { x: 100, y: 50, thickness: 10 },
  spoilboardPenetration: 0.5,
  safeHeight: 5,
  depthPerPass: 3,
};

/** Parses mm G-code starting at (0, 0, 5) and analyzes it. */
const analyze = (lines: string[]) => {
  const { moves } = parseGcode(['G21 F1000', ...lines].join('\n'), { point: { x: 0, y: 0, z: 5 }, units: 'mm' });
  return analyzeProgram(moves, params);
};
const codes = (lines: string[]) => analyze(lines).map((d) => d.code);
const only = (lines: string[], code: DiagnosticCode) => analyze(lines).filter((d) => d.code === code);

const line = (start: Point, end: Point): Path[number] => ({ type: 'line', start, end });

describe('analyzeProgram', () => {
  it('returns nothing for no moves', () => {
    expect(analyzeProgram([], params)).toEqual([]);
  });

  it('finds nothing wrong in a multi-pass job from buildMoves', () => {
    const open: Path = [line({ x: 10, y: 10 }, { x: 90, y: 10 }), line({ x: 90, y: 10 }, { x: 90, y: 40 })];
    const closed: Path = [
      line({ x: 20, y: 20 }, { x: 40, y: 20 }),
      line({ x: 40, y: 20 }, { x: 40, y: 30 }),
      line({ x: 40, y: 30 }, { x: 20, y: 20 }),
    ];
    const moves = buildMoves([open, closed], [false, true], params);
    // The open path's later passes rapid down into the slot already cut.
    expect(moves.some((m) => m.kind === 'rapid' && m.to.z < 0)).toBe(true);
    expect(analyzeProgram(moves, params)).toEqual([]);
  });

  describe('rapid-into-material', () => {
    it('flags a rapid below the sheet top into uncut material, on its source line', () => {
      expect(only(['G0 X10 Y10', 'G0 Z-1'], 'rapid-into-material')).toEqual([
        expect.objectContaining({ line: 2, severity: 'error' }),
      ]);
    });

    it('allows a rapid down to exactly Z 0', () => {
      expect(codes(['G0 X10 Y10', 'G0 Z0', 'G1 Z-1'])).toEqual([]);
    });

    it('allows a rapid down to exactly the deepest cut so far, and flags one below it', () => {
      const cut = ['G0 X10 Y10', 'G1 Z-3', 'G1 X20', 'G0 Z5', 'G0 X10'];
      expect(codes([...cut, 'G0 Z-3'])).toEqual([]);
      expect(codes([...cut, 'G0 Z-3.1'])).toEqual(['rapid-into-material']);
    });

    it('flags a rapid moving in XY below the sheet top', () => {
      expect(codes(['G0 X10 Y10', 'G1 Z-3', 'G0 X20'])).toEqual(['rapid-into-material']);
      expect(codes(['G0 X10 Y10', 'G1 Z-3', 'G0 X20 Z5'])).toEqual(['rapid-into-material']);
    });

    it('does not flag retracts', () => {
      expect(codes(['G0 X10 Y10', 'G1 Z-3', 'G0 Z-1', 'G0 Z5'])).toEqual([]);
    });
  });

  describe('too-deep', () => {
    it('allows exactly the penetration limit', () => {
      expect(codes(['G0 X10 Y10', 'G1 Z-10.5'])).toEqual([]);
    });

    it('flags a move below the penetration limit', () => {
      expect(only(['G0 X10 Y10', 'G1 Z-10.6'], 'too-deep')).toEqual([
        expect.objectContaining({ line: 2, severity: 'error' }),
      ]);
    });
  });

  describe('out-of-bounds', () => {
    it('allows cutting exactly on the sheet edge', () => {
      expect(codes(['G0 X0 Y0', 'G1 Z-1', 'X100', 'Y50', 'X0', 'Y0'])).toEqual([]);
    });

    it('flags a cut past the sheet edge', () => {
      expect(only(['G0 X90 Y10', 'G1 Z-1', 'X101'], 'out-of-bounds')).toEqual([
        expect.objectContaining({ line: 3, severity: 'warning' }),
      ]);
      expect(codes(['G0 X10 Y10', 'G1 Z-1', 'Y-0.1'])).toEqual(['out-of-bounds']);
    });

    it('flags a plunge outside the sheet', () => {
      expect(codes(['G0 X110 Y10', 'G1 Z-1'])).toEqual(['out-of-bounds']);
    });

    it('flags an arc that bulges past the edge while both endpoints are inside', () => {
      // Half circle from (90, 10) to (90, 40) bulging to X 105.
      expect(codes(['G0 X90 Y10', 'G1 Z-1', 'G3 X90 Y40 R15'])).toEqual(['out-of-bounds']);
      // The same arc bowing the other way stays inside.
      expect(codes(['G0 X90 Y10', 'G1 Z-1', 'G2 X90 Y40 R15'])).toEqual([]);
    });

    it('ignores moves outside the sheet at or above the sheet top', () => {
      expect(codes(['G0 X150 Y10', 'G1 Z0', 'X200', 'G0 Z5', 'X90', 'G1 Z-1'])).toEqual([]);
    });

    it('flags a ramp that enters the material outside the sheet', () => {
      // From (200, 10, 0) down to (90, 10, −1): below Z 0 right after X 200.
      expect(codes(['G0 X200 Y10', 'G1 Z0', 'G1 X90 Z-1'])).toEqual(['out-of-bounds']);
      // A ramp that is outside only while above the sheet top is fine.
      expect(codes(['G0 X110 Y10', 'G1 Z1', 'G1 X90 Z-1'])).toEqual([]);
    });
  });

  describe('no-cut', () => {
    it('notes a program that never goes below Z 0', () => {
      expect(analyze(['G0 X10 Y10', 'G1 Z0', 'X20'])).toEqual([
        expect.objectContaining({ line: 0, severity: 'info', code: 'no-cut' }),
      ]);
    });
  });

  it('reports line −1 for moves without a source line', () => {
    const [d] = analyzeProgram([{ kind: 'rapid', from: { x: 0, y: 0, z: 5 }, to: { x: 0, y: 0, z: -1 } }], params);
    expect(d.line).toBe(-1);
  });

  it('says what it found in the current units', () => {
    const [d] = only(['G0 X10 Y10', 'G1 Z-11'], 'too-deep');
    expect(d.message).toMatch(/-11(\.0+)? mm/);
  });
});
