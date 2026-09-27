/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// What the playback scrubber shows along its length: which kind of motion
// dominates each stretch of time, and where the problems are. Bucketed so a
// 10⁵-move program costs one canvas draw, not 10⁵ elements.
import type { Diagnostic, Severity } from '../gcode/diagnostics';
import type { Timeline } from './timeline';

/** Band codes: nothing, rapid, plunge or retract, cut. */
export const BAND_NONE = 0;
export const BAND_RAPID = 1;
export const BAND_VERTICAL = 2;
export const BAND_CUT = 3;

/** Most bins worth computing; a scrubber is never this many pixels wide. */
export const MAX_BINS = 2000;

/**
 * Splits `[0, timeline.total]` into `bins` equal stretches and gives each
 * the code of the motion that takes most of its time (`BAND_*`), or
 * `BAND_NONE` for an empty timeline. `bins` is clamped to `1..MAX_BINS`.
 */
export function scrubberBands(timeline: Timeline, bins: number): Uint8Array {
  const n = Math.max(1, Math.min(MAX_BINS, Math.floor(bins)));
  const out = new Uint8Array(n);
  const { blocks, blockStart, moves, total } = timeline;
  if (!(total > 0)) return out;
  // Seconds of rapid, vertical and cut motion per bin.
  const time = new Float64Array(n * 3);
  const width = total / n;
  blocks.forEach((b, i) => {
    const kind = moves[b.move].kind;
    const slot = kind === 'rapid' ? 0 : kind === 'feed' ? 2 : 1;
    const t0 = blockStart[i];
    const t1 = blockStart[i + 1];
    const first = Math.min(n - 1, Math.floor(t0 / width));
    const last = Math.min(n - 1, Math.floor(t1 / width));
    for (let k = first; k <= last; k++) {
      const overlap = Math.min(t1, (k + 1) * width) - Math.max(t0, k * width);
      if (overlap > 0) time[k * 3 + slot] += overlap;
    }
  });
  for (let k = 0; k < n; k++) {
    const [rapid, vertical, cut] = [time[k * 3], time[k * 3 + 1], time[k * 3 + 2]];
    if (rapid + vertical + cut === 0) continue;
    // Ties go to cutting, then vertical: the more interesting motion.
    out[k] = cut >= rapid && cut >= vertical ? BAND_CUT : vertical >= rapid ? BAND_VERTICAL : BAND_RAPID;
  }
  return out;
}

export type ScrubberTick = { time: number; severity: Severity };

const RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };

/**
 * One tick per playback time that has problems: the start of the first
 * move at or after each diagnostic's line (`lineMoves` from
 * `firstMoveByLine`), with the most severe problem there. Lines after the
 * last move have no time and get no tick. Sorted by time.
 */
export function diagnosticTicks(timeline: Timeline, lineMoves: Int32Array, diagnostics: Diagnostic[]): ScrubberTick[] {
  const byTime = new Map<number, Severity>();
  for (const d of diagnostics) {
    const m = lineMoves[d.line] ?? -1;
    if (m < 0) continue;
    const time = timeline.moveStart[m];
    const prev = byTime.get(time);
    if (!prev || RANK[d.severity] > RANK[prev]) byTime.set(time, d.severity);
  }
  return [...byTime].map(([time, severity]) => ({ time, severity })).sort((a, b) => a.time - b.time);
}
