/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { Canvas } from './components/Canvas';
import { ParametersPanel } from './components/ParametersPanel';
import type { ProgramSummary } from './components/ParametersPanel';
import { ProgramBar } from './components/ProgramBar';
import { ProgramView } from './components/ProgramView';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import type { ViewMode } from './components/ViewToggle';
import { ViewToggle } from './components/ViewToggle';
import type { MachineParams, Units } from './machine/params';
import { DEFAULT_PARAMS, unitFactor } from './machine/params';
import { analyzeProgram } from './gcode/analyze';
import { parseGcode } from './gcode/parse';
import { scaleMoves } from './gcode/scale';
import { useDrawingState } from './state/useDrawingState';
import { useMachineParams } from './state/useMachineParams';
import { useProgram } from './state/useProgram';
import { estimateCutTime } from './toolpath/estimate';
import { buildMoves } from './toolpath/moves';
import { effectiveCutSide } from './toolpath/offset';
import { computeToolpath } from './toolpath/toolpath';

// Three.js is only downloaded once the 3D view is first opened.
const Viewer3D = lazy(() => import('./components/Viewer3D'));

const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/demo.nc`;

const PANEL_OPEN_KEY = 'cnc-visualizer.panelOpen';
const VIEW_KEY = 'cnc-visualizer.view';

function loadPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === '3d' ? '3d' : '2d';
  } catch {
    return '2d';
  }
}

function App() {
  const drawing = useDrawingState();
  const { params, update, setUnits, replace } = useMachineParams();
  const [panelOpen, setPanelOpen] = useState(loadPanelOpen);
  const [view, setView] = useState(loadView);
  const programFile = useProgram();
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_OPEN_KEY, String(panelOpen));
    } catch {
      // Per-viewer convenience only; ignore storage failures.
    }
  }, [panelOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Per-viewer convenience only; ignore storage failures.
    }
  }, [view]);

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
  const drawingMoves = useMemo(() => buildMoves(toolpath.loops, toolpath.closed, params), [toolpath, params]);

  // An open G-code file replaces the drawing as the source of moves; the
  // drawing and its history stay untouched underneath. The program keeps
  // its own units and is scaled into the current ones, so a unit toggle
  // never changes it physically. It re-parses when the start height moves.
  const { source } = programFile;
  const { safeHeight, units } = params;
  const program = useMemo(
    () => (source ? parseGcode(source.text, { point: { x: 0, y: 0, z: safeHeight }, units }) : null),
    [source, safeHeight, units]
  );
  const programMoves = useMemo(
    () => (program ? scaleMoves(program.moves, unitFactor(program.units, units)) : null),
    [program, units]
  );
  const moves = programMoves ?? drawingMoves;
  const diagnostics = useMemo(
    () => (program && programMoves ? [...program.diagnostics, ...analyzeProgram(programMoves, params)] : []),
    [program, programMoves, params]
  );
  const programSummary: ProgramSummary | null =
    program && source
      ? {
          fileName: source.name,
          units: program.units,
          lineCount: program.lineCount,
          moveCount: program.moves.length,
          diagnostics,
        }
      : null;

  const estimate = useMemo(() => estimateCutTime(moves, params), [moves, params]);
  const viewToggle = <ViewToggle view={view} onChange={setView} />;

  const { load } = programFile;
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const handleDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const handleDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const file = e.dataTransfer.files[0];
    if (file) load(file);
  };
  const handleDragLeave = (e: DragEvent) => {
    // Leaving for a child element still counts as inside.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>CNC Toolpath Visualizer</h1>
        <ProgramBar
          fileName={source?.name ?? null}
          error={programFile.error}
          onOpen={load}
          onLoadSample={() => programFile.loadUrl(SAMPLE_URL, 'demo.nc')}
          onClose={programFile.close}
        />
      </header>
      <main
        className={dropping ? 'app-main dropping' : 'app-main'}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {view === '3d' ? (
          <ViewErrorBoundary viewToggle={viewToggle}>
            <Suspense fallback={<div className="canvas-workspace view-loading">Loading 3D view…</div>}>
              <Viewer3D moves={moves} params={params} estimate={estimate} viewToggle={viewToggle} />
            </Suspense>
          </ViewErrorBoundary>
        ) : program && source ? (
          <ProgramView
            moves={moves}
            sheet={params.sheet}
            fileName={source.name}
            lineCount={program.lineCount}
            estimate={estimate}
            viewToggle={viewToggle}
          />
        ) : (
          <Canvas
            drawing={drawing}
            sheet={params.sheet}
            units={params.units}
            toolpath={toolpath}
            estimate={estimate}
            viewToggle={viewToggle}
          />
        )}
        <ParametersPanel
          params={params}
          program={programSummary}
          update={update}
          toolpath={toolpath}
          estimate={estimate}
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
