/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// The 3D view. Three.js objects are owned imperatively: one effect creates
// and tears down the renderer, others rebuild the job geometry or move the
// bit when their inputs change. The scene uses machine coordinates directly
// (Z up); only the camera's `up` vector differs from Three.js defaults.
// Frames are rendered on demand, not in a permanent loop.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MachineParams } from '../machine/params';
import type { Tooling } from '../machine/tooling';
import { bitOfMove, diameterRange } from '../machine/tooling';
import { unitFactor } from '../machine/params';
import type { Bounds3, CameraPose, CameraPreset } from '../sim/camera';
import { CAMERA_PRESETS, cameraPose, framePose, jobBounds, orthoHalfHeight } from '../sim/camera';
import type { LayerKey, Layers } from '../sim/layers';
import { kindLayer } from '../sim/layers';
import { bitProfile, kindCounts, moveLineBuffers, pathBuffer } from '../sim/sceneData';
import type { MoveKind } from '../sim/sceneData';
import type { DirtyRect, Stock } from '../sim/stock';
import { stockFromGrid, stockGrid, surfaceHeight } from '../sim/stock';
import type { Rgb } from '../sim/stockMesh';
import type { CutTarget } from '../sim/stockSim';
import { StockSimulator } from '../sim/stockSim';
import { useLayers } from '../state/useLayers';
import type { CutTimeEstimate } from '../toolpath/estimate';
import { formatDuration } from '../toolpath/estimate';
import type { Move, Point3 } from '../toolpath/moves';
import type { Timeline, TimelineSample } from '../toolpath/timeline';
import { ignoreShortcut } from './keyboard';
import { StockView } from './stockView';
import { ChipView } from './chipView';
import { chipLoad, chipsCut, cutConditions } from '../toolpath/chipLoad';
import { useExactCut } from './useExactCut';
import './Workspace.css';
import './Viewer3D.css';

type Viewer3DProps = {
  moves: Move[];
  params: MachineParams;
  estimate: CutTimeEstimate;
  /** The 2D/3D switch, rendered at the start of the toolbar. */
  viewToggle: ReactNode;
  /** Timeline and playback sample, shared with the other views (owned by `PlaybackWorkspace`). */
  timeline: Timeline;
  /** Which bit cuts each move (a program can change tools). */
  tooling: Tooling;
  sample: TimelineSample;
  /** Blocks of the move to highlight (`first` … `first + count − 1`), or null for none. */
  currentMove: { first: number; count: number } | null;
  /** The playback controls, rendered under the view. */
  playbackBar: ReactNode;
  /** True when ← and → step through moves (a program is open), for the hint. */
  stepping: boolean;
  /** True when playback is at the end of the job, where the exact finished part is shown. */
  atEnd: boolean;
  /** True while playback runs; chips are thrown only then. */
  playing: boolean;
};

/** Theme colors read from CSS custom properties on the workspace element. */
type Palette = {
  rapid: string;
  feed: string;
  vertical: string;
  edge: string;
  sheet: string;
  spoilboard: string;
  stock: string;
  stockCut: string;
  chip: string;
  bit: string;
  traversed: string;
  current: string;
};

/** Visual spoilboard thickness in inches (not a machine parameter). */
const SPOILBOARD_IN = 0.75;
/** Visible bit length above the tip, in bit diameters. */
const BIT_LENGTH_DIAMETERS = 4;
/** Stock simulation time per animation frame, in ms; the rest of the frame is left for rendering. */
const SIM_FRAME_MS = 6;
/** Most chips thrown in one frame, so fast playback does not flood the view. */
const MAX_CHIPS_PER_FRAME = 40;
/** Work units (grid points) per `advanceTo` call, so the frame budget is checked often. */
const SIM_CHUNK = 50_000;

const KINDS: MoveKind[] = ['rapid', 'plunge', 'feed', 'retract'];

/** Vertical field of view of the perspective camera, in degrees. */
const FOV = 45;

/** Toolbar labels for the view presets; keys 1–4 pick them in this order. */
const PRESET_LABELS: Record<CameraPreset, string> = { iso: 'Iso', top: 'Top', front: 'Front', right: 'Right' };

/** The move-kind layers, shown as the toolbar legend. */
const LEGEND: { key: 'cut' | 'vertical' | 'rapid'; swatch: string; label: string }[] = [
  { key: 'cut', swatch: 'swatch-feed', label: 'cut' },
  { key: 'vertical', swatch: 'swatch-vertical', label: 'plunge/retract' },
  { key: 'rapid', swatch: 'swatch-rapid', label: 'rapid' },
];

/** The other layers, in the Layers menu. */
const MENU_LAYERS: { key: LayerKey; label: string }[] = [
  { key: 'stock', label: 'Stock (material removal)' },
  { key: 'sheet', label: 'Sheet and spoilboard' },
  { key: 'untraversed', label: 'Path not played yet' },
  { key: 'axes', label: 'Axes' },
  { key: 'chips', label: 'Wood chips' },
];

/** True when the browser can create a WebGL context (it may be disabled or unsupported). */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    // Release the probe right away; browsers cap the number of live contexts.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

function readPalette(el: HTMLElement): Palette {
  const style = getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    rapid: v('--text', '#6b6375'),
    feed: v('--toolpath', '#0e8f7e'),
    vertical: v('--accent', '#7a3bff'),
    edge: v('--text-h', '#08060d'),
    sheet: v('--sheet-3d', '#d8c3a0'),
    spoilboard: v('--spoilboard-3d', '#9c8b70'),
    stock: v('--stock-3d', '#e2cfae'),
    stockCut: v('--stock-cut-3d', '#b89468'),
    chip: v('--chip-3d', '#ecd9b0'),
    bit: v('--text', '#6b6375'),
    traversed: v('--traversed-3d', '#d97706'),
    current: v('--current-move', '#e11d48'),
  };
}

/** Re-reads the palette whenever the color scheme changes. */
function usePalette(ref: RefObject<HTMLElement | null>): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setPalette(readPalette(el));
    update();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [ref]);
  return palette;
}

/** A CSS color as vertex-color bytes (linear, as Three.js expects vertex colors). */
function toRgb(css: string): Rgb {
  const c = new THREE.Color(css);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** Disposes every geometry and material under `root` and empties it. */
function clearGroup(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of materials) m.dispose();
    }
  });
  root.clear();
}

/** A translucent box from z = `bottom` to z = `top` over the sheet footprint, with crisp edges. */
function slab(width: number, depth: number, bottom: number, top: number, color: string, edge: string, opacity: number) {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(width, depth, top - bottom);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.35 })
  );
  group.add(mesh, edges);
  group.position.set(width / 2, depth / 2, (top + bottom) / 2);
  return group;
}

type Line = THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;

/** The parts of the job group that layers show and hide; rebuilt with the job. */
type JobParts = {
  sheet: THREE.Object3D | null;
  spoilboard: THREE.Object3D | null;
  axes: THREE.Object3D | null;
  /** The whole path per kind. */
  lines: Partial<Record<MoveKind, Line>>;
  /** The played path per kind: the same buffers, drawn up to the current block. */
  traversed: Partial<Record<MoveKind, Line>>;
};

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  perspective: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  /** Whichever of the two cameras is in use (and driven by the controls). */
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  controls: OrbitControls;
  job: THREE.Group;
  parts: JobParts;
  /** Holds the stock surface and skirt. */
  stockGroup: THREE.Group;
  /** Holds the exact finished part, shown instead of the stock at the end. */
  exactGroup: THREE.Group;
  chips: ChipView;
  bit: THREE.Mesh;
  /** The bit's shape for each of the job's tools (`Tooling.bits`); the bit shows the current move's. */
  bitShapes: THREE.BufferGeometry[];
  /** The played part of the current block, from its start to the bit. */
  current: Line;
  /** The whole current move (step-through), a draw range over the path buffer. */
  moveOverlay: Line;
  render: () => void;
};

/** The simulated stock and what draws it. */
type StockState = {
  stock: Stock;
  sim: StockSimulator;
  view: StockView;
};

const emptyParts = (): JobParts => ({ sheet: null, spoilboard: null, axes: null, lines: {}, traversed: {} });

export default function Viewer3D({
  moves,
  params,
  estimate,
  viewToggle,
  timeline,
  tooling,
  sample,
  currentMove,
  playbackBar,
  stepping,
  atEnd,
  playing,
}: Viewer3DProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const [webglError] = useState(() => !webglAvailable());
  const palette = usePalette(workspaceRef);
  const [layers, toggleLayer] = useLayers();
  // The exact finished part, computed in the background while the stock is shown.
  const exact = useExactCut(timeline, params.sheet, tooling, params.units, layers.stock);
  // At the end of the job the exact part replaces the simulated stock.
  const exactShown = layers.stock && atEnd && exact.status === 'ready';

  // (a) Renderer, camera, controls and lights, for the component's lifetime.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || webglError) return;
    // Throws if the context cannot be created after all; ViewErrorBoundary shows that.
    // The log depth buffer keeps depth precise with the near plane close enough to inspect the bit.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-1, -2, 3);
    scene.add(sun);

    const perspective = new THREE.PerspectiveCamera(FOV, 1, 0.01, 1000);
    perspective.up.set(0, 0, 1);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
    ortho.up.set(0, 0, 1);
    const controls = new OrbitControls(perspective, renderer.domElement);
    controls.zoomToCursor = true;

    const job = new THREE.Group();
    const stockGroup = new THREE.Group();
    const exactGroup = new THREE.Group();
    exactGroup.visible = false;
    const bit = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial());
    bit.rotation.x = Math.PI / 2; // Lathe axis is +Y; turn it to +Z.
    // Drawn after the job lines so the highlight wins where they coincide.
    const overlay = (): Line => {
      const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
      line.renderOrder = 1;
      line.frustumCulled = false;
      return line;
    };
    const current = overlay();
    current.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const moveOverlay = overlay();
    moveOverlay.renderOrder = 2;
    moveOverlay.visible = false;
    scene.add(job, stockGroup, exactGroup, bit, current, moveOverlay);

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, state.camera);
      });
    };
    controls.addEventListener('change', render);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      perspective.aspect = w / h;
      perspective.updateProjectionMatrix();
      // The ortho view keeps its height and widens or narrows with the aspect.
      const half = ortho.top;
      ortho.left = -half * perspective.aspect;
      ortho.right = half * perspective.aspect;
      ortho.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    // Chips animate on their own frames and ask for a redraw on each.
    const chips = new ChipView(render);
    scene.add(chips.mesh);

    const state: SceneState = {
      renderer,
      scene,
      perspective,
      ortho,
      camera: perspective,
      controls,
      job,
      parts: emptyParts(),
      stockGroup,
      exactGroup,
      chips,
      bit,
      bitShapes: [],
      current,
      moveOverlay,
      render,
    };
    sceneRef.current = state;
    observer.observe(host);
    resize();
    return () => {
      sceneRef.current = null;
      chips.dispose();
      // Every tool's bit shape, not only the one on the mesh that clearGroup below reaches.
      for (const g of state.bitShapes) g.dispose();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      clearGroup(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [webglError]);

  const sheetX = params.sheet.x;
  const sheetY = params.sheet.y;
  const thickness = params.sheet.thickness;
  const safeHeight = params.safeHeight;

  /**
   * Moves the active camera to `pose`. Clip planes scale with the
   * distance; the ortho view is sized to show what the perspective view
   * would at the target.
   */
  const applyPose = useCallback((pose: CameraPose) => {
    const s = sceneRef.current;
    if (!s) return;
    const { camera, controls } = s;
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    camera.near = pose.distance / 10000;
    camera.far = pose.distance * 20;
    if (camera instanceof THREE.OrthographicCamera) {
      const half = orthoHalfHeight(pose.distance, FOV);
      camera.zoom = 1;
      camera.top = half;
      camera.bottom = -half;
      camera.left = -half * s.perspective.aspect;
      camera.right = half * s.perspective.aspect;
    }
    camera.updateProjectionMatrix();
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    controls.update();
    s.render();
  }, []);

  // The sheet and the space above it up to safe height.
  const sheetBounds = useMemo<Bounds3>(
    () => ({ min: { x: 0, y: 0, z: -thickness }, max: { x: sheetX, y: sheetY, z: safeHeight } }),
    [sheetX, sheetY, thickness, safeHeight]
  );

  /** Frames the sheet from one of the presets. */
  const viewPreset = useCallback(
    (preset: CameraPreset) => {
      const s = sceneRef.current;
      if (s) applyPose(cameraPose(preset, sheetBounds, FOV, s.perspective.aspect));
    },
    [applyPose, sheetBounds]
  );

  const resetView = useCallback(() => viewPreset('iso'), [viewPreset]);

  // Reframe when the sheet changes (size or units), not on every job edit.
  useEffect(resetView, [resetView]);

  const lines = useMemo(() => moveLineBuffers(moves, params), [moves, params]);
  const counts = useMemo(() => kindCounts(moves, params), [moves, params]);

  // (b) Sheet, spoilboard, axes, toolpath lines (whole and played, per
  // kind) and the bit shape.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !palette) return;
    clearGroup(s.job);
    const parts = emptyParts();

    const spoil = SPOILBOARD_IN * unitFactor('in', params.units);
    parts.sheet = slab(sheetX, sheetY, -thickness, 0, palette.sheet, palette.edge, 0.45);
    parts.spoilboard = slab(sheetX, sheetY, -thickness - spoil, -thickness, palette.spoilboard, palette.edge, 0.25);
    parts.axes = new THREE.AxesHelper(0.08 * Math.max(sheetX, sheetY));
    s.job.add(parts.sheet, parts.spoilboard, parts.axes);

    const dash = 0.006 * Math.max(sheetX, sheetY);
    const materials: Record<MoveKind, THREE.LineBasicMaterial> = {
      rapid: new THREE.LineDashedMaterial({ color: palette.rapid, dashSize: dash, gapSize: dash }),
      plunge: new THREE.LineBasicMaterial({ color: palette.vertical }),
      retract: new THREE.LineBasicMaterial({ color: palette.vertical }),
      feed: new THREE.LineBasicMaterial({ color: palette.feed }),
    };
    for (const kind of KINDS) {
      if (lines[kind].length === 0) {
        materials[kind].dispose();
        continue;
      }
      const attribute = new THREE.BufferAttribute(lines[kind], 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', attribute);
      const segments = new THREE.LineSegments(geometry, materials[kind]);
      if (kind === 'rapid') segments.computeLineDistances();
      // The played path shares the buffer; only its draw range changes in (c).
      const played = new THREE.BufferGeometry();
      played.setAttribute('position', attribute);
      played.setDrawRange(0, 0);
      const traversed = new THREE.LineSegments(played, new THREE.LineBasicMaterial({ color: palette.traversed }));
      traversed.renderOrder = 1;
      traversed.frustumCulled = false;
      parts.lines[kind] = segments;
      parts.traversed[kind] = traversed;
      s.job.add(segments, traversed);
    }
    s.parts = parts;

    for (const g of s.bitShapes) g.dispose();
    s.bitShapes = tooling.bits.map((b) => {
      const profile = bitProfile(b.shape, b.diameter, BIT_LENGTH_DIAMETERS * b.diameter);
      return new THREE.LatheGeometry(
        profile.map((q) => new THREE.Vector2(q.x, q.y)),
        32
      );
    });
    s.bit.geometry = s.bitShapes[0];
    (s.bit.material as THREE.MeshLambertMaterial).color.set(palette.bit);
    s.current.material.color.set(palette.traversed);
    s.moveOverlay.material.color.set(palette.current);
    s.render();
  }, [lines, palette, sheetX, sheetY, thickness, params.units, tooling]);

  // Layers only toggle `visible`; nothing is rebuilt. The sheet's slab
  // gives way to the stock while the stock is shown.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { parts } = s;
    if (parts.sheet) parts.sheet.visible = layers.sheet && !layers.stock;
    if (parts.spoilboard) parts.spoilboard.visible = layers.sheet;
    if (parts.axes) parts.axes.visible = layers.axes;
    for (const kind of KINDS) {
      const on = layers[kindLayer(kind)];
      const whole = parts.lines[kind];
      const played = parts.traversed[kind];
      if (whole) whole.visible = on && layers.untraversed;
      if (played) played.visible = on;
    }
    s.stockGroup.visible = layers.stock && !exactShown;
    s.exactGroup.visible = exactShown;
    s.render();
  }, [layers, lines, palette, exactShown]);

  const path = useMemo(() => pathBuffer(moves, params), [moves, params]);

  /** Frames the toolpath (or the sheet, with no moves) from the current viewing direction. */
  const fitJob = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    const d = s.camera.position.clone().sub(s.controls.target);
    // Rapids start from home, which would pull the frame towards the origin.
    const bounds = jobBounds(lines.feed, lines.plunge, lines.retract) ?? jobBounds(path) ?? sheetBounds;
    applyPose(framePose(d, bounds, FOV, s.perspective.aspect));
  }, [applyPose, lines, path, sheetBounds]);

  // Perspective or orthographic. Switching keeps the view direction and
  // the scale at the target.
  const [orthographic, setOrthographic] = useState(false);
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { perspective, ortho, controls } = s;
    const next = orthographic ? ortho : perspective;
    if (s.camera === next) return;
    const target = controls.target;
    if (next === ortho) {
      const distance = perspective.position.distanceTo(target);
      const half = orthoHalfHeight(distance, FOV);
      ortho.position.copy(perspective.position);
      ortho.zoom = 1;
      ortho.top = half;
      ortho.bottom = -half;
      ortho.left = -half * perspective.aspect;
      ortho.right = half * perspective.aspect;
      ortho.near = perspective.near;
      ortho.far = perspective.far;
      ortho.updateProjectionMatrix();
    } else {
      // Back far enough that the target area appears the same size.
      const distance = ortho.top / ortho.zoom / orthoHalfHeight(1, FOV);
      const dir = ortho.position.clone().sub(target).normalize();
      perspective.position.copy(target).addScaledVector(dir, distance);
      perspective.near = distance / 10000;
      perspective.far = distance * 20;
      perspective.updateProjectionMatrix();
    }
    s.camera = next;
    controls.object = next;
    controls.update();
    s.render();
  }, [orthographic]);

  // Follow the bit: the view stays centered on it. Recentering (rather than
  // adding the bit's movement) stays right when something else moves the
  // camera at the same time, such as the reframe after a unit change.
  const [follow, setFollow] = useState(false);
  const followRef = useRef(follow);
  /** Moves the camera and its target so the target is `point`, keeping the view direction and distance. */
  const centerOn = useCallback((point: THREE.Vector3) => {
    const s = sceneRef.current;
    if (!s) return;
    const delta = point.clone().sub(s.controls.target);
    if (delta.lengthSq() === 0) return;
    s.camera.position.add(delta);
    s.controls.target.add(delta);
    s.controls.update();
  }, []);
  useEffect(() => {
    followRef.current = follow;
    const s = sceneRef.current;
    if (follow && s) centerOn(s.bit.position);
  }, [follow, centerOn]);

  // View keys, only while the 3D view is shown: 1–4 pick a preset.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (ignoreShortcut(e) || e.shiftKey) return;
      const preset = CAMERA_PRESETS[Number(e.key) - 1];
      if (!preset) return;
      e.preventDefault();
      viewPreset(preset);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewPreset]);

  // The whole path in playback order, for the current-move highlight.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.moveOverlay.geometry.dispose();
    s.moveOverlay.geometry = new THREE.BufferGeometry();
    s.moveOverlay.geometry.setAttribute('position', new THREE.BufferAttribute(path, 3));
    s.moveOverlay.geometry.setDrawRange(0, 0);
    s.render();
  }, [path]);

  // The current move (step-through): a draw range, never a geometry rebuild.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.moveOverlay.visible = currentMove !== null && currentMove.count > 0;
    if (currentMove) s.moveOverlay.geometry.setDrawRange(currentMove.first * 2, currentMove.count * 2);
    s.render();
  }, [currentMove, path]);

  // Stock simulation. The simulator cuts towards `targetRef` in slices of
  // SIM_FRAME_MS per animation frame, so a long jump never freezes the
  // page; `simProgress` is shown while it is behind.
  const stockRef = useRef<StockState | null>(null);
  const targetRef = useRef<CutTarget | null>(null);
  const simFrameRef = useRef(0);
  const paletteRef = useRef(palette);
  const layersRef = useRef(layers);
  const [simProgress, setSimProgress] = useState<number | null>(null);
  const exactShownRef = useRef(exactShown);

  const stockColors = useCallback(() => {
    const p = paletteRef.current;
    return p ? { top: toRgb(p.stock), cut: toRgb(p.stockCut) } : { top: toRgb('#e2cfae'), cut: toRgb('#b89468') };
  }, []);

  /** Uploads the tiles `rect` touched (everything after a checkpoint restore). */
  const flushStock = useCallback((st: StockState, rect: DirtyRect | null) => st.view.update(rect), []);

  const playingRef = useRef(playing);
  // Fractions of a chip carried to the next frame, so slow cuts still throw some.
  const chipCarry = useRef(0);
  // True from a checkpoint restore until the stock catches up: re-cutting
  // what was already played throws no chips.
  const catchingUpRef = useRef(false);
  const paramsRef = useRef(params);
  /**
   * Throws the chips a slice cut: one per tooth pass over the `distance`
   * that removed material, sized from the chip load and the depth it
   * engaged (`chipsCut`), at most MAX_CHIPS_PER_FRAME (beyond that each
   * flake stands for several chips). They leave the bit at `tip`, with the
   * feed and bit of `blockIndex` (the last block that removed material).
   */
  const throwChips = useCallback(
    (s: SceneState, volume: number, distance: number, blockIndex: number, tip: Point3) => {
      const p = paramsRef.current;
      const block = timeline.blocks[blockIndex];
      const move = block ? timeline.moves[block.move] : undefined;
      const conditions = move ? cutConditions(move, p) : null;
      if (!block || !conditions) return;
      const bit = bitOfMove(tooling, block.move);
      const load = chipLoad(conditions.feedRate, conditions.rpm, bit.fluteCount);
      const cut = chipsCut(volume, distance, load, bit.diameter);
      if (!cut) return;
      const wanted = cut.count + chipCarry.current;
      const n = Math.min(MAX_CHIPS_PER_FRAME, Math.floor(wanted));
      chipCarry.current = n === MAX_CHIPS_PER_FRAME ? 0 : wanted - n;
      const xy = Math.hypot(block.u.x, block.u.y);
      s.chips.emit(n, {
        tip,
        travel: xy > 1e-6 ? { x: block.u.x / xy, y: block.u.y / xy } : { x: 0, y: 0 },
        chip: cut.size,
        bitDiameter: bit.diameter,
        flute: bit.flute,
      });
    },
    [timeline, tooling]
  );

  const simulateSlice = useCallback(
    function slice() {
      simFrameRef.current = 0;
      const st = stockRef.current;
      const s = sceneRef.current;
      const target = targetRef.current;
      // Nothing to simulate while the exact part stands in for the stock.
      if (!st || !s || !target || !layersRef.current.stock || exactShownRef.current) {
        setSimProgress(null);
        return;
      }
      const start = performance.now();
      const removedBefore = st.stock.removed;
      const distanceBefore = st.sim.removingDistance;
      let restored = false;
      let result;
      do {
        result = st.sim.advanceTo(target, SIM_CHUNK);
        const d = result.dirty;
        if (d && d.i0 === 0 && d.j0 === 0 && d.i1 === st.stock.nx - 1 && d.j1 === st.stock.ny - 1) restored = true;
        flushStock(st, result.dirty);
      } while (!result.done && performance.now() - start < SIM_FRAME_MS);
      if (restored) catchingUpRef.current = true;
      // Chips for whatever this slice cut while playing, even when the
      // stock is behind at high speed; not while catching up after a seek.
      const tip = st.sim.removingTip;
      if (playingRef.current && !catchingUpRef.current && layersRef.current.chips && tip) {
        const volume = (st.stock.removed - removedBefore) * st.stock.dx * st.stock.dy;
        throwChips(s, volume, st.sim.removingDistance - distanceBefore, st.sim.lastRemovingBlock, tip);
      }
      if (result.done) catchingUpRef.current = false;
      s.render();
      if (result.done) {
        setSimProgress(null);
      } else {
        setSimProgress(Math.floor(result.progress * 100));
        simFrameRef.current = requestAnimationFrame(slice);
      }
    },
    [flushStock, throwChips]
  );

  /** Catches the stock up with `targetRef` now, unless a slice is already queued for this frame. */
  const simulate = useCallback(() => {
    if (!simFrameRef.current) simulateSlice();
  }, [simulateSlice]);

  // Fine enough for the job's smallest bit, coarsened only if its cuts would not fit the budget.
  const grid = useMemo(() => {
    const { min, max } = diameterRange(tooling);
    const smallest = tooling.bits.find((b) => b.diameter === min) ?? tooling.bits[0];
    return stockGrid({ x: sheetX, y: sheetY, thickness }, smallest, timeline.blocks, max / 2);
  }, [sheetX, sheetY, thickness, tooling, timeline]);

  // (d) A fresh stock whenever the job, sheet or bit change.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const stock = stockFromGrid({ x: sheetX, y: sheetY, thickness }, grid);
    const sim = new StockSimulator(timeline, stock, (m) => bitOfMove(tooling, m));
    const view = new StockView(stock, stockColors(), paletteRef.current?.stock ?? '#e2cfae');
    s.stockGroup.add(view.group);
    stockRef.current = { stock, sim, view };
    simulate();
    return () => {
      cancelAnimationFrame(simFrameRef.current);
      simFrameRef.current = 0;
      stockRef.current = null;
      // The old target belongs to the old timeline; (c) sets the next one.
      targetRef.current = null;
      clearGroup(s.stockGroup);
      // On unmount (a) has already disposed the renderer; only redraw a live scene.
      if (sceneRef.current === s) s.render();
    };
  }, [timeline, grid, sheetX, sheetY, thickness, tooling, stockColors, simulate]);

  useEffect(() => {
    playingRef.current = playing;
    paramsRef.current = params;
  }, [playing, params]);

  // The chips' world follows the job; hiding them clears them.
  const unitsPerMeter = params.units === 'mm' ? 1000 : 1000 / 25.4;
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.chips.setWorld({
      unitsPerMeter,
      // The live stock, so chips settle into grooves already cut; the flat
      // sheet top while there is none yet.
      surfaceAt: (x, y) => {
        const st = stockRef.current;
        if (st) return surfaceHeight(st.stock, x, y);
        return x >= 0 && y >= 0 && x <= sheetX && y <= sheetY ? 0 : null;
      },
      lowest: -thickness - SPOILBOARD_IN * unitFactor('in', params.units) * 4,
    });
  }, [timeline, unitsPerMeter, sheetX, sheetY, thickness, params.units]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.chips.mesh.visible = layers.chips;
    if (!layers.chips) s.chips.clear();
  }, [layers.chips]);

  useEffect(() => {
    const s = sceneRef.current;
    if (s && palette) s.chips.setColor(palette.chip);
  }, [palette]);

  // Recolor the stock for a new color scheme.
  useEffect(() => {
    paletteRef.current = palette;
    const st = stockRef.current;
    const s = sceneRef.current;
    if (!st || !s || !palette) return;
    st.view.recolor(stockColors(), palette.stock);
    s.render();
  }, [palette, stockColors]);

  // Showing the stock again catches it up; hiding it (or the exact part
  // standing in for it) stops the work.
  useEffect(() => {
    layersRef.current = layers;
    exactShownRef.current = exactShown;
    if (layers.stock && !exactShown) {
      simulate();
    } else {
      cancelAnimationFrame(simFrameRef.current);
      simFrameRef.current = 0;
    }
  }, [layers, exactShown, simulate]);

  const exactPositions = exact.status === 'ready' ? exact.positions : null;
  const exactIndices = exact.status === 'ready' ? exact.indices : null;

  // The exact part's mesh: the sheet's own faces in the stock color, cut
  // faces in the cut color, one flat-shaded triangle each.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    clearGroup(s.exactGroup);
    if (!exactPositions || !exactIndices || !palette) {
      s.render();
      return;
    }
    const geometry = exactPartGeometry(exactPositions, exactIndices, { x: sheetX, y: sheetY, thickness }, [
      new THREE.Color(palette.stock),
      new THREE.Color(palette.stockCut),
    ]);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        flatShading: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
    );
    s.exactGroup.add(mesh);
    s.render();
  }, [exactPositions, exactIndices, palette, sheetX, sheetY, thickness]);

  // (c) Bit position, the played part of the path and the stock's target.
  // Only moves things and sets draw ranges, so it is cheap enough to run
  // every frame.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { position, block, kind } = sample;
    s.bit.position.set(position.x, position.y, position.z);
    const shape = s.bitShapes[sample.moveIndex >= 0 ? (tooling.ofMove[sample.moveIndex] ?? 0) : 0];
    if (shape && s.bit.geometry !== shape) s.bit.geometry = shape;
    if (followRef.current) centerOn(s.bit.position);
    const played = Math.max(0, block);
    for (const k of KINDS) s.parts.traversed[k]?.geometry.setDrawRange(0, counts[k][played] * 2);
    const attr = s.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (block >= 0) {
      attr.setXYZ(0, path[block * 6], path[block * 6 + 1], path[block * 6 + 2]);
      attr.setXYZ(1, position.x, position.y, position.z);
    } else {
      attr.setXYZ(0, 0, 0, 0);
      attr.setXYZ(1, 0, 0, 0);
    }
    attr.needsUpdate = true;
    s.current.visible = kind !== null && layers[kindLayer(kind)];
    targetRef.current = { block, position };
    simulate();
    s.render();
    // `lines` and `palette` rebuild the traversed lines in (b), which start empty.
  }, [sample, path, counts, lines, palette, layers, simulate, centerOn, tooling]);

  const status = [
    `${moves.length} move${moves.length === 1 ? '' : 's'}`,
    estimate.total > 0 ? `est. ${formatDuration(estimate.total)}` : null,
    simProgress !== null && layers.stock && !exactShown ? `Simulating… ${simProgress} %` : null,
    layers.stock ? exactStatus(exact) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="canvas-workspace" ref={workspaceRef}>
      <div className="toolbar">
        {viewToggle}
        <span className="view-toggle" role="group" aria-label="View">
          {CAMERA_PRESETS.map((preset, k) => (
            <button
              key={preset}
              type="button"
              title={`${PRESET_LABELS[preset]} view of the sheet (${k + 1})`}
              onClick={() => viewPreset(preset)}
              disabled={webglError}
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </span>
        <button type="button" onClick={fitJob} disabled={webglError} title="Frame the toolpath from the current direction">
          Fit job
        </button>
        <button
          type="button"
          className="toggle"
          aria-pressed={follow}
          onClick={() => setFollow((f) => !f)}
          disabled={webglError}
          title="Keep the view centered on the bit while it moves"
        >
          Follow bit
        </button>
        <button
          type="button"
          className="toggle"
          aria-pressed={orthographic}
          onClick={() => setOrthographic((o) => !o)}
          disabled={webglError}
          title="Orthographic projection: no perspective, parallel lines stay parallel"
        >
          Ortho
        </button>
        <span className="divider" />
        <span className="legend">
          {LEGEND.map(({ key, swatch, label }) => (
            <button
              key={key}
              type="button"
              className="legend-toggle"
              aria-pressed={layers[key]}
              title={`${layers[key] ? 'Hide' : 'Show'} ${label} moves`}
              onClick={() => toggleLayer(key)}
            >
              <span className={`swatch ${swatch}`} /> {label}
            </button>
          ))}
        </span>
        <LayersMenu layers={layers} onToggle={toggleLayer} />
        <span className="status">
          {status}
          {grid.coarsened && layers.stock && (
            <span
              className="stock-note"
              title="The sheet is large for this bit, so the stock grid is coarser than 1/8 of the bit diameter. Small details of the cut may look blocky."
            >
              {' · '}stock grid {formatSpacing(Math.max(grid.dx, grid.dy))} {params.units}
            </span>
          )}
        </span>
      </div>
      <div className="viewer-3d" ref={hostRef}>
        {webglError && <p className="viewer-3d-message">3D view needs WebGL, which this browser has turned off or does not support.</p>}
      </div>
      {playbackBar}
      <p className="hint">
        Drag to orbit, right-drag (or Shift+drag) to pan, scroll to zoom; 1–4 pick a view. Space plays and pauses,
        Home/End jump to the ends, + and − change speed{stepping ? ', ← and → step through moves' : ''}, Shift+← and
        Shift+→ step one block.
      </p>
    </div>
  );
}

/** The exact cut's progress for the toolbar, or null once it is ready. */
function exactStatus(exact: ReturnType<typeof useExactCut>): string | null {
  switch (exact.status) {
    case 'computing':
      return exact.progress < 1 ? `Exact cut… ${Math.floor(exact.progress * 100)} %` : 'Exact cut… finishing';
    case 'skipped':
      return `exact cut skipped (${exact.moves.toLocaleString()} moves)`;
    case 'failed':
      return 'exact cut failed';
    default:
      return null;
  }
}

/**
 * A non-indexed geometry for the exact part with a color per triangle:
 * `colors[0]` on the sheet's original faces (top, bottom and sides, which
 * are left where nothing cut them) and `colors[1]` on faces the bit made.
 */
function exactPartGeometry(
  positions: Float32Array,
  indices: Uint32Array,
  sheet: { x: number; y: number; thickness: number },
  colors: [THREE.Color, THREE.Color]
): THREE.BufferGeometry {
  const eps = 1e-5 * Math.max(sheet.x, sheet.y);
  const onPlane = (a: number, b: number, c: number, value: number) =>
    Math.abs(a - value) < eps && Math.abs(b - value) < eps && Math.abs(c - value) < eps;
  const out = new Float32Array(indices.length * 3);
  const rgb = new Float32Array(indices.length * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const xs = [positions[a], positions[b], positions[c]] as const;
    const ys = [positions[a + 1], positions[b + 1], positions[c + 1]] as const;
    const zs = [positions[a + 2], positions[b + 2], positions[c + 2]] as const;
    const original =
      onPlane(...zs, 0) ||
      onPlane(...zs, -sheet.thickness) ||
      onPlane(...xs, 0) ||
      onPlane(...xs, sheet.x) ||
      onPlane(...ys, 0) ||
      onPlane(...ys, sheet.y);
    const color = original ? colors[0] : colors[1];
    for (let k = 0; k < 3; k++) {
      const v = indices[t + k] * 3;
      const o = (t + k) * 3;
      out[o] = positions[v];
      out[o + 1] = positions[v + 1];
      out[o + 2] = positions[v + 2];
      rgb[o] = color.r;
      rgb[o + 1] = color.g;
      rgb[o + 2] = color.b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  return geometry;
}

/** A grid spacing with three significant digits. */
function formatSpacing(value: number): string {
  return Number(value.toPrecision(3)).toString();
}

/** The layers that are not move kinds, as a dropdown of checkboxes. */
function LayersMenu({ layers, onToggle }: { layers: Layers; onToggle: (key: LayerKey) => void }) {
  return (
    <details className="layers-menu">
      <summary>Layers</summary>
      <div className="layers-popup">
        {MENU_LAYERS.map(({ key, label }) => (
          <label key={key}>
            <input type="checkbox" checked={layers[key]} onChange={() => onToggle(key)} /> {label}
          </label>
        ))}
      </div>
    </details>
  );
}
