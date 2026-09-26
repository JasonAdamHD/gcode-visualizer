# CLAUDE.md

Guidance for coding agents working in this repository.

## What this is

A browser-based CNC toolpath visualizer: draw 2D cut paths on a sheet, and
eventually compute cutter-compensated toolpaths, estimate cut time, simulate
in 3D, and import/debug real G-code. See `README.md` for the full roadmap
(Phases 1–8) and the **Status** checklist of what is done.

This project is developed agent-first: agents implement changes on branches,
and a human reviews and merges. Leave every change in a state a reviewer can
verify quickly.

## Commands

```sh
npm install
npm run dev          # Vite dev server
npm run lint         # oxlint
npm run build        # tsc -b typecheck + production build
npm run test         # Vitest, single run
npm run test:watch   # Vitest, watch mode
npm run check        # lint + build + test: run before every commit
```

**Definition of done:** `npm run check` passes. CI
(`.github/workflows/ci.yml`) runs the same steps on every PR.

## Architecture

- `src/geometry/` holds pure, framework-free math. This is where
  correctness matters most and where tests live.
  - `segment.ts`: `Point`, `Segment`, `Path` types; arc math using the
    DXF **bulge** convention (`bulge = tan(θ/4)`, 0 = straight, positive =
    counterclockwise); SVG path generation; path length and closure.
  - `snapping.ts`: grid spacing, endpoint/grid/axis snapping.
- `src/state/useDrawingState.ts` is a React hook holding drawing state as
  immutable snapshots in a history array (undo/redo moves an index). Arc
  bowing uses a transient drag state that commits one snapshot on release.
- `src/components/Canvas.tsx` does SVG rendering and pointer handling. It
  converts screen coordinates to world coordinates and picks the snap mode
  from modifier keys (Ctrl/Cmd = axis lock, Shift = no snap).
- World coordinates are **Y-up** (CNC convention). SVG is Y-down, so the
  flip happens at the canvas boundary (`screenToWorld`). Keep geometry code
  in world coordinates.
- Planned: `src/gcode/` for the G-code parser (Phase 5). Keep parsing pure
  and client-side only (see the Privacy section of the README).

## Conventions

- Every new source file starts with the MPL 2.0 header used in existing
  files.
- Keep geometry and parsing logic pure and put it outside components, so it
  can be unit tested.
- New or changed logic in `src/geometry/` (and later `src/gcode/`) gets
  tests in a colocated `*.test.ts` file. When fixing a bug, add a test that
  fails without the fix.
- Exported functions get a JSDoc comment explaining intent and conventions
  (units, coordinate system, sign of angles).
- TypeScript is strict about unused locals and parameters; `npm run build`
  catches these.
- Match the surrounding code style: single quotes, 2-space indent, named
  exports.

## Workflow

- Work on a feature branch and open a PR; don't push to `master`.
- Keep commits small and focused, with messages that explain *why*.
- When a roadmap item lands, tick it off in the README's **Status** list.
- If you notice an unrelated problem, note it for a separate change rather
  than widening the current one.
