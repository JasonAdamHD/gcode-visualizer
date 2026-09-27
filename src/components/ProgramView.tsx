/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { niceGridSpacing } from '../geometry/snapping';
import { moveBounds, moveKindPaths } from '../gcode/pathData';
import type { CutTimeEstimate } from '../toolpath/estimate';
import { formatDuration } from '../toolpath/estimate';
import type { Move } from '../toolpath/moves';
import { SheetGrid } from './SheetGrid';
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
};

/**
 * Read-only 2D view of an imported program: the sheet, feeds solid, rapids
 * dashed, plunges and retracts as dots, projected onto XY. The view frames
 * the sheet and everything the program reaches, so moves off the sheet
 * stay visible.
 */
export function ProgramView({ moves, sheet, fileName, lineCount, estimate, viewToggle }: ProgramViewProps) {
  const gridSpacing = useMemo(() => niceGridSpacing(sheet.x, sheet.y), [sheet.x, sheet.y]);
  const paths = useMemo(() => moveKindPaths(moves), [moves]);
  const bounds = useMemo(() => moveBounds(moves), [moves]);

  const margin = gridSpacing;
  const minX = Math.min(0, bounds?.minX ?? 0) - margin;
  const minY = Math.min(0, bounds?.minY ?? 0) - margin;
  const maxX = Math.max(sheet.x, bounds?.maxX ?? 0) + margin;
  const maxY = Math.max(sheet.y, bounds?.maxY ?? 0) + margin;
  // World Y-up is flipped about Y = 0, so the top of the view is −maxY.
  const viewBox = `${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`;

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
        <span className="status">
          {lineCount} line{lineCount === 1 ? '' : 's'} · {moves.length} move{moves.length === 1 ? '' : 's'}
          {estimate.total > 0 && ` · est. ${formatDuration(estimate.total)}`}
        </span>
      </div>

      <svg className="drawing-svg program-svg" viewBox={viewBox} role="img" aria-label={`Toolpath of ${fileName}`}>
        <g transform="scale(1 -1)">
          <SheetGrid sheet={sheet} gridSpacing={gridSpacing} />
          <path d={paths.rapid} className="program-rapid" />
          <path d={paths.feed} className="program-feed" />
          <path d={paths.plunge} className="program-plunge" />
          <path d={paths.retract} className="program-retract" />
        </g>
      </svg>

      <p className="hint">
        Read-only view of {fileName}. Close the file to return to your drawing; it is kept as you left it.
      </p>
    </div>
  );
}
