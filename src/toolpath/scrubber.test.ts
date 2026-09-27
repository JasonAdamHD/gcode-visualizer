/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../gcode/diagnostics';
import type { MachineParams } from '../machine/params';
import { DEFAULT_PARAMS } from '../machine/params';
import type { Move, Point3 } from './moves';
import { BAND_CUT, BAND_NONE, BAND_RAPID, BAND_VERTICAL, MAX_BINS, diagnosticTicks, scrubberBands } from './scrubber';
import { buildTimeline } from './timeline';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
/** Huge acceleration so every block runs at its nominal speed and times are easy to reason about. */
const params: MachineParams = { ...DEFAULT_PARAMS, acceleration: 1e9, feedRate: 60, plungeRate: 60, rapidRateXY: 60, rapidRateZ: 60 };

// At 1 in/s: a 4 s rapid, a 1 s plunge, a 5 s cut, a 1 s retract (11 s).
const moves: Move[] = [
  { kind: 'rapid', from: p(0, 0, 1), to: p(4, 0, 1) },
  { kind: 'plunge', from: p(4, 0, 1), to: p(4, 0, 0) },
  { kind: 'feed', from: p(4, 0, 0), to: p(9, 0, 0) },
  { kind: 'retract', from: p(9, 0, 0), to: p(9, 0, 1) },
];
const timeline = buildTimeline(moves, params);

describe('scrubberBands', () => {
  it('gives each bin the motion that takes most of its time', () => {
    expect(timeline.total).toBeCloseTo(11, 6);
    // 11 bins of 1 s each.
    expect(Array.from(scrubberBands(timeline, 11))).toEqual([
      BAND_RAPID,
      BAND_RAPID,
      BAND_RAPID,
      BAND_RAPID,
      BAND_VERTICAL,
      BAND_CUT,
      BAND_CUT,
      BAND_CUT,
      BAND_CUT,
      BAND_CUT,
      BAND_VERTICAL,
    ]);
  });

  it('picks the majority within a coarse bin', () => {
    // Two bins of 5.5 s: 4 s rapid + 1 s plunge + 0.5 s cut; then 4.5 s cut + 1 s retract.
    expect(Array.from(scrubberBands(timeline, 2))).toEqual([BAND_RAPID, BAND_CUT]);
  });

  it('is all empty for an empty timeline and clamps the bin count', () => {
    const empty = buildTimeline([], params);
    expect(Array.from(scrubberBands(empty, 4))).toEqual([BAND_NONE, BAND_NONE, BAND_NONE, BAND_NONE]);
    expect(scrubberBands(timeline, 10 ** 6)).toHaveLength(MAX_BINS);
    expect(scrubberBands(timeline, 0)).toHaveLength(1);
  });
});

describe('diagnosticTicks', () => {
  // Source lines 0..3 make moves 0..3; line 4 has none after it.
  const lineMoves = Int32Array.from([0, 1, 2, 3, -1]);
  const diag = (line: number, severity: Diagnostic['severity']): Diagnostic => ({
    line,
    severity,
    code: 'unsupported-word',
    message: '',
  });

  it('puts one tick per time with the most severe problem, sorted', () => {
    const ticks = diagnosticTicks(timeline, lineMoves, [
      diag(2, 'info'),
      diag(0, 'warning'),
      diag(2, 'error'),
      diag(2, 'warning'),
    ]);
    expect(ticks).toEqual([
      { time: 0, severity: 'warning' },
      { time: timeline.moveStart[2], severity: 'error' },
    ]);
  });

  it('skips problems after the last move', () => {
    expect(diagnosticTicks(timeline, lineMoves, [diag(4, 'error'), diag(99, 'error')])).toEqual([]);
  });
});
