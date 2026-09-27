# Phase 6 — 3D visualization enhancements: working plan

Hand-off brief for the agent implementing Phase 6. Read `CLAUDE.md` first:
it has the architecture, conventions, the definition of done
(`npm run check`), and the branch → PR → `/code-review` → hand-off workflow.
This plan says **what** to build and in what order; `CLAUDE.md` says **how**
changes are made.

## Goal

Make the 3D view a real simulation and the playback a debugging tool:

- **Material removal:** the sheet is cut away as the bit moves, with the
  real bit shape (flat, ball, V), in sync with the playback clock, forwards
  and backwards.
- **Camera:** top/front/right/iso presets, fit to the job, follow the bit,
  perspective ↔ orthographic.
- **Playback:** a scrubber that shows what happens when (move kinds,
  problems), continuous speed, more keyboard control, layer toggles, and
  breakpoints ("run to this line", "run to next problem").
- **2D pan/zoom** in the drawing canvas and the program view (deferred here
  from Phase 5).

It must stay responsive on the Phase 5 scale target (10⁵-line programs).

## Prerequisite

Phase 5 is merged (PR #15): `PlaybackWorkspace` owns the one clock;
`Viewer3D` gets `timeline`, `playback`, `sample`, `currentMove` as props.

## Out of scope (do not build)

- Full 3D (dexel/voxel/mesh-boolean) stock. The heightfield is exact for
  3-axis work with a vertical bit, which is all the parser produces.
- Cutting the spoilboard: stock bottoms out at Z = −thickness; the
  penetration check stays in `analyzeProgram`.
- A Web Worker for the simulation (keep it pure so one can be added later).
- Stock export (STL), collision checks for holder/collet, animated camera
  transitions, touch gestures.
- Breakpoints persisted or shared (Phase 7 deep links will cover sharing).
- Pan/zoom changes to snapping behaviour beyond scaling its tolerance.

## What already exists (read these)

| File | Relevant contents |
|------|-------------------|
| `src/components/Viewer3D.tsx` | Imperative Three.js: effect (a) renderer/camera/`OrbitControls` (`zoomToCursor`), (b) job geometry (`slab` sheet + spoilboard, per-kind `LineSegments`, lathe bit), `traversed`/`current`/`moveOverlay` draw ranges over `pathBuffer`, (c) per-frame bit position. `resetView` frames the sheet; on-demand `render()`. |
| `src/sim/sceneData.ts` | `moveLineBuffers`, `pathBuffer` (piece `i` = timeline block `i`), `bitProfile(shape, diameter, length)`. |
| `src/toolpath/timeline.ts` | `Timeline` (`blocks`, `blockStart`, `moveStart`, `total`), `sampleTimeline` (`position`, `block`, `moveIndex`), `moveBlockStarts`, `adjacentMoveTime`. |
| `src/toolpath/planner.ts` | `linearize` → `Block { from, u, length, move }`. |
| `src/state/usePlayback.ts` | rAF clock: `time`, `speed`, `seek`, …; `PLAYBACK_SPEEDS`; `MAX_FRAME_SECONDS`. |
| `src/components/PlaybackWorkspace.tsx` | Owns the clock; Space / ←/→ key handler (`isFormControl` guard); `selectLine`; renders `Viewer3D`, `ProgramView`, `ProgramPane`. |
| `src/components/PlaybackBar.tsx` | Play/Restart/step buttons, range scrubber, speed `<select>`, readout. |
| `src/components/SourceListing.tsx`, `ProgramPane.tsx` | Virtualized listing with severity markers; line click → `onSelectLine`. |
| `src/gcode/step.ts`, `diagnostics.ts` | `firstMoveByLine`; `Diagnostic { line, severity, code }`. |
| `src/gcode/pathData.ts` | `moveBounds` (2D bounds; pattern for 3D bounds). |
| `src/components/Canvas.tsx`, `ProgramView.tsx` | Fixed `viewBox` (Canvas: Y flipped via `sheet.y − y`; ProgramView: `scale(1 −1)` group). `screenToWorld` uses `getScreenCTM`, so it survives a changing `viewBox`. Snap tolerance is `gridSpacing * 0.35` (world units). |
| `src/App.tsx` | View mode and panel state in localStorage (pattern for layer toggles). |

## Key decisions

1. **Stock is a heightfield.** A pure `Stock` in `src/sim/stock.ts`:
   `{ nx, ny, cell, heights: Float32Array }` over the sheet footprint
   (`0..sheet.x`, `0..sheet.y`), heights start at 0 (sheet top), and
   cutting only ever lowers them (`h = min(h, toolSurface)`), clamped at
   −thickness. Because cutting is a `min`, applying a block in pieces
   equals applying it whole: this is what makes incremental playback exact.
2. **Resolution.** `cell = max(bit.diameter / 8, sqrt(sheet.x·sheet.y / MAX_CELLS))`
   with `MAX_CELLS = 2²⁰` (a named constant; tune it during verification).
   Say in the UI when the cap coarsened the grid below diameter / 8.
3. **Tool shape** as a radial offset `tipOffset(d)`: height of the bit
   surface above its tip at horizontal distance `d ≤ r` (flat 0, ball
   `r − √(r² − d²)`, V `d / tan(half-angle)`, clamped to the bit's
   cylinder like `bitProfile`). One function, tested against `bitProfile`.
4. **Sweeping a block.** Constant-Z blocks (most cuts) and vertical blocks
   are exact: per cell in the block's XY box grown by `r`,
   `z + tipOffset(distance to the XY segment)`. Sloped and helical chords
   are stamped at steps ≤ cell / 2. Blocks whose tip stays above Z = 0 are
   skipped (rapids at safe height cost nothing). Every sweep returns the
   dirty cell rectangle.
5. **Sync with the clock.** A `StockSimulator` (pure, `src/sim/stockSim.ts`)
   tracks how far it has cut: `(block, distance)`. `advanceTo(target,
   budget)` cuts forward up to `sample.block` / `sample.position`, doing at
   most `budget` work units and reporting whether it caught up, so a jump
   to the end of a 10⁵-line file is time-sliced across frames (show
   "Simulating… n %" in the toolbar) and never freezes the page. Seeking
   backwards restores the nearest **checkpoint** at or before the target
   (a copy of `heights`, taken every ~N blocks of work, at most
   `MAX_CHECKPOINTS` of them, evicting evenly) and cuts forward from there.
   Invariant (tested): any sequence of seeks gives the same heights as
   cutting from scratch to the final time.
6. **Rendering the stock.** One `PlaneGeometry`-style grid mesh
   (`nx × ny` vertices, Z from `heights`) with `flatShading: true` so no
   normals are computed, plus skirt walls down to −thickness on the four
   edges. Updates write only dirty rows and use
   `BufferAttribute.addUpdateRange`; never rebuild the geometry during
   playback. The translucent sheet `slab` is replaced by the stock while
   the stock layer is on; the spoilboard slab stays.
7. **Camera math is pure.** `src/sim/camera.ts`:
   `cameraPose(preset, bounds, fov)` → `{ position, target, up }` for
   `iso` (today's `resetView` direction), `top`, `front`, `right`;
   `jobBounds(path: Float32Array)` → 3D bounds of the toolpath. Top view
   looks down −Z with a tiny tilt so `OrbitControls` (whose `up` is +Z)
   does not hit its pole singularity. Ortho uses a second camera whose
   frustum height matches the perspective view at the target
   (`2·distance·tan(fov/2)`); switching copies position/target and sets
   `controls.object`.
8. **Breakpoints are clock stops.** `usePlayback` takes an optional sorted
   `stops: Float64Array` of times; a frame that would cross a stop lands on
   it and pauses (pure helper `firstStopIn(stops, t0, t1)`, tested; a stop
   exactly at the current time does not re-trigger). Stops come from
   breakpoint lines (`timeline.moveStart[firstMoveByLine[line]]`) and,
   when "Stop at problems" is on, diagnostic lines. `firstMoveByLine` is
   −1 for lines after the last move (e.g. a trailing `M30`); drop those
   rather than indexing `moveStart[-1]` (NaN would break the sorted
   `stops` and the scrubber ticks). Breakpoints are
   transient `Set<number>` state in `PlaybackWorkspace`, cleared when the
   program closes.
9. **Scrubber markers are bucketed.** A pure `scrubberBands(timeline, bins)`
   gives the dominant move kind per time bin (bins ≈ scrubber width in
   px, ≤ 2000), and `diagnosticTicks(timeline, lineMoves, diagnostics)`
   gives unique (time, severity) ticks (same −1 rule as decision 8). Drawn on a `<canvas>` under the
   range input, so 10⁵ moves cost one draw, not 10⁵ elements.
10. **2D viewport is pure.** `src/geometry/viewport.ts`:
    `ViewBox = { x, y, w, h }`, `zoomAt(vb, point, factor, limits)`
    (point stays under the cursor), `panBy(vb, dx, dy)`,
    `fitBox(bounds, margin, aspect)`. One `usePanZoom(svgRef, home)` hook
    serves `Canvas` and `ProgramView`: wheel zooms at the cursor,
    middle- or right-drag pans (left click still places points), a Fit
    button and the `0` key reset to `home`. The view resets when the sheet
    or units change. Canvas's snap tolerance becomes a fixed screen
    distance converted to world units, so snapping feels the same at any
    zoom.
11. **Layer toggles** (3D): stock, sheet/spoilboard, cut, plunge/retract,
    rapid, untraversed path (off = show only the traversed path), axes.
    Toggling sets `visible`, never rebuilds geometry. Persist in
    localStorage (`cnc-visualizer.layers`) like the 2D/3D view, with every
    read/write in try/catch.

## Implementation steps (five PRs)

Each PR is its own branch off up-to-date `master`, passes `npm run check`,
gets `/code-review`, and is handed off for a human to merge before the
next one starts.

### PR 1 — `feat/stock-heightfield`: stock math only, no UI

1. `src/sim/stock.ts`: `createStock(sheet, thickness, bit)` (decision 2),
   `tipOffset(shape, diameter, d)` (decision 3),
   `cutSegment(stock, from, to, bit): DirtyRect | null` (decision 4).
2. `src/sim/stockSim.ts`: `StockSimulator` (decision 5): constructor
   `(timeline, stock, bit)`, `advanceTo({ block, position }, budget)`,
   `progress`, checkpoints.
3. Tests (`stock.test.ts`, `stockSim.test.ts`, mm units):
   - `tipOffset` matches `bitProfile` for all three shapes;
   - flat slot at Z = −3: width = diameter (± one cell), depth 3, untouched
     outside; ball slot cross-section is a circle arc; V slot width at the
     surface = `2·depth·tan(half)`;
   - a plunge makes a round hole; a block above Z = 0 changes nothing;
   - cuts past the sheet edge and below −thickness are clipped/clamped;
   - a block cut in two halves equals the block cut whole (decision 1);
   - the resolution cap engages for a large sheet with a tiny bit;
   - seek invariant: random forward/backward seek sequences over a small
     program equal a from-scratch cut to the final time;
   - `advanceTo` with a small budget needs several calls and ends equal to
     one unbounded call;
   - 10⁵-block generated program completes (no timing assertion).

### PR 2 — `feat/stock-view`: material removal + layer toggles

1. `Viewer3D`: create the `Stock`/`StockSimulator` when `timeline`, sheet
   or bit change; drive `advanceTo` from `sample` inside the existing
   per-frame effect (c), continuing in rAF while not caught up, with a
   per-frame budget (~6 ms). Render per decision 6.
2. Toolbar: "Simulating… n %" while behind; a note when the grid was
   coarsened (decision 2).
3. Layer toggles (decision 11) in a compact toolbar menu; the legend
   swatches double as the kind toggles if that reads well.
4. Colors come from new CSS tokens (`--stock-3d`, cut-floor shade) in both
   color schemes, read by `readPalette`.

### PR 3 — `feat/camera-controls`

1. `src/sim/camera.ts` + `camera.test.ts` (decision 7): each preset's
   direction; the pose frames the bounds (bounding sphere inside the
   frustum); `jobBounds` on a known path; ortho frustum height equality.
2. `Viewer3D`: preset buttons (Iso / Top / Front / Right) and keys
   `1`–`4`; "Fit job" (toolpath bounds) next to "Reset view" (sheet);
   "Follow bit" toggle that moves `controls.target` and the camera by the
   bit's delta each sample; Perspective/Ortho toggle. `resetView` becomes
   `cameraPose('iso', sheetBounds)`.
3. Keys go through `PlaybackWorkspace`'s handler pattern (ignore form
   controls and modifiers); only active in the 3D view.

### PR 4 — `feat/playback-controls`

1. Scrubber (decision 9): `src/toolpath/scrubber.ts` + tests (bands over
   a known timeline, empty timeline, tick dedupe, a diagnostic after the
   last move gives no tick). Canvas under the range
   input in `PlaybackBar`, redrawn on resize and palette change.
2. Speed: replace the `<select>` with a log slider (0.25×–500×) plus the
   current value; keep `PLAYBACK_SPEEDS` as detents/labels.
3. Keys: Home/End (start/end), `+`/`−` (speed ×2 / ÷2), Shift+←/→ (step
   one planner block). Update the hint line in both views.
4. Breakpoints (decision 8): gutter click in `SourceListing` toggles a
   breakpoint (marker distinct from the severity marker); "Run to line"
   in the listing's context (e.g. Alt+click or a row button) seeks-plays to
   that line; a "Stop at problems" toggle and a "Next problem" button in
   `ProgramPane`. `usePlayback` stop tests: a stop inside a frame's
   advance pauses exactly on it; at the current time it is skipped; seeks
   ignore stops.

### PR 5 — `feat/2d-pan-zoom` + docs

1. `src/geometry/viewport.ts` + `viewport.test.ts` (decision 10): zoom
   keeps the cursor point fixed, zoom limits clamp, pan in world units,
   fit keeps aspect and centers.
2. `usePanZoom` hook; wire into `Canvas` (snap tolerance in screen px) and
   `ProgramView`; Fit button in both toolbars. Drawing (click, drag-to-bow,
   snapping) must behave identically at any zoom.
3. Docs:
   - tick Phase 6 in the README **Status** list, with a one-paragraph
     summary like the other phases;
   - README project structure: `/sim` becomes "Pure 3D scene data, stock
     heightfield and camera math (+ *.test.ts)";
   - `CLAUDE.md` Architecture: `src/sim/` entries for `stock.ts`,
     `stockSim.ts`, `camera.ts` (heightfield rule, min-only cutting,
     checkpoints); `viewport.ts` under `src/geometry/`; the `Viewer3D`,
     `usePlayback` (stops) and `PlaybackWorkspace` (breakpoints) entries.

## Verification expected in each PR description

- `npm run check` passes (paste the test count).
- PR 1: the seek-invariant and split-block tests, listed by name.
- PR 2–5, in `npm run dev`:
  - the drawing's job and the bundled sample show the sheet being cut,
    with flat, ball and V bits giving visibly different grooves;
  - scrubbing backwards and forwards, and stepping, leave no stale cuts;
  - a generated 10⁵-line file: jumping to the end shows progress and the
    page stays responsive; playback frame rate stays usable;
  - in ↔ mm toggle keeps stock, camera framing and markers consistent;
  - each camera preset, Fit job, Follow bit and Ortho work; orbiting from
    Top does not flip;
  - scrubber bands and problem ticks line up with the listing; a
    breakpoint and "Stop at problems" pause on the right line;
  - 2D: wheel zoom at cursor, pan, Fit; drawing and snapping unchanged
    when zoomed;
  - `vite build` still emits Three.js in its own chunk.
