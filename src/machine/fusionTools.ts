/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Reads Autodesk Fusion tool libraries (its JSON export: `{ data: [...] }`)
// into this app's tools. Only the fields this app uses are read:
// - `type`: "flat end mill", "ball end mill", "bull nose end mill" (as flat,
//   corner radius ignored), "chamfer mill" (a V-bit whose `TA` is the half
//   angle), "counter sink"/"countersink" (a V-bit whose `SIG` is the full
//   point angle). Other types (drills, taps, face mills, …) are skipped.
// - `geometry.DC` diameter, `geometry.NOF` flutes, `unit` "inches" or
//   "millimeters", `post-process.number` tool number, `description` name.
// - Speeds and feeds from `start-values`: the older `"*"` entry or the first
//   of the newer `presets`: `n` RPM, `v_f` feed, `v_f_plunge` plunge feed.
// Fusion has no flute direction, so imported tools are up-cut.
import type { BitShape } from './params';
import { MAX_FLUTES } from './params';
import type { Tool } from './tools';
import { newToolId, parseLibrary } from './tools';

/** What an import brought in, and what it left out and why. */
export type ToolImport = {
  tools: Tool[];
  /** Tools not imported: name and reason. */
  skipped: { name: string; reason: string }[];
  /** Imported, but with something left out (e.g. a corner radius). */
  notes: string[];
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** True for Fusion's export layout: an object with a `data` array. */
export function isFusionLibrary(raw: unknown): boolean {
  return isObject(raw) && Array.isArray(raw.data);
}

/** The tip shape for a Fusion tool type, a reason it is skipped, and a note for anything lost. */
function shapeFor(type: string, geometry: Record<string, unknown>): { shape?: BitShape; skip?: string; note?: string } {
  switch (type) {
    case 'flat end mill':
      return { shape: { kind: 'flat' } };
    case 'bull nose end mill':
      return { shape: { kind: 'flat' }, note: 'corner radius ignored (imported as a flat end mill)' };
    case 'ball end mill':
      return { shape: { kind: 'ball' } };
    case 'chamfer mill': {
      const half = positive(geometry.TA);
      return half && half < 90 ? { shape: { kind: 'vbit', includedAngleDeg: 2 * half } } : { skip: 'no taper angle (TA)' };
    }
    case 'counter sink':
    case 'countersink': {
      const point = positive(geometry.SIG);
      return point && point < 180 ? { shape: { kind: 'vbit', includedAngleDeg: point } } : { skip: 'no point angle (SIG)' };
    }
    default:
      return { skip: `${type || 'unknown'} tools are not supported` };
  }
}

/** The speeds and feeds preset: the older `"*"` entry, or the first of `presets`. */
function preset(startValues: unknown): Record<string, unknown> {
  if (!isObject(startValues)) return {};
  if (isObject(startValues['*'])) return startValues['*'];
  if (Array.isArray(startValues.presets) && isObject(startValues.presets[0])) return startValues.presets[0];
  return {};
}

/**
 * The tools in a Fusion tool library (parsed JSON). Tools keep Fusion's
 * `guid` as their id when it has one, so importing the same library again
 * updates them rather than adding copies.
 */
export function fromFusionLibrary(raw: unknown, now = Date.now()): ToolImport {
  const result: ToolImport = { tools: [], skipped: [], notes: [] };
  if (!isObject(raw) || !Array.isArray(raw.data)) return result;
  for (const item of raw.data) {
    if (!isObject(item)) continue;
    const type = typeof item.type === 'string' ? item.type : '';
    const name = (typeof item.description === 'string' && item.description.trim()) || type || 'Unnamed tool';
    const geometry = isObject(item.geometry) ? item.geometry : {};
    const { shape, skip, note } = shapeFor(type, geometry);
    if (!shape) {
      result.skipped.push({ name, reason: skip ?? 'not supported' });
      continue;
    }
    const diameter = positive(geometry.DC);
    if (!diameter) {
      result.skipped.push({ name, reason: 'no diameter (DC)' });
      continue;
    }
    const units = item.unit === 'millimeters' ? 'mm' : item.unit === 'inches' ? 'in' : null;
    if (!units) {
      result.skipped.push({ name, reason: 'unknown units' });
      continue;
    }
    const flutes = positive(geometry.NOF);
    const fluteCount = flutes ? Math.min(MAX_FLUTES, Math.max(1, Math.round(flutes))) : 2;
    if (!flutes) result.notes.push(`${name}: no flute count (NOF); assumed 2`);
    else if (fluteCount !== flutes) result.notes.push(`${name}: ${flutes} flutes stored as ${fluteCount}`);
    if (note) result.notes.push(`${name}: ${note}`);
    const post = isObject(item['post-process']) ? item['post-process'] : {};
    const number = positive(post.number);
    const values = preset(item['start-values']);
    const tool: Tool = {
      id: typeof item.guid === 'string' && item.guid ? item.guid : newToolId(),
      number: number && Number.isInteger(number) && number <= 999 ? number : 0,
      name,
      units,
      diameter,
      shape,
      flute: { kind: 'up' },
      fluteCount,
      updatedAt: positive(item.last_modified) ?? now,
    };
    const feedRate = positive(values.v_f);
    const plungeRate = positive(values.v_f_plunge);
    const spindleRpm = positive(values.n);
    if (feedRate) tool.feedRate = feedRate;
    if (plungeRate) tool.plungeRate = plungeRate;
    if (spindleRpm) tool.spindleRpm = spindleRpm;
    result.tools.push(tool);
  }
  return result;
}

export type ToolFileResult = { ok: true; format: 'app' | 'fusion'; import: ToolImport } | { ok: false; error: string };

/**
 * Reads a tool library file: this app's own export (`{ version: 1, tools }`)
 * or a Fusion tool library (`{ data: [...] }`). Never throws.
 */
export function readToolFile(text: string): ToolFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  if (isFusionLibrary(raw)) return { ok: true, format: 'fusion', import: fromFusionLibrary(raw) };
  const own = parseLibrary(text);
  if (own.ok) return { ok: true, format: 'app', import: { tools: own.library.tools, skipped: [], notes: [] } };
  return { ok: false, error: isObject(raw) && 'tools' in raw ? own.error : 'Not a tool library from this app or from Fusion' };
}
