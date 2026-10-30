import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Board } from '../core/board';
import type { Cell, Fall } from '../core/types';
import { CANDY_TEXTURE_SIZE, makeCandyCanvas } from './textures';
import { easings, Tweener } from './tweener';

/** Mild overshoot so drops feel weighted instead of linear. */
const dropEase = (t: number): number => {
  const q = t * t;
  if (t < 0.86) return q / (0.86 * 0.86);
  const over = (t - 0.86) / 0.14;
  return 1 + Math.sin(over * Math.PI) * 0.035;
};

const squashEase = (t: number): number => Math.sin(t * Math.PI);

interface TileSprite {
  sprite: Sprite;
  kind: number;
  cell: Cell;
}

export interface BoardMetrics {
  readonly cell: number;
  readonly pad: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Owns tile sprites, the board plate and all tile-level animation. Sprites are
 * keyed by `Tile.id`, so a tile that falls is the *same* sprite re-targeted —
 * the model is never consulted for position.
 */
export class BoardView {
  readonly container = new Container();

  private readonly tileLayer = new Container();
  private readonly plate = new Graphics();
  private readonly wells = new Graphics();
  private readonly highlight = new Graphics();
  private readonly sprites = new Map<number, TileSprite>();
  private readonly textures: Texture[];
  private readonly tweens: Tweener;
  private readonly board: Board;
  private metrics: BoardMetrics;

  constructor(board: Board, textures: Texture[], tweens: Tweener, cell: number) {
    this.board = board;
    this.textures = textures;
    this.tweens = tweens;
    this.metrics = computeMetrics(board, cell);
    this.container.addChild(this.plate, this.wells, this.highlight, this.tileLayer);
    this.drawPlate();
  }

  get metricsView(): BoardMetrics {
    return this.metrics;
  }

  get tileCount(): number {
    return this.sprites.size;
  }

  centerOf(x: number, y: number): { x: number; y: number } {
    const m = this.metrics;
    return { x: m.pad + x * m.cell + m.cell / 2, y: m.pad + y * m.cell + m.cell / 2 };
  }

  centerOfCell(c: Cell): { x: number; y: number } {
    return this.centerOf(c.x, c.y);
  }

  /** World cell for a point in board-local space, or null if outside. */
  cellAt(localX: number, localY: number): Cell | null {
    const m = this.metrics;
    const x = Math.floor((localX - m.pad) / m.cell);
    const y = Math.floor((localY - m.pad) / m.cell);
    if (x < 0 || y < 0 || x >= this.board.w || y >= this.board.h) return null;
    return { x, y };
  }

  /** Rebuild every sprite (level start / reshuffle). */
  rebuild(): void {
    for (const t of this.sprites.values()) t.sprite.destroy();
    this.sprites.clear();
    for (let y = 0; y < this.board.h; y++) {
      for (let x = 0; x < this.board.w; x++) {
        const tile = this.board.at(x, y);
        if (!tile) continue;
        this.spawn(tile.id, tile.kind, { x, y }, false);
      }
    }
    this.tileLayer.sortChildren();
  }

  private spawn(tileId: number, kind: number, cell: Cell, incoming: boolean): TileSprite {
    const tex = this.textures[kind % this.textures.length] as Texture;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    const m = this.metrics;
    sprite.scale.set((m.cell * 0.92) / tex.width);
    const c = this.centerOf(cell.x, cell.y);
    // Tiles falling in start one full board-height above their landing cell so
    // the whole column enters as a rigid stack.
    sprite.x = c.x;
    sprite.y = incoming ? c.y - m.cell * (this.board.h + 1) : c.y;
    sprite.tint = 0xffffff;
    this.tileLayer.addChild(sprite);
    const entry: TileSprite = { sprite, kind, cell: { ...cell } };
    this.sprites.set(tileId, entry);
    return entry;
  }

  /** Size the plate + wells to the board. */
  private drawPlate(): void {
    const m = this.metrics;
    const r = Math.max(8, m.cell * 0.22);
    this.plate.clear();
    this.plate
      .roundRect(0, 0, m.width, m.height, r)
      .fill({ color: 0x160f2e, alpha: 0.86 })
      .stroke({ width: Math.max(2, m.cell * 0.06), color: 0x3a2a68, alpha: 0.9 });
    this.plate
      .roundRect(m.pad * 0.5, m.pad * 0.5, m.width - m.pad, m.height - m.pad, r * 0.7)
      .stroke({ width: 1, color: 0x6a4fb0, alpha: 0.35 });

    this.wells.clear();
    const inset = m.cell * 0.06;
    for (let y = 0; y < this.board.h; y++) {
      for (let x = 0; x < this.board.w; x++) {
        const c = this.centerOf(x, y);
        const half = m.cell / 2 - inset;
        this.wells
          .roundRect(c.x - half, c.y - half, half * 2, half * 2, m.cell * 0.18)
          .fill({ color: (x + y) % 2 === 0 ? 0x1d1440 : 0x241a52, alpha: 0.9 });
      }
    }
  }

  setCellSize(cell: number): void {
    if (Math.abs(cell - this.metrics.cell) < 0.5) return;
    this.metrics = computeMetrics(this.board, cell);
    this.drawPlate();
    for (const t of this.sprites.values()) {
      const tex = this.textures[t.kind % this.textures.length] as Texture;
      t.sprite.scale.set((this.metrics.cell * 0.92) / tex.width);
      const c = this.centerOf(t.cell.x, t.cell.y);
      t.sprite.x = c.x;
      t.sprite.y = c.y;
    }
  }

  /** Instantly place tiles for a set of falls (used before animating). */
  private ensureFallSprites(falls: readonly Fall[]): void {
    for (const f of falls) {
      const existing = this.sprites.get(f.tileId);
      if (existing) {
        const from = this.centerOf(f.from.x, f.from.y);
        existing.sprite.x = from.x;
        existing.sprite.y = from.y;
        existing.cell = { ...f.from };
      } else {
        const entry = this.spawn(f.tileId, f.kind, f.to, true);
        const from = this.centerOf(f.from.x, f.from.y);
        entry.sprite.x = from.x;
        entry.sprite.y = from.y;
        entry.cell = { ...f.from };
      }
    }
  }

  /**
   * Animate gravity + refill. Returns when every tile has landed; each column
   * staggers slightly so the refill reads as a cascade of drops.
   */
  async playFalls(falls: readonly Fall[]): Promise<void> {
    if (falls.length === 0) return;
    this.ensureFallSprites(falls);
    const jobs = falls.map((f) => {
      const entry = this.sprites.get(f.tileId);
      if (!entry) return Promise.resolve();
      const to = this.centerOf(f.to.x, f.to.y);
      const fromY = entry.sprite.y;
      const dist = Math.abs(to.y - fromY);
      const duration = Math.min(430, 150 + dist * 0.5);
      const delay = (f.to.x % 3) * 18 + Math.min(60, f.distance * 8);
      entry.cell = { ...f.to };
      const sprite = entry.sprite;
      return this.tweens
        .tween({
          duration,
          delay,
          ease: dropEase,
          onUpdate: (_p, eased) => {
            sprite.y = fromY + (to.y - fromY) * eased;
          },
        })
        .then(() => this.squash(sprite, Math.min(1, 0.35 + f.distance * 0.12)));
    });
    await Promise.all(jobs);
  }

  /** Landing squash-and-stretch, scaled by how far the tile fell. */
  private squash(sprite: Sprite, amount: number): Promise<void> {
    const base = sprite.scale.x;
    return this.tweens.tween({
      duration: 150,
      ease: squashEase,
      onUpdate: (_p, eased) => {
        const a = eased * amount * 0.22;
        sprite.scale.set(base * (1 + a), base * (1 - a));
      },
    });
  }

  /**
   * Deal the board in from above. Every column enters as one rigid stack (all
   * tiles share a travel distance), with a small per-column stagger.
   */
  async playIntro(): Promise<void> {
    const m = this.metrics;
    const entries = [...this.sprites.values()];
    if (entries.length === 0) return;
    const lift = m.cell * (this.board.h + 1);
    for (const e of entries) {
      const target = this.centerOf(e.cell.x, e.cell.y);
      e.sprite.alpha = 1;
      e.sprite.rotation = 0;
      e.sprite.y = target.y - lift;
    }
    await Promise.all(
      entries.map((e) => {
        const target = this.centerOf(e.cell.x, e.cell.y);
        const fromY = e.sprite.y;
        const delay = (e.cell.x % 4) * 34 + Math.random() * 30;
        return this.tweens
          .tween({
            duration: 520,
            delay,
            ease: dropEase,
            onUpdate: (_p, eased) => {
              e.sprite.y = fromY + (target.y - fromY) * eased;
            },
          })
          .then(() => this.squash(e.sprite, 0.7));
      }),
    );
  }

  /** Drop the board out downwards before a reshuffle or level change. */
  async playOut(): Promise<void> {
    const entries = [...this.sprites.values()];
    if (entries.length === 0) return;
    const starts = entries.map((e) => ({ e, y: e.sprite.y }));
    await Promise.all(
      starts.map(({ e, y }) =>
        this.tweens.tween({
          duration: 340,
          delay: e.cell.y * 14,
          ease: easings.quadIn,
          onUpdate: (_p, eased) => {
            e.sprite.y = y + eased * eased * this.metrics.cell * 3.2;
            e.sprite.alpha = 1 - eased;
          },
        }),
      ),
    );
    for (const { e } of starts) e.sprite.destroy();
    this.sprites.clear();
  }

  /** Sprite currently occupying a cell, if any. */
  spriteAt(x: number, y: number): TileSprite | null {
    for (const entry of this.sprites.values()) {
      if (entry.cell.x === x && entry.cell.y === y) return entry;
    }
    return null;
  }

  /** Two tiles trade places. */
  async playSwap(a: Cell, b: Cell, ids: [number, number]): Promise<void> {
    const sa = this.sprites.get(ids[0]);
    const sb = this.sprites.get(ids[1]);
    if (!sa || !sb) return;
    const ca = this.centerOf(a.x, a.y);
    const cb = this.centerOf(b.x, b.y);
    const lift = this.metrics.cell * 0.14;
    sa.sprite.zIndex = 2;
    sb.sprite.zIndex = 1;
    const jobs = [
      this.arc(sa.sprite, cb, lift, 165),
      this.arc(sb.sprite, ca, -lift, 165),
    ];
    await Promise.all(jobs);
    sa.sprite.zIndex = 0;
    sb.sprite.zIndex = 0;
    sa.cell = { ...b };
    sb.cell = { ...a };
  }

  private arc(sprite: Sprite, to: { x: number; y: number }, lift: number, duration: number): Promise<void> {
    const fromX = sprite.x;
    const fromY = sprite.y;
    return this.tweens.tween({
      duration,
      ease: easings.cubicInOut,
      onUpdate: (_p, eased) => {
        sprite.x = fromX + (to.x - fromX) * eased;
        sprite.y = fromY + (to.y - fromY) * eased + Math.sin(eased * Math.PI) * lift;
      },
    });
  }

  /** Rejected swap: nudge out and spring back. */
  async playRejected(a: Cell, b: Cell, ids: [number, number]): Promise<void> {
    const sa = this.sprites.get(ids[0]);
    const sb = this.sprites.get(ids[1]);
    if (!sa || !sb) return;
    const ca = this.centerOf(a.x, a.y);
    const cb = this.centerOf(b.x, b.y);
    const dist = Math.max(1, Math.hypot(cb.x - ca.x, cb.y - ca.y));
    const ux = (cb.x - ca.x) / dist;
    const uy = (cb.y - ca.y) / dist;
    const nudge = this.metrics.cell * 0.3;

    const jobs = [sa, sb].map((entry, i) => {
      const sign = i === 0 ? 1 : -1;
      const sx = entry.sprite.x;
      const sy = entry.sprite.y;
      return this.tweens.tween({
        duration: 260,
        ease: easings.linear,
        onUpdate: (p) => {
          // spring out, overshoot back past home, settle
          const k = Math.sin(p * Math.PI * 2) * (1 - p) * sign;
          entry.sprite.x = sx + ux * nudge * k;
          entry.sprite.y = sy + uy * nudge * k;
        },
      });
    });
    await Promise.all(jobs);
    for (const [entry, cell] of [
      [sa, a],
      [sb, b],
    ] as const) {
      const c = this.centerOf(cell.x, cell.y);
      entry.sprite.x = c.x;
      entry.sprite.y = c.y;
    }
  }

  /**
   * Pop the cleared tiles: overshoot, then shrink away. Sprites are removed
   * from the map immediately so a later fall in the same round cannot reuse a
   * dying tile's cell.
   */
  async playClear(cells: readonly Cell[]): Promise<void> {
    const targets: { entry: TileSprite; base: number }[] = [];
    for (const c of cells) {
      for (const [id, entry] of this.sprites) {
        if (entry.cell.x !== c.x || entry.cell.y !== c.y) continue;
        targets.push({ entry, base: entry.sprite.scale.x });
        this.sprites.delete(id);
      }
    }
    if (targets.length === 0) return;

    await this.tweens.tween({
      duration: 165,
      ease: easings.quadOut,
      onUpdate: (_p, eased) => {
        for (const t of targets) {
          t.entry.sprite.scale.set(t.base * (1 + 0.26 * eased));
          t.entry.sprite.rotation = Math.sin(eased * Math.PI) * 0.09;
        }
      },
    });

    await Promise.all(
      targets.map((t) =>
        this.tweens.tween({
          duration: 150,
          ease: easings.quadIn,
          onUpdate: (_p, eased) => {
            t.entry.sprite.alpha = 1 - eased;
            t.entry.sprite.scale.set(t.base * (1.26 - 0.6 * eased));
          },
        }),
      ),
    );

    for (const t of targets) t.entry.sprite.destroy();
  }

  /** Drop any sprites left orphaned by a reshuffle. */
  pruneOrphans(): void {
    const alive = new Set<number>();
    for (const cell of this.board.cells) if (cell) alive.add(cell.id);
    for (const [id, entry] of this.sprites) {
      if (alive.has(id)) continue;
      entry.sprite.destroy();
      this.sprites.delete(id);
    }
  }

  /** Selection / hint ring around a cell. */
  showHighlight(cells: readonly Cell[], color = 0xffffff, alpha = 0.85): void {
    const m = this.metrics;
    this.highlight.clear();
    for (const c of cells) {
      const p = this.centerOf(c.x, c.y);
      const half = m.cell / 2 - m.cell * 0.03;
      this.highlight
        .roundRect(p.x - half, p.y - half, half * 2, half * 2, m.cell * 0.2)
        .stroke({ width: Math.max(2, m.cell * 0.055), color, alpha });
    }
  }

  clearHighlight(): void {
    this.highlight.clear();
  }

  /** Flash the whole board (used on cascade beats). */
  async flash(alpha = 0.35): Promise<void> {
    await this.tweens.tween({
      duration: 200,
      ease: easings.pulse,
      onUpdate: (_p, eased) => {
        this.tileLayer.alpha = 1 - alpha * eased;
      },
    });
    this.tileLayer.alpha = 1;
  }

  /** Whole-board shake for big cascades. */
  async shake(strength: number, duration = 260): Promise<void> {
    const ox = this.container.x;
    const oy = this.container.y;
    await this.tweens.tween({
      duration,
      ease: easings.linear,
      onUpdate: (p) => {
        const decay = 1 - p;
        this.container.x = ox + Math.sin(p * 42) * strength * decay;
        this.container.y = oy + Math.cos(p * 37) * strength * 0.6 * decay;
      },
    });
    this.container.x = ox;
    this.container.y = oy;
  }

  setSpriteAlphaForCells(cells: readonly Cell[], alpha: number): void {
    for (const c of cells) {
      const entry = this.spriteAt(c.x, c.y);
      if (entry) entry.sprite.alpha = alpha;
    }
  }

  destroy(): void {
    for (const t of this.sprites.values()) t.sprite.destroy();
    this.sprites.clear();
    this.container.destroy({ children: true });
  }
}

export function computeMetrics(board: Board, cell: number): BoardMetrics {
  const pad = Math.max(6, Math.round(cell * 0.16));
  return {
    cell,
    pad,
    width: board.w * cell + pad * 2,
    height: board.h * cell + pad * 2,
  };
}

/**
 * One smooth texture per candy kind. Candies are antialiased vector-style art,
 * so they use the default linear filtering and downsample cleanly; the hard
 * nearest-sampled pixel texture belongs to the particles layer instead.
 */
export function makeCandyTextures(
  kindCount: number,
  resolution: number = CANDY_TEXTURE_SIZE,
): Texture[] {
  const out: Texture[] = [];
  for (let k = 0; k < kindCount; k++) {
    out.push(Texture.from(makeCandyCanvas(k, resolution)));
  }
  return out;
}
