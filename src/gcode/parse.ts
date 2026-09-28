/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The modal interpreter: tokenized lines in, `Move[]` out. Supports basic,
// standard G-code (G0/G1/G2/G3 in the XY plane, G17, G20/G21, G90/G91, F)
// with GRBL's semantics and defaults; every other word is reported, never
// silently ignored.
import type { Units } from '../machine/params';
import { unitFactor } from '../machine/params';
import type { Move, Point3 } from '../toolpath/moves';
import type { Diagnostic, DiagnosticCode, Severity } from './diagnostics';
import type { TokenizedLine } from './tokenize';
import { tokenize } from './tokenize';

/** Where the machine is before the first line, in `units` (home: sheet origin at safe height). */
export type StartPosition = { point: Point3; units: Units };

/**
 * A parsed program. `moves` and every feed rate are in `units`, the
 * program's own units; `lineCount` is the number of source lines.
 */
export type GcodeProgram = {
  moves: Move[];
  units: Units;
  lineCount: number;
  diagnostics: Diagnostic[];
};

/** GRBL's arc end-radius check, in millimeters: fail above `MAX`, or above `MIN` and `RELATIVE` of the radius. */
const ARC_RADIUS_MIN_ERROR_MM = 0.005;
const ARC_RADIUS_MAX_ERROR_MM = 0.5;
const ARC_RADIUS_RELATIVE_ERROR = 0.001;
/** GRBL's ARC_ANGULAR_TRAVEL_EPSILON: an I/J arc sweeping less than this (radians) is a full circle. */
const ARC_ANGULAR_EPSILON = 5e-7;
/** Relative slack for an R arc whose chord is exactly 2R, so rounding does not reject a half circle. */
const R_SLACK = 1e-9;

/** Non-modal G-codes that use the axis words on their line for something other than motion. */
const AXIS_WORD_CODES = new Set([4, 10, 28, 30, 53, 92]);

type Motion = 0 | 1 | 2 | 3;

/** What one line asks for, after grouping its words. */
type Block = {
  motion?: Motion;
  units?: Units;
  absolute?: boolean;
  plane?: 17 | 18 | 19;
  values: Partial<Record<'X' | 'Y' | 'Z' | 'I' | 'J' | 'R' | 'F' | 'S', number>>;
  unsupported: string[];
  /** The line has a G-code (G28, G53, …) that consumes its axis words, so they are not a move. */
  axisWordsUsed: boolean;
};

type BlockResult = { block: Block } | { error: { code: DiagnosticCode; message: string } };

/** Groups a line's words by modal group and value letter, rejecting duplicates. */
function readBlock(line: TokenizedLine): BlockResult {
  const block: Block = { values: {}, unsupported: [], axisWordsUsed: false };
  const groups = new Map<string, string>();
  const setGroup = (group: string, text: string): BlockResult | null => {
    const other = groups.get(group);
    if (other) return { error: { code: 'modal-conflict', message: `${other} and ${text} are in the same modal group` } };
    groups.set(group, text);
    return null;
  };

  for (const word of line.words) {
    const { letter, value, text } = word;
    if (letter === 'G') {
      let conflict: BlockResult | null = null;
      if (value === 0 || value === 1 || value === 2 || value === 3) {
        conflict = setGroup('motion', text);
        block.motion = value;
      } else if (value === 17 || value === 18 || value === 19) {
        conflict = setGroup('plane', text);
        block.plane = value;
      } else if (value === 20 || value === 21) {
        conflict = setGroup('units', text);
        block.units = value === 20 ? 'in' : 'mm';
      } else if (value === 90 || value === 91) {
        conflict = setGroup('distance', text);
        block.absolute = value === 90;
      } else {
        block.unsupported.push(text);
        if (AXIS_WORD_CODES.has(Math.trunc(value))) block.axisWordsUsed = true;
      }
      if (conflict) return conflict;
    } else if (
      letter === 'X' ||
      letter === 'Y' ||
      letter === 'Z' ||
      letter === 'I' ||
      letter === 'J' ||
      letter === 'R' ||
      letter === 'F' ||
      letter === 'S'
    ) {
      if (block.values[letter] !== undefined) {
        return { error: { code: 'duplicate-word', message: `${letter} appears twice on one line` } };
      }
      block.values[letter] = value;
    } else {
      block.unsupported.push(text);
    }
  }
  return { block };
}

/** The first G20/G21 in the file decides the program's units; mm (GRBL's default) if there is none. */
function programUnits(lines: TokenizedLine[]): Units | null {
  for (const line of lines) {
    if (line.error) continue;
    for (const w of line.words) {
      if (w.letter === 'G' && (w.value === 20 || w.value === 21)) return w.value === 20 ? 'in' : 'mm';
    }
  }
  return null;
}

/**
 * Distances at or below this (program units) count as no motion, so unit
 * round-off (a 0.5 in start height that comes back as 0.49999999999999994)
 * neither adds a phantom move nor changes a move's kind.
 */
const SAME = 1e-9;
const sameXY = (a: Point3, b: Point3) => Math.abs(a.x - b.x) <= SAME && Math.abs(a.y - b.y) <= SAME;
const samePoint = (a: Point3, b: Point3) => sameXY(a, b) && Math.abs(a.z - b.z) <= SAME;

/**
 * An arc's center and signed sweep (radians, positive = CCW) from I/J
 * (always incremental from `from`) or R, following GRBL's checks. `values`
 * are already in program units. Returns an error for a bad arc.
 */
function arcGeometry(
  from: Point3,
  to: Point3,
  ccw: boolean,
  values: Block['values'],
  mm: number
): { center: { x: number; y: number }; radius: number; theta: number } | { code: DiagnosticCode; message: string } {
  const { I, J, R } = values;
  if (I === undefined && J === undefined) {
    if (R === undefined) return { code: 'arc-missing-center', message: 'Arc has no I/J or R' };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return { code: 'arc-full-circle-r', message: 'An R arc cannot be a full circle (use I/J)' };
    const r = Math.abs(R);
    if (d > 2 * r * (1 + R_SLACK)) {
      return {
        code: 'arc-radius-too-small',
        message: `Arc radius R${R} is too small for endpoints ${d.toFixed(4)} apart`,
      };
    }
    const half = Math.asin(Math.min(1, d / (2 * r)));
    const minor = 2 * half;
    const sweep = R < 0 ? 2 * Math.PI - minor : minor;
    // A CCW minor arc has its center left of the chord; CW or a major arc flips it.
    const side = (ccw ? 1 : -1) * (R < 0 ? -1 : 1);
    const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2));
    const center = { x: (from.x + to.x) / 2 - (dy / d) * h * side, y: (from.y + to.y) / 2 + (dx / d) * h * side };
    return { center, radius: r, theta: ccw ? sweep : -sweep };
  }

  const center = { x: from.x + (I ?? 0), y: from.y + (J ?? 0) };
  const r0 = Math.hypot(from.x - center.x, from.y - center.y);
  if (r0 === 0) return { code: 'arc-zero-radius', message: 'Arc center is at its start point (I and J are 0)' };
  const r1 = Math.hypot(to.x - center.x, to.y - center.y);
  const delta = Math.abs(r1 - r0);
  if (delta > ARC_RADIUS_MIN_ERROR_MM * mm && (delta > ARC_RADIUS_MAX_ERROR_MM * mm || delta > ARC_RADIUS_RELATIVE_ERROR * r0)) {
    return {
      code: 'arc-radius-mismatch',
      message: `Arc start and end radii differ by ${delta.toPrecision(3)} (start ${r0.toPrecision(6)}, end ${r1.toPrecision(6)})`,
    };
  }
  let theta = Math.atan2(to.y - center.y, to.x - center.x) - Math.atan2(from.y - center.y, from.x - center.x);
  if (ccw) {
    if (theta <= ARC_ANGULAR_EPSILON) theta += 2 * Math.PI;
  } else if (theta >= -ARC_ANGULAR_EPSILON) {
    theta -= 2 * Math.PI;
  }
  return { center, radius: r0, theta };
}

/**
 * Splits a file into its lines the way the parser numbers them: LF or CRLF
 * endings (the CR is dropped), and one trailing newline does not start an
 * extra line. Line `i` here is `sourceLine` / diagnostic line `i`.
 */
export function sourceLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * Parses G-code `text` into moves in the program's units. The program's
 * units come from the first G20/G21, or mm when there is none; a later
 * unit switch is converted. `start` is where the machine is before the
 * first line. Coordinates are world coordinates (Y-up, Z = 0 at the sheet
 * top); I/J are always incremental from the arc start.
 *
 * Kinds: G0 straight up in Z is a `retract`, other G0 a `rapid`; G1
 * straight down in Z is a `plunge`, other G1 a `feed`; G2/G3 are `feed`s
 * with a bulge (negative = CW). An arc sweeping more than 180° is split in
 * two halves on the same line, so a full circle is two half arcs. A bad arc
 * becomes a straight feed to its end point, with an error. Zero-length
 * straight moves are dropped. Every move has a `sourceLine`; feeds and
 * plunges carry the modal F as `feedRate` and the modal S as
 * `spindleRpm` once each is set. (M3/M4/M5 are still reported as
 * unsupported: S is taken as the speed whether or not the spindle is on.)
 */
export function parseGcode(text: string, start: StartPosition): GcodeProgram {
  const lines = sourceLines(text).map(tokenize);

  const diagnostics: Diagnostic[] = [];
  const report = (line: number, severity: Severity, code: DiagnosticCode, message: string) =>
    diagnostics.push({ line, severity, code, message });

  const explicitUnits = programUnits(lines);
  const units: Units = explicitUnits ?? 'mm';
  if (!explicitUnits && lines.length > 0) report(0, 'info', 'no-units', 'No G20/G21 in the file; assuming mm (G21)');
  const mm = unitFactor('mm', units);

  const moves: Move[] = [];
  const s = unitFactor(start.units, units);
  let pos: Point3 = { x: start.point.x * s, y: start.point.y * s, z: start.point.z * s };
  let motion: Motion = 0;
  let absolute = true;
  let lineUnits: Units = 'mm';
  let plane: 17 | 18 | 19 = 17;
  let feedRate: number | undefined;
  let spindleRpm: number | undefined;
  let unitsSet = false;
  let moved = false;
  let missingFeedReported = false;

  const emit = (line: number, kind: Move['kind'], to: Point3, bulge?: number) => {
    if (!bulge && samePoint(pos, to)) return;
    const move: Move = { kind, from: pos, to, sourceLine: line };
    if (bulge) move.bulge = bulge;
    if (kind === 'feed' || kind === 'plunge') {
      if (feedRate !== undefined) move.feedRate = feedRate;
      if (spindleRpm !== undefined) move.spindleRpm = spindleRpm;
    }
    moves.push(move);
    pos = to;
  };

  lines.forEach((tokens, line) => {
    if (tokens.error) {
      report(line, 'error', 'syntax', `${tokens.error}; line skipped`);
      return;
    }
    const result = readBlock(tokens);
    if ('error' in result) {
      report(line, 'error', result.error.code, `${result.error.message}; line skipped`);
      return;
    }
    const { block } = result;
    const { values } = block;

    if (block.units) {
      if (block.units !== lineUnits && (unitsSet || moved)) {
        report(line, 'info', 'unit-change', `Units switch to ${block.units}; converted to ${units}`);
      }
      lineUnits = block.units;
      unitsSet = true;
    }
    if (block.absolute !== undefined) absolute = block.absolute;
    if (block.plane) plane = block.plane;
    const k = unitFactor(lineUnits, units);

    if (values.F !== undefined) {
      if (values.F > 0) feedRate = values.F * k;
      else report(line, 'error', 'invalid-feed', `Feed rate F${values.F} must be positive; ignored`);
    }
    if (values.S !== undefined) {
      if (values.S >= 0) spindleRpm = values.S;
      else report(line, 'error', 'invalid-spindle', `Spindle speed S${values.S} must not be negative; ignored`);
    }
    for (const word of block.unsupported) {
      const detail = block.axisWordsUsed ? '; the axis words on this line are ignored too' : '';
      report(line, 'warning', 'unsupported-word', `${word} is not supported and was ignored${detail}`);
    }
    if (block.motion !== undefined) motion = block.motion;
    if (block.axisWordsUsed) return;

    const { X, Y, Z, I, J, R } = values;
    const arc = motion === 2 || motion === 3;
    const hasAxis = X !== undefined || Y !== undefined || Z !== undefined;
    const arcWords = I !== undefined || J !== undefined || R !== undefined;
    // An arc with only I/J is a full circle at the current position.
    const isMove = hasAxis || (arc && (I !== undefined || J !== undefined));
    if (arcWords && !(arc && isMove)) {
      report(line, 'warning', 'unused-word', 'I/J/R without a G2/G3 move are ignored');
    }
    if (!isMove) return;

    const axis = (value: number | undefined, current: number) =>
      value === undefined ? current : absolute ? value * k : current + value * k;
    const to: Point3 = { x: axis(X, pos.x), y: axis(Y, pos.y), z: axis(Z, pos.z) };
    moved = true;

    if (motion !== 0 && feedRate === undefined && !missingFeedReported) {
      missingFeedReported = true;
      report(line, 'error', 'missing-feed', `G${motion} before any F word; timed with the Feed/Plunge rate parameters`);
    }

    if (motion === 0) {
      const up = sameXY(to, pos) && to.z > pos.z;
      emit(line, up ? 'retract' : 'rapid', to);
      return;
    }
    if (motion === 1) {
      const down = sameXY(to, pos) && to.z < pos.z;
      emit(line, down ? 'plunge' : 'feed', to);
      return;
    }

    if (plane !== 17) {
      report(line, 'error', 'arc-plane', `G${motion} in the G${plane} plane is not supported; drawn as a straight line`);
      emit(line, 'feed', to);
      return;
    }
    const scaled = { I: I === undefined ? undefined : I * k, J: J === undefined ? undefined : J * k, R: R === undefined ? undefined : R * k };
    const geometry = arcGeometry(pos, to, motion === 3, scaled, mm);
    if ('code' in geometry) {
      report(line, 'error', geometry.code, `${geometry.message}; drawn as a straight line`);
      emit(line, 'feed', to);
      return;
    }
    const { center, radius, theta } = geometry;
    if (Math.abs(theta) <= Math.PI) {
      emit(line, 'feed', to, Math.tan(theta / 4));
      return;
    }
    const a = Math.atan2(pos.y - center.y, pos.x - center.x) + theta / 2;
    const mid: Point3 = {
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
      z: (pos.z + to.z) / 2,
    };
    const bulge = Math.tan(theta / 8);
    emit(line, 'feed', mid, bulge);
    emit(line, 'feed', to, bulge);
  });

  return { moves, units, lineCount: lines.length, diagnostics };
}
