/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Path } from '../geometry/segment';
import { pathLength } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import type { CutSide } from './offset';
import { compensationRadius, offsetPath, sheetBoundsWarning, toolpathBounds } from './offset';

export type Toolpath = {
  /** Cutter-center loops, in world units (Y-up), climb-milling direction. */
  loops: Path[];
  /**
   * Per loop, whether it is closed. Usually the drawn path's closure, but a
   * self-intersecting closed path can offset into open pieces.
   */
  closed: boolean[];
  /** Compensation radius used for the offset, in world units. */
  radius: number;
  /** Total length of all loops, in world units. */
  length: number;
  warnings: string[];
};

/**
 * Turns the drawn path into the cutter-center toolpath: offsets it by the
 * bit's compensation radius to `cutSide` (already made valid for `closed`,
 * see `effectiveCutSide`), then checks the result against the sheet. Empty
 * input gives an empty toolpath with no warnings.
 */
export function computeToolpath(
  segments: Path,
  closed: boolean,
  cutSide: CutSide,
  params: MachineParams
): Toolpath {
  const radius = compensationRadius(params);
  if (segments.length < 1) return { loops: [], closed: [], radius, length: 0, warnings: [] };

  const { loops, closed: loopClosed, warning } = offsetPath(segments, closed, cutSide, radius);
  const warnings: string[] = [];
  if (warning) warnings.push(warning);
  const boundsWarning = sheetBoundsWarning(toolpathBounds(loops, loopClosed), params.sheet);
  if (boundsWarning) warnings.push(boundsWarning);

  const length = loops.reduce((total, loop) => total + pathLength(loop), 0);
  return { loops, closed: loopClosed, radius, length, warnings };
}
