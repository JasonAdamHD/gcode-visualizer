/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type Units = 'in' | 'mm';

/**
 * Cutting bit profile. A discriminated union so that a future
 * `{ kind: 'custom'; profile: Point[] }` (user-drawn bit, README Phase 8)
 * slots in without reshaping callers.
 */
export type BitShape =
  | { kind: 'flat' }
  | { kind: 'ball' }
  | { kind: 'vbit'; includedAngleDeg: number };

export type BitKind = BitShape['kind'];

/**
 * Machine/job configuration. Every length is in `units`; rates are in
 * `units` per minute, acceleration in `units` per second². Angles are
 * degrees and are unit-independent.
 */
export type MachineParams = {
  version: 2;
  units: Units;
  sheet: { x: number; y: number; thickness: number };
  bit: { diameter: number; shape: BitShape };
  /** Units per minute, XY cutting moves. */
  feedRate: number;
  /** Units per minute, Z moves. */
  plungeRate: number;
  /** Depth cut below the sheet bottom into the spoilboard, >= 0. */
  spoilboardPenetration: number;
  /** Units per minute, G0 moves in XY. */
  rapidRateXY: number;
  /** Units per minute, G0 moves in Z (retracts and rapid lowers). */
  rapidRateZ: number;
  /** Height above the sheet top for rapid travel, > 0. */
  safeHeight: number;
  /** Maximum step-down per depth pass, > 0. */
  depthPerPass: number;
  /** Units per second², applied to every axis (GRBL-style planner). */
  acceleration: number;
  /** GRBL junction deviation (a length), >= 0; 0 stops fully at every corner. */
  junctionDeviation: number;
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
  | 'spoilboardPenetration'
  | 'rapidRateXY'
  | 'rapidRateZ'
  | 'safeHeight'
  | 'depthPerPass'
  | 'acceleration'
  | 'junctionDeviation';

export type ValidationErrors = Partial<Record<FieldKey, string>>;

/** Default job in inches: a 4 × 8 ft sheet of 3/4" stock and a 1/4" flat end mill. */
export const DEFAULT_PARAMS: MachineParams = {
  version: 2,
  units: 'in',
  sheet: { x: 96, y: 48, thickness: 0.75 },
  bit: { diameter: 0.25, shape: { kind: 'flat' } },
  feedRate: 200,
  plungeRate: 50,
  spoilboardPenetration: 0.01,
  rapidRateXY: 400,
  rapidRateZ: 150,
  safeHeight: 0.5,
  depthPerPass: 0.25,
  acceleration: 10,
  junctionDeviation: 0.002,
};

export const MM_PER_INCH = 25.4;

/** Multiplier that converts a length (or length-per-time) from `from` units to `to` units. */
export function unitFactor(from: Units, to: Units): number {
  if (from === to) return 1;
  return from === 'in' ? MM_PER_INCH : 1 / MM_PER_INCH;
}

/**
 * Converts every length, rate and acceleration in `params` to `to` units,
 * so the physical job is unchanged. Angles and bit kind are left alone. Values are not
 * rounded (round only for display). Returns `params` itself if the units
 * already match.
 */
export function convertParams(params: MachineParams, to: Units): MachineParams {
  if (params.units === to) return params;
  const f = unitFactor(params.units, to);
  return {
    version: 2,
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
    rapidRateXY: params.rapidRateXY * f,
    rapidRateZ: params.rapidRateZ * f,
    safeHeight: params.safeHeight * f,
    depthPerPass: params.depthPerPass * f,
    acceleration: params.acceleration * f,
    junctionDeviation: params.junctionDeviation * f,
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
 * Field-level hard errors (empty object when valid). Lengths, rates and
 * acceleration must be positive, spoilboard penetration and junction
 * deviation non-negative, and a V-bit's included angle strictly between 0°
 * and 180°.
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
  positive('rapidRateXY', params.rapidRateXY);
  positive('rapidRateZ', params.rapidRateZ);
  positive('safeHeight', params.safeHeight);
  positive('depthPerPass', params.depthPerPass);
  positive('acceleration', params.acceleration);
  const nonNegative = (key: FieldKey, v: number) => {
    if (!isNum(v) || v < 0) errors[key] = 'Must be 0 or greater';
  };
  nonNegative('spoilboardPenetration', params.spoilboardPenetration);
  nonNegative('junctionDeviation', params.junctionDeviation);
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
 * file). Checks shape, version, field types, and `validateParams`. Unknown
 * extra fields are dropped. Never throws.
 *
 * Version 1 (before the motion fields existed) is migrated: the missing
 * fields take `DEFAULT_PARAMS` converted into the file's units, so old
 * localStorage and exported files keep working. Other versions are rejected.
 */
export function parseParams(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  if (!isObject(raw)) return { ok: false, error: 'Expected a JSON object' };
  if (raw.version !== 1 && raw.version !== 2) return { ok: false, error: 'Unsupported settings version' };
  if (raw.units !== 'in' && raw.units !== 'mm') return { ok: false, error: 'Units must be "in" or "mm"' };
  const units: Units = raw.units;
  if (raw.version === 1) {
    const d = convertParams(DEFAULT_PARAMS, units);
    Object.assign(raw, {
      rapidRateXY: d.rapidRateXY,
      rapidRateZ: d.rapidRateZ,
      safeHeight: d.safeHeight,
      depthPerPass: d.depthPerPass,
      acceleration: d.acceleration,
      junctionDeviation: d.junctionDeviation,
    });
  }

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
    ['rapidRateXY', raw.rapidRateXY],
    ['rapidRateZ', raw.rapidRateZ],
    ['safeHeight', raw.safeHeight],
    ['depthPerPass', raw.depthPerPass],
    ['acceleration', raw.acceleration],
    ['junctionDeviation', raw.junctionDeviation],
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
    version: 2,
    units,
    sheet: { x: sheet.x as number, y: sheet.y as number, thickness: sheet.thickness as number },
    bit: { diameter: bit.diameter as number, shape },
    feedRate: raw.feedRate as number,
    plungeRate: raw.plungeRate as number,
    spoilboardPenetration: raw.spoilboardPenetration as number,
    rapidRateXY: raw.rapidRateXY as number,
    rapidRateZ: raw.rapidRateZ as number,
    safeHeight: raw.safeHeight as number,
    depthPerPass: raw.depthPerPass as number,
    acceleration: raw.acceleration as number,
    junctionDeviation: raw.junctionDeviation as number,
  };

  const errors = Object.entries(validateParams(params));
  if (errors.length > 0) {
    const [field, message] = errors[0];
    return { ok: false, error: `${field}: ${message}` };
  }
  return { ok: true, params };
}
