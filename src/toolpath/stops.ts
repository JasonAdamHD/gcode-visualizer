/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Breakpoints as clock stops: sorted playback times where playing pauses.
// Pure, so the playback hook's frame step can be tested without a browser.
import type { Timeline } from './timeline';

/**
 * Sorted, de-duplicated stop times for source `lines`: the start of the
 * first move at or after each line (`lineMoves` from `firstMoveByLine`).
 * Lines with no move at or after them are dropped.
 */
export function stopTimes(timeline: Timeline, lineMoves: Int32Array, lines: Iterable<number>): Float64Array {
  const times = new Set<number>();
  for (const line of lines) {
    const m = lineMoves[line] ?? -1;
    if (m >= 0) times.add(timeline.moveStart[m]);
  }
  return Float64Array.from(times).sort();
}

/** Index of the first entry of sorted `stops` greater than `t`. */
function firstAfter(stops: Float64Array, t: number): number {
  let lo = 0;
  let hi = stops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stops[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The first stop in `(t0, t1]`, or null. A stop exactly at `t0` (where
 * playback just paused) does not count, so playing on from it moves on.
 */
export function firstStopIn(stops: Float64Array, t0: number, t1: number): number | null {
  const k = firstAfter(stops, t0);
  return k < stops.length && stops[k] <= t1 ? stops[k] : null;
}

/** The first stop after `t`, or null (for "next problem"). */
export function nextStop(stops: Float64Array, t: number): number | null {
  const k = firstAfter(stops, t);
  return k < stops.length ? stops[k] : null;
}

/**
 * One frame of the playback clock: from `time`, advance by `seconds` of
 * wall clock at `speed`, up to `total`. Returns the new time and whether
 * playback should pause there: at the end, or at the first of `stops`
 * crossed on the way (landing exactly on it).
 */
export function advanceClock(
  time: number,
  seconds: number,
  speed: number,
  total: number,
  stops: Float64Array
): { time: number; pause: boolean } {
  const from = Math.min(time, total);
  const to = Math.min(total, from + seconds * speed);
  const stop = firstStopIn(stops, from, to);
  if (stop !== null) return { time: stop, pause: true };
  return { time: to, pause: to >= total };
}
