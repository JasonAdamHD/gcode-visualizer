/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Pure drawing data for the read-only 2D program view: one SVG path per
// move kind, so a 10⁵-move file is four DOM elements, not 10⁵.
import { arcFromBulge, segmentPathData } from '../geometry/segment';
import type { Bounds } from '../toolpath/offset';
import type { Move } from '../toolpath/moves';

/** SVG path data per move kind, in world coordinates (Y-up; the view flips it). */
export type KindPaths = Record<Move['kind'], string>;

/**
 * Builds XY path data for each move kind. Feeds (with arcs) and rapids
 * are drawn as lines, starting a new subpath only where a move does not
 * continue from the previous one of its kind; moves with no XY travel are
 * left out. Plunges and retracts become zero-length subpaths at their XY
 * position, which render as dots with a round line cap.
 */
export function moveKindPaths(moves: Move[]): KindPaths {
  const parts: Record<Move['kind'], string[]> = { feed: [], rapid: [], plunge: [], retract: [] };
  const last: Partial<Record<Move['kind'], { x: number; y: number }>> = {};
  for (const move of moves) {
    const { kind, from, to } = move;
    const out = parts[kind];
    if (kind === 'plunge' || kind === 'retract') {
      out.push(`M ${to.x} ${to.y} h 0`);
      continue;
    }
    if (from.x === to.x && from.y === to.y && !move.bulge) continue;
    const pen = last[kind];
    if (!pen || pen.x !== from.x || pen.y !== from.y) out.push(`M ${from.x} ${from.y}`);
    out.push(segmentPathData({ type: move.bulge ? 'arc' : 'line', start: from, end: to, bulge: move.bulge }));
    last[kind] = to;
  }
  return { feed: parts.feed.join(' '), rapid: parts.rapid.join(' '), plunge: parts.plunge.join(' '), retract: parts.retract.join(' ') };
}

/** Whether angle `a` lies on the sweep of `theta` radians starting at `a0` (positive = CCW). */
function onSweep(a: number, a0: number, theta: number): boolean {
  const turn = 2 * Math.PI;
  const d = theta >= 0 ? a - a0 : a0 - a;
  return ((d % turn) + turn) % turn <= Math.abs(theta) + 1e-12;
}

/** XY bounds of every move's path, arcs included (their extreme points, not just endpoints), or null for no moves. */
export function moveBounds(moves: Move[]): Bounds | null {
  if (moves.length === 0) return null;
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x);
    b.maxY = Math.max(b.maxY, y);
  };
  for (const move of moves) {
    add(move.from.x, move.from.y);
    add(move.to.x, move.to.y);
    const arc = move.bulge ? arcFromBulge(move.from, move.to, move.bulge) : null;
    if (!arc) continue;
    const a0 = Math.atan2(move.from.y - arc.center.y, move.from.x - arc.center.x);
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2;
      if (onSweep(a, a0, arc.theta)) add(arc.center.x + arc.radius * Math.cos(a), arc.center.y + arc.radius * Math.sin(a));
    }
  }
  return b;
}
