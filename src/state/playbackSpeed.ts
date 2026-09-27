/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Playback speed: a continuous multiplier on a log scale, with detents at
// round values so the slider lands on them easily.

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 500;

/** Round speeds the slider snaps to and marks. */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500] as const;

/** How close (in octaves) a slider value must be to a detent to snap to it. */
const SNAP_OCTAVES = 0.1;

/** `speed` limited to `[MIN_SPEED, MAX_SPEED]`. */
export function clampSpeed(speed: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

/**
 * The speed for a slider position `octaves` (log₂ of the speed): the
 * nearest detent if within `SNAP_OCTAVES`, otherwise the value rounded to
 * two significant digits, clamped to the range.
 */
export function speedFromSlider(octaves: number): number {
  const raw = clampSpeed(2 ** octaves);
  for (const detent of PLAYBACK_SPEEDS) {
    if (Math.abs(Math.log2(detent) - Math.log2(raw)) <= SNAP_OCTAVES) return detent;
  }
  return clampSpeed(Number(raw.toPrecision(2)));
}

/** A speed for display, without trailing zeros: 0.25, 1.5, 12, 350. */
export function formatSpeed(speed: number): string {
  return String(Number(speed.toPrecision(speed < 10 ? 2 : 3)));
}
