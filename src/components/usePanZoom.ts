/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import type { ViewBox } from '../geometry/viewport';
import { panBy, viewBoxAttr, zoomAt, zoomLimits } from '../geometry/viewport';
import { ignoreShortcut } from './keyboard';

/** View size change per wheel pixel: 100 px of scrolling zooms by e^0.15 ≈ 1.16×. */
const ZOOM_PER_PIXEL = 0.0015;

/** A pointer event's position in the SVG's user units (its viewBox space), or null. */
function toUser(svg: SVGSVGElement, e: { clientX: number; clientY: number }) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

export type PanZoom = {
  viewBox: ViewBox;
  /** How far in from `home`: 2 means everything looks twice as big. */
  zoom: number;
  /** Back to `home`. */
  reset: () => void;
};

/**
 * Pan and zoom for an SVG view whose unzoomed viewBox is `home`: the wheel
 * zooms about the cursor, a middle- or right-button drag pans (the left
 * button is left to the view), and the `0` key or `reset` goes back to
 * `home`. The view also returns home whenever `home` changes (a new sheet
 * size, units or program).
 */
export function usePanZoom(svgRef: RefObject<SVGSVGElement | null>, home: ViewBox): PanZoom {
  const [viewBox, setViewBox] = useState(home);
  const homeKey = viewBoxAttr(home);
  const [shownHome, setShownHome] = useState(homeKey);
  if (homeKey !== shownHome) {
    setShownHome(homeKey);
    setViewBox(home);
  }
  const limits = useMemo(() => zoomLimits(home), [home]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (e: WheelEvent) => {
      const p = toUser(svg, e);
      if (!p) return;
      e.preventDefault();
      const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      setViewBox((vb) => zoomAt(vb, p, Math.exp(pixels * ZOOM_PER_PIXEL), limits));
    };

    let drag: { id: number; x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 1 && e.button !== 2) return;
      e.preventDefault(); // no middle-button autoscroll
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      svg.classList.add('panning');
      // Keeps the drag when the pointer leaves the view; throws for a pointer that is already gone.
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        // Panning still works while the pointer stays over the view.
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      // Screen pixels to user units at the current zoom.
      const dx = (e.clientX - drag.x) / ctm.a;
      const dy = (e.clientY - drag.y) / ctm.d;
      drag = { ...drag, x: e.clientX, y: e.clientY };
      setViewBox((vb) => panBy(vb, dx, dy));
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      svg.classList.remove('panning');
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    };
    // Right-drag pans, so the context menu would only get in the way.
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('contextmenu', onContextMenu);
    return () => {
      svg.removeEventListener('wheel', onWheel);
      svg.removeEventListener('pointerdown', onPointerDown);
      svg.removeEventListener('pointermove', onPointerMove);
      svg.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('pointercancel', onPointerUp);
      svg.removeEventListener('contextmenu', onContextMenu);
    };
  }, [svgRef, limits]);

  const reset = useCallback(() => setViewBox(home), [home]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (ignoreShortcut(e) || e.key !== '0') return;
      e.preventDefault();
      reset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reset]);

  return { viewBox, zoom: home.w / viewBox.w, reset };
}
