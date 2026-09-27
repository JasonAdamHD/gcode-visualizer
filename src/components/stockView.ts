/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Draws a tiled Stock with Three.js. Cut tiles get fine grid meshes, packed
// PAGE_TILES to a buffer (one draw call per page) in the order they are
// first cut; uncut tiles are quads of a coarse flat top; a skirt walls the
// sheet edge. Updates rewrite only the tiles a cut touched.
import * as THREE from 'three';
import type { DirtyRect, Stock } from '../sim/stock';
import type { Rgb } from '../sim/stockMesh';
import {
  TILE_VERTS,
  flatTopIndex,
  flatTopPositions,
  packedTileIndex,
  skirtIndex,
  skirtVertexCount,
  tilesCovering,
  writeSkirt,
  writeTileVertices,
} from '../sim/stockMesh';

/** Tile meshes per buffer (and draw call). */
const PAGE_TILES = 32;

type Page = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  positions: THREE.BufferAttribute;
  colors: THREE.BufferAttribute;
};

export type StockColors = { top: Rgb; cut: Rgb };

/** Pushed back a little so toolpath lines lying on a cut floor stay visible. */
function stockMaterial() {
  return new THREE.MeshLambertMaterial({ flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
}

export class StockView {
  readonly group = new THREE.Group();
  private readonly stock: Stock;
  private colors: StockColors;
  private readonly pages: Page[] = [];
  private readonly slotOf: Int32Array;
  private slotTiles: number[] = [];
  private readonly pageIndex: THREE.BufferAttribute;
  private readonly indexPerTile: number;
  private readonly tileMaterial = stockMaterial();
  private readonly top: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private readonly skirt: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  private readonly skirtPositions: THREE.BufferAttribute;

  constructor(stock: Stock, colors: StockColors, stockColor: string) {
    this.stock = stock;
    this.colors = colors;
    this.slotOf = new Int32Array(stock.tx * stock.ty).fill(-1);
    const index = packedTileIndex(PAGE_TILES);
    this.indexPerTile = index.length / PAGE_TILES;
    this.pageIndex = new THREE.BufferAttribute(index, 1);
    this.tileMaterial.vertexColors = true;

    const topGeometry = new THREE.BufferGeometry();
    topGeometry.setAttribute('position', new THREE.BufferAttribute(flatTopPositions(stock), 3));
    this.top = new THREE.Mesh(topGeometry, stockMaterial());
    this.top.frustumCulled = false;

    this.skirtPositions = new THREE.BufferAttribute(new Float32Array(skirtVertexCount(stock) * 3), 3);
    this.skirtPositions.setUsage(THREE.DynamicDrawUsage);
    const skirtGeometry = new THREE.BufferGeometry();
    skirtGeometry.setAttribute('position', this.skirtPositions);
    skirtGeometry.setIndex(new THREE.BufferAttribute(skirtIndex(stock), 1));
    this.skirt = new THREE.Mesh(skirtGeometry, stockMaterial());
    this.skirt.frustumCulled = false;

    this.group.add(this.top, this.skirt);
    this.setStockColor(stockColor);
    this.rebuild();
  }

  /**
   * Shows the cut in `rect` (from the simulator). A rectangle covering the
   * whole grid (a checkpoint restore) redraws everything, since tiles may
   * have gone back to uncut.
   */
  update(rect: DirtyRect | null) {
    if (!rect) return;
    const { stock } = this;
    if (rect.i0 === 0 && rect.j0 === 0 && rect.i1 === stock.nx - 1 && rect.j1 === stock.ny - 1) {
      this.rebuild();
      return;
    }
    let newTiles = false;
    for (const t of tilesCovering(stock, rect)) {
      if (!stock.tiles[t]) continue;
      let slot = this.slotOf[t];
      if (slot < 0) {
        slot = this.assign(t);
        newTiles = true;
      }
      this.writeTile(t, slot, true);
    }
    if (newTiles) this.rebuildTop();
    if (rect.i0 === 0 || rect.j0 === 0 || rect.i1 === stock.nx - 1 || rect.j1 === stock.ny - 1) this.rebuildSkirt();
  }

  /** New colors for a new color scheme: cut and uncut vertex colors and the flat parts. */
  recolor(colors: StockColors, stockColor: string) {
    this.colors = colors;
    this.setStockColor(stockColor);
    this.rebuild();
  }

  /** Redraws every tile, the flat top and the skirt from the stock. */
  rebuild() {
    this.slotOf.fill(-1);
    this.slotTiles = [];
    for (const page of this.pages) page.mesh.geometry.setDrawRange(0, 0);
    const { tiles } = this.stock;
    for (let t = 0; t < tiles.length; t++) {
      if (tiles[t]) this.writeTile(t, this.assign(t), false);
    }
    // Whole buffers: any queued ranges would limit the upload to themselves.
    for (const page of this.pages) {
      for (const attr of [page.positions, page.colors]) {
        attr.clearUpdateRanges();
        attr.needsUpdate = true;
      }
    }
    this.rebuildTop();
    this.rebuildSkirt();
  }

  private setStockColor(color: string) {
    this.top.material.color.set(color);
    this.skirt.material.color.set(color);
  }

  /** Gives tile `t` the next free slot, adding a page when needed. */
  private assign(t: number): number {
    const slot = this.slotTiles.length;
    this.slotTiles.push(t);
    this.slotOf[t] = slot;
    const p = Math.floor(slot / PAGE_TILES);
    if (p === this.pages.length) this.pages.push(this.newPage());
    this.pages[p].mesh.geometry.setDrawRange(0, ((slot % PAGE_TILES) + 1) * this.indexPerTile);
    return slot;
  }

  private newPage(): Page {
    const positions = new THREE.BufferAttribute(new Float32Array(PAGE_TILES * TILE_VERTS * 3), 3);
    const colors = new THREE.BufferAttribute(new Uint8Array(PAGE_TILES * TILE_VERTS * 3), 3, true);
    positions.setUsage(THREE.DynamicDrawUsage);
    colors.setUsage(THREE.DynamicDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setAttribute('color', colors);
    geometry.setIndex(this.pageIndex);
    const mesh = new THREE.Mesh(geometry, this.tileMaterial);
    // Heights only go down inside the sheet's box; bounds would cost a pass over every vertex.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, positions, colors };
  }

  private writeTile(t: number, slot: number, queueRange: boolean) {
    const page = this.pages[Math.floor(slot / PAGE_TILES)];
    const first = (slot % PAGE_TILES) * TILE_VERTS;
    writeTileVertices(
      this.stock,
      t,
      page.positions.array as Float32Array,
      { data: page.colors.array as Uint8Array, ...this.colors },
      first
    );
    if (!queueRange) return;
    for (const attr of [page.positions, page.colors]) {
      attr.addUpdateRange(first * 3, TILE_VERTS * 3);
      attr.needsUpdate = true;
    }
  }

  /** New geometry rather than a new index, so the old index's GPU buffer is freed with it. */
  private rebuildTop() {
    const old = this.top.geometry;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', old.getAttribute('position'));
    geometry.setIndex(new THREE.BufferAttribute(flatTopIndex(this.stock), 1));
    this.top.geometry = geometry;
    old.dispose();
  }

  private rebuildSkirt() {
    writeSkirt(this.stock, this.skirtPositions.array as Float32Array);
    this.skirtPositions.needsUpdate = true;
  }
}
