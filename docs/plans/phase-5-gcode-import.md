# Phase 5 — G-code import + debugging: working plan

Hand-off brief for the agent implementing Phase 5. Read `CLAUDE.md` first:
it has the architecture, conventions, the definition of done
(`npm run check`), and the branch → PR → `/code-review` → hand-off workflow.
This plan says **what** to build and in what order; `CLAUDE.md` says **how**
changes are made.

## Goal

Open a real G-code file and debug it:

- Open a `.nc` / `.gcode` / `.ngc` / `.tap` / `.txt` file with a button or by
  dropping it on the workspace. It is parsed in the browser and never
  uploaded or stored, not even in localStorage (see the README's **Privacy
  and data handling**).
- Show the program in the existing 2D and 3D views, with the cut-time
  estimate and playback.
- Step through the program move by move. A source listing highlights the
  current line, and clicking a line jumps to it.
- A diagnostics list covers parse problems (unsupported words, bad arcs)
  and job problems (out of bounds, too deep, rapids into material).
  Clicking an entry jumps to its line.

The import supports basic, standard G-code only: G0/G1/G2/G3 (arcs by I/J
or R, XY plane), G20/G21, G90/G91, F and comments. Every other word is
reported, never silently ignored.

## Prerequisite

Phase 4 is merged (`feat/playback`, PR #9): `usePlayback`, `PlaybackBar`,
the traversed-path highlight and `pathBuffer` are on `master`.

## Out of scope (do not build)

- Controller dialects (Biesse etc.). Leave a seam for them (decision 8),
  but no dialect interface.
- G18/G19 arcs, G90.1 (absolute arc centers), canned cycles (G81…),
  G28/G53, work offsets (G54…) beyond reporting them, subprograms and
  macros.
- Cutter compensation in the file (G41/G42): report it, do not apply it.
- Converting an imported program into an editable drawing (Phase 7
  "manual repair").
- A Web Worker parser.
- G-code export.
- Pan/zoom in the 2D view (the drawing canvas has none either; Phase 6).

## What already exists (read these)

| File | Relevant contents |
|------|-------------------|
| `src/toolpath/moves.ts` | `Point3` and `Move` (`rapid`/`plunge`/`feed`/`retract`, optional `bulge`) are the interchange format. The `Move` JSDoc says `feed` is at constant Z; imported files break that (update the comment). |
| `src/toolpath/planner.ts` | `linearize` chords arcs (Z interpolated along the arc, so helices already work) and calls the private `nominalSpeed(kind, u, params)`, which takes feed and plunge speeds from `params`, not from the move. `planBlocks`, `planTime`. |
| `src/toolpath/estimate.ts` | `estimateCutTime` (on top of `planTime`), `formatDuration`. |
| `src/toolpath/timeline.ts` | `buildTimeline` (with `moveStart[m]`, the start time of move `m`, for seeking), `sampleTimeline` (`moveIndex`, `block`, `position`). |
| `src/sim/sceneData.ts` | `moveLineBuffers` (per-kind line buffers), `pathBuffer` (playback-ordered). |
| `src/state/usePlayback.ts` | `usePlayback(total, source)`: `time`, `seek`, `play`, `pause`, …; pauses and clamps when `source` changes. |
| `src/components/Viewer3D.tsx` | Props: `moves`, `params`, `estimate`, `viewToggle`. It builds the timeline and calls `usePlayback` **internally**; the `current` overlay line already draws the block in progress. |
| `src/components/PlaybackBar.tsx` | Playback controls and readout. |
| `src/components/Canvas.tsx` | 2D drawing view: fixed `viewBox` framing the sheet with a margin, toolbar with status line. |
| `src/geometry/segment.ts` | `arcFromBulge` (bulge = tan(θ/4), positive = CCW). |
| `src/machine/params.ts` | `unitFactor`, `displayDecimals`, `formatNumber`. |
| `src/toolpath/offset.ts` | `toolpathBounds` / `sheetBoundsWarning`: the pattern for a bounds check (sheet is `0..sheet.x`, `0..sheet.y`). |
| `src/App.tsx` | Memo chain: `toolpath` → `moves` → `estimate`; `view` (2D/3D) and panel state in localStorage. |

## Key decisions

1. **Moves stay the interchange format.** Add two optional fields to
   `Move`:
   - `sourceLine?: number`: 0-based line index in the file (the UI shows
     it 1-based).
   - `feedRate?: number`: units/min, from the modal F.

   `nominalSpeed` takes the move: for `feed`/`plunge` it uses
   `move.feedRate` when set, else `params.feedRate` / `params.plungeRate`.
   Rapids and retracts ignore `feedRate`. Existing planner, estimate,
   timeline and scene-data tests must pass unchanged; that is the
   refactor's safety net.
2. **Kind mapping.**
   - G0 moving only up in Z → `retract`; any other G0 → `rapid`.
   - G1 moving only down in Z → `plunge`; any other G1 (XY, 3D, or
     upward) → `feed`.
   - G2/G3 → `feed` with a bulge (G2 negative, G3 positive). Helical Z
     already interpolates in the planner.
   - A full circle (start = end with I/J) splits into two half arcs
     (bulge ±1) with the same `sourceLine`, because one bulge cannot
     represent 360°.
   - A zero-length straight move (e.g. `G1 X10` while already at X10) is
     dropped, as in `buildMoves`. The full-circle split happens first, so
     an arc with start = end is never dropped.
3. **Units.** The parser converts everything to one unit: the program's
   `units`, from the first G20/G21, or mm (GRBL's default) if there is
   none. A mid-file unit switch is converted and noted as `info`. The App
   stores the program in its own units and scales it into `params.units`
   in a memo with a pure `scaleMoves(moves, factor)` (positions and
   `feedRate`; bulge is dimensionless). A unit toggle therefore never
   mutates the program and never touches drawing history.
4. **Start position** is home `(0, 0, safeHeight)`, the same as
   `buildMoves` and the timeline. Say so in a tooltip on the file chip.
5. **Parse and analysis are separate pure functions.**
   - `parseGcode(text, start): GcodeProgram` takes no params, only the
     start position (decision 4) as `{ point: Point3; units: Units }`,
     which it converts into the program's units. It re-runs when a file is loaded or
     `safeHeight` changes. Patching the first move is not enough: an axis
     the file never sets (e.g. no Z before the first `G1 X10`, or
     anything under G91) carries the start value into later moves.
   - `analyzeProgram(moves, params): Diagnostic[]` runs on the scaled
     moves and re-runs when the sheet, thickness or penetration change.
6. **Diagnostics** have the shape
   `{ line: number; severity: 'error' | 'warning' | 'info'; code: string; message: string }`.
   `line` is 0-based like `sourceLine`. The UI groups them by `code` with
   a count, so a file with 10⁵ out-of-bounds moves doesn't produce 10⁵
   rows.
7. **Scale target is 10⁵ lines.** The parser is one linear pass over the
   text with a hand-written scanner (no regex per character, no
   per-line array allocations beyond the words). The source listing is a
   hand-rolled fixed-row-height virtual list (no new dependency). The 2D
   view draws one SVG `<path>` per move kind, not one element per move.
8. **Dialect seam.** Keep `tokenize(line)` (line → words and comments)
   separate from the modal interpreter in `parse.ts`, so a dialect layer
   can sit between them later. Do not build the dialect interface now.
9. **One playback clock per job.** Step-through needs the listing, the 2D
   view and the 3D view to agree on the current move, so PR 4 lifts
   `buildTimeline` and `usePlayback` out of `Viewer3D` into `App` and
   passes `timeline` and `playback` down as props. `Viewer3D` must keep
   depending only on `Move[]`, params and those props.

## Implementation steps (four PRs)

Each PR is its own branch off up-to-date `master`, passes `npm run check`,
gets `/code-review`, and is handed off for a human to merge before the
next one starts.

### PR 1 — `feat/gcode-parser`: parser only, no UI

1. **`src/gcode/tokenize.ts`**: `tokenize(line)` → words
   (`{ letter, value }`) and comments.
   - Case-insensitive; whitespace optional (`G1X10Y-.5`).
   - `( … )` and `;` comments. An unclosed `(` is an error.
   - `N` line numbers and `%` program delimiters are accepted and dropped.
   - A malformed number or an unknown letter is an error for that line,
     and the line is skipped.
2. **`src/gcode/parse.ts`**: `parseGcode(text, start)` (decision 5) returns
   `{ moves, units, lineCount, diagnostics }`.
   - Modal state: motion mode (G0–G3), G90/G91, G20/G21, F, G17.
   - A line with only axis words (`X10`) continues the last motion mode.
   - A duplicate word on one line (`X1 X2`, two motion G-codes) is an
     error; the line is skipped.
   - I/J are always incremental from the arc start (G91.1 behavior).
   - Arcs:
     - I/J: the start and end radii must agree. Error when they differ by
       more than 0.5 mm, or by more than 0.005 mm **and** more than 0.1 %
       of the radius (GRBL's rule; convert the mm limits to program
       units).
     - R: error when the endpoints are more than 2R apart. Negative R
       means the arc spans more than 180°.
     - Missing I/J/R, or R with start = end, is an error.
     - An erroring arc becomes a straight `feed` to its end point, with
       the error on its line, so the path stays continuous.
   - G1/G2/G3 before any F is an error; the move has no `feedRate`, so
     timing falls back to `params.feedRate` or `params.plungeRate` by kind
     (decision 1).
   - Every other word (M3/M5/S/T/M6/G4/G28/G53/G54/G18/G19/G41/G42…) gets a
     `warning` that names the word and says it was ignored. G18/G19 also
     make the following arcs errors (they would be in another plane).
3. **`src/gcode/scale.ts`**: `scaleMoves(moves, factor)`.
4. **`Move` fields and planner**: decision 1. Update the `Move` JSDoc.
5. **Tests** (`tokenize.test.ts`, `parse.test.ts`, `scale.test.ts`,
   `planner.test.ts` additions):
   - each word and comment form, and each tokenizer error;
   - modal carry-over (motion mode, F, units, G90/G91);
   - G91 relative moves, including arcs;
   - a mid-file G20 → G21 switch;
   - I/J and R arcs: CW and CCW, R > 180°, a full circle split into two
     half arcs, a helix;
   - each error and warning code, with its line;
   - kind mapping (the four kinds plus 3D and upward G1);
   - `sourceLine` values, including blank and comment-only lines;
   - per-move F reaching the planner: a square with F600 in the file
     estimates the same as the square with `params.feedRate = 600` and no
     `feedRate` on the moves;
   - `scaleMoves` round-trips in → mm → in;
   - a 10⁵-line generated program parses to the expected move count (no
     timing assertion).

### PR 2 — `feat/gcode-analysis`: job checks

1. **`src/gcode/analyze.ts`**: `analyzeProgram(moves, params)`. Checks:
   - `rapid-into-material` (error): a `rapid` that goes below the
     deepest Z already reached, or that moves in XY while below Z = 0.
     Rapiding down into an already-cut slot is normal: `buildMoves` does
     it on later passes of an open path, and so do most CAM post
     processors. Tests must include that `buildMoves` pattern and expect
     no diagnostic.
   - `too-deep` (error): Z below −(thickness + spoilboardPenetration).
   - `out-of-bounds` (warning): a cutting move (below Z = 0) that leaves
     the sheet in XY. Check arcs through their chord points from
     `linearize` (block `from` points plus the move's `to`), not just
     their endpoints.
   - `no-cut` (info): the program never goes below Z = 0.
   Use a small epsilon like `sheetBoundsWarning` so values exactly on a
   limit pass.
2. **`analyze.test.ts`**: each check, plus the boundaries: exactly at
   Z = 0, exactly at the penetration limit, exactly on the sheet edge, and
   an arc that bulges past the sheet edge while both endpoints are inside.

### PR 3 — `feat/gcode-import`: load and view

1. **`src/state/useProgram.ts`**: `{ program, fileName, load(file), close() }`.
   Reads with `file.text()`. Not persisted. A file that fails to read
   shows an error and leaves the current state unchanged.
2. **Program source in `App`**: while a program is loaded, `moves` come
   from `scaleMoves(program.moves, unitFactor(program.units, params.units))`
   instead of `buildMoves`. The estimate, `Viewer3D` and playback are
   reused unchanged. Closing the program returns to the untouched drawing
   (its undo history intact).
3. **Toolbar**:
   - an "Open G-code" button, and drag-drop onto the workspace;
   - a file chip with the name and a close ✕;
   - a "Load sample" button that opens `public/samples/demo.nc`, a
     hand-written sample with a square, a circle, a helix and one
     deliberate out-of-bounds move. The sample must contain no customer
     data.
4. **2D program view** (`src/components/ProgramView.tsx`): read-only SVG
   with the same sheet framing and CSS tokens as `Canvas`; feeds solid,
   rapids dashed, plunges and retracts as small markers. Drawing tools are
   hidden.
5. **Parameters panel in program mode**: hide cut side and toolpath
   warnings; note that feed and plunge rates come from the file (and are
   the fallback without F); sheet, thickness, penetration, rapids,
   acceleration, safe height and bit still apply.
6. **Diagnostics panel**: parse and analysis diagnostics together,
   grouped by code with a count and severity icon; each group expands to
   its lines (cap the expanded list, e.g. first 200, with "+N more").

### PR 4 — `feat/gcode-step`: step-through and docs

1. **Shared clock** (decision 9): lift `buildTimeline` and `usePlayback`
   into `App`; `Viewer3D` and the 2D program view both receive them. Show
   `PlaybackBar` in the 2D program view too. Existing drawing-mode
   behavior must not change.
2. **Source listing**: virtualized, with line numbers. The line of the
   current move (`moves[sample.moveIndex].sourceLine`) is highlighted and
   scrolled into view while playing. Lines with diagnostics get a
   severity marker.
3. **Seeking**:
   - clicking a line seeks to `timeline.moveStart` of that line's first
     move; a line without moves seeks to the next line that has one;
   - previous/next move buttons and ←/→ keys seek to the previous/next
     move's start (ignore the keys while an input has focus, as the Space
     handler does);
   - clicking a diagnostic seeks to its line.
4. **Current-move highlight** in the 2D view (an overlay `<path>`) and the
   3D view (a single overlay line for the whole current move, updated in
   place like `current`, never a geometry rebuild).
5. **Docs**:
   - tick Phase 5 in the README **Status** list;
   - README project structure: `/gcode` becomes "G-code tokenizer, parser
     and job checks -> Move[] (+ *.test.ts)";
   - a `CLAUDE.md` Architecture entry for `src/gcode/` (tokenize / parse /
     analyze, `sourceLine` and `feedRate` on `Move`, the units rule,
     nothing persisted), and update the "Planned: `src/gcode/`" line and
     the `Viewer3D` entry for the lifted clock.

## Verification expected in each PR description

- `npm run check` passes (paste the test count).
- PR 1: the per-move F estimate-equality test, listed by name.
- PR 3/4, in `npm run dev`:
  - the sample loads and shows its diagnostics (the out-of-bounds move is
    flagged);
  - the in ↔ mm toggle keeps the program physically identical in 2D and
    3D and keeps the estimate;
  - closing the program restores the drawing with undo intact;
  - a generated 10⁵-line file loads and stays responsive when scrolling
    the listing and stepping;
  - stepping highlights the same move in the listing, 2D and 3D;
  - `vite build` still emits Three.js in its own chunk.
