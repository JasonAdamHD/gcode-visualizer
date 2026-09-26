# Phase 4 — 3D visualization: working plan

Hand-off brief for the agent implementing Phase 4. Read `CLAUDE.md` first:
it has the architecture, conventions, the definition of done
(`npm run check`), and the branch → PR → `/code-review` → hand-off workflow.
This plan says **what** to build and in what order; `CLAUDE.md` says **how**
changes are made.

## Goal

Show the job in 3D and simulate the bit moving along the toolpath:

- the sheet (with thickness) and spoilboard as solids,
- the full move list from `buildMoves` drawn as lines, rapids visibly
  different from cutting moves,
- a bit mesh shaped like the configured bit (flat / ball / V) at its real
  diameter,
- playback: play / pause / scrub / speed, with the bit's motion timed by
  the **same GRBL-style planner** that produces the cut-time estimate, so
  the playback clock and the estimate always agree and the bit visibly
  slows into corners.

## Out of scope (do not build)

- Material removal / stock simulation (Phase 8).
- Camera presets, fit-to-selection, section views, better playback UX such
  as per-move stepping (Phase 8). A basic orbit camera and a "reset view"
  button **are** in scope.
- G-code parsing (Phase 5). Design the viewer so Phase 5 can reuse it (see
  [Phase 5 compatibility](#phase-5-compatibility)), but do not add a parser.
- Tabs, lead-ins, pockets (Phase 6); tool library, custom bit profiles
  (Phase 7).

## What already exists (read these)

| File | Relevant contents |
|------|-------------------|
| `src/toolpath/moves.ts` | `Point3`, `Move` (`rapid`/`plunge`/`feed`/`retract`, optional `bulge` for arcs), `buildMoves`. Z = 0 at sheet top, negative into material; home = sheet origin at safe height. |
| `src/toolpath/planner.ts` | `linearize` (moves → straight `Block`s, arcs chorded at `ARC_TOLERANCE_MM`), `junctionSpeed`, `blockTime`, `planTime` (backward/forward passes → `moveTimes`, `total`). The per-block entry speeds are computed internally but **not exported**. |
| `src/toolpath/estimate.ts` | `estimateCutTime`, `formatDuration`. |
| `src/machine/params.ts` | `MachineParams`, `BitShape` (`flat` / `ball` / `vbit` with `includedAngleDeg`), `unitFactor`. |
| `src/App.tsx` | Owns drawing + params hooks; memoizes `toolpath` and `estimate`. Currently calls `buildMoves` inline inside the estimate memo. |
| `src/components/Canvas.tsx` | 2D SVG view and its toolbar (status line shows the estimate). |
| `src/index.css` | Theme tokens (`--accent`, `--sheet-bg`, …) with a dark-mode override. |

## Key decisions

1. **Plain `three`, no react-three-fiber.** The README names Three.js;
   one dependency (`three` + `@types/three`) keeps the bundle and the
   review surface small. Pin `three` to an exact version like
   `cavalier-contours-js`. A single React component owns the renderer
   imperatively (create in `useEffect`, dispose on unmount).
2. **Machine coordinates in the scene, Z up.** Do not swap axes. Set
   `camera.up.set(0, 0, 1)` and configure `OrbitControls` for Z-up. World
   X/Y/Z in the scene are exactly `Move` coordinates, in the current
   units. The only transform lives in the camera.
3. **Timing comes from the planner, not from distance / feed.** Export the
   planner's per-block kinematics and build a playback timeline on top of
   them (step 1 below). The timeline's total must equal
   `estimateCutTime(...).total` to floating-point tolerance; this is a test.
4. **Pure logic outside components.** Timeline sampling, line-buffer
   building, and bit profile generation are pure functions with colocated
   `*.test.ts` files. Vitest runs in Node with no WebGL, so the
   Three.js component itself is verified in the browser, not in unit
   tests.
5. **Lazy-load the 3D view.** `React.lazy(() => import('./components/Viewer3D'))`
   so the 2D-only path does not pay for Three.js. Check that `vite build`
   emits a separate chunk.
6. **Built for big move lists.** Phase 5 will feed imported files with
   10⁴–10⁵ moves. One `BufferGeometry` per move kind (not one object per
   move), time lookup by binary search, and never rebuild geometry on a
   time change.

## Implementation steps (three PRs)

Each PR is its own branch off up-to-date `master`, passes `npm run check`,
gets `/code-review`, and is handed off for a human to merge before the next
one starts (later PRs build on earlier ones).

### PR 1 — `feat/sim-timeline`: planner kinematics + playback timeline (no UI)

1. **`src/toolpath/planner.ts`**
   - Give `Block` a `from: Point3` (start point of the chord) so a block can
     be positioned without re-walking the moves.
   - Add and export `planBlocks(moves, params): PlannedBlock[]`, where
     `PlannedBlock = Block & { vEntry: number; vExit: number; time: number }`,
     i.e. the result of the existing backward/forward passes.
   - Reimplement `planTime` on top of `planBlocks`. **Existing planner and
     estimate tests must pass unchanged**; that is the refactor's safety net.
2. **`src/toolpath/timeline.ts`** (new)
   - `distanceAtTime(length, vEntry, vExit, vNom, accel, t): number`: the
     inverse of `blockTime` for the same trapezoid/triangle profile
     (accelerate → cruise → decelerate). Clamp `t` to `[0, blockTime]`.
   - `buildTimeline(moves, params): Timeline`. Holds the planned blocks,
     cumulative block start times (`Float64Array`), per-move start times,
     and `total`.
   - `sampleTimeline(timeline, t): { position: Point3; moveIndex: number; kind: Move['kind']; speed: number }`,
     binary search for the block, then `distanceAtTime` along `u` from
     `from`. `t ≤ 0` gives the first move's start (home); `t ≥ total` gives
     the last move's end. An empty move list gives home at `(0, 0, safeHeight)`.
3. **Tests** (`planner.test.ts` additions, new `timeline.test.ts`):
   - `distanceAtTime` at `t = 0` is 0, at `t = blockTime(...)` is `length`,
     is monotonic, and inverts `blockTime` for both trapezoid and triangle
     profiles (including `vEntry = vExit = 0` and cruise-only blocks).
   - `buildTimeline(...).total` equals `planTime(...).total` and
     `estimateCutTime(...).total` for a square, a circle (arc chords), and a
     multi-pass job.
   - Sampling at each move's start time returns that move's `from`; at
     `total` returns home; position is continuous across block boundaries
     (sample `boundary ± ε`).
   - Speed never exceeds the block's `vNom` and is 0 at `t = 0` and `total`.
4. **`src/App.tsx`**: hoist `buildMoves(...)` into its own `useMemo` so
   `moves` can be shared by the estimate and (PR 2) the viewer. No
   behavior change.

### PR 2 — `feat/3d-viewer`: static 3D scene + 2D/3D toggle

1. `npm install --save-exact three` and `npm install -D @types/three`.
2. **`src/sim/sceneData.ts`** (new, pure; or `src/toolpath/`, the agent's
   call, but keep it out of `components/`):
   - `moveLineBuffers(moves, params): Record<Move['kind'], Float32Array>`:
     flat `[x0,y0,z0, x1,y1,z1, …]` segment pairs per kind, arcs chorded
     with the planner's tolerance (reuse `linearize` or the chord helper;
     do not write a second arc sampler).
   - `bitProfile(shape, diameter, length): Point[]`: a 2D (radius, z)
     outline for `THREE.LatheGeometry`, tip at z = 0.
     Flat = cylinder; ball = hemisphere of radius d/2 then cylinder;
     V-bit = cone with half-angle `includedAngleDeg / 2` (cone height
     `(d/2) / tan(half)`) then cylinder.
   - Tests: buffer lengths are multiples of 6, arc chord endpoints lie on
     the arc, each kind contains only its moves; profile tip at (0, 0),
     max radius exactly d/2, V-bit cone height for 90° and 60°, ball
     profile points at distance d/2 from (0, d/2).
3. **`src/components/Viewer3D.tsx`** (+ `Viewer3D.css`), default export
   for `React.lazy`:
   - Props: `moves: Move[]`, `params: MachineParams`, `position: Point3`
     (bit tip), `traversedTime` or a progress value for the highlight (PR 3;
     pass `0` for now).
   - Scene: sheet as a translucent box from z = −thickness to 0 over
     `sheet.x × sheet.y`; a thin spoilboard slab below it; axis triad at
     the origin; `LineSegments` per move kind: feed solid in `--accent`,
     rapid dashed (`LineDashedMaterial` + `computeLineDistances`),
     plunge/retract a third distinguishable color. Read colors from the
     CSS tokens so dark mode works; re-read on `prefers-color-scheme`
     change.
   - Bit: `LatheGeometry(bitProfile(...))` rotated so its axis is Z,
     positioned so the tip is at `position`.
   - Camera: perspective, Z-up, initial isometric view framing the sheet
     plus safe height; `OrbitControls`; "Reset view" button.
   - Lifecycle: separate effects for (a) renderer/scene setup and
     teardown, (b) rebuilding line/sheet/bit geometry when
     `moves`/`params` change (dispose old geometry and materials), (c)
     moving the bit when `position` changes. Resize with `ResizeObserver`.
     Render on demand (on change or controls interaction), not in a
     permanent rAF loop, when not playing.
   - If WebGL is unavailable, render a plain message instead of throwing.
4. **View toggle**: a `2D | 3D` segmented control in the toolbar area.
   Remember the choice per viewer in localStorage with the same
   try/catch pattern as `PANEL_OPEN_KEY` in `App.tsx`. The parameters panel
   stays visible in both views; editing params updates the 3D scene live.
   Wrap the lazy viewer in `<Suspense>` with a small loading state.

### PR 3 — `feat/playback`: animation, controls, docs

1. **`src/state/usePlayback.ts`** (new hook): `time`, `playing`, `speed`
   (e.g. 1×, 2×, 5×, 10×, 50×, 200×), `play`, `pause`, `toggle`,
   `seek(t)`, `restart`. A rAF loop advances `time += dt · speed` while
   playing and stops at `total`. When `total` changes (new moves), clamp
   `time` and pause. Playback state is **not** part of drawing history
   and not persisted.
2. **Playback bar** (in the 3D view): play/pause, restart, a scrubber
   (`<input type="range">` over `[0, total]`), speed select, and a readout:
   `elapsed / total` via `formatDuration`, current move kind, and bit
   X/Y/Z in current units (`displayDecimals`). Space toggles play when the
   3D view is focused. Disabled state when there are no moves.
3. **Viewer updates**: bit follows `sampleTimeline(timeline, time).position`.
   Highlight the traversed part of the path: build the line buffers in
   move order and use `geometry.setDrawRange` (or a second, brighter
   overlay) up to the current block, so it costs O(1) per frame rather
   than a rebuild.
4. **Docs**: tick Phase 4 in the README **Status** list (one line in the
   style of the others), update the README Stack/structure if a new folder
   was added, and add the new modules to the `CLAUDE.md` Architecture
   section (timeline, scene data, viewer, playback hook; the Z-up camera
   rule).

## Verification expected in each PR description

- `npm run check` passes (paste the test count).
- PR 1: the timeline/estimate equality tests, listed by name.
- PR 2/3: run `npm run dev` and check in the browser: a closed square with
  outside compensation and 3 depth passes shows 3 stacked loops below the
  sheet top, dashed rapids up to safe height, the correct bit shape for
  each of flat/ball/V; unit toggle in↔mm keeps the scene physically
  identical; dark mode colors are legible. `vite build` output shows
  Three.js in a separate chunk.
- PR 3: playback at 1× for a short job takes the estimated time (± a
  frame or so); the bit visibly slows at square corners; scrubbing to
  the end shows the bit at home.

## Phase 5 compatibility

Phase 5 imports G-code and needs the same viewer and playback. Keep these
properties so it can reuse PR 1–3 unchanged:

- `Viewer3D` and the timeline depend only on `Move[]` + `MachineParams`,
  never on drawing state or `computeToolpath` output.
- Moves are the interchange format: the Phase 5 parser will emit `Move[]`
  (G0 → `rapid`, G1 → `feed`/`plunge`/`retract` by Z direction, G2/G3 →
  `feed` with a bulge, or chords for helical/non-XY-plane arcs). If a
  field is needed to map a move back to its source line, add an optional
  `sourceLine?: number` on `Move` in Phase 5, not now.
- Nothing in the viewer assumes moves start at home or stay inside the
  sheet; imported files will violate both, and Phase 5 flags them.
