/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The tool library: named bits the user keeps, picks from, and (later)
// matches to a program's T words. Pure; stored as versioned JSON in
// localStorage today and meant to sync to an account later, so every tool
// has a stable id and a last-changed time.
import type { BitShape, FluteDirection, MachineParams, Units } from './params';
import { MAX_FLUTES, unitFactor } from './params';

/**
 * A tool in the library. Lengths and rates are in the tool's own `units`
 * (converted when applied). `number` is the tool number a program's T
 * word refers to. The optional feed rate, plunge rate and spindle speed are
 * the tool's own defaults; when set, picking the tool sets them too.
 */
export type Tool = {
  id: string;
  number: number;
  name: string;
  units: Units;
  diameter: number;
  shape: BitShape;
  flute: FluteDirection;
  fluteCount: number;
  feedRate?: number;
  plungeRate?: number;
  spindleRpm?: number;
  /** Milliseconds since 1970 of the last change, for merging with a synced copy later. */
  updatedAt: number;
};

export type ToolLibrary = { version: 1; tools: Tool[] };

/** Most tools a library holds. */
export const MAX_TOOLS = 500;

/** A new id for a tool: random, so libraries from different devices can merge. */
export function newToolId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Problems with one tool, as readable messages (empty when it is valid). */
export function validateTool(tool: Tool): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(tool.number) || tool.number < 1 || tool.number > 999) errors.push('Tool number must be a whole number from 1 to 999');
  if (!tool.name.trim()) errors.push('Name must not be empty');
  if (!isNum(tool.diameter) || tool.diameter <= 0) errors.push('Diameter must be greater than 0');
  if (tool.shape.kind === 'vbit') {
    const a = tool.shape.includedAngleDeg;
    if (!isNum(a) || a <= 0 || a >= 180) errors.push('V-bit angle must be between 0° and 180°');
  }
  if (tool.flute.kind === 'compression' && !(isNum(tool.flute.upcutLength) && tool.flute.upcutLength > 0)) {
    errors.push('Up-cut length must be greater than 0');
  }
  if (!Number.isInteger(tool.fluteCount) || tool.fluteCount < 1 || tool.fluteCount > MAX_FLUTES) {
    errors.push(`Flute count must be a whole number from 1 to ${MAX_FLUTES}`);
  }
  for (const [label, v] of [
    ['Feed rate', tool.feedRate],
    ['Plunge rate', tool.plungeRate],
    ['Spindle speed', tool.spindleRpm],
  ] as const) {
    if (v !== undefined && !(isNum(v) && v > 0)) errors.push(`${label} must be greater than 0`);
  }
  return errors;
}

/** Problems with a library: each tool's, plus tool numbers or ids used twice. */
export function validateLibrary(library: ToolLibrary): string[] {
  const errors: string[] = [];
  const numbers = new Set<number>();
  const ids = new Set<string>();
  if (library.tools.length > MAX_TOOLS) errors.push(`At most ${MAX_TOOLS} tools`);
  for (const tool of library.tools) {
    for (const e of validateTool(tool)) errors.push(`T${tool.number} ${tool.name}: ${e}`);
    if (numbers.has(tool.number)) errors.push(`Tool number ${tool.number} is used twice`);
    if (ids.has(tool.id)) errors.push(`Tool id ${tool.id} is used twice`);
    numbers.add(tool.number);
    ids.add(tool.id);
  }
  return errors;
}

/**
 * The picked tool's id from a stored choice: the id when it names a tool in
 * `library`, otherwise none. There is deliberately no fallback to some
 * tool, since the params may hold a different bit; picking applies a tool.
 */
export function resolveActiveTool(stored: string | null, library: ToolLibrary): string | null {
  return stored && library.tools.some((t) => t.id === stored) ? stored : null;
}

/** The lowest tool number not in use. */
export function nextToolNumber(library: ToolLibrary): number {
  const used = new Set(library.tools.map((t) => t.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/**
 * A tool from the params' current bit, spindle speed and feeds (in the
 * params' units): what "Save as tool" stores.
 */
export function toolFromParams(params: MachineParams, number: number, name: string, id = newToolId(), now = Date.now()): Tool {
  return {
    id,
    number,
    name,
    units: params.units,
    diameter: params.bit.diameter,
    shape: params.bit.shape,
    flute: params.bit.flute,
    fluteCount: params.bit.fluteCount,
    feedRate: params.feedRate,
    plungeRate: params.plungeRate,
    spindleRpm: params.spindleRpm,
    updatedAt: now,
  };
}

/**
 * `params` cutting with `tool`: its bit, and its feed rate, plunge rate and
 * spindle speed where it has them, converted from the tool's units into
 * the params' units.
 */
export function applyTool(params: MachineParams, tool: Tool): MachineParams {
  const f = unitFactor(tool.units, params.units);
  const flute: FluteDirection =
    tool.flute.kind === 'compression' ? { kind: 'compression', upcutLength: tool.flute.upcutLength * f } : tool.flute;
  return {
    ...params,
    bit: { diameter: tool.diameter * f, shape: tool.shape, flute, fluteCount: tool.fluteCount },
    feedRate: tool.feedRate !== undefined ? tool.feedRate * f : params.feedRate,
    plungeRate: tool.plungeRate !== undefined ? tool.plungeRate * f : params.plungeRate,
    spindleRpm: tool.spindleRpm ?? params.spindleRpm,
  };
}

/** True when `params` cut with exactly `tool` (so an edit in the panel since picking it shows). */
export function paramsMatchTool(params: MachineParams, tool: Tool): boolean {
  const applied = applyTool(params, tool);
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const upcut = (x: FluteDirection) => (x.kind === 'compression' ? x.upcutLength : 0);
  const { bit } = params;
  return (
    close(applied.bit.diameter, bit.diameter) &&
    JSON.stringify(applied.bit.shape) === JSON.stringify(bit.shape) &&
    applied.bit.flute.kind === bit.flute.kind &&
    close(upcut(applied.bit.flute), upcut(bit.flute)) &&
    applied.bit.fluteCount === bit.fluteCount &&
    close(applied.feedRate, params.feedRate) &&
    close(applied.plungeRate, params.plungeRate) &&
    applied.spindleRpm === params.spindleRpm
  );
}

/** What merging tools into a library did. */
export type MergeResult = {
  library: ToolLibrary;
  added: number;
  updated: number;
  /** Tools whose number was missing or already taken, with the number they got. */
  renumbered: { name: string; number: number }[];
  /** Tools left out: an older copy of one already in the library, or no room. */
  ignored: { name: string; reason: string }[];
};

/**
 * Adds `incoming` tools to `base`. A tool with the same id as one in the
 * library replaces it when it is at least as new (`updatedAt`), so
 * importing a library again updates it instead of duplicating it. A tool
 * with no number (0) or a number another tool has gets the lowest free
 * number. The library never grows past `MAX_TOOLS`.
 */
export function mergeTools(base: ToolLibrary, incoming: readonly Tool[]): MergeResult {
  const tools = [...base.tools];
  const result: Omit<MergeResult, 'library'> = { added: 0, updated: 0, renumbered: [], ignored: [] };
  for (const tool of incoming) {
    const at = tools.findIndex((t) => t.id === tool.id);
    if (at < 0 && tools.length >= MAX_TOOLS) {
      result.ignored.push({ name: tool.name, reason: `the library is full (${MAX_TOOLS} tools)` });
      continue;
    }
    if (at >= 0 && tool.updatedAt < tools[at].updatedAt) {
      result.ignored.push({ name: tool.name, reason: 'the library has a newer copy' });
      continue;
    }
    let number = tool.number;
    const taken = (n: number) => tools.some((t, k) => t.number === n && k !== at);
    if (!(number >= 1) || taken(number)) {
      number = nextToolNumber({ version: 1, tools: at >= 0 ? tools.filter((_, k) => k !== at) : tools });
      result.renumbered.push({ name: tool.name, number });
    }
    const merged = { ...tool, number };
    if (at >= 0) {
      tools[at] = merged;
      result.updated++;
    } else {
      tools.push(merged);
      result.added++;
    }
  }
  return { library: { version: 1, tools }, ...result };
}

/** A one-line label: `T3 · 1/4" down-cut (0.25 in flat, 2 fl)`. */
export function toolLabel(tool: Tool): string {
  const shape = tool.shape.kind === 'vbit' ? `${tool.shape.includedAngleDeg}° V` : tool.shape.kind;
  return `T${tool.number} · ${tool.name} (${Number(tool.diameter.toPrecision(4))} ${tool.units} ${shape}, ${tool.fluteCount} fl)`;
}

/** The library as pretty-printed JSON, for storage and export. */
export function serializeLibrary(library: ToolLibrary): string {
  return JSON.stringify(library, null, 2);
}

export type LibraryParseResult = { ok: true; library: ToolLibrary } | { ok: false; error: string };

function parseShape(v: unknown): BitShape | null {
  if (!isObject(v)) return null;
  if (v.kind === 'flat' || v.kind === 'ball') return { kind: v.kind };
  if (v.kind === 'vbit' && isNum(v.includedAngleDeg)) return { kind: 'vbit', includedAngleDeg: v.includedAngleDeg };
  return null;
}

function parseFlute(v: unknown): FluteDirection | null {
  if (!isObject(v)) return null;
  if (v.kind === 'up' || v.kind === 'down') return { kind: v.kind };
  if (v.kind === 'compression' && isNum(v.upcutLength)) return { kind: 'compression', upcutLength: v.upcutLength };
  return null;
}

/** One tool from untrusted JSON, or an error. Unknown fields are dropped. */
function parseTool(v: unknown, index: number): Tool | string {
  const where = `Tool ${index + 1}`;
  if (!isObject(v)) return `${where}: not an object`;
  if (typeof v.id !== 'string' || !v.id) return `${where}: missing id`;
  if (typeof v.name !== 'string') return `${where}: missing name`;
  if (v.units !== 'in' && v.units !== 'mm') return `${where}: units must be "in" or "mm"`;
  for (const key of ['number', 'diameter', 'fluteCount', 'updatedAt'] as const) {
    if (!isNum(v[key])) return `${where}: ${key} must be a number`;
  }
  for (const key of ['feedRate', 'plungeRate', 'spindleRpm'] as const) {
    if (v[key] !== undefined && !isNum(v[key])) return `${where}: ${key} must be a number`;
  }
  const shape = parseShape(v.shape);
  if (!shape) return `${where}: unknown shape`;
  const flute = parseFlute(v.flute);
  if (!flute) return `${where}: unknown flute direction`;
  const tool: Tool = {
    id: v.id,
    number: v.number as number,
    name: v.name,
    units: v.units,
    diameter: v.diameter as number,
    shape,
    flute,
    fluteCount: v.fluteCount as number,
    updatedAt: v.updatedAt as number,
  };
  if (v.feedRate !== undefined) tool.feedRate = v.feedRate as number;
  if (v.plungeRate !== undefined) tool.plungeRate = v.plungeRate as number;
  if (v.spindleRpm !== undefined) tool.spindleRpm = v.spindleRpm as number;
  return tool;
}

/** Parses and validates a library (from storage or a file). Never throws. */
export function parseLibrary(text: string): LibraryParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not valid JSON' };
  }
  if (!isObject(raw)) return { ok: false, error: 'Expected a JSON object' };
  if (raw.version !== 1) return { ok: false, error: 'Unsupported tool library version' };
  if (!Array.isArray(raw.tools)) return { ok: false, error: 'Missing tools' };
  const tools: Tool[] = [];
  for (let k = 0; k < raw.tools.length; k++) {
    const tool = parseTool(raw.tools[k], k);
    if (typeof tool === 'string') return { ok: false, error: tool };
    tools.push(tool);
  }
  const library: ToolLibrary = { version: 1, tools };
  const errors = validateLibrary(library);
  return errors.length > 0 ? { ok: false, error: errors[0] } : { ok: true, library };
}
