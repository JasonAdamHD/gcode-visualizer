/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { MachineParams } from '../machine/params';
import type { Move } from './moves';
import { moveLength, passDepths } from './moves';
import { planTime } from './planner';

/**
 * Cut-time breakdown in seconds. `cutting + plunging + rapids + retracts`
 * equals `total`; `cornerLoss` is the part of `total` lost to acceleration
 * and corner slowdowns (total minus the time at nominal speed everywhere),
 * so it overlaps the other buckets rather than adding to them.
 */
export type CutTimeEstimate = {
  total: number;
  cutting: number;
  plunging: number;
  rapids: number;
  retracts: number;
  cornerLoss: number;
  /** Depth passes per loop (0 when there is nothing to cut). */
  passes: number;
  /** Total length of cutting (feed) moves, in world units. */
  cutLength: number;
};

/** Estimates how long `moves` take on the machine described by `params`, using the GRBL-style planner. */
export function estimateCutTime(moves: Move[], params: MachineParams): CutTimeEstimate {
  const { moveTimes, nominalTimes, total } = planTime(moves, params);
  const est: CutTimeEstimate = {
    total,
    cutting: 0,
    plunging: 0,
    rapids: 0,
    retracts: 0,
    cornerLoss: total - nominalTimes.reduce((sum, t) => sum + t, 0),
    passes: 0,
    cutLength: 0,
  };
  moves.forEach((move, i) => {
    const t = moveTimes[i];
    switch (move.kind) {
      case 'feed':
        est.cutting += t;
        est.cutLength += moveLength(move);
        break;
      case 'plunge':
        est.plunging += t;
        break;
      case 'rapid':
        est.rapids += t;
        break;
      case 'retract':
        est.retracts += t;
        break;
    }
  });
  if (moves.length > 0) {
    est.passes = passDepths(params.sheet.thickness + params.spoilboardPenetration, params.depthPerPass).length;
  }
  return est;
}

/** Formats seconds as "1h 02m 05s", "3m 12s" or "42s", rounded to the nearest second. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}
