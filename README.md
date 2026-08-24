# CNC Toolpath Visualizer

A browser-based tool for drawing CNC cut paths on a sheet, calculating cut
time, and importing/visualizing real G-code files — including customer
files, to debug them before they hit the machine.

Built as a portfolio piece: it's a geometry/CAD problem (arc handling, cutter
compensation, G-code parsing) implemented in a modern web stack
(React/TypeScript), to demonstrate both domain expertise from CNC/CAD work
and frontend ability.

## What it does (or will do)

1. **Draw** a 2D cut path on a virtual sheet by clicking to place line
   segments, with snapping to the grid, to existing points, and to the
   X/Y axis relative to your last point, plus the ability to bow any segment
   into an arc.
2. **Configure** machine parameters — units, sheet size, bit diameter/shape,
   feed speed, spoilboard penetration.
3. **Compute** the actual toolpath: offset the drawn path by the bit radius
   (cutter compensation) and estimate cut time from path length and feed
   rate.
4. **Visualize** the cut in 3D and simulate the bit moving along the
   toolpath.
5. **Import** a G-code file (from any CAM/post-processor, including customer
   files) and step through it move-by-move, with the current line
   highlighted on the canvas/3D view, rapid vs. feed moves visually
   distinct, and flags for likely problems (out-of-bounds moves, suspicious
   Z depth, unresolved arcs) — built for debugging real files, not just
   visualizing your own.

## Status

- [x] Phase 1 — Drawing canvas: sheet boundary, grid, click-to-place line
      segments, drag-to-bow arcs, snapping (grid, endpoint, and Ctrl
      axis-lock), undo/redo, closed-path detection
- [ ] Phase 2 — Parameters panel
- [ ] Phase 3 — Toolpath math (offsetting, cut time)
- [ ] Phase 4 — 3D visualization
- [ ] Phase 5 — G-code import + debugging (parser, step-through, error flags)
- [ ] Phase 6 — Drawing canvas enhancements (pocket clearing, tabs,
      lead-in/lead-out, manual repair of an imported path)
- [ ] Phase 7 — Parameters panel enhancements (tool library, multiple passes)
- [ ] Phase 8 — 3D visualization enhancements (material removal, camera
      controls, better playback)

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
  /gcode         # G-code parsing -> Path, for import (Phase 5)
  /components    # UI components (Canvas, etc.)
  /state         # Drawing state, undo/redo
```
