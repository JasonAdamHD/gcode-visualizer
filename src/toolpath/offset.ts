/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The only module that imports cavalier-contours-js. Everything else talks
// to it through `Path`, so the offset engine can be swapped (e.g. for
// Clipper2) by rewriting this file alone. Never offset paths by hand.
import { Polyline } from 'cavalier-contours-js';
import type { Path, Segment } from '../geometry/segment';
import type { MachineParams } from '../machine/params';

/**
 * Which side of the drawn path the cutter runs on. `outside`/`inside` apply
 * to closed paths; `left`/`right` apply to open paths and are relative to
 * the drawing direction in Y-up world coordinates; `on` (cutter centered on
 * the line) applies to either.
 */
export type CutSide = 'outside' | 'inside' | 'left' | 'right' | 'on';

/**
 * Offset loops plus, per loop, whether it is closed. Closure is per loop
 * because offsetting a self-intersecting closed path can yield open pieces.
 */
export type OffsetResult = { loops: Path[]; closed: boolean[]; warning?: string };

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** The cut side a new path gets: `outside` for a closed path, `on` for an open one. */
export function defaultCutSide(closed: boolean): CutSide {
  return closed ? 'outside' : 'on';
}

/**
 * Maps a cut side that no longer fits the path (e.g. `inside` after the path
 * was reopened, or `left` after it was closed) to that path's default, and
 * returns valid sides unchanged.
 */
export function effectiveCutSide(side: CutSide, closed: boolean): CutSide {
  if (side === 'on') return side;
  const closedSide = side === 'outside' || side === 'inside';
  return closedSide === closed ? side : defaultCutSide(closed);
}

/**
 * Cutter compensation radius, in `params.units`: the widest cutting radius
 * anywhere inside the material, so the drawn contour is never gouged at any
 * depth. The material depth is sheet thickness plus spoilboard penetration.
 * Flat: D/2. Ball: D/2 once the cut is at least D/2 deep, else the radius of
 * the circle where the sphere crosses the sheet top. V-bit: the cone's
 * radius at the sheet top, capped at D/2.
 */
export function compensationRadius(params: MachineParams): number {
  const depth = params.sheet.thickness + params.spoilboardPenetration;
  const d = params.bit.diameter;
  const shape = params.bit.shape;
  switch (shape.kind) {
    case 'flat':
      return d / 2;
    case 'ball':
      return depth >= d / 2 ? d / 2 : Math.sqrt(depth * (d - depth));
    case 'vbit':
      return Math.min(d / 2, depth * Math.tan(((shape.includedAngleDeg / 2) * Math.PI) / 180));
  }
}

/**
 * Converts a path to a polyline: vertex i is `segments[i].start` carrying
 * `segments[i].bulge` (same DXF bulge convention on both sides). A closed
 * path does not repeat its first point; the closing segment's bulge sits on
 * the last vertex. An open path gets a final bulge-0 vertex at its end.
 */
export function pathToPolyline(path: Path, closed: boolean): Polyline {
  const pline = new Polyline({ isClosed: closed });
  for (const seg of path) pline.add(seg.start.x, seg.start.y, seg.bulge ?? 0);
  if (!closed && path.length > 0) {
    const end = path[path.length - 1].end;
    pline.add(end.x, end.y, 0);
  }
  return pline;
}

/** Inverse of `pathToPolyline`; a closed polyline's last segment ends exactly at its first vertex. */
export function polylineToPath(pline: Polyline): Path {
  const n = pline.vertexCount;
  const count = pline.isClosed ? n : n - 1;
  const path: Path = [];
  for (let i = 0; i < count; i++) {
    const a = pline.at(i);
    const b = pline.at((i + 1) % n);
    const segment: Segment = {
      type: a.bulge ? 'arc' : 'line',
      start: { x: a.x, y: a.y },
      end: { x: b.x, y: b.y },
      bulge: a.bulge,
    };
    path.push(segment);
  }
  return path;
}

/**
 * Offsets `path` by `radius` (world units) to the requested `side`, giving
 * the cutter-center toolpath. Arcs stay arcs. Closed paths are normalized
 * first, so `outside`/`inside` don't depend on whether the user drew CW or
 * CCW; an inside offset may split into several loops or vanish (then
 * `loops` is empty and `warning` says why). `on` returns the path unchanged.
 * A self-intersecting closed path can offset into open pieces, so check
 * `closed[i]` rather than assuming the input's closure.
 *
 * Output direction is normalized to climb milling for a clockwise spindle:
 * the kept material is on the cutter's right, so outside profiles run CW,
 * inside profiles CCW, and a `left` open cut runs in the drawing direction
 * while a `right` one is reversed. It doesn't change cut time, but the 3D
 * simulation relies on it.
 */
export function offsetPath(path: Path, closed: boolean, side: CutSide, radius: number): OffsetResult {
  if (path.length === 0) return { loops: [], closed: [] };
  if (side === 'on' || radius <= 0) return { loops: [path], closed: [closed] };

  const pline = pathToPolyline(path, closed);
  let delta: number;
  if (closed) {
    // Positive offsets go left of the direction of travel: inward on CCW.
    if (pline.area() < 0) pline.invertDirectionMut();
    delta = side === 'inside' ? radius : -radius;
  } else {
    delta = side === 'left' ? radius : -radius;
  }

  const results = pline
    .parallelOffsetOpt(delta, { handleSelfIntersects: true })
    .filter((loop) => loop.vertexCount > 1);
  for (const loop of results) {
    let reverse: boolean;
    if (loop.isClosed) reverse = (side === 'outside') === (loop.area() > 0); // outside -> CW, inside -> CCW
    else if (!closed) reverse = side === 'right';
    else reverse = false; // open piece of a self-intersecting closed path: no clear material side
    if (reverse) loop.invertDirectionMut();
  }

  const loops = results.map(polylineToPath);
  const loopClosed = results.map((loop) => loop.isClosed);
  if (loops.length === 0) {
    return {
      loops,
      closed: loopClosed,
      warning: side === 'inside' ? 'Bit is too large for this inside cut' : 'Offset produced no toolpath',
    };
  }
  return { loops, closed: loopClosed };
}

/**
 * Axis-aligned bounds of the toolpath loops, including arc bulges, or null
 * when there are none. `closed[i]` says whether loop i is closed.
 */
export function toolpathBounds(loops: Path[], closed: boolean[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const [i, loop] of loops.entries()) {
    const e = pathToPolyline(loop, closed[i]).extents();
    if (!e) continue;
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, e.minX),
          minY: Math.min(bounds.minY, e.minY),
          maxX: Math.max(bounds.maxX, e.maxX),
          maxY: Math.max(bounds.maxY, e.maxY),
        }
      : { minX: e.minX, minY: e.minY, maxX: e.maxX, maxY: e.maxY };
  }
  return bounds;
}

/** Warning text when `bounds` leaves the sheet (`0..sheet.x`, `0..sheet.y`), else undefined. */
export function sheetBoundsWarning(bounds: Bounds | null, sheet: { x: number; y: number }): string | undefined {
  const eps = 1e-9;
  if (!bounds) return undefined;
  const outside =
    bounds.minX < -eps || bounds.minY < -eps || bounds.maxX > sheet.x + eps || bounds.maxY > sheet.y + eps;
  return outside ? 'Toolpath extends past the sheet edge' : undefined;
}
