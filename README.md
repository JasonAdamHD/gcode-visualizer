# CNC Toolpath Visualizer

A browser-based tool for drawing CNC cut paths on a sheet, calculating cut
time, and exporting G-code.

Built as a portfolio piece: it's a geometry/CAD problem (arc handling, cutter
compensation, G-code generation) implemented in a modern web stack
(React/TypeScript), to demonstrate both domain expertise from CNC/CAD work
and frontend ability.

## What it does (or will do)

1. **Draw** a 2D cut path on a virtual sheet by clicking to place line
   segments, with snapping to the grid and to existing points, and the
   ability to bow any segment into an arc.
2. **Configure** machine parameters — units, sheet size, bit diameter/shape,
   feed speed, spoilboard penetration.
3. **Compute** the actual toolpath: offset the drawn path by the bit radius
   (cutter compensation) and estimate cut time from path length and feed
   rate.
4. **Visualize** the cut in 3D and simulate the bit moving along the
   toolpath.
5. **Export** the result as G-code.

## Status

- [x] Phase 1 — Drawing canvas: sheet boundary, grid, click-to-place line
      segments, drag-to-bow arcs, snapping, undo/redo, closed-path detection
- [ ] Phase 2 — Parameters panel
- [ ] Phase 3 — Toolpath math (offsetting, cut time)
- [ ] Phase 4 — 3D visualization
- [ ] Phase 5 — G-code export

## Stack

- React + TypeScript
- SVG for the 2D drawing canvas (real DOM elements for hit-testing and
  snapping, rather than raw `<canvas>`)
- Three.js for 3D toolpath simulation (Phase 4)
- Vite

## Development

```sh
npm install
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run lint      # oxlint
```

## Project structure

```
/src
  /geometry      # Segment/Path types, bulge (arc) math, snapping
  /gcode         # Path -> G-code export (Phase 5)
  /components    # UI components (Canvas, etc.)
  /state         # Drawing state, undo/redo
```
