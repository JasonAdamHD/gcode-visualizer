/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useMemo } from 'react';

type SheetGridProps = {
  /** Sheet extents in world units, origin at the lower-left corner. */
  sheet: { x: number; y: number };
  gridSpacing: number;
};

/** The sheet rectangle and its grid, in world coordinates (render inside the Y-flipped group). */
export function SheetGrid({ sheet, gridSpacing }: SheetGridProps) {
  const gridLines = useMemo(() => {
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = 0; x <= sheet.x + 1e-6; x += gridSpacing) {
      lines.push({ key: `v${x}`, x1: x, y1: 0, x2: x, y2: sheet.y });
    }
    for (let y = 0; y <= sheet.y + 1e-6; y += gridSpacing) {
      lines.push({ key: `h${y}`, x1: 0, y1: y, x2: sheet.x, y2: y });
    }
    return lines;
  }, [sheet.x, sheet.y, gridSpacing]);

  return (
    <>
      <rect x={0} y={0} width={sheet.x} height={sheet.y} className="sheet" />
      {gridLines.map((line) => (
        <line
          key={line.key}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          className="grid-line"
          strokeWidth={gridSpacing * 0.01}
        />
      ))}
    </>
  );
}
