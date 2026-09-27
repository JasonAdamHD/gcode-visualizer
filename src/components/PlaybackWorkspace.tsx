/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Suspense, lazy, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { Diagnostic } from '../gcode/diagnostics';
import { firstMoveByLine } from '../gcode/step';
import type { MachineParams } from '../machine/params';
import { usePlayback } from '../state/usePlayback';
import type { CutTimeEstimate } from '../toolpath/estimate';
import type { Move } from '../toolpath/moves';
import { adjacentMoveTime, buildTimeline, moveBlockStarts, sampleTimeline } from '../toolpath/timeline';
import { PlaybackBar } from './PlaybackBar';
import { ProgramPane } from './ProgramPane';
import { ProgramView } from './ProgramView';
import { ViewErrorBoundary } from './ViewErrorBoundary';
import type { ViewMode } from './ViewToggle';

// Three.js is only downloaded once the 3D view is first opened.
const Viewer3D = lazy(() => import('./Viewer3D'));

/** An open program, as the workspace needs it. */
export type WorkspaceProgram = {
  fileName: string;
  /** Source lines, numbered like `Move.sourceLine`. */
  lines: string[];
  diagnostics: Diagnostic[];
};

type PlaybackWorkspaceProps = {
  view: ViewMode;
  viewToggle: ReactNode;
  moves: Move[];
  params: MachineParams;
  estimate: CutTimeEstimate;
  /** The open program, or null when playing the drawing's moves (3D only). */
  program: WorkspaceProgram | null;
};

/** True when a key event is aimed at a control that uses it (typing, sliders, selects). */
function isFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Everything that follows the playback clock: the 3D view, the 2D program
 * view and the program pane (problems and source listing). It owns one
 * clock, so all of them agree on the current move, and only this part of
 * the page re-renders while playing. Space plays and pauses; with a
 * program open, ← and → step between moves and clicking a line or a
 * problem seeks to it.
 */
export function PlaybackWorkspace({ view, viewToggle, moves, params, estimate, program }: PlaybackWorkspaceProps) {
  const timeline = useMemo(() => buildTimeline(moves, params), [moves, params]);
  const playback = usePlayback(timeline.total, timeline);
  const sample = useMemo(() => sampleTimeline(timeline, playback.time), [timeline, playback.time]);

  const blockStarts = useMemo(() => moveBlockStarts(timeline), [timeline]);
  const lineCount = program?.lines.length ?? 0;
  const lineMoves = useMemo(() => firstMoveByLine(moves, lineCount), [moves, lineCount]);

  // Step-through highlights only apply to programs; drawing playback is unchanged.
  const moveIndex = program ? sample.moveIndex : -1;
  const currentMove = moveIndex >= 0 ? moves[moveIndex] : null;
  const currentBlocks = useMemo(
    () =>
      moveIndex >= 0
        ? { first: blockStarts[moveIndex], count: blockStarts[moveIndex + 1] - blockStarts[moveIndex] }
        : null,
    [moveIndex, blockStarts]
  );
  const currentLine = currentMove?.sourceLine ?? null;

  const { seek, toggle, time } = playback;
  const step = useCallback(
    (direction: 1 | -1) => {
      const t = adjacentMoveTime(timeline, time, direction);
      if (t !== null) seek(t);
    },
    [timeline, time, seek]
  );
  const selectLine = useCallback(
    (line: number) => {
      const m = lineMoves[line] ?? -1;
      if (m >= 0) seek(timeline.moveStart[m]);
    },
    [lineMoves, timeline, seek]
  );

  const stepping = program !== null;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isFormControl(e.target)) return;
      if (e.key === ' ') {
        // A focused button handles Space itself.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        toggle();
      } else if (stepping && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle, step, stepping]);

  const onStep = stepping ? step : undefined;

  return (
    <>
      {view === '3d' ? (
        <ViewErrorBoundary viewToggle={viewToggle}>
          <Suspense fallback={<div className="canvas-workspace view-loading">Loading 3D view…</div>}>
            <Viewer3D
              moves={moves}
              params={params}
              estimate={estimate}
              viewToggle={viewToggle}
              timeline={timeline}
              playback={playback}
              sample={sample}
              currentMove={currentBlocks}
              onStep={onStep}
            />
          </Suspense>
        </ViewErrorBoundary>
      ) : (
        program && (
          <ProgramView
            moves={moves}
            sheet={params.sheet}
            fileName={program.fileName}
            lineCount={lineCount}
            estimate={estimate}
            viewToggle={viewToggle}
            sample={sample}
            currentMove={currentMove}
            playbackBar={
              <PlaybackBar
                playback={playback}
                total={timeline.total}
                sample={sample}
                units={params.units}
                onStep={onStep}
              />
            }
          />
        )
      )}
      {program && (
        <ProgramPane
          lines={program.lines}
          diagnostics={program.diagnostics}
          currentLine={currentLine}
          onSelectLine={selectLine}
        />
      )}
    </>
  );
}
