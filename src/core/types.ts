/** Shared model types. Nothing here imports Pixi — the model stays testable. */

export interface Tile {
  /** Stable identity so the view can chase a tile across gravity moves. */
  readonly id: number;
  kind: number;
}

export interface Cell {
  x: number;
  y: number;
}

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A connected set of same-kind tiles joined by at least one run of >= 3. */
export interface MatchGroup {
  readonly kind: number;
  readonly cells: Cell[];
  /** Longest single straight run inside the group (3, 4, 5...). */
  readonly maxRun: number;
  readonly bbox: BBox;
  readonly cx: number;
  readonly cy: number;
}

/** A tile travelling from one cell to another. `from.y < 0` means "falling in". */
export interface Fall {
  readonly tileId: number;
  readonly kind: number;
  readonly from: Cell;
  readonly to: Cell;
  readonly distance: number;
}

export interface ScorePart {
  readonly label: string;
  readonly value: number;
}

export interface Round {
  /** 1-based cascade index within the current resolution. */
  readonly cascade: number;
  readonly groups: MatchGroup[];
  readonly cleared: Cell[];
  readonly score: number;
  readonly parts: ScorePart[];
  readonly falls: Fall[];
}

export interface Resolution {
  readonly rounds: Round[];
  readonly clearedCount: number;
  /** Longest cascade reached (== rounds.length). */
  readonly maxCascade: number;
  readonly score: number;
  /** Largest single-group size seen during the resolution. */
  readonly biggestGroup: number;
}
