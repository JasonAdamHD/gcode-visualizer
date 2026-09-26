/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useState } from 'react';
import type { MachineParams, Units } from '../machine/params';
import { DEFAULT_PARAMS, convertParams, parseParams, serializeParams } from '../machine/params';

export const PARAMS_STORAGE_KEY = 'cnc-visualizer.params';

function loadParams(): MachineParams {
  try {
    const text = localStorage.getItem(PARAMS_STORAGE_KEY);
    if (text === null) return DEFAULT_PARAMS;
    const result = parseParams(text);
    return result.ok ? result.params : DEFAULT_PARAMS;
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return DEFAULT_PARAMS;
  }
}

/**
 * Machine/job parameters, persisted to localStorage. This hook knows nothing
 * about the drawing: a unit change that must also rescale geometry is
 * coordinated by the caller (see App).
 */
export function useMachineParams() {
  const [params, setParams] = useState<MachineParams>(loadParams);

  useEffect(() => {
    try {
      localStorage.setItem(PARAMS_STORAGE_KEY, serializeParams(params));
    } catch {
      // Quota exceeded or storage unavailable: keep working in memory.
    }
  }, [params]);

  /** Shallow-merges a patch, or applies an updater function. */
  const update = useCallback(
    (patch: Partial<MachineParams> | ((prev: MachineParams) => MachineParams)) => {
      setParams((prev) => (typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }));
    },
    []
  );

  /** Switches units, converting every length and rate so the physical job is unchanged. */
  const setUnits = useCallback((units: Units) => setParams((prev) => convertParams(prev, units)), []);

  /** Replaces all params, e.g. from an imported settings file or a reset to DEFAULT_PARAMS. */
  const replace = useCallback((next: MachineParams) => setParams(next), []);

  return { params, update, setUnits, replace };
}
