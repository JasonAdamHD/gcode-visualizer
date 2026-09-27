/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { segmentPathData } from '../geometry/segment';
import { niceGridSpacing } from '../geometry/snapping';
import { fitBox, viewBoxAttr } from '../geometry/viewport';
import { moveBounds, moveKindPaths } from '../gcode/pathData';
import type { CutTimeEstimate } from '../toolpath/estimate';
import { formatDuration } from '../toolpath/estimate';
import type { Move } from '../toolpath/moves';
import type { TimelineSample } from '../toolpath/timeline';
import { SheetGrid } from './SheetGrid';
import { usePanZoom } from './usePanZoom';
import './Workspace.css';
import './Canvas.css';
import './ProgramView.css';

type ProgramViewProps = {
  /** The program's moves in the current units. */
  moves: Move[];
  /** Sheet extents in world units, origin at the lower-left corner. */
  sheet: { x: number; y: number };
  fileName: string;
  lineCount: number;
  estimate: CutTimeEstimate;
  /** The 2D/3D switch, rendered at the start of the toolbar. */
  viewToggle: ReactNode;
  /** Machine state at the playback time: the tool is drawn at its position. */
  sample: TimelineSample;
  /** The move in progress, highlighted, or null. */
  currentMove: Move | null;
  /** Playback controls, rendered under the view. */
  playbackBar: ReactNode;
};

/**
 * Read-only 2D view of an imported program: the sheet, feeds solid, rapids
 * dashed, plunges and retracts as dots, projected onto XY, with the current
 * move highlighted and the tool at its playback position. The view frames
 * the sheet and everything the program reaches, so moves off the sheet
 * stay visible.
 */
export function ProgramView({
  moves,
  sheet,
  fileName,
  lineCount,
  estimate,
  viewToggle,
  sample,
  currentMove,
  playbackBar,
}: ProgramViewProps) {
  const gridSpacing = useMemo(() => niceGridSpacing(sheet.x, sheet.y), [sheet.x, sheet.y]);
  const paths = useMemo(() => moveKindPaths(moves), [moves]);
  const bounds = useMemo(() => moveBounds(moves), [moves]);

  // The sheet and everything the program reaches. World Y-up is flipped
  // about Y = 0, so in SVG user units the box spans −maxY … −minY.
  const home = useMemo(() => {
    const minX = Math.min(0, bounds?.minX ?? 0);
    const minY = Math.min(0, bounds?.minY ?? 0);
    const maxX = Math.max(sheet.x, bounds?.maxX ?? 0);
    const maxY = Math.max(sheet.y, bounds?.maxY ?? 0);
    return fitBox({ minX, minY: -maxY, maxX, maxY: -minY }, gridSpacing);
  }, [bounds, sheet.x, sheet.y, gridSpacing]);
  const svgRef = useRef<SVGSVGElement>(null);
  const { viewBox, zoom, reset: fitView } = usePanZoom(svgRef, home);
  const currentPath = currentMove
    ? `M ${currentMove.from.x} ${currentMove.from.y} ` +
      segmentPathData({
        type: currentMove.bulge ? 'arc' : 'line',
        start: currentMove.from,
        end: currentMove.to,
        bulge: currentMove.bulge,
      })
    : '';
  const tool = sample.position;


  return (
    <div className="canvas-workspace">
      <div className="toolbar">
        {viewToggle}
        <span className="divider" />
        <span className="legend">
          <span className="swatch swatch-feed" /> cut
          <span className="swatch swatch-vertical" /> plunge
          <span className="swatch swatch-rapid" /> rapid
        </span>
        <span className="divider" />
        <button type="button" onClick={fitView} disabled={zoom === 1 && viewBoxAttr(viewBox) === viewBoxAttr(home)} title="Show the whole program and sheet (0)">
          Fit
        </button>
        <span className="status">
          {lineCount} line{lineCount === 1 ? '' : 's'} · {moves.length} move{moves.length === 1 ? '' : 's'}
          {estimate.total > 0 && ` · est. ${formatDuration(estimate.total)}`}
        </span>
      </div>

      <svg
        ref={svgRef}
        className="drawing-svg program-svg"
        viewBox={viewBoxAttr(viewBox)} role="img" aria-label={`Toolpath of ${fileName}`}>
        <g transform="scale(1 -1)">
          <SheetGrid sheet={sheet} gridSpacing={gridSpacing} strokeScale={1 / zoom} />
          <path d={paths.rapid} className="program-rapid" />
          <path d={paths.feed} className="program-feed" />
          <path d={paths.plunge} className="program-plunge" />
          <path d={paths.retract} className="program-retract" />
          <path d={currentPath} className="program-current" />
          {sample.moveIndex >= 0 && <path d={`M ${tool.x} ${tool.y} h 0`} className="program-tool" />}
        </g>
      </svg>

      {playbackBar}

      <p className="hint">
        Read-only view of {fileName}. Click a source line or a problem to jump to it, a line number to set a
        breakpoint, Alt+click a line to play until it. ← and → step through moves (Shift for one block), Space plays
        and pauses, Home/End jump to the ends, + and − change speed. Scroll to zoom, right- or middle-drag to pan, 0 to
        fit. Close the file to return to your drawing; it is
        kept as you left it.
      </p>
    </div>
  );
}
