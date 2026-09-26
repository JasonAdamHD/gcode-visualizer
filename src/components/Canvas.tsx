/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { Point } from '../geometry/segment';
import { pathToSvgPath, segmentHandlePoint } from '../geometry/segment';
import { findSnapPoint, constrainToAxis, snapToNothing, niceGridSpacing, snapToGrid, type SnapResult } from '../geometry/snapping';
import type { Units } from '../machine/params';
import type { Drawing } from '../state/useDrawingState';
import type { CutTimeEstimate } from '../toolpath/estimate';
import { formatDuration } from '../toolpath/estimate';
import type { Toolpath } from '../toolpath/toolpath';
import './Workspace.css';
import './Canvas.css';

type SheetSize = { x: number; y: number };

type CanvasProps = {
  drawing: Drawing;
  /** Sheet extents in world units (`units`), origin at the lower-left corner. */
  sheet: SheetSize;
  units: Units;
  /** Cutter-center toolpath for the drawn path, drawn as an overlay. */
  toolpath: Toolpath;
  estimate: CutTimeEstimate;
  /** The 2D/3D switch, rendered at the start of the toolbar. */
  viewToggle: ReactNode;
};

/** Returns true when a key event is aimed at a form control, so global shortcuts leave it alone. */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function Canvas({ drawing, sheet: sheetSize, units, toolpath, estimate, viewToggle }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<SnapResult | null>(null);
  // A pointerdown+move+up on a handle still synthesizes a 'click' on the
  // svg (the nearest common ancestor of the down/up targets) once released;
  // this suppresses that stray click so it doesn't place a stray point.
  const suppressNextClickRef = useRef(false);

  const gridSpacing = useMemo(() => niceGridSpacing(sheetSize.x, sheetSize.y), [sheetSize]);
  const tolerance = gridSpacing * 0.35;
  const margin = gridSpacing;

  const screenToWorld = useCallback(
    (e: { clientX: number; clientY: number }): Point | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const svgP = pt.matrixTransform(ctm.inverse());
      return { x: svgP.x, y: sheetSize.y - svgP.y };
    },
    [sheetSize.y]
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const world = screenToWorld(e);
      if (!world) return;
      if (drawing.isDragging) {
        drawing.updateDrag(snapToGrid(world, gridSpacing));
        return;
      }
      
      switch (e.ctrlKey ? 'ctrl' : e.metaKey ? 'meta' : e.shiftKey ? 'shift' : 'none') {
        case 'ctrl':
        case 'meta':
          if (drawing.draftStart === null) return null;
          setHover(constrainToAxis(drawing.draftStart, world));
          break;
        case 'shift':
          setHover(snapToNothing(world));
          break;
        default:
          setHover(findSnapPoint(world, drawing.segments, gridSpacing, tolerance));
          break;
      }
    },
    [drawing, gridSpacing, screenToWorld, tolerance]
  );

  const handleClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (drawing.isDragging || !hover) return;
    drawing.placePoint(hover.point);
  }, [drawing, hover]);

  // Dragging can leave the SVG bounds, so listen globally while it's active.
  useEffect(() => {
    if (!drawing.isDragging) return;
    const onMove = (e: PointerEvent) => {
      const world = screenToWorld(e);
      if (world) drawing.updateDrag(snapToGrid(world, gridSpacing));
    };
    const onUp = () => drawing.endDrag();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drawing, gridSpacing, screenToWorld]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z' && e.shiftKey) {
        e.preventDefault();
        drawing.redo();
      } else if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        drawing.undo();
      } else if ((e.ctrlKey || e.metaKey) && key === 'y') {
        e.preventDefault();
        drawing.redo();
      } else if (key === 'backspace' || key === 'delete') {
        e.preventDefault();
        drawing.deleteLast();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawing]);

  const gridLines = useMemo(() => {
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = 0; x <= sheetSize.x + 1e-6; x += gridSpacing) {
      lines.push({ key: `v${x}`, x1: x, y1: 0, x2: x, y2: sheetSize.y });
    }
    for (let y = 0; y <= sheetSize.y + 1e-6; y += gridSpacing) {
      lines.push({ key: `h${y}`, x1: 0, y1: y, x2: sheetSize.x, y2: y });
    }
    return lines;
  }, [sheetSize, gridSpacing]);

  const strokeThin = gridSpacing * 0.01;
  const strokePath = gridSpacing * 0.05;
  const handleRadius = gridSpacing * 0.12;
  const dotRadius = gridSpacing * 0.08;
  const snapRadius = gridSpacing * 0.18;

  // Closed loops get a Z so the round join also applies at the start point.
  const toolpathData = toolpath.loops.map((loop, i) => pathToSvgPath(loop) + (toolpath.closed[i] ? ' Z' : ''));

  const previewLine =
    drawing.draftStart && hover && !drawing.isDragging && !drawing.closed
      ? { from: drawing.draftStart, to: hover.point }
      : null;

  return (
    <div className="canvas-workspace">
      <div className="toolbar">
        {viewToggle}
        <span className="divider" />
        <button type="button" onClick={drawing.undo} disabled={!drawing.canUndo}>
          Undo
        </button>
        <button type="button" onClick={drawing.redo} disabled={!drawing.canRedo}>
          Redo
        </button>
        <button type="button" onClick={drawing.deleteLast} disabled={drawing.segments.length === 0 && !drawing.draftStart}>
          Delete Last
        </button>
        <button type="button" onClick={drawing.closePath} disabled={drawing.segments.length < 2 || drawing.closed}>
          Close Path
        </button>
        <button type="button" onClick={drawing.reset} disabled={drawing.segments.length === 0 && !drawing.draftStart}>
          Clear
        </button>
        <span className="divider" />
        <span className="status">
          {drawing.segments.length} segment{drawing.segments.length === 1 ? '' : 's'}
          {' · '}
          {drawing.closed ? 'closed' : 'open'}
          {' · '}
          length {drawing.totalLength.toFixed(2)} {units}
          {estimate.total > 0 && ` · est. ${formatDuration(estimate.total)}`}
        </span>
      </div>

      <svg
        ref={svgRef}
        className="drawing-svg"
        viewBox={`${-margin} ${-margin} ${sheetSize.x + 2 * margin} ${sheetSize.y + 2 * margin}`}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
        onPointerLeave={() => setHover(null)}
      >
        <g transform={`translate(0 ${sheetSize.y}) scale(1 -1)`}>
          <rect x={0} y={0} width={sheetSize.x} height={sheetSize.y} className="sheet" />

          {gridLines.map((line) => (
            <line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              className="grid-line"
              strokeWidth={strokeThin}
            />
          ))}

          {drawing.segments.length > 0 && (
            <path
              d={pathToSvgPath(drawing.segments)}
              className={drawing.closed ? 'drawn-path closed' : 'drawn-path'}
              strokeWidth={strokePath}
              fill={drawing.closed ? 'currentColor' : 'none'}
            />
          )}

          {toolpathData.map((d, i) => (
            <path key={`k${i}`} d={d} className="kerf" strokeWidth={2 * toolpath.radius} />
          ))}
          {toolpathData.map((d, i) => (
            <path
              key={`t${i}`}
              d={d}
              className="toolpath"
              strokeWidth={strokeThin * 3}
              strokeDasharray={`${gridSpacing * 0.1} ${gridSpacing * 0.06}`}
            />
          ))}

          {hover && previewLine && (
            <line
              x1={previewLine.from.x}
              y1={previewLine.from.y}
              x2={previewLine.to.x}
              y2={previewLine.to.y}
              className={hover.type ? `preview-line line-${hover.type}` : 'preview-line'}
              strokeWidth={strokeThin * 2}
            />
          )}

          {drawing.segments.map((segment, i) => {
            const handle = segmentHandlePoint(segment);
            return (
              <circle
                key={i}
                cx={handle.x}
                cy={handle.y}
                r={handleRadius}
                className={segment.bulge ? 'handle handle-arc' : 'handle'}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  suppressNextClickRef.current = true;
                  drawing.beginDrag(i);
                }}
              />
            );
          })}

          {drawing.segments.map((segment, i) => (
            <circle key={`s${i}`} cx={segment.start.x} cy={segment.start.y} r={dotRadius} className="endpoint-dot" />
          ))}
          {drawing.segments.length > 0 && (
            <circle
              cx={drawing.segments[drawing.segments.length - 1].end.x}
              cy={drawing.segments[drawing.segments.length - 1].end.y}
              r={dotRadius}
              className="endpoint-dot"
            />
          )}

          {drawing.draftStart && (
            <circle cx={drawing.draftStart.x} cy={drawing.draftStart.y} r={dotRadius * 1.3} className="draft-point" />
          )}

          {hover && !drawing.isDragging && (
            <circle
              cx={hover.point.x}
              cy={hover.point.y}
              r={snapRadius}
              className={hover.snapped ? `snap-indicator snap-${hover.type}` : 'snap-indicator'}
            />
          )}
        </g>
      </svg>

      <p className="hint">
        Click to place points and draw connected line segments. Drag a segment's midpoint handle to bow it into an
        arc. Endpoints and grid intersections snap automatically. Hold Shift to place a point anywhere, or Ctrl/Cmd to constrain the next point to a horizontal or vertical line from the last.
      </p>
    </div>
  );
}
