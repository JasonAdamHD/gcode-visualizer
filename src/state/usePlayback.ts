/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceClock } from '../toolpath/stops';
import { clampSpeed } from './playbackSpeed';

/**
 * Longest wall-clock step one frame may advance, in seconds. Browsers stop
 * animation frames in background tabs; without a cap, coming back would
 * jump playback forward by the whole time away.
 */
export const MAX_FRAME_SECONDS = 0.25;

const NO_STOPS = new Float64Array();

export type Playback = {
  /** Playback clock in machine seconds, within `[0, total]`. */
  time: number;
  playing: boolean;
  speed: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  /** Plays until `t` and pauses there; when `t` is not ahead, seeks to it instead. */
  runTo: (t: number) => void;
  restart: () => void;
  /** Sets the speed multiplier, clamped to the playback speed range. */
  setSpeed: (speed: number) => void;
  /** Multiplies the speed by `factor` (clamped); repeated calls before a render all count. */
  scaleSpeed: (factor: number) => void;
};

/**
 * Playback clock for a job `total` seconds long. While playing, a
 * requestAnimationFrame loop advances `time` by wall-clock seconds times
 * `speed` (at most `MAX_FRAME_SECONDS` of wall clock per frame) and pauses
 * at the end, or on the first of the sorted `stops` (breakpoint times) it
 * crosses; playing on from a stop moves past it. Seeking ignores stops.
 * Playing from the end starts over. When `source` changes (a new
 * timeline), playback pauses and `time` is clamped to the new total.
 * Playback is transient: it is not part of drawing history and is not
 * persisted.
 */
export function usePlayback(total: number, source: unknown, stops: Float64Array = NO_STOPS): Playback {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<number>(1);
  const [prevSource, setPrevSource] = useState(source);
  // The frame loop and event handlers read the latest time from here; state
  // updaters can run later, so they cannot report back whether the end was hit.
  const timeRef = useRef(0);
  const stopsRef = useRef(stops);
  // A one-off stop for "run to line", cleared when reached or on any seek.
  const runToRef = useRef<number | null>(null);
  const setBoth = useCallback((t: number) => {
    timeRef.current = t;
    setTime(t);
  }, []);

  // A new timeline: pause and clamp, adjusting state during render rather
  // than in an effect so the stale time never renders.
  if (source !== prevSource) {
    setPrevSource(source);
    setPlaying(false);
    setTime((t) => Math.min(t, total));
  }

  // Picks up time changes made during render (the clamp above).
  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  useEffect(() => {
    stopsRef.current = stops;
  }, [stops]);

  useEffect(() => {
    if (!playing) {
      runToRef.current = null;
      return;
    }
    let last: number | null = null;
    let frame = requestAnimationFrame(function tick(now) {
      const dt = last === null ? 0 : Math.min(MAX_FRAME_SECONDS, (now - last) / 1000);
      last = now;
      const from = timeRef.current;
      let { time: next, pause } = advanceClock(from, dt, speed, total, stopsRef.current);
      const target = runToRef.current;
      if (target !== null && target > from && target <= next) {
        next = target;
        pause = true;
      }
      setBoth(next);
      if (pause) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, total, setBoth]);

  const play = useCallback(() => {
    if (!(total > 0)) return;
    if (timeRef.current >= total) setBoth(0);
    setPlaying(true);
  }, [total, setBoth]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const seek = useCallback(
    (t: number) => {
      runToRef.current = null;
      setBoth(Math.min(total, Math.max(0, t)));
    },
    [total, setBoth]
  );
  const runTo = useCallback(
    (t: number) => {
      const target = Math.min(total, Math.max(0, t));
      if (target <= timeRef.current) {
        setPlaying(false);
        seek(target);
        return;
      }
      runToRef.current = target;
      setPlaying(true);
    },
    [total, seek]
  );
  const restart = useCallback(() => seek(0), [seek]);
  const setSpeed = useCallback((s: number) => setSpeedState(clampSpeed(s)), []);
  const scaleSpeed = useCallback((factor: number) => setSpeedState((s) => clampSpeed(s * factor)), []);

  return { time, playing, speed, play, pause, toggle, seek, runTo, restart, setSpeed, scaleSpeed };
}
