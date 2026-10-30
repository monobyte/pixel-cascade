import type { Rng } from './rng';
import type { BBox, Cell, Fall, MatchGroup, Tile } from './types';

/**
 * Authoritative grid model. The view never owns board state: it replays the
 * `Fall` lists this class produces, keyed by `Tile.id`.
 */
export class Board {
  readonly w: number;
  readonly h: number;
  readonly kindCount: number;
  readonly cells: (Tile | null)[];
  private nextId = 1;

  constructor(w: number, h: number, kindCount: number) {
    if (w < 3 || h < 3) throw new Error('board must be at least 3x3');
    if (kindCount < 3) throw new Error('need at least 3 tile kinds');
    this.w = w;
    this.h = h;
    this.kindCount = kindCount;
    this.cells = new Array<Tile | null>(w * h).fill(null);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }
  colOf(i: number): number {
    return i % this.w;
  }
  rowOf(i: number): number {
    return Math.floor(i / this.w);
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  at(x: number, y: number): Tile | null {
    return this.inBounds(x, y) ? (this.cells[this.idx(x, y)] ?? null) : null;
  }
  kindAt(x: number, y: number): number {
    const t = this.at(x, y);
    return t ? t.kind : -1;
  }
  get filledCount(): number {
    let n = 0;
    for (const c of this.cells) if (c) n++;
    return n;
  }

  newTile(kind: number): Tile {
    return { id: this.nextId++, kind };
  }

  /** Adopt externally created ids (used by tests / deterministic fixtures). */
  setNextId(id: number): void {
    this.nextId = Math.max(this.nextId, id);
  }

  clone(): Board {
    const b = new Board(this.w, this.h, this.kindCount);
    for (let i = 0; i < this.cells.length; i++) {
      const t = this.cells[i];
      b.cells[i] = t ? { id: t.id, kind: t.kind } : null;
    }
    b.setNextId(this.nextId);
    return b;
  }

  /** Populate every empty cell so no match of three exists anywhere. */
  fillWithoutMatches(rng: Rng): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const banned = new Set<number>();
        const addBan = (ax: number, ay: number, bx: number, by: number): void => {
          const a = this.kindAt(ax, ay);
          const b = this.kindAt(bx, by);
          if (a >= 0 && a === b) banned.add(a);
        };
        // Would placing `k` here close a run to the left / above?
        addBan(x - 2, y, x - 1, y);
        addBan(x - 1, y - 1, x - 2, y - 2);
        addBan(x - 1, y + 1, x - 2, y + 2);
        addBan(x, y - 2, x, y - 1);
        addBan(x - 1, y - 1, x - 2, y - 2);
        addBan(x + 1, y - 1, x + 2, y - 2);
        const allowed: number[] = [];
        for (let k = 0; k < this.kindCount; k++) if (!banned.has(k)) allowed.push(k);
        const pool = allowed.length > 0 ? allowed : allKinds(this.kindCount);
        this.cells[this.idx(x, y)] = this.newTile(rng.pick(pool));
      }
    }
  }

  swapCells(a: number, b: number): void {
    const ta = this.cells[a] ?? null;
    this.cells[a] = this.cells[b] ?? null;
    this.cells[b] = ta;
  }

  areAdjacent(a: number, b: number): boolean {
    const ax = this.colOf(a);
    const ay = this.rowOf(a);
    const bx = this.colOf(b);
    const by = this.rowOf(b);
    return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
  }

  clearCells(indices: Iterable<number>): void {
    for (const i of indices) this.cells[i] = null;
  }

  /**
   * Horizontal and vertical runs of >= 3 merge into one group when they share
   * a cell, so L and T shapes score (and shatter) as a single event.
   */
  findMatches(): MatchGroup[] {
    const runs: number[][] = [];

    const scan = (line: number[]): void => {
      let start = 0;
      for (let i = 1; i <= line.length; i++) {
        const prev = this.cells[line[i - 1] as number];
        const cur = i < line.length ? (this.cells[line[i] as number] ?? null) : null;
        const same = !!prev && !!cur && prev.kind === cur.kind;
        if (!same) {
          if (i - start >= 3 && prev) runs.push(line.slice(start, i));
          start = i;
        }
      }
    };

    for (let y = 0; y < this.h; y++) {
      const line: number[] = [];
      for (let x = 0; x < this.w; x++) line.push(this.idx(x, y));
      scan(line);
    }
    for (let x = 0; x < this.w; x++) {
      const line: number[] = [];
      for (let y = 0; y < this.h; y++) line.push(this.idx(x, y));
      scan(line);
    }
    if (runs.length === 0) return [];

    // Union overlapping runs.
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      let root = i;
      while (parent.get(root) !== root) root = parent.get(root) as number;
      let cur = i;
      while (parent.get(cur) !== root) {
        const nxt = parent.get(cur) as number;
        parent.set(cur, root);
        cur = nxt;
      }
      return root;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const run of runs) {
      for (const i of run) if (!parent.has(i)) parent.set(i, i);
      for (let i = 1; i < run.length; i++) union(run[i - 1] as number, run[i] as number);
    }

    const byRoot = new Map<number, number[]>();
    for (const i of parent.keys()) {
      const r = find(i);
      const list = byRoot.get(r);
      if (list) list.push(i);
      else byRoot.set(r, [i]);
    }

    const maxRunByRoot = new Map<number, number>();
    for (const run of runs) {
      const r = find(run[0] as number);
      maxRunByRoot.set(r, Math.max(maxRunByRoot.get(r) ?? 0, run.length));
    }

    const groups: MatchGroup[] = [];
    for (const indices of byRoot.values()) {
      const kind = (this.cells[indices[0] as number] as Tile).kind;
      const cells: Cell[] = [];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let sx = 0;
      let sy = 0;
      for (const i of indices) {
        const x = this.colOf(i);
        const y = this.rowOf(i);
        cells.push({ x, y });
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
        sx += x;
        sy += y;
      }
      const bbox: BBox = { x0, y0, x1, y1 };
      groups.push({
        kind,
        cells: cells.sort((a, b) => a.y - b.y || a.x - b.x),
        maxRun: maxRunByRoot.get(find(indices[0] as number)) ?? indices.length,
        bbox,
        cx: sx / indices.length,
        cy: sy / indices.length,
      });
    }
    // Top-left first keeps cascade presentation stable.
    return groups.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  }

  /**
   * Compact every column downward. Returns the moves; caller must then call
   * `spawnIncoming` to fill the holes left at the top.
   */
  collapse(): Fall[] {
    const falls: Fall[] = [];
    for (let x = 0; x < this.w; x++) {
      let write = this.h - 1;
      for (let y = this.h - 1; y >= 0; y--) {
        const i = this.idx(x, y);
        const tile = this.cells[i];
        if (!tile) continue;
        if (write !== y) {
          this.cells[this.idx(x, write)] = tile;
          this.cells[i] = null;
          falls.push({
            tileId: tile.id,
            kind: tile.kind,
            from: { x, y },
            to: { x, y: write },
            distance: write - y,
          });
        }
        write--;
      }
    }
    return falls;
  }

  /**
   * Drop brand new tiles in from above. Call after `collapse`, which leaves
   * every hole contiguous at the top of its column. The holes fall in as a
   * rigid stack, so each one travels exactly `holes` rows.
   */
  spawnIncoming(rng: Rng): Fall[] {
    const falls: Fall[] = [];
    for (let x = 0; x < this.w; x++) {
      let holes = 0;
      for (let y = 0; y < this.h; y++) if (!this.cells[this.idx(x, y)]) holes++;
      for (let y = 0; y < holes; y++) {
        const i = this.idx(x, y);
        if (this.cells[i]) continue;
        const tile = this.newTile(rng.int(this.kindCount));
        this.cells[i] = tile;
        falls.push({
          tileId: tile.id,
          kind: tile.kind,
          from: { x, y: y - holes },
          to: { x, y },
          distance: holes,
        });
      }
    }
    return falls;
  }

  /** Any adjacent swap that produces a match? */
  hasValidMove(): boolean {
    return this.findValidMove() !== null;
  }

  findValidMove(): [number, number] | null {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const a = this.idx(x, y);
        if (x + 1 < this.w) {
          const b = this.idx(x + 1, y);
          this.swapCells(a, b);
          const ok = this.findMatches().length > 0;
          this.swapCells(a, b);
          if (ok) return [a, b];
        }
        if (y + 1 < this.h) {
          const b = this.idx(x, y + 1);
          this.swapCells(a, b);
          const ok = this.findMatches().length > 0;
          this.swapCells(a, b);
          if (ok) return [a, b];
        }
      }
    }
    return null;
  }

  /** Randomise kinds in place until the board is playable again. */
  reshuffle(rng: Rng): void {
    const tiles = this.cells.filter((t): t is Tile => !!t);
    for (let attempt = 0; attempt < 200; attempt++) {
      const kinds = tiles.map((t) => t.kind);
      rng.shuffle(kinds);
      let k = 0;
      for (let i = 0; i < this.cells.length; i++) {
        const t = this.cells[i];
        if (t) t.kind = kinds[k++] as number;
      }
      if (this.findMatches().length === 0 && this.hasValidMove()) return;
    }
    // pathological boards: rebuild from scratch
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = null;
    this.fillWithoutMatches(rng);
  }

  /** Debug / test helper. */
  toString(): string {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      for (let x = 0; x < this.w; x++) {
        const k = this.kindAt(x, y);
        row += k < 0 ? '.' : k.toString(36);
      }
      rows.push(row);
    }
    return rows.join('\n');
  }
}

function allKinds(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

/** Parse rows like `'.1122.'` into a board — handy for focused unit tests. */
export function boardFromRows(rows: readonly string[], kindCount = 6): Board {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const b = new Board(w, h, kindCount);
  for (let y = 0; y < h; y++) {
    const row = rows[y] as string;
    for (let x = 0; x < w; x++) {
      const ch = row[x] as string;
      b.cells[b.idx(x, y)] = ch === '.' || ch === ' ' ? null : b.newTile(parseInt(ch, 36));
    }
  }
  return b;
}
