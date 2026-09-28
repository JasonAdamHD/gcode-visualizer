/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { arcFromBulge } from '../geometry/segment';
import type { Units } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import { estimateCutTime } from '../toolpath/estimate';
import type { Move } from '../toolpath/moves';
import { moveLength } from '../toolpath/moves';
import type { DiagnosticCode } from './diagnostics';
import { parseGcode } from './parse';

/** Parses `lines` starting at (0, 0, 5) in `units` (mm by default). */
const parse = (lines: string[], units: Units = 'mm', z = 5) =>
  parseGcode(lines.join('\n'), { point: { x: 0, y: 0, z }, units });
const codes = (lines: string[]) => parse(lines).diagnostics.map((d) => d.code);
const ends = (moves: Move[]) => moves.map((m) => [m.to.x, m.to.y, m.to.z]);

describe('parseGcode: basics', () => {
  it('returns nothing for an empty file', () => {
    expect(parseGcode('', { point: { x: 0, y: 0, z: 5 }, units: 'mm' })).toEqual({
      moves: [],
      units: 'mm',
      lineCount: 0,
      diagnostics: [],
    });
  });

  it('counts lines, ignoring one trailing newline, and handles CRLF', () => {
    const program = parseGcode('G21\r\nG0 X1\r\n', { point: { x: 0, y: 0, z: 5 }, units: 'mm' });
    expect(program.lineCount).toBe(2);
    expect(ends(program.moves)).toEqual([[1, 0, 5]]);
  });

  it('starts at the start position and chains moves', () => {
    const { moves } = parse(['G21', 'G0 X10 Y20', 'G1 Z-1 F100', 'G1 X30']);
    expect(moves[0].from).toEqual({ x: 0, y: 0, z: 5 });
    for (let i = 1; i < moves.length; i++) expect(moves[i].from).toEqual(moves[i - 1].to);
    expect(ends(moves)).toEqual([
      [10, 20, 5],
      [10, 20, -1],
      [30, 20, -1],
    ]);
  });

  it('gives every move its 0-based source line, skipping blank and comment-only lines', () => {
    const { moves } = parse(['G21', '', '(comment)', 'G0 X1', '; note', 'G1 X2 F100', 'X3']);
    expect(moves.map((m) => m.sourceLine)).toEqual([3, 5, 6]);
  });

  it('ignores round-off in the start position: no phantom move, same kinds', () => {
    // 0.5 in via mm and back is 0.49999999999999994 in.
    const start = { point: { x: 1e-16, y: 0, z: 12.7 * (1 / 25.4) }, units: 'in' as const };
    const { moves } = parseGcode(['G20', 'G0 Z0.5', 'G0 Z1'].join('\n'), start);
    expect(moves.map((m) => m.kind)).toEqual(['retract']);
  });

  it('drops zero-length straight moves', () => {
    const { moves } = parse(['G21', 'G0 X0 Y0 Z5', 'G1 X1 F100', 'G1 X1']);
    expect(moves).toHaveLength(1);
  });
});

describe('parseGcode: kinds', () => {
  it('maps G0/G1 by direction', () => {
    const { moves } = parse([
      'G21 F100',
      'G0 X10', // rapid in XY
      'G0 Z1', // rapid down
      'G1 Z-2', // plunge
      'G1 X20', // feed in XY
      'G1 X25 Z-3', // 3D feed
      'G1 Z-1', // upward feed
      'G0 Z5', // retract
      'G0 X0 Z10', // up with XY: rapid
    ]);
    expect(moves.map((m) => m.kind)).toEqual(['rapid', 'rapid', 'plunge', 'feed', 'feed', 'feed', 'retract', 'rapid']);
  });

  it('carries the spindle speed on feeds and plunges once an S word sets it', () => {
    const { moves } = parse(['G21', 'G1 X1 F100', 'S12000', 'G0 X2', 'G1 Z-1', 'G1 X3 S9000', 'S0 G1 X4']);
    expect(moves.map((m) => m.spindleRpm)).toEqual([undefined, undefined, 12000, 9000, 0]);
  });

  it('carries the feed rate on feeds and plunges only', () => {
    const { moves } = parse(['G21', 'G0 X1', 'G1 Z-1 F50', 'G1 X2 F300', 'G0 Z5']);
    expect(moves.map((m) => m.feedRate)).toEqual([undefined, 50, 300, undefined]);
  });
});

describe('parseGcode: modal state', () => {
  it('continues the last motion mode and F for axis-only lines', () => {
    const { moves } = parse(['G21', 'X1', 'G1 X2 F120', 'Y3', 'G0 X4', 'Y5']);
    expect(moves.map((m) => m.kind)).toEqual(['rapid', 'feed', 'feed', 'rapid', 'rapid']);
    expect(moves[2].feedRate).toBe(120);
  });

  it('moves relative to the current position under G91 and back to absolute under G90', () => {
    const { moves } = parse(['G21 G91', 'G0 X10 Y5', 'X10', 'G90 X1']);
    expect(ends(moves)).toEqual([
      [10, 5, 5],
      [20, 5, 5],
      [1, 5, 5],
    ]);
  });

  it('ends a G91 arc relative to its start, with I/J from the start', () => {
    const { moves } = parse(['G21 G91 F100', 'G0 X10', 'G3 X-10 Y10 I-10']);
    expect(ends(moves)[1]).toEqual([0, 10, 5]);
    const arc = arcFromBulge(moves[1].from, moves[1].to, moves[1].bulge!)!;
    expect(arc.center.x).toBeCloseTo(0, 12);
    expect(arc.center.y).toBeCloseTo(0, 12);
  });
});

describe('parseGcode: units', () => {
  it('assumes mm without G20/G21 and says so', () => {
    const program = parse(['G0 X1']);
    expect(program.units).toBe('mm');
    expect(program.diagnostics).toEqual([expect.objectContaining({ line: 0, severity: 'info', code: 'no-units' })]);
  });

  it('uses the first G20/G21 as the program units and converts the start position', () => {
    const program = parse(['G20', 'G0 X1'], 'mm', 25.4);
    expect(program.units).toBe('in');
    expect(program.moves[0].from.z).toBeCloseTo(1, 12);
    expect(program.diagnostics).toEqual([]);
  });

  it('converts a mid-file unit switch, including F, and notes it', () => {
    const program = parse(['G21', 'G0 X10', 'G20', 'G1 X1 F10']);
    expect(program.units).toBe('mm');
    expect(program.moves[1].to.x).toBeCloseTo(25.4, 12);
    expect(program.moves[1].feedRate).toBeCloseTo(254, 12);
    expect(program.diagnostics).toEqual([expect.objectContaining({ line: 2, severity: 'info', code: 'unit-change' })]);
  });

  it('converts moves made before the first G20 from the mm default', () => {
    const program = parse(['G0 X25.4', 'G20', 'G0 X2']);
    expect(program.units).toBe('in');
    expect(program.moves[0].to.x).toBeCloseTo(1, 12);
    expect(program.moves[1].to.x).toBe(2);
    expect(program.diagnostics.map((d) => d.code)).toEqual(['unit-change']);
  });

  it('applies G20 on the same line to that line’s numbers', () => {
    const { moves } = parse(['G21', 'G20 G0 X1']);
    expect(moves[0].to.x).toBeCloseTo(25.4, 12);
  });
});

describe('parseGcode: arcs', () => {
  const centerOf = (m: Move) => arcFromBulge(m.from, m.to, m.bulge!)!.center;

  it('draws a CCW quarter by I/J with a positive bulge', () => {
    const { moves } = parse(['G21 F100', 'G0 X10', 'G3 X0 Y10 I-10 J0']);
    expect(moves[1].kind).toBe('feed');
    expect(moves[1].bulge).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    expect(centerOf(moves[1]).x).toBeCloseTo(0, 12);
    expect(centerOf(moves[1]).y).toBeCloseTo(0, 12);
  });

  it('draws a CW quarter by I/J with a negative bulge', () => {
    const { moves } = parse(['G21 F100', 'G0 Y10', 'G2 X10 Y0 J-10']);
    expect(moves[1].bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 12);
  });

  it('draws a CW quarter by R around the same center', () => {
    const { moves } = parse(['G21 F100', 'G0 Y10', 'G2 X10 Y0 R10']);
    expect(moves[1].bulge).toBeCloseTo(-Math.tan(Math.PI / 8), 12);
    expect(centerOf(moves[1]).x).toBeCloseTo(0, 12);
    expect(centerOf(moves[1]).y).toBeCloseTo(0, 12);
  });

  it('draws a half circle by R when the chord is exactly 2R', () => {
    const { moves, diagnostics } = parse(['G21 F100', 'G0 X10', 'G3 X-10 R10']);
    expect(diagnostics).toEqual([]);
    expect(moves[1].bulge).toBeCloseTo(1, 12);
  });

  it('draws a negative-R arc as the major arc, split into two halves on one line', () => {
    const { moves } = parse(['G21 F100', 'G0 X10', 'G3 X0 Y10 R-10']);
    expect(moves).toHaveLength(3);
    expect(moves[1].sourceLine).toBe(2);
    expect(moves[2].sourceLine).toBe(2);
    for (const m of moves.slice(1)) {
      expect(m.bulge).toBeCloseTo(Math.tan((1.5 * Math.PI) / 8), 12);
      expect(centerOf(m).x).toBeCloseTo(10, 9);
      expect(centerOf(m).y).toBeCloseTo(10, 9);
    }
    const length = moveLength(moves[1]) + moveLength(moves[2]);
    expect(length).toBeCloseTo(10 * 1.5 * Math.PI, 9);
  });

  it('splits a full circle by I/J into two half arcs', () => {
    const { moves } = parse(['G21 F100', 'G0 X10', 'G2 X10 Y0 I-10']);
    expect(moves.slice(1).map((m) => m.bulge)).toEqual([-Math.tan(Math.PI / 4), -Math.tan(Math.PI / 4)]);
    expect(moves[1].to.x).toBeCloseTo(-10, 12);
    expect(moves[1].to.y).toBeCloseTo(0, 12);
    expect(moves[2].to).toEqual({ x: 10, y: 0, z: 5 });
  });

  it('reads an arc with only I/J as a full circle at the current position', () => {
    const { moves } = parse(['G21 F100', 'G0 X10', 'G3 I-10']);
    expect(moves).toHaveLength(3);
    expect(moveLength(moves[1]) + moveLength(moves[2])).toBeCloseTo(20 * Math.PI, 9);
  });

  it('interpolates Z along a helix', () => {
    const { moves } = parse(['G21 F100', 'G0 X10 Z0', 'G2 X10 Y0 Z-2 I-10']);
    expect(moves[1].to.z).toBeCloseTo(-1, 12);
    expect(moves[2].to.z).toBe(-2);
    expect(moves[1].kind).toBe('feed');
  });

  it('accepts I/J radius differences within GRBL tolerance', () => {
    // End radius 10.004 vs start 10: 0.004 mm is under the 0.005 mm floor.
    expect(parse(['G21 F100', 'G0 X10', 'G3 X0 Y10.004 I-10']).diagnostics).toEqual([]);
    // 0.006 mm on a 10 mm radius is under 0.1 % (0.01 mm).
    expect(parse(['G21 F100', 'G0 X10', 'G3 X0 Y10.006 I-10']).diagnostics).toEqual([]);
  });

  it('rejects I/J radius differences beyond GRBL tolerance', () => {
    // 0.006 mm on a 1 mm radius is over 0.1 % (0.001 mm).
    expect(codes(['G21 F100', 'G0 X1', 'G3 X0 Y1.006 I-1'])).toEqual(['arc-radius-mismatch']);
    // 0.6 mm on a 1000 mm radius is under 0.1 % but over the 0.5 mm ceiling.
    expect(codes(['G21 F100', 'G0 X1000', 'G3 X0 Y1000.6 I-1000'])).toEqual(['arc-radius-mismatch']);
  });

  it('applies the tolerance in mm to an inch program', () => {
    // 0.0002 in = 0.00508 mm on a 0.04 in radius: over 0.005 mm and over 0.1 %.
    const program = parse(['G20 F10', 'G0 X0.04', 'G3 X0 Y0.0402 I-0.04']);
    expect(program.diagnostics.map((d) => d.code)).toEqual(['arc-radius-mismatch']);
    const ok = parse(['G20 F10', 'G0 X0.04', 'G3 X0 Y0.04019 I-0.04']);
    expect(ok.diagnostics).toEqual([]);
  });
});

describe('parseGcode: diagnostics', () => {
  it.each<[string, string[], DiagnosticCode]>([
    ['a syntax error', ['G21', 'G1 X'], 'syntax'],
    ['two motion codes on one line', ['G21', 'G0 G1 X1'], 'modal-conflict'],
    ['G20 and G21 on one line', ['G21 G20'], 'modal-conflict'],
    ['a repeated axis word', ['G21', 'G0 X1 X2'], 'duplicate-word'],
    ['an arc without I/J/R', ['G21 F100', 'G2 X10'], 'arc-missing-center'],
    ['an arc with I0 J0', ['G21 F100', 'G2 X10 I0 J0'], 'arc-zero-radius'],
    ['an R too small for the chord', ['G21 F100', 'G2 X10 R4'], 'arc-radius-too-small'],
    ['a full circle by R', ['G21 F100', 'G0 X1', 'G2 X1 Y0 Z4 R5'], 'arc-full-circle-r'],
    ['an arc outside the XY plane', ['G21 F100 G18', 'G2 X10 I5'], 'arc-plane'],
    ['a zero feed rate', ['G21 F0'], 'invalid-feed'],
    ['a negative spindle speed', ['G21 S-100'], 'invalid-spindle'],
  ])('reports %s as an error on its line', (_, lines, code) => {
    const found = parse(lines).diagnostics.filter((d) => d.severity === 'error');
    expect(found).toEqual([expect.objectContaining({ line: lines.length - 1, code })]);
  });

  it('skips a line with an error', () => {
    expect(parse(['G21', 'G0 X1 X2', 'G0 Y1 E']).moves).toEqual([]);
  });

  it('draws a bad arc as a straight feed to its end', () => {
    const { moves } = parse(['G21 F100', 'G2 X10 Y5']);
    expect(moves).toEqual([{ kind: 'feed', from: { x: 0, y: 0, z: 5 }, to: { x: 10, y: 5, z: 5 }, sourceLine: 1, feedRate: 100 }]);
  });

  it('reports a missing F once and leaves feedRate unset', () => {
    const program = parse(['G21', 'G1 X1', 'G1 X2', 'G1 X3 F100', 'X4']);
    expect(program.diagnostics).toEqual([expect.objectContaining({ line: 1, severity: 'error', code: 'missing-feed' })]);
    expect(program.moves.map((m) => m.feedRate)).toEqual([undefined, undefined, 100, 100]);
  });

  it('does not require F for rapids', () => {
    expect(codes(['G21', 'G0 X1 Y1 Z0'])).toEqual([]);
  });

  it('warns about each unsupported word and still runs the motion', () => {
    const program = parse(['G21', 'M3 S12000 T1 G54 G1 X5 F100']);
    const warnings = program.diagnostics.filter((d) => d.code === 'unsupported-word');
    expect(warnings.map((d) => d.message.split(' ')[0])).toEqual(['M3', 'T1', 'G54']);
    expect(program.moves[0].spindleRpm).toBe(12000);
    expect(warnings.every((d) => d.severity === 'warning' && d.line === 1)).toBe(true);
    expect(program.moves).toHaveLength(1);
  });

  it('does not treat the axis words of G28/G53/G92 as a move', () => {
    for (const line of ['G28 X0 Y0', 'G53 G0 Z0', 'G92 X0', 'G4 P1']) {
      const program = parse(['G21', 'G0 X5', line]);
      expect(program.moves).toHaveLength(1);
      expect(program.diagnostics[0].message).toMatch(/axis words on this line are ignored/);
    }
  });

  it('warns about I/J/R without an arc', () => {
    expect(codes(['G21 F100', 'G1 X1 I1'])).toEqual(['unused-word']);
    expect(codes(['G21', 'R5'])).toEqual(['unused-word']);
  });

  it('returns to arcs after G17', () => {
    expect(codes(['G21 F100 G18', 'G17', 'G0 X10', 'G3 X0 Y10 I-10'])).toEqual([]);
  });
});

describe('parseGcode: timing and scale', () => {
  it('times F600 in the file the same as a 600 feed/plunge-rate parameter', () => {
    const square = ['G21', 'G0 X0 Y0', 'G0 Z1', 'G1 Z-3 F600', 'X100', 'Y100', 'X0', 'Y0', 'G0 Z5'];
    const { moves } = parse(square);
    const bare = moves.map((m) => ({ kind: m.kind, from: m.from, to: m.to }));
    const mm = { ...DEFAULT_PARAMS, units: 'mm' as const, acceleration: 500, junctionDeviation: 0.01 };
    const fromFile = estimateCutTime(moves, { ...mm, feedRate: 123, plungeRate: 45 });
    const fromParams = estimateCutTime(bare, { ...mm, feedRate: 600, plungeRate: 600 });
    expect(fromFile.total).toBeCloseTo(fromParams.total, 9);
    expect(fromFile.cutting).toBeCloseTo(fromParams.cutting, 9);
    expect(fromFile.plunging).toBeCloseTo(fromParams.plunging, 9);
  });

  it('parses a 100 000-line program', () => {
    const lines = ['G21 F1000', 'G0 X0 Y0 Z1', 'G1 Z-1'];
    for (let i = 0; i < 100_000 - 3; i++) lines.push(i % 2 === 0 ? `G1 X${(i % 1000) + 1}.5 Y${i % 7}` : `G2 X${i % 1000} Y${i % 7} R50`);
    const program = parse(lines);
    expect(program.lineCount).toBe(100_000);
    expect(program.moves.length).toBeGreaterThan(99_000);
    expect(program.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
