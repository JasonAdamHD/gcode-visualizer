export type Point = { x: number; y: number };

export type Segment = {
  type: 'line' | 'arc';
  start: Point;
  end: Point;
  bulge?: number; // DXF-style bulge factor (tan of quarter included angle)
                   // 0 = straight line, +/- = arc direction/curvature
};

export type Path = Segment[];

const EPSILON = 1e-6;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function pointsEqual(a: Point, b: Point, epsilon = EPSILON): boolean {
  return distance(a, b) < epsilon;
}

export type ArcGeometry = {
  center: Point;
  radius: number;
  theta: number; // signed included angle, radians (positive = CCW)
  largeArc: boolean;
  sweep: boolean; // true -> SVG sweep-flag 1
};

/**
 * Arc center/radius from a chord and DXF-style bulge, using the standard
 * relations: theta = 4*atan(bulge), r = L*(1+b^2)/(4b), with the chord's
 * perpendicular measured clockwise from start->end so that positive bulge
 * yields a counterclockwise sweep in world (Y-up) coordinates.
 */
export function arcFromBulge(start: Point, end: Point, bulge: number): ArcGeometry | null {
  if (!bulge) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength < EPSILON) return null;

  const ux = dx / chordLength;
  const uy = dy / chordLength;
  const px = uy;
  const py = -ux;

  const theta = 4 * Math.atan(bulge);
  const radius = Math.abs((chordLength * (1 + bulge * bulge)) / (4 * bulge));
  const centerOffset = (chordLength * (1 - bulge * bulge)) / (4 * bulge);
  const mid = midpoint(start, end);
  const center = { x: mid.x + px * centerOffset, y: mid.y + py * centerOffset };

  return {
    center,
    radius,
    theta,
    largeArc: Math.abs(theta) > Math.PI,
    sweep: bulge > 0,
  };
}

/** The point on the arc farthest from the chord (its own midpoint). */
export function sagittaPoint(start: Point, end: Point, bulge: number): Point {
  const mid = midpoint(start, end);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength < EPSILON) return mid;
  const ux = dx / chordLength;
  const uy = dy / chordLength;
  const px = uy;
  const py = -ux;
  const h = (bulge * chordLength) / 2;
  return { x: mid.x + px * h, y: mid.y + py * h };
}

/** Inverse of sagittaPoint: the bulge whose arc's midpoint passes through dragPoint. */
export function bulgeFromDrag(start: Point, end: Point, dragPoint: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chordLength = Math.hypot(dx, dy);
  if (chordLength < EPSILON) return 0;
  const ux = dx / chordLength;
  const uy = dy / chordLength;
  const px = uy;
  const py = -ux;
  const mid = midpoint(start, end);
  const h = (dragPoint.x - mid.x) * px + (dragPoint.y - mid.y) * py;
  return (2 * h) / chordLength;
}

/** The draggable handle position for a segment: its arc sagitta, or chord midpoint for a line. */
export function segmentHandlePoint(segment: Segment): Point {
  const bulge = segment.bulge ?? 0;
  if (!bulge) return midpoint(segment.start, segment.end);
  return sagittaPoint(segment.start, segment.end, bulge);
}

/** SVG path drawing command (L or A) that draws this segment, assuming the pen is at segment.start. */
export function segmentPathData(segment: Segment): string {
  const bulge = segment.bulge ?? 0;
  const arc = bulge ? arcFromBulge(segment.start, segment.end, bulge) : null;
  if (!arc) {
    return `L ${segment.end.x} ${segment.end.y}`;
  }
  const largeArcFlag = arc.largeArc ? 1 : 0;
  const sweepFlag = arc.sweep ? 1 : 0;
  return `A ${arc.radius} ${arc.radius} 0 ${largeArcFlag} ${sweepFlag} ${segment.end.x} ${segment.end.y}`;
}

export function pathToSvgPath(path: Path): string {
  if (path.length === 0) return '';
  const commands = [`M ${path[0].start.x} ${path[0].start.y}`];
  for (const segment of path) {
    commands.push(segmentPathData(segment));
  }
  return commands.join(' ');
}

export function isPathClosed(path: Path, epsilon = 1e-3): boolean {
  if (path.length < 3) return false;
  return pointsEqual(path[0].start, path[path.length - 1].end, epsilon);
}

export function pathLength(path: Path): number {
  let total = 0;
  for (const seg of path) {
    const bulge = seg.bulge ?? 0;
    const arc = bulge ? arcFromBulge(seg.start, seg.end, bulge) : null;
    total += arc ? arc.radius * Math.abs(arc.theta) : distance(seg.start, seg.end);
  }
  return total;
}
