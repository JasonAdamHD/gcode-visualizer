import type { Path, Point } from './segment';
import { distance } from './segment';

export type SnapResult = {
  point: Point;
  snapped: boolean;
  type?: 'endpoint' | 'grid' | 'axis' | 'none';
};

const EPSILON_SIZE = 1e-3;

/** Picks a "nice" grid spacing (1/2/5 * 10^n) targeting roughly `targetDivisions` lines across the sheet. 
 * @param sheetX - The width of the sheet.
 * @param sheetY - The height of the sheet.
 * @param targetDivisions - The target number of divisions across the smaller dimension of the sheet.
 * @returns A "nice" grid spacing value.
*/
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

/** Snaps a point to the nearest grid intersection based on the given grid spacing. 
 * @param point - The point to snap to the grid.
 * @param gridSpacing - The spacing of the grid to snap to.
 * @returns A new point snapped to the nearest grid intersection.
*/
export function snapToGrid(point: Point, gridSpacing: number): Point {
  return {
    x: Math.round(point.x / gridSpacing) * gridSpacing,
    y: Math.round(point.y / gridSpacing) * gridSpacing,
  };
}

/** Finds the point in the path nearest to candidate, checking every segment's end plus
 * the very first segment's start.
 * Assumes path is one contiguous chain (each segment's start == the previous segment's
 * end), so only the very first start needs checking explicitly — every other start is
 * already covered by the prior segment's end. Won't hold for disconnected paths (e.g.
 * imported G-code with rapid moves).
 * @param candidate - The point to measure distance from.
 * @param path - The path to search.
 * @returns The nearest point and its distance, or null if the path is empty.
*/
function nearestPathEndpoint(candidate: Point, path: Path): { point: Point; distance: number } | null {
  if (path.length === 0) return null;
  let nearestPoint = path[0].start;
  let nearestDist = distance(candidate, nearestPoint);
  for (const seg of path) {
    const d = distance(candidate, seg.end);
    if (d < nearestDist) {
      nearestDist = d;
      nearestPoint = seg.end;
    }
  }
  return { point: nearestPoint, distance: nearestDist };
}

/** Snaps to the nearest existing endpoint first, then grid intersections, else returns the raw candidate.
 * @param candidate - The candidate point to snap to.
 * @param path - The current path to check for existing endpoints.
 * @param gridSpacing - The spacing of the grid to snap to.
 * @param tolerance - The maximum distance to snap to an endpoint or grid point.
 * @returns A SnapResult indicating the snapped point and whether it was snapped to an endpoint, grid, or neither.
*/
export function findSnapPoint(
  candidate: Point,
  path: Path,
  gridSpacing: number,
  tolerance: number
): SnapResult {
  const nearest = nearestPathEndpoint(candidate, path);

  if (nearest && nearest.distance <= tolerance) {
    return { point: nearest.point, snapped: true, type: 'endpoint' };
  }

  const gridPoint = snapToGrid(candidate, gridSpacing);
  if (distance(candidate, gridPoint) <= tolerance) {
    return { point: gridPoint, snapped: true, type: 'grid' };
  }

  return { point: candidate, snapped: false, type: 'none' };
}

/** Snaps to the nearest axis-aligned point relative to the reference point. 
 * @param reference - The reference point to snap from.
 * @param candidate - The candidate point to snap to.
 * @returns A SnapResult indicating the snapped point along the axis.
*/
export function constrainToAxis(reference: Point, candidate: Point): SnapResult {
  const dx = candidate.x - reference.x;
  const dy = candidate.y - reference.y;
  if (Math.abs(dx) < Math.abs(dy)) {
    const point: Point = { x: reference.x, y: candidate.y };
    return { point: point, snapped: true, type: 'axis' };
  } else {
    const point: Point = { x: candidate.x, y: reference.y };
    return { point: point, snapped: true, type: 'axis' };
  }
}

/** Snaps to the candidate point without any constraints. 
 * @param candidate - The candidate point to place the point at.
 * @returns A SnapResult indicating that the candidate point is not snapped to any grid or axis.
*/
export function snapToNothing(candidate: Point): SnapResult {
  return { point: { x: candidate.x, y: candidate.y }, snapped: false, type: 'none' };
}
