import type { Path, Point } from './segment';
import { distance } from './segment';

export type SnapResult = {
  point: Point;
  snapped: boolean;
  type?: 'endpoint' | 'grid';
};

const EPSILON_SIZE = 1e-3;

/** Picks a "nice" grid spacing (1/2/5 * 10^n) targeting roughly `targetDivisions` lines across the sheet. */
export function niceGridSpacing(sheetX: number, sheetY: number, targetDivisions = 20): number {
  const smaller = Math.max(Math.min(sheetX, sheetY), EPSILON_SIZE);
  const raw = smaller / targetDivisions;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  let niceNormalized: number;
  if (normalized < 1.5) niceNormalized = 1;
  else if (normalized < 3.5) niceNormalized = 2;
  else if (normalized < 7.5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

export function snapToGrid(point: Point, gridSpacing: number): Point {
  return {
    x: Math.round(point.x / gridSpacing) * gridSpacing,
    y: Math.round(point.y / gridSpacing) * gridSpacing,
  };
}

export function collectEndpoints(path: Path): Point[] {
  const points: Point[] = [];
  for (const seg of path) {
    points.push(seg.start, seg.end);
  }
  return points;
}

/** Snaps to the nearest existing endpoint first, then grid intersections, else returns the raw candidate. */
export function findSnapPoint(
  candidate: Point,
  path: Path,
  gridSpacing: number,
  tolerance: number
): SnapResult {
  let nearestEndpoint: Point | null = null;
  let nearestEndpointDist = Infinity;
  for (const p of collectEndpoints(path)) {
    const d = distance(candidate, p);
    if (d < nearestEndpointDist) {
      nearestEndpointDist = d;
      nearestEndpoint = p;
    }
  }
  if (nearestEndpoint && nearestEndpointDist <= tolerance) {
    return { point: nearestEndpoint, snapped: true, type: 'endpoint' };
  }

  const gridPoint = snapToGrid(candidate, gridSpacing);
  if (distance(candidate, gridPoint) <= tolerance) {
    return { point: gridPoint, snapped: true, type: 'grid' };
  }

  return { point: candidate, snapped: false };
}
