import { describe, expect, it } from 'vitest';
import { Board, boardFromRows } from '../src/core/board';
import { createRng } from '../src/core/rng';

/** Fixtures use '.' for empty cells and base-36 digits for tile kinds. */

describe('Board.findMatches', () => {
  it('finds a single horizontal run of three', () => {
    const b = boardFromRows(['.....', '.111.', '.....', '.....', '.....']);
    const groups = b.findMatches();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.cells).toHaveLength(3);
    expect(groups[0]?.maxRun).toBe(3);
    expect(groups[0]?.kind).toBe(1);
  });

  it('merges an L shape into one group', () => {
    const b = boardFromRows(['222..', '2....', '2....', '.....', '.....']);
    const groups = b.findMatches();
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.cells).toHaveLength(5);
    expect(g?.maxRun).toBe(3);
    expect(g?.bbox).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
  });

  it('keeps two disjoint runs as two groups', () => {
    const b = boardFromRows(['111..', '.....', '222..', '.....', '.....']);
    expect(b.findMatches()).toHaveLength(2);
  });

  it('ignores runs shorter than three', () => {
    const b = boardFromRows(['11...', '11...', '.....', '.....', '.....']);
    expect(b.findMatches()).toHaveLength(0);
  });

  it('reports the longest run of a T shape', () => {
    const b = boardFromRows(['.333.', '..3..', '..3..', '.....', '.....']);
    const g = b.findMatches()[0];
    expect(g?.cells).toHaveLength(5);
    expect(g?.maxRun).toBe(3);
  });

  it('handles a vertical run', () => {
    const b = boardFromRows(['4..', '4..', '4..', '.1.', '..1']);
    const g = b.findMatches()[0];
    expect(g?.cells).toHaveLength(3);
    expect(g?.kind).toBe(4);
  });

  it('counts empty cells as breaks, never as a match', () => {
    const b = boardFromRows(['...', '...', '...', '...', '...']);
    expect(b.findMatches()).toHaveLength(0);
  });

  it('sorts groups top-left first', () => {
    const b = boardFromRows(['.....', '.....', '..1..', '22222', '11111']);
    const groups = b.findMatches();
    expect(groups.length).toBeGreaterThanOrEqual(2);
    const first = groups[0];
    expect(first?.bbox.y0).toBeLessThanOrEqual(groups[groups.length - 1]?.bbox.y0 as number);
  });
});

describe('Board.collapse', () => {
  it('drops tiles to the floor and records distance', () => {
    const b = boardFromRows(['1111', '2222', '3333', '4444']);
    b.clearCells([b.idx(1, 1), b.idx(1, 2), b.idx(2, 1), b.idx(2, 2), b.idx(1, 3), b.idx(2, 3)]);
    const falls = b.collapse();
    expect(falls).toHaveLength(2);
    for (const f of falls) {
      expect(f.to.y).toBe(3);
      expect(f.from.y).toBe(0);
      expect(f.distance).toBe(3);
    }
    expect(b.toString()).toBe('1..1\n2..2\n3..3\n4114');
  });

  it('does not move tiles that are already resting on the stack', () => {
    const b = boardFromRows(['1111', '2222', '3333', '4444']);
    b.clearCells([b.idx(3, 0)]);
    // column 3 keeps y1..y3, nothing to compact
    expect(b.collapse()).toHaveLength(0);
  });

  it('compacts columns independently', () => {
    const b = boardFromRows(['1..', '...', '...', '2..']);
    b.clearCells([b.idx(0, 3)]);
    const falls = b.collapse();
    expect(falls).toHaveLength(1);
    expect(falls[0]).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 0, y: 3 }, distance: 3 });
    expect(b.kindAt(0, 3)).toBe(1);
    expect(b.kindAt(0, 0)).toBe(-1);
  });

  it('preserves tile identity so the view can follow a falling sprite', () => {
    const b = boardFromRows(['1..', '...', '...', '2..']);
    const moving = b.at(0, 0)?.id;
    b.clearCells([b.idx(0, 3)]);
    b.collapse();
    expect(b.at(0, 3)?.id).toBe(moving);
  });
});

describe('Board.spawnIncoming', () => {
  it('fills every hole with a valid new kind', () => {
    const b = boardFromRows(['1111', '2222', '3333', '4444'], 6);
    b.clearCells([b.idx(0, 2), b.idx(0, 3), b.idx(1, 2), b.idx(1, 3), b.idx(2, 3)]);
    b.collapse();
    const spawns = b.spawnIncoming(createRng(7));
    expect(spawns).toHaveLength(5);
    expect(b.filledCount).toBe(16);
    for (const s of spawns) {
      expect(s.from.y).toBeLessThan(0);
      expect(s.to.y).toBeGreaterThanOrEqual(0);
      expect(s.kind).toBeGreaterThanOrEqual(0);
      expect(s.kind).toBeLessThan(6);
    }
  });

  it('falls a column stack in as a rigid block', () => {
    const b = boardFromRows(['111', '111', '111', '111'], 6);
    b.clearCells([b.idx(0, 2), b.idx(0, 3)]);
    b.collapse();
    const spawns = b.spawnIncoming(createRng(3)).filter((s) => s.to.x === 0);
    expect(spawns).toHaveLength(2);
    // The tile landing at y0 must enter from higher up than the one at y1.
    const to0 = spawns.find((s) => s.to.y === 0);
    const to1 = spawns.find((s) => s.to.y === 1);
    expect(to0?.from.y).toBe(-2);
    expect(to1?.from.y).toBe(-1);
    expect(to0?.distance).toBe(2);
    expect(to1?.distance).toBe(2);
  });

  it('assigns a unique id to every spawned tile', () => {
    const b = boardFromRows(['111', '111', '111', '111'], 6);
    b.clearCells([0, 1, 2, 3, 4, 5]);
    b.collapse();
    const spawns = b.spawnIncoming(createRng(11));
    const ids = new Set(spawns.map((s) => s.tileId));
    expect(ids.size).toBe(spawns.length);
  });
});

describe('Board.fillWithoutMatches', () => {
  it('never seeds an immediate match', () => {
    for (let seed = 0; seed < 60; seed++) {
      const b = new Board(9, 9, 5);
      b.fillWithoutMatches(createRng(seed * 977 + 13));
      expect(b.findMatches()).toHaveLength(0);
      expect(b.filledCount).toBe(81);
    }
  });

  it('still uses the whole colour palette', () => {
    const b = new Board(10, 10, 6);
    b.fillWithoutMatches(createRng(42));
    const used = new Set(b.cells.map((t) => t?.kind));
    expect(used.size).toBe(6);
  });
});

describe('Board.hasValidMove', () => {
  it('detects a board with a legal swap', () => {
    const b = boardFromRows(['112', '221', '121'], 4);
    expect(b.findMatches()).toHaveLength(0);
    expect(b.hasValidMove()).toBe(true);
    expect(b.findValidMove()).not.toBeNull();
  });

  it('detects a locked board', () => {
    // Diagonal stripes: no run of three, and no single swap can create one.
    const b = boardFromRows(['012012', '120120', '201201', '012012', '120120', '201201'], 3);
    expect(b.findMatches()).toHaveLength(0);
    expect(b.hasValidMove()).toBe(false);
  });

  it('leaves a reshuffled board playable and quiet', () => {
    const b = boardFromRows(['012012', '120120', '201201', '012012', '120120', '201201'], 5);
    b.reshuffle(createRng(99));
    expect(b.hasValidMove()).toBe(true);
    expect(b.findMatches()).toHaveLength(0);
    expect(b.filledCount).toBe(36);
  });
});

describe('Board misc', () => {
  it('treats only manhattan-1 pairs as adjacent', () => {
    const b = new Board(4, 4, 4);
    expect(b.areAdjacent(b.idx(1, 1), b.idx(2, 1))).toBe(true);
    expect(b.areAdjacent(b.idx(1, 1), b.idx(1, 2))).toBe(true);
    expect(b.areAdjacent(b.idx(1, 1), b.idx(2, 2))).toBe(false);
    expect(b.areAdjacent(b.idx(1, 1), b.idx(3, 1))).toBe(false);
  });

  it('swapCells exchanges tiles in place', () => {
    const b = boardFromRows(['12.', '...', '...']);
    const a = b.at(0, 0)?.id;
    const c = b.at(1, 0)?.id;
    b.swapCells(b.idx(0, 0), b.idx(1, 0));
    expect(b.at(1, 0)?.id).toBe(a);
    expect(b.at(0, 0)?.id).toBe(c);
  });

  it('clone is independent', () => {
    const b = boardFromRows(['1..', '...', '...']);
    const c = b.clone();
    c.cells[0] = null;
    expect(b.cells[0]).not.toBeNull();
  });

  it('rejects degenerate boards', () => {
    expect(() => new Board(2, 5, 4)).toThrow();
    expect(() => new Board(5, 5, 2)).toThrow();
  });
});
