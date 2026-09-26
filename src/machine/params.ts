/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type Units = 'in' | 'mm';

/**
 * Cutting bit profile. A discriminated union so that a future
 * `{ kind: 'custom'; profile: Point[] }` (user-drawn bit, README Phase 7)
 * slots in without reshaping callers.
 */
export type BitShape =
  | { kind: 'flat' }
  | { kind: 'ball' }
  | { kind: 'vbit'; includedAngleDeg: number };

export type BitKind = BitShape['kind'];

/**
 * Machine/job configuration. Every length is in `units`; rates are in
 * `units` per minute. Angles are degrees and are unit-independent.
 */
export type MachineParams = {
  version: 1;
  units: Units;
  sheet: { x: number; y: number; thickness: number };
  bit: { diameter: number; shape: BitShape };
  /** Units per minute, XY cutting moves. */
  feedRate: number;
  /** Units per minute, Z moves. */
  plungeRate: number;
  /** Depth cut below the sheet bottom into the spoilboard, >= 0. */
  spoilboardPenetration: number;
};

/** Identifies a single editable numeric field, for field-level validation errors. */
export type FieldKey =
  | 'sheet.x'
  | 'sheet.y'
  | 'sheet.thickness'
  | 'bit.diameter'
  | 'bit.includedAngleDeg'
  | 'feedRate'
  | 'plungeRate'
  | 'spoilboardPenetration';

export type ValidationErrors = Partial<Record<FieldKey, string>>;

/** Default job in inches: a 4 × 8 ft sheet of 3/4" stock and a 1/4" flat end mill. */
export const DEFAULT_PARAMS: MachineParams = {
  version: 1,
  units: 'in',
  sheet: { x: 96, y: 48, thickness: 0.75 },
  bit: { diameter: 0.25, shape: { kind: 'flat' } },
  feedRate: 200,
  plungeRate: 50,
  spoilboardPenetration: 0.01,
};

export const MM_PER_INCH = 25.4;

/** Multiplier that converts a length (or length-per-time) from `from` units to `to` units. */
export function unitFactor(from: Units, to: Units): number {
  if (from === to) return 1;
  return from === 'in' ? MM_PER_INCH : 1 / MM_PER_INCH;
}

/**
 * Converts every length and rate in `params` to `to` units, so the physical
 * job is unchanged. Angles and bit kind are left alone. Values are not
 * rounded (round only for display). Returns `params` itself if the units
 * already match.
 */
export function convertParams(params: MachineParams, to: Units): MachineParams {
  if (params.units === to) return params;
  const f = unitFactor(params.units, to);
  return {
    version: 1,
    units: to,
    sheet: {
      x: params.sheet.x * f,
      y: params.sheet.y * f,
      thickness: params.sheet.thickness * f,
    },
    bit: { diameter: params.bit.diameter * f, shape: params.bit.shape },
    feedRate: params.feedRate * f,
    plungeRate: params.plungeRate * f,
    spoilboardPenetration: params.spoilboardPenetration * f,
  };
}

/** Decimal places used to display lengths and rates: 4 for inches, 2 for millimeters. */
export function displayDecimals(units: Units): number {
  return units === 'in' ? 4 : 2;
}

/**
 * Rounds for display only and trims trailing zeros, e.g. (0.25, 4) -> "0.25".
 * Stored values are never rounded.
 */
export function formatNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

const isNum = (v: number) => typeof v === 'number' && Number.isFinite(v);

/**
 * Field-level hard errors (empty object when valid). Lengths and rates must
 * be positive, spoilboard penetration non-negative, and a V-bit's included
 * angle strictly between 0° and 180°.
 */
export function validateParams(params: MachineParams): ValidationErrors {
  const errors: ValidationErrors = {};
  const positive = (key: FieldKey, v: number) => {
    if (!isNum(v) || v <= 0) errors[key] = 'Must be greater than 0';
  };
  positive('sheet.x', params.sheet.x);
  positive('sheet.y', params.sheet.y);
  positive('sheet.thickness', params.sheet.thickness);
  positive('bit.diameter', params.bit.diameter);
  positive('feedRate', params.feedRate);
  positive('plungeRate', params.plungeRate);
  if (!isNum(params.spoilboardPenetration) || params.spoilboardPenetration < 0) {
    errors.spoilboardPenetration = 'Must be 0 or greater';
  }
  if (params.bit.shape.kind === 'vbit') {
    const a = params.bit.shape.includedAngleDeg;
    if (!isNum(a) || a <= 0 || a >= 180) errors['bit.includedAngleDeg'] = 'Must be between 0° and 180°';
  }
  return errors;
}

/** Serializes params as pretty-printed JSON, for localStorage and settings-file export. */
export function serializeParams(params: MachineParams): string {
  return JSON.stringify(params, null, 2);
}

export type ParseResult = { ok: true; params: MachineParams } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses and validates serialized params (from localStorage or an imported
 * file). Checks shape, `version === 1`, field types, and `validateParams`.
 * Unknown extra fields are dropped. Never throws.
 */
export function parseParams(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  if (!isObject(raw)) return { ok: false, error: 'Expected a JSON object' };
  if (raw.version !== 1) return { ok: false, error: 'Unsupported settings version' };
  if (raw.units !== 'in' && raw.units !== 'mm') return { ok: false, error: 'Units must be "in" or "mm"' };

  const { sheet, bit } = raw;
  if (!isObject(sheet)) return { ok: false, error: 'Missing sheet' };
  if (!isObject(bit) || !isObject(bit.shape)) return { ok: false, error: 'Missing bit' };

  const numbers: [string, unknown][] = [
    ['sheet.x', sheet.x],
    ['sheet.y', sheet.y],
    ['sheet.thickness', sheet.thickness],
    ['bit.diameter', bit.diameter],
    ['feedRate', raw.feedRate],
    ['plungeRate', raw.plungeRate],
    ['spoilboardPenetration', raw.spoilboardPenetration],
  ];
  for (const [name, v] of numbers) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `${name} must be a number` };
  }

  let shape: BitShape;
  switch (bit.shape.kind) {
    case 'flat':
    case 'ball':
      shape = { kind: bit.shape.kind };
      break;
    case 'vbit':
      if (typeof bit.shape.includedAngleDeg !== 'number') {
        return { ok: false, error: 'bit.includedAngleDeg must be a number' };
      }
      shape = { kind: 'vbit', includedAngleDeg: bit.shape.includedAngleDeg };
      break;
    default:
      return { ok: false, error: 'Unknown bit shape' };
  }

  const params: MachineParams = {
    version: 1,
    units: raw.units,
    sheet: { x: sheet.x as number, y: sheet.y as number, thickness: sheet.thickness as number },
    bit: { diameter: bit.diameter as number, shape },
    feedRate: raw.feedRate as number,
    plungeRate: raw.plungeRate as number,
    spoilboardPenetration: raw.spoilboardPenetration as number,
  };

  const errors = Object.entries(validateParams(params));
  if (errors.length > 0) {
    const [field, message] = errors[0];
    return { ok: false, error: `${field}: ${message}` };
  }
  return { ok: true, params };
}
