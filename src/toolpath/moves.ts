/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { Path, Point } from '../geometry/segment';
import { arcFromBulge } from '../geometry/segment';
import type { MachineParams } from '../machine/params';
import { unitFactor } from '../machine/params';

/** A machine position in world units: X/Y as on the canvas (Y-up), Z = 0 at the sheet top, negative into material. */
export type Point3 = { x: number; y: number; z: number };

/**
 * One machine motion. `rapid` and `retract` are G0 moves (`retract` only
 * moves up in Z); `plunge` is a feed-rate Z move straight down; `feed` is
 * any other cutting move, an arc in XY when `bulge` is non-zero (DXF bulge
 * convention, positive = CCW, Z interpolated along the arc for a helix).
 * Moves built from a drawing keep `feed` at constant Z; imported G-code
 * can feed in 3D. This list is what the planner times, what the 3D view
 * animates, and what the G-code parser produces.
 */
export type Move = {
  kind: 'rapid' | 'plunge' | 'feed' | 'retract';
  from: Point3;
  to: Point3;
  bulge?: number;
  /** 0-based line in the source G-code file, for imported moves. */
  sourceLine?: number;
  /** Programmed feed rate in units/min (an imported F word); overrides the params' feed or plunge rate. */
  feedRate?: number;
  /** Programmed spindle speed in RPM (an imported S word; 0 = stopped); overrides the params' spindle speed. */
  spindleRpm?: number;
};

/** Height above the current material surface where a rapid lower stops and the plunge starts, in inches. */
export const PLUNGE_CLEARANCE_IN = 0.02;

/**
 * Z levels of the depth passes for a cut `totalDepth` deep (both positive
 * lengths): `ceil(totalDepth / depthPerPass)` equal steps, returned as
 * negative Z values, the last exactly `-totalDepth`. A tiny tolerance keeps
 * an exact multiple (0.75 / 0.25) from gaining a pass through rounding.
 */
export function passDepths(totalDepth: number, depthPerPass: number): number[] {
  if (!(totalDepth > 0) || !(depthPerPass > 0)) return [];
  const n = Math.max(1, Math.ceil(totalDepth / depthPerPass - 1e-9));
  const depths: number[] = [];
  for (let i = 1; i < n; i++) depths.push((-totalDepth * i) / n);
  depths.push(-totalDepth);
  return depths;
}

/** Length of a move in world units, following the arc for a bulged feed. */
export function moveLength(move: Move): number {
  const arc = move.bulge ? arcFromBulge(move.from, move.to, move.bulge) : null;
  if (arc) return Math.hypot(arc.radius * Math.abs(arc.theta), move.to.z - move.from.z);
  return Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y, move.to.z - move.from.z);
}

const dist2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/**
 * Builds the full move list that cuts `loops` (toolpath loops; `closed[i]`
 * says whether loop i is closed) through the sheet in depth passes. Starts
 * and ends at home, the sheet origin at safe height. Each loop is cut fully
 * to depth before the next, and the next loop is the one whose start is
 * nearest the current position. Per pass: rapid down to just above the
 * material surface (sheet top, or the previous pass's floor), plunge, feed
 * the loop. A closed loop plunges straight to the next pass from its end
 * point (which is its start); an open one retracts and returns to its start.
 */
export function buildMoves(loops: Path[], closed: boolean[], params: MachineParams): Move[] {
  const moves: Move[] = [];
  const passes = passDepths(params.sheet.thickness + params.spoilboardPenetration, params.depthPerPass);
  if (passes.length === 0) return moves;

  const safe = params.safeHeight;
  const clearance = PLUNGE_CLEARANCE_IN * unitFactor('in', params.units);
  let pos: Point3 = { x: 0, y: 0, z: safe };
  const go = (kind: Move['kind'], to: Point3, bulge?: number) => {
    if (to.x === pos.x && to.y === pos.y && to.z === pos.z) return;
    moves.push(bulge ? { kind, from: pos, to, bulge } : { kind, from: pos, to });
    pos = to;
  };
  const retract = () => go('retract', { ...pos, z: safe });
  // Rapid down to just above `surface`, then plunge to `z`. The rapid never
  // goes up, even if the safe height is below the clearance.
  const lowerAndPlunge = (surface: number, z: number) => {
    go('rapid', { ...pos, z: Math.min(surface + clearance, pos.z) });
    go('plunge', { ...pos, z });
  };

  const remaining = loops.flatMap((loop, i) => (loop.length > 0 ? [i] : []));
  while (remaining.length > 0) {
    let best = 0;
    for (let k = 1; k < remaining.length; k++) {
      if (dist2(loops[remaining[k]][0].start, pos) < dist2(loops[remaining[best]][0].start, pos)) best = k;
    }
    const [index] = remaining.splice(best, 1);
    const loop = loops[index];
    const start = loop[0].start;

    passes.forEach((z, p) => {
      const surface = p === 0 ? 0 : passes[p - 1];
      if (p === 0 || !closed[index]) {
        retract();
        go('rapid', { x: start.x, y: start.y, z: safe });
        lowerAndPlunge(surface, z);
      } else {
        go('plunge', { ...pos, z });
      }
      for (const seg of loop) go('feed', { x: seg.end.x, y: seg.end.y, z }, seg.bulge ?? 0);
    });
  }

  retract();
  go('rapid', { x: 0, y: 0, z: safe });
  return moves;
}
