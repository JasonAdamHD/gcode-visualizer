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
  sheet, bit shape, feeds, spoilboard penetration): defaults, in/mm
  conversion, field validation, and JSON (de)serialization shared by
  localStorage and settings-file import. `BitShape` is a discriminated union
  so a custom drawn profile can be added later.
- `src/state/useDrawingState.ts` is a React hook holding drawing state as
  immutable snapshots in a history array (undo/redo moves an index). Arc
  bowing uses a transient drag state that commits one snapshot on release.
- `src/state/useMachineParams.ts` holds `MachineParams`, persisted to
  localStorage. It knows nothing about the drawing.
- `src/App.tsx` owns both hooks. Units live **outside** drawing history: a
  unit change (toggle, import, reset) rescales every history snapshot in
  place via `rescale`, so undo never shows inch geometry on an mm sheet.
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
