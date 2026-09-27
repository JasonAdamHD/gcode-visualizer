/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../machine/params';
import type { Move, Point3 } from './moves';
import { advanceClock, firstStopIn, nextStop, stopTimes } from './stops';
import { buildTimeline } from './timeline';

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z });
const stops = Float64Array.from([2, 5, 9]);
const none = new Float64Array();

describe('firstStopIn', () => {
  it('finds the first stop after t0 and up to t1', () => {
    expect(firstStopIn(stops, 0, 1)).toBeNull();
    expect(firstStopIn(stops, 1, 6)).toBe(2);
    expect(firstStopIn(stops, 3, 5)).toBe(5);
    expect(firstStopIn(stops, 9, 20)).toBeNull();
    expect(firstStopIn(none, 0, 100)).toBeNull();
  });

  it('skips a stop exactly at t0, so playing on from it moves on', () => {
    expect(firstStopIn(stops, 2, 4)).toBeNull();
    expect(firstStopIn(stops, 2, 6)).toBe(5);
  });
});

describe('nextStop', () => {
  it('is the first stop strictly after t', () => {
    expect(nextStop(stops, 0)).toBe(2);
    expect(nextStop(stops, 2)).toBe(5);
    expect(nextStop(stops, 9)).toBeNull();
  });
});

describe('advanceClock', () => {
  it('advances by wall clock times speed', () => {
    expect(advanceClock(1, 0.5, 2, 20, none)).toEqual({ time: 2, pause: false });
  });

  it('pauses exactly on a stop crossed within the frame', () => {
    expect(advanceClock(4, 0.25, 8, 20, stops)).toEqual({ time: 5, pause: true });
  });

  it('does not stop again at the stop it is resuming from', () => {
    expect(advanceClock(5, 0.25, 4, 20, stops)).toEqual({ time: 6, pause: false });
  });

  it('pauses at the end, clamped', () => {
    expect(advanceClock(19, 1, 5, 20, none)).toEqual({ time: 20, pause: true });
    expect(advanceClock(25, 1, 1, 20, none)).toEqual({ time: 20, pause: true });
  });

  it('prefers a stop before the end', () => {
    expect(advanceClock(8, 10, 1, 10, stops)).toEqual({ time: 9, pause: true });
  });
});

describe('stopTimes', () => {
  const moves: Move[] = [
    { kind: 'rapid', from: p(0, 0, 1), to: p(4, 0, 1) },
    { kind: 'plunge', from: p(4, 0, 1), to: p(4, 0, 0) },
    { kind: 'feed', from: p(4, 0, 0), to: p(9, 0, 0) },
  ];
  const timeline = buildTimeline(moves, DEFAULT_PARAMS);
  // Line 0 is a comment (next move is 0); lines 1-3 make moves 0-2; line 4 has nothing after.
  const lineMoves = Int32Array.from([0, 0, 1, 2, -1]);

  it('maps lines to their first move start, sorted and unique, dropping lines with no move', () => {
    const t = stopTimes(timeline, lineMoves, new Set([3, 0, 1, 4, 42]));
    expect(Array.from(t)).toEqual([0, timeline.moveStart[2]]);
    expect(Array.from(t).every(Number.isFinite)).toBe(true);
  });
});
