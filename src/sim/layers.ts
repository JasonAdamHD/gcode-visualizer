/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Which parts of the 3D scene are shown. A per-viewer preference, stored as
// JSON; anything unreadable falls back to the defaults field by field.
import type { MoveKind } from './sceneData';

export type Layers = {
  /** The simulated stock (material removal). */
  stock: boolean;
  /** Sheet outline (when the stock is off) and spoilboard. */
  sheet: boolean;
  /** Cutting moves. */
  cut: boolean;
  /** Plunges and retracts. */
  vertical: boolean;
  rapid: boolean;
  /** The path not played yet; off shows only the traversed path. */
  untraversed: boolean;
  axes: boolean;
};

export type LayerKey = keyof Layers;

export const DEFAULT_LAYERS: Layers = {
  stock: true,
  sheet: true,
  cut: true,
  vertical: true,
  rapid: true,
  untraversed: true,
  axes: true,
};

/** The layer that shows moves of `kind`. */
export function kindLayer(kind: MoveKind): 'cut' | 'vertical' | 'rapid' {
  return kind === 'feed' ? 'cut' : kind === 'rapid' ? 'rapid' : 'vertical';
}

/** Layers from stored JSON: known boolean fields are kept, everything else is the default. */
export function parseLayers(raw: string | null): Layers {
  const layers = { ...DEFAULT_LAYERS };
  if (!raw) return layers;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return layers;
  }
  if (typeof data !== 'object' || data === null) return layers;
  for (const key of Object.keys(layers) as LayerKey[]) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'boolean') layers[key] = value;
  }
  return layers;
}
