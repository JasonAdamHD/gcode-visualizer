/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from './components/Canvas';
import { ParametersPanel } from './components/ParametersPanel';
import type { MachineParams, Units } from './machine/params';
import { DEFAULT_PARAMS, unitFactor } from './machine/params';
import { useDrawingState } from './state/useDrawingState';
import { useMachineParams } from './state/useMachineParams';
import { effectiveCutSide } from './toolpath/offset';
import { computeToolpath } from './toolpath/toolpath';

const PANEL_OPEN_KEY = 'cnc-visualizer.panelOpen';

function loadPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

function App() {
  const drawing = useDrawingState();
  const { params, update, setUnits, replace } = useMachineParams();
  const [panelOpen, setPanelOpen] = useState(loadPanelOpen);

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_OPEN_KEY, String(panelOpen));
    } catch {
      // Per-viewer convenience only; ignore storage failures.
    }
  }, [panelOpen]);

  // Units live outside drawing history, so any change of units (toggle,
  // import, reset) rescales every drawing snapshot alongside the params to
  // keep the physical part unchanged.
  const { rescale } = drawing;
  const applyUnits = useCallback(
    (next: Units) => {
      rescale(unitFactor(params.units, next));
      setUnits(next);
    },
    [params.units, rescale, setUnits]
  );

  const applyParams = useCallback(
    (next: MachineParams) => {
      rescale(unitFactor(params.units, next.units));
      replace(next);
    },
    [params.units, rescale, replace]
  );

  // Uses the display segments, so the offset follows a live arc drag.
  const cutSide = effectiveCutSide(drawing.cutSide, drawing.closed);
  const toolpath = useMemo(
    () => computeToolpath(drawing.segments, drawing.closed, cutSide, params),
    [drawing.segments, drawing.closed, cutSide, params]
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>CNC Toolpath Visualizer</h1>
      </header>
      <main className="app-main">
        <Canvas drawing={drawing} sheet={params.sheet} units={params.units} toolpath={toolpath} />
        <ParametersPanel
          params={params}
          update={update}
          toolpath={toolpath}
          closed={drawing.closed}
          cutSide={cutSide}
          onCutSideChange={drawing.setCutSide}
          onUnitsChange={applyUnits}
          onImport={applyParams}
          onReset={() => applyParams(DEFAULT_PARAMS)}
          open={panelOpen}
          onToggle={() => setPanelOpen((o) => !o)}
        />
      </main>
    </div>
  );
}

export default App;
