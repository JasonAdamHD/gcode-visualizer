/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useState } from 'react';
import type { LayerKey, Layers } from '../sim/layers';
import { parseLayers } from '../sim/layers';

const LAYERS_KEY = 'cnc-visualizer.layers';

function loadLayers(): Layers {
  try {
    return parseLayers(localStorage.getItem(LAYERS_KEY));
  } catch {
    return parseLayers(null);
  }
}

/** The 3D view's layer visibility, remembered per viewer in localStorage. */
export function useLayers(): [Layers, (key: LayerKey) => void] {
  const [layers, setLayers] = useState(loadLayers);

  useEffect(() => {
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
    } catch {
      // Per-viewer convenience only; ignore storage failures.
    }
  }, [layers]);

  const toggle = useCallback((key: LayerKey) => setLayers((l) => ({ ...l, [key]: !l[key] })), []);
  return [layers, toggle];
}
