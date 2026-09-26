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
   X/Y axis relative to your last point (Shift to bypass snapping entirely),
   plus the ability to bow any segment into an arc.
2. **Configure** machine parameters — units, sheet size, bit diameter/shape,
   feed speed, spoilboard penetration.
3. **Compute** the actual toolpath: offset the drawn path by the bit radius
   (cutter compensation) and estimate cut time from path length and feed
   rate.
4. **Visualize** the cut in 3D and simulate the bit moving along the
   toolpath.
5. **Import** a G-code file (starting with basic, standard G-code; see
   Phase 5 below) and step through it move-by-move, with the current line
   highlighted on the canvas/3D view, rapid vs. feed moves visually
   distinct, and flags for likely problems (out-of-bounds moves, suspicious
   Z depth, unresolved arcs) — built for debugging real files, not just
   visualizing your own.

## How this project is built

Besides being a CNC tool, this project is practice in **agentic software
engineering**. Most of the code is written by coding agents (Claude Code,
locally and on the web), and my job is steering, reviewing, and deciding
what ships:

1. **Scope** a change as an issue or prompt: what to build, why, and how
   it can be verified.
2. **Delegate** it to an agent working on its own branch. The agent reads
   [`CLAUDE.md`](CLAUDE.md) for architecture, conventions, and the definition
   of done.
3. **Verify** automatically: `npm run check` (lint, typecheck/build, unit
   tests) runs locally, and the same steps run in CI on every PR.
4. **Review** with Claude: the agent runs a code review on its own PR and
   fixes or answers every finding.
5. **Merge** by a human, iterating with the agent on any remaining review
   comments.

The guardrails that make this work live in the repo: `CLAUDE.md` for
context and workflow, Vitest unit tests for the geometry code, a GitHub
Actions CI workflow, and hooks in `.claude/`: one installs dependencies so
cloud agent sessions can run the checks immediately, and one blocks agents
from changing `master` directly.

## Status

- [x] Phase 1 — Drawing canvas: sheet boundary, grid, click-to-place line
      segments, drag-to-bow arcs, snapping (grid, endpoint, Ctrl axis-lock,
      Shift to disable), undo/redo, closed-path detection
- [x] Phase 2 — Parameters panel: collapsible sidebar for units (in/mm,
      converting sheet, drawing, bit, and feeds), sheet size/thickness,
      flat/ball/V-bit, feed/plunge rates, spoilboard penetration; saved in
      localStorage with JSON settings-file import/export
- [x] Phase 3 — Toolpath math: cutter compensation (outside/inside/left/
      right/on, via cavalier-contours-js) with a kerf overlay, depth passes,
      and a cut-time estimate from a GRBL-style planner (rapids, plunges,
      retracts, acceleration and corner slowdowns)
- [ ] Phase 4 — 3D visualization
- [ ] Phase 5 — G-code import + debugging (parser, step-through, error flags).
      The initial import supports basic, standard G-code syntax only:
      G0/G1/G2/G3 (arcs by I/J or R, XY plane), G20/G21 units,
      G90/G91 positioning, F feed rates, and comments; other words are
      reported rather than silently ignored. Controller-specific dialects
      (e.g. Biesse) are planned later, behind a per-controller dialect
      layer on top of the same parser
- [ ] Phase 6 — Drawing canvas enhancements (pocket clearing, tabs,
      lead-in/lead-out, manual repair of an imported path)
- [ ] Phase 7 — Parameters panel enhancements (tool library, multiple passes,
      custom (drawn) bit profiles)
- [ ] Phase 8 — 3D visualization enhancements (material removal, camera
      controls, better playback)

## Privacy and data handling

G-code often contains proprietary shop data; a customer's part program is
their intellectual property. The design rule follows from that:

**Parsing always happens in your browser. A file is uploaded only when you
explicitly choose to save it.**

- **Today:** there is no server at all. The app is entirely client-side, so
  nothing you open ever leaves your machine. No account, no upload, no
  telemetry.
- **Planned:** an optional account for saving your *own* programs and sharing
  a deep link to a specific line with a coworker. The parser stays on the
  client even then — saving uploads the file and the results your browser
  already computed, rather than recomputing them server-side.

Treat the hosted version as a **demo and portfolio piece.** Once uploads
exist: don't put anything through it you couldn't afford to lose or expose,
and saved files will be deleted automatically after 30 days.

## Stack

- React + TypeScript
- SVG for the 2D drawing canvas (real DOM elements for hit-testing and
  snapping, rather than raw `<canvas>`)
- Three.js for 3D toolpath simulation (Phase 4)
- Vite
- Vitest for unit tests

## Development

```sh
npm install
npm run dev      # start the dev server
npm run build    # typecheck + production build
npm run lint     # oxlint
npm run test     # unit tests (Vitest)
npm run check    # lint + build + test, the definition of done
```

## License

[Mozilla Public License 2.0](LICENSE).

You can use this commercially, and you can combine it with closed-source
code. If you modify one of the files in this repo, that file's source has to
stay open under the MPL — new files you add alongside it are yours to license
however you want.

## Project structure

```
/src
  /geometry      # Segment/Path types, bulge (arc) math, snapping (+ *.test.ts)
  /machine       # Machine/job parameters: units, conversion, validation (+ *.test.ts)
  /gcode         # G-code parsing -> Path, for import (Phase 5)
  /components    # UI components (Canvas, ParametersPanel, etc.)
  /state         # Drawing state (undo/redo), persisted machine params
/.claude         # Claude Code settings and SessionStart hook
/.github         # CI workflow
/docs/plans      # Working plans handed to implementing agents
CLAUDE.md        # Guidance for coding agents
```
