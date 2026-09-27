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
import { unitFactor } from '../machine/params';
import { bitProfile, moveLineBuffers, pathBuffer } from '../sim/sceneData';
import type { MoveKind } from '../sim/sceneData';
import type { CutTimeEstimate } from '../toolpath/estimate';
import { formatDuration } from '../toolpath/estimate';
import type { Move } from '../toolpath/moves';
import type { Timeline, TimelineSample } from '../toolpath/timeline';
import type { Playback } from '../state/usePlayback';
import { PlaybackBar } from './PlaybackBar';
import './Workspace.css';
import './Viewer3D.css';

type Viewer3DProps = {
  moves: Move[];
  params: MachineParams;
  estimate: CutTimeEstimate;
  /** The 2D/3D switch, rendered at the start of the toolbar. */
  viewToggle: ReactNode;
  /** Playback clock and timeline, shared with the other views (owned by `PlaybackWorkspace`). */
  timeline: Timeline;
  playback: Playback;
  sample: TimelineSample;
  /** Blocks of the move to highlight (`first` … `first + count − 1`), or null for none. */
  currentMove: { first: number; count: number } | null;
  /** Previous/next move, for step-through; the buttons are hidden without it. */
  onStep?: (direction: 1 | -1) => void;
};

/** Theme colors read from CSS custom properties on the workspace element. */
type Palette = {
  rapid: string;
  feed: string;
  vertical: string;
  edge: string;
  sheet: string;
  spoilboard: string;
  bit: string;
  traversed: string;
  current: string;
};

/** Visual spoilboard thickness in inches (not a machine parameter). */
const SPOILBOARD_IN = 0.75;
/** Visible bit length above the tip, in bit diameters. */
const BIT_LENGTH_DIAMETERS = 4;

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

type SceneState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  job: THREE.Group;
  bit: THREE.Mesh;
  /** The path already played, drawn over the job lines up to the current block. */
  traversed: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** The played part of the current block, from its start to the bit. */
  current: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  /** The whole current move (step-through), a draw range over the path buffer. */
  moveOverlay: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  render: () => void;
};

export default function Viewer3D({
  moves,
  params,
  estimate,
  viewToggle,
  timeline,
  playback,
  sample,
  currentMove,
  onStep,
}: Viewer3DProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const [webglError] = useState(() => !webglAvailable());
  const palette = usePalette(workspaceRef);

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

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.zoomToCursor = true;

    const job = new THREE.Group();
    const bit = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial());
    bit.rotation.x = Math.PI / 2; // Lathe axis is +Y; turn it to +Z.
    // Drawn after the job lines so the highlight wins where they coincide.
    const overlay = () => {
      const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
      line.renderOrder = 1;
      line.frustumCulled = false;
      return line;
    };
    const traversed = overlay();
    const current = overlay();
    current.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const moveOverlay = overlay();
    moveOverlay.renderOrder = 2;
    moveOverlay.visible = false;
    scene.add(job, bit, traversed, current, moveOverlay);

    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
      });
    };
    controls.addEventListener('change', render);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    sceneRef.current = { renderer, scene, camera, controls, job, bit, traversed, current, moveOverlay, render };
    return () => {
      sceneRef.current = null;
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

  // Frames the sheet (and the space up to safe height) from the front left, above.
  const resetView = useCallback(() => {
    const s = sceneRef.current;
    if (!s) return;
    const target = new THREE.Vector3(sheetX / 2, sheetY / 2, (safeHeight - thickness) / 2);
    const radius = 0.5 * Math.hypot(sheetX, sheetY, safeHeight + thickness);
    // The oblique view foreshortens the sheet, so the bounding sphere can be framed a little tight.
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(s.camera.fov / 2))) * 0.9;
    const dir = new THREE.Vector3(-0.35, -1, 0.9).normalize();
    s.camera.position.copy(target).addScaledVector(dir, distance);
    s.camera.near = distance / 10000;
    s.camera.far = distance * 20;
    s.camera.updateProjectionMatrix();
    s.controls.target.copy(target);
    s.controls.update();
    s.render();
  }, [sheetX, sheetY, thickness, safeHeight]);

  // Reframe when the sheet changes (size or units), not on every job edit.
  useEffect(resetView, [resetView]);

  const lines = useMemo(() => moveLineBuffers(moves, params), [moves, params]);

  // (b) Sheet, spoilboard, toolpath lines and the bit shape.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !palette) return;
    clearGroup(s.job);

    const spoil = SPOILBOARD_IN * unitFactor('in', params.units);
    s.job.add(slab(sheetX, sheetY, -thickness, 0, palette.sheet, palette.edge, 0.45));
    s.job.add(slab(sheetX, sheetY, -thickness - spoil, -thickness, palette.spoilboard, palette.edge, 0.25));

    const axes = new THREE.AxesHelper(0.08 * Math.max(sheetX, sheetY));
    s.job.add(axes);

    const dash = 0.006 * Math.max(sheetX, sheetY);
    const materials: Record<MoveKind, THREE.LineBasicMaterial> = {
      rapid: new THREE.LineDashedMaterial({ color: palette.rapid, dashSize: dash, gapSize: dash }),
      plunge: new THREE.LineBasicMaterial({ color: palette.vertical }),
      retract: new THREE.LineBasicMaterial({ color: palette.vertical }),
      feed: new THREE.LineBasicMaterial({ color: palette.feed }),
    };
    for (const kind of Object.keys(materials) as MoveKind[]) {
      if (lines[kind].length === 0) {
        materials[kind].dispose();
        continue;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(lines[kind], 3));
      const segments = new THREE.LineSegments(geometry, materials[kind]);
      if (kind === 'rapid') segments.computeLineDistances();
      s.job.add(segments);
    }

    s.bit.geometry.dispose();
    const profile = bitProfile(params.bit.shape, params.bit.diameter, BIT_LENGTH_DIAMETERS * params.bit.diameter);
    s.bit.geometry = new THREE.LatheGeometry(
      profile.map((q) => new THREE.Vector2(q.x, q.y)),
      32
    );
    (s.bit.material as THREE.MeshLambertMaterial).color.set(palette.bit);
    s.traversed.material.color.set(palette.traversed);
    s.current.material.color.set(palette.traversed);
    s.moveOverlay.material.color.set(palette.current);
    s.render();
  }, [lines, palette, sheetX, sheetY, thickness, params.units, params.bit]);

  const path = useMemo(() => pathBuffer(moves, params), [moves, params]);

  // The whole path in playback order, revealed block by block in (c).
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.traversed.geometry.dispose();
    s.traversed.geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(path, 3);
    s.traversed.geometry.setAttribute('position', attribute);
    s.traversed.geometry.setDrawRange(0, 0);
    // Shares the path's buffer; only its draw range changes when stepping.
    s.moveOverlay.geometry.dispose();
    s.moveOverlay.geometry = new THREE.BufferGeometry();
    s.moveOverlay.geometry.setAttribute('position', attribute);
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

  // (c) Bit position and the played part of the path. Only moves things and
  // sets a draw range, so it is cheap enough to run every frame.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const { position, block } = sample;
    s.bit.position.set(position.x, position.y, position.z);
    s.traversed.geometry.setDrawRange(0, Math.max(0, block) * 2);
    const attr = s.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (block >= 0) {
      attr.setXYZ(0, path[block * 6], path[block * 6 + 1], path[block * 6 + 2]);
      attr.setXYZ(1, position.x, position.y, position.z);
    } else {
      attr.setXYZ(0, 0, 0, 0);
      attr.setXYZ(1, 0, 0, 0);
    }
    attr.needsUpdate = true;
    s.render();
  }, [sample, path]);


  return (
    <div className="canvas-workspace" ref={workspaceRef}>
      <div className="toolbar">
        {viewToggle}
        <button type="button" onClick={resetView} disabled={webglError}>
          Reset view
        </button>
        <span className="divider" />
        <span className="legend">
          <span className="swatch swatch-feed" /> cut
          <span className="swatch swatch-vertical" /> plunge/retract
          <span className="swatch swatch-rapid" /> rapid
        </span>
        <span className="status">
          {moves.length} move{moves.length === 1 ? '' : 's'}
          {estimate.total > 0 && ` · est. ${formatDuration(estimate.total)}`}
        </span>
      </div>
      <div className="viewer-3d" ref={hostRef}>
        {webglError && <p className="viewer-3d-message">3D view needs WebGL, which this browser has turned off or does not support.</p>}
      </div>
      <PlaybackBar playback={playback} total={timeline.total} sample={sample} units={params.units} onStep={onStep} />
      <p className="hint">
        Drag to orbit, right-drag (or Shift+drag) to pan, scroll to zoom. Space plays and pauses
        {onStep ? '; ← and → step through moves.' : '.'}
      </p>
    </div>
  );
}
