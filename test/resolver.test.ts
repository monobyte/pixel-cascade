import { describe, expect, it } from 'vitest';
import { Board, boardFromRows } from '../src/core/board';
import { createRng } from '../src/core/rng';
import { resolveBoard, swapCreatesMatch } from '../src/core/resolver';

function full(w: number, h: number, kindCount: number, seed: number): Board {
  const b = new Board(w, h, kindCount);
  b.fillWithoutMatches(createRng(seed));
  return b;
}

describe('resolveBoard', () => {
  it('is a no-op on a quiet board', () => {
    const b = full(8, 8, 5, 3);
    const res = resolveBoard(b, createRng(1));
    expect(res.rounds).toHaveLength(0);
    expect(res.score).toBe(0);
    expect(res.clearedCount).toBe(0);
    expect(res.maxCascade).toBe(0);
    expect(b.filledCount).toBe(64);
  });

  it('clears, collapses and refills in one scripted round', () => {
    const b = boardFromRows(['.....', '.111.', '.....', '.....', '.....'], 5);
    const res = resolveBoard(b, createRng(9));
    expect(res.rounds.length).toBeGreaterThanOrEqual(1);
    const round = res.rounds[0];
    expect(round?.cascade).toBe(1);
    expect(round?.cleared).toHaveLength(3);
    expect(round?.falls.length).toBeGreaterThanOrEqual(3);
    expect(b.filledCount).toBe(25);
    expect(b.findMatches()).toHaveLength(0);
    expect(res.score).toBeGreaterThan(0);
  });

  it('keeps scripting rounds until the board goes quiet', () => {
    // Column arranged so the refill is guaranteed to chain at least twice.
    const b = boardFromRows(
      ['2.1.2.', '1.2.1.', '2.1.2.', '1.2.1.', '2.1.2.', '111111'],
      3,
    );
    const res = resolveBoard(b, createRng(5));
    expect(res.rounds.length).toBeGreaterThanOrEqual(1);
    res.rounds.forEach((r, i) => expect(r.cascade).toBe(i + 1));
    expect(b.findMatches()).toHaveLength(0);
    expect(b.filledCount).toBe(36);
  });

  it('applies a growing cascade multiplier', () => {
    // A deeper cascade must pay strictly more per equivalent round.
    const deep = boardFromRows(['.....', '.111.', '..2..', '..2..', '..2..'], 5);
    const rounds = resolveBoard(deep, createRng(2)).rounds;
    expect(rounds.length).toBeGreaterThanOrEqual(2);
    expect((rounds[1]?.score ?? 0) / (rounds[0]?.score ?? 1)).toBeGreaterThan(1.5);
  });

  it('counts each cleared cell exactly once across rounds', () => {
    const b = boardFromRows(['.....', '.111.', '..1..', '..1..', '.....'], 5);
    const res = resolveBoard(b, createRng(17));
    const seen = new Set<string>();
    for (const r of res.rounds) {
      for (const c of r.cleared) {
        const key = `${c.x},${c.y},${r.cascade}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(res.clearedCount).toBe(res.rounds.reduce((n, r) => n + r.cleared.length, 0));
  });

  it('tracks the biggest single group', () => {
    const b = boardFromRows(['11111', '.....', '.....', '.....', '.....'], 5);
    const res = resolveBoard(b, createRng(4));
    expect(res.biggestGroup).toBe(5);
  });

  it('is deterministic for a given seed', () => {
    const run = (): string => {
      const b = full(9, 9, 6, 21);
      // create a guaranteed match first
      const t = b.at(4, 4);
      if (t) b.cells[b.idx(3, 4)] = { id: 9001, kind: t.kind };
      const res = resolveBoard(b, createRng(77));
      return `${res.score}|${res.clearedCount}|${b.toString()}`;
    };
    expect(run()).toBe(run());
  });
});

describe('swapCreatesMatch', () => {
  it('accepts a swap that completes a line', () => {
    const b = boardFromRows(['11.', '...', '222'], 4);
    expect(swapCreatesMatch(b, b.idx(2, 0), b.idx(2, 1))).toBe(true);
  });

  it('rejects a pointless swap', () => {
    const b = boardFromRows(['12.', '...', '212'], 4);
    expect(swapCreatesMatch(b, b.idx(0, 0), b.idx(1, 0))).toBe(false);
  });

  it('rejects non-adjacent pairs', () => {
    const b = boardFromRows(['11.', '...', '212'], 4);
    expect(swapCreatesMatch(b, b.idx(0, 0), b.idx(2, 0))).toBe(false);
  });

  it('leaves the board untouched', () => {
    const b = boardFromRows(['11.', '...', '222'], 4);
    const before = b.toString();
    swapCreatesMatch(b, b.idx(2, 0), b.idx(2, 1));
    expect(b.toString()).toBe(before);
  });
});

describe('resolveBoard cascades', () => {
  /**
   * Regression: a board index cleared in round 1 is refilled with a brand-new
   * tile, which can legitimately match again in a later round. Deduplicating
   * cleared indices across rounds skipped those tiles, so they stayed on the
   * board and the resolution looped forever looking for progress — which froze
   * the tab. A seeded sweep reproduces it reliably.
   */
  it('clears a board index that matches again in a later cascade round', () => {
    const ROUND_CAP = 150;

    for (let seed = 1; seed <= 300; seed++) {
      const rng = createRng(seed);
      const b = full(8, 8, 5, seed);

      for (let move = 0; move < 25; move++) {
        const mv = b.findValidMove();
        if (!mv) break;
        if (!swapCreatesMatch(b, mv[0], mv[1])) continue;
        b.swapCells(mv[0], mv[1]);

        // Turn a runaway loop into a readable failure instead of a hung run.
        const findMatches = b.findMatches.bind(b);
        let calls = 0;
        b.findMatches = () => {
          if (++calls > ROUND_CAP) {
            throw new Error(`seed ${seed} move ${move}: cascade never settled`);
          }
          return findMatches();
        };

        const res = resolveBoard(b, rng);
        delete (b as unknown as { findMatches?: unknown }).findMatches;

        // The contract of resolving: the board ends quiet and fully populated.
        expect(b.findMatches(), `seed ${seed} move ${move} left matches on the board`).toHaveLength(0);
        expect(b.filledCount, `seed ${seed} move ${move} left holes`).toBe(64);

        // Every round must remove the tiles it reported, and the total must
        // count a tile cleared in a later round rather than silently dropping it.
        const perRound = res.rounds.reduce((n, r) => n + r.cleared.length, 0);
        expect(res.clearedCount, `seed ${seed} clearedCount drifted`).toBe(perRound);
        for (const r of res.rounds) {
          expect(r.cleared.length, `seed ${seed} round ${r.cascade} cleared nothing`).toBeGreaterThan(0);
        }
      }
    }
  });
});
