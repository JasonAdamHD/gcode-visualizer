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
- `src/machine/params.ts` holds the pure `MachineParams` model (units,
  sheet, bit shape, feeds, spoilboard penetration, and the v2 motion fields:
  rapid rates, safe height, depth per pass, acceleration, junction
  deviation): defaults, in/mm conversion, field validation, and JSON
  (de)serialization shared by localStorage and settings-file import.
  `parseParams` migrates version 1 by filling the motion fields with
  defaults in the file's units; bump the version and add a migration for
  any future shape change. `BitShape` is a discriminated union so a custom
  drawn profile can be added later.
- `src/toolpath/` turns the drawing into machine motion (pure, tested):
  - `offset.ts`: cutter compensation. The **only** module that imports
    `cavalier-contours-js` (pinned exact); never offset paths by hand.
    Closed paths are normalized so CW/CCW drawings match, and output is
    normalized to **climb milling** for a CW spindle (outside loops CW,
    inside CCW). Loop closure is per loop (`closed[i]`): a
    self-intersecting closed path can offset into open pieces.
  - `toolpath.ts`: `computeToolpath` (offset + compensation radius +
    warnings).
  - `moves.ts`: the `Move` list (rapid/plunge/feed/retract) with depth
    passes. **Z = 0 at the sheet top, negative into material**; home is
    the sheet origin at safe height. The 3D view animates this list, and
    Phase 5 import will produce it too, so keep viewers dependent on
    `Move[]` only.
  - `planner.ts`: GRBL-style planner (arcs to chords, junction deviation,
    backward/forward passes, trapezoidal profiles). `planBlocks` exposes
    each block's entry/exit speed and time; `planTime` sums them and
    `estimate.ts` buckets the per-move times.
  - `timeline.ts`: playback timing on top of `planBlocks`. `profileAt`
    inverts `blockTime`; `sampleTimeline` gives position, move, block and
    speed at any time. Its total must equal the estimate (tested).
- `src/sim/sceneData.ts` holds pure data for the 3D view: per-kind line
  buffers, a playback-ordered path buffer (piece `i` = timeline block `i`),
  and lathe outlines for the bit shapes.
- `src/state/useDrawingState.ts` is a React hook holding drawing state as
  immutable snapshots in a history array (undo/redo moves an index). Arc
  bowing uses a transient drag state that commits one snapshot on release.
- `src/state/useMachineParams.ts` holds `MachineParams`, persisted to
  localStorage. It knows nothing about the drawing.
- `src/state/usePlayback.ts` is the transient playback clock (not in
  history, not persisted): a requestAnimationFrame loop that pauses and
  clamps when the timeline changes.
- `src/App.tsx` owns both hooks. Units live **outside** drawing history: a
  unit change (toggle, import, reset) rescales every history snapshot in
  place via `rescale`, so undo never shows inch geometry on an mm sheet.
- `src/components/Canvas.tsx` does SVG rendering and pointer handling. It
  converts screen coordinates to world coordinates and picks the snap mode
  from modifier keys (Ctrl/Cmd = axis lock, Shift = no snap).
- `src/components/Viewer3D.tsx` is the 3D view, lazily loaded (Three.js
  stays out of the main chunk) inside `ViewErrorBoundary`. It owns Three.js
  imperatively: one effect creates/disposes the renderer, others rebuild
  geometry or move the bit, and frames render on demand. The scene uses
  machine coordinates directly; only the camera differs from Three.js
  defaults (`camera.up = (0, 0, 1)`, **Z up**). Never swap axes in scene
  data. `PlaybackBar.tsx` holds the playback controls and readout.
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

Every change follows these steps, in order. No exceptions for small fixes.

1. **Never change `master`.** Before the first edit, branch off an
   up-to-date `master`: `git switch master`, `git pull`, then
   `git switch -c <type>/<short-name>` (e.g. `feat/arc-offset`,
   `fix/bulge-sign`, `chore/ci-cache`). All commits go on that branch.
2. **Implement** in small, focused commits with messages that explain
   *why*. `npm run check` must pass before each commit.
3. **Open a PR**: push the branch and run `gh pr create`. The description
   has these sections:
   - **Summary**: what changed.
   - **Why**: the reason for the change.
   - **Verified**: what you actually ran and the results (e.g.
     `npm run check` passes, cases exercised, behavior observed in the
     app). Verifying is the agent's job; never list steps you didn't run.
   - **Reviewer spot-check (optional)**: the one or two quickest ways for
     the human to confirm the change themselves, if they want to.
4. **Review the PR** with Claude: `/code-review <PR number>`.
5. **Address every finding**: fix it in a new commit on the branch, or
   explain in the PR why it doesn't apply. Re-run `npm run check` and push;
   re-review if the fixes were non-trivial.
6. **Hand off for merge** once CI is green and findings are resolved: report
   the PR as ready. A human merges. Agents never merge PRs or push to
   `master`.

A PreToolUse hook (`.claude/hooks/guard-master.mjs`) enforces step 1: while
the checkout is on `master`, it blocks edits to files in the repo and
`git commit`/`push`/`merge`. From any branch it also blocks pushes that
target `master`. Create the branch as its own command, then continue.

Also:

- When a roadmap item lands, tick it off in the README's **Status** list.
- If you notice an unrelated problem, note it for a separate change rather
  than widening the current one.
