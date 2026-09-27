/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Job checks on a move list against the machine setup: things that parse
// fine but would damage the part, the spoilboard or the bit.
import type { MachineParams } from '../machine/params';
import { displayDecimals, formatNumber } from '../machine/params';
import type { Move, Point3 } from '../toolpath/moves';
import { linearize } from '../toolpath/planner';
import type { Diagnostic } from './diagnostics';

/** Slack for comparisons, so a value exactly on a limit passes (as in `sheetBoundsWarning`). */
const EPS = 1e-9;

/**
 * Checks `moves` (in `params.units`, Z = 0 at the sheet top) against the
 * sheet and returns diagnostics in move order:
 *
 * - `rapid-into-material` (error): a rapid that ends below Z = 0 deeper than
 *   anything cut so far, or moves in XY while below Z = 0. Rapiding down
 *   into an already-cut slot (as `buildMoves` does on later passes) passes.
 * - `too-deep` (error): a move ending below −(thickness + spoilboard
 *   penetration).
 * - `out-of-bounds` (warning): a feed or plunge that is below Z = 0 outside
 *   the sheet (`0..sheet.x`, `0..sheet.y`) in XY anywhere along its length:
 *   arcs along their chords, ramps from where they cross Z = 0.
 * - `no-cut` (info): nothing goes below Z = 0.
 *
 * `line` is the move's `sourceLine`, or −1 for a move without one.
 */
export function analyzeProgram(moves: Move[], params: MachineParams): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (moves.length === 0) return diagnostics;

  const decimals = displayDecimals(params.units);
  const fmt = (v: number) => `${formatNumber(v, decimals)} ${params.units}`;
  const { sheet } = params;
  const floor = -(sheet.thickness + params.spoilboardPenetration);
  const outsideXY = (p: Point3) => p.x < -EPS || p.y < -EPS || p.x > sheet.x + EPS || p.y > sheet.y + EPS;
  // The part of chord a→b below Z = 0 is itself a straight piece; the sheet
  // is convex, so it leaves the sheet exactly when one of its ends does.
  const cutsOutside = (a: Point3, b: Point3) => {
    if (a.z >= -EPS && b.z >= -EPS) return false;
    const clip = (p: Point3, q: Point3): Point3 => {
      if (p.z < 0) return p;
      const t = p.z / (p.z - q.z);
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: 0 };
    };
    return outsideXY(clip(a, b)) || outsideXY(clip(b, a));
  };

  // Chord points of each move in order (block starts, then its end), so arcs
  // are checked along their length.
  const points: Point3[][] = moves.map(() => []);
  for (const block of linearize(moves, params)) points[block.move].push(block.from);
  moves.forEach((m, i) => points[i].push(m.to));
  const leavesSheet = (chord: Point3[]) => chord.some((p, k) => k > 0 && cutsOutside(chord[k - 1], p));

  let deepest = moves[0].from.z;
  let cut = false;
  moves.forEach((move, i) => {
    const line = move.sourceLine ?? -1;
    const { from, to } = move;
    const lowest = Math.min(from.z, to.z);

    if (move.kind === 'rapid') {
      const movesXY = Math.abs(to.x - from.x) > EPS || Math.abs(to.y - from.y) > EPS;
      if (movesXY && lowest < -EPS) {
        diagnostics.push({
          line,
          severity: 'error',
          code: 'rapid-into-material',
          message: `Rapid moves sideways at Z ${fmt(lowest)}, below the sheet top`,
        });
      } else if (to.z < -EPS && to.z < deepest - EPS) {
        diagnostics.push({
          line,
          severity: 'error',
          code: 'rapid-into-material',
          message: `Rapid down to Z ${fmt(to.z)}, below anything cut so far (${fmt(Math.min(deepest, 0))})`,
        });
      }
    }

    if (to.z < floor - EPS) {
      diagnostics.push({
        line,
        severity: 'error',
        code: 'too-deep',
        message: `Z ${fmt(to.z)} is below the sheet bottom plus spoilboard penetration (${fmt(floor)})`,
      });
    }

    if ((move.kind === 'feed' || move.kind === 'plunge') && leavesSheet(points[i])) {
      diagnostics.push({
        line,
        severity: 'warning',
        code: 'out-of-bounds',
        message: `Cut leaves the ${formatNumber(sheet.x, decimals)} × ${formatNumber(sheet.y, decimals)} sheet`,
      });
    }

    if (lowest < -EPS) cut = true;
    deepest = Math.min(deepest, to.z);
  });

  if (!cut) {
    diagnostics.push({ line: 0, severity: 'info', code: 'no-cut', message: 'The program never goes below the sheet top (Z 0)' });
  }
  return diagnostics;
}
