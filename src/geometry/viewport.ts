/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Pan and zoom for the 2D views as pure viewBox math. A ViewBox is in SVG
// user units (Y down, as SVG draws it); the views flip world Y inside it,
// so nothing here needs to know about world coordinates.
import type { Point } from './segment';

/** An SVG viewBox: top-left corner and size, in user units. */
export type ViewBox = { x: number; y: number; w: number; h: number };

/** Allowed view widths, in user units: `minW` is the closest zoom, `maxW` the farthest. */
export type ZoomLimits = { minW: number; maxW: number };

export type Bounds2 = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Zooms by `factor` (the view's size is multiplied by it, so below 1
 * zooms in) about `point` (user units), which stays at the same place on
 * screen. The width is clamped to `limits`, keeping the aspect ratio.
 */
export function zoomAt(vb: ViewBox, point: Point, factor: number, limits: ZoomLimits): ViewBox {
  const w = Math.min(limits.maxW, Math.max(limits.minW, vb.w * factor));
  const s = w / vb.w;
  return { x: point.x - (point.x - vb.x) * s, y: point.y - (point.y - vb.y) * s, w, h: vb.h * s };
}

/** Moves the content by `(dx, dy)` user units (the view moves the other way), as when dragging it. */
export function panBy(vb: ViewBox, dx: number, dy: number): ViewBox {
  return { x: vb.x - dx, y: vb.y - dy, w: vb.w, h: vb.h };
}

/**
 * The smallest view of `bounds` grown by `margin` on every side, widened
 * or heightened around its center to width / height `aspect` when given.
 */
export function fitBox(bounds: Bounds2, margin: number, aspect?: number): ViewBox {
  let w = bounds.maxX - bounds.minX + 2 * margin;
  let h = bounds.maxY - bounds.minY + 2 * margin;
  if (aspect && aspect > 0) {
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
  }
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Zoom limits relative to a home view: from 1/200 of its width up to 4 times it. */
export function zoomLimits(home: ViewBox): ZoomLimits {
  return { minW: home.w / 200, maxW: home.w * 4 };
}

/** `vb` as an SVG `viewBox` attribute. */
export function viewBoxAttr(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}
