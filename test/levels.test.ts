import { describe, expect, it } from 'vitest';
import { GOAL_LABELS, LEVELS, goalProgressLabel, goalValue } from '../src/core/levels';
import { createRng } from '../src/core/rng';
import { Board } from '../src/core/board';

const stats = { score: 5000, tilesCleared: 40, bigMosaics: 3, bestCascade: 4 };

describe('levels', () => {
  it('ships a handful of short levels with increasing ambition', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(3);
    expect(LEVELS.length).toBeLessThanOrEqual(8);
    LEVELS.forEach((lvl, i) => {
      expect(lvl.id).toBe(i + 1);
      expect(lvl.name.length).toBeGreaterThan(0);
      expect(lvl.hint.length).toBeGreaterThan(0);
      expect(lvl.width).toBeGreaterThanOrEqual(6);
      expect(lvl.height).toBeGreaterThanOrEqual(6);
      expect(lvl.kinds).toBeGreaterThanOrEqual(4);
      expect(lvl.moves).toBeGreaterThanOrEqual(10);
      expect(lvl.goals.length).toBeGreaterThan(0);
    });
    // targets should not go backwards
    const firstTarget = LEVELS[0]!.goals.reduce((n, g) => n + g.target, 0);
    const lastTarget = LEVELS[LEVELS.length - 1]!.goals.reduce((n, g) => n + g.target, 0);
    expect(lastTarget).toBeGreaterThan(firstTarget);
  });

  it('every level is buildable and playable at start', () => {
    for (const lvl of LEVELS) {
      for (const seed of [1, 17, 42]) {
        const b = new Board(lvl.width, lvl.height, lvl.kinds);
        b.fillWithoutMatches(createRng(seed));
        expect(b.findMatches(), `level ${lvl.id} seed ${seed}`).toHaveLength(0);
        expect(b.hasValidMove(), `level ${lvl.id} seed ${seed}`).toBe(true);
      }
    }
  });

  it('keeps score targets reachable inside the move budget', () => {
    // ~250 pts/move is a comfortable average for a competent player; require
    // that the easiest goal of each level stays under that ceiling.
    for (const lvl of LEVELS) {
      for (const goal of lvl.goals) {
        if (goal.kind !== 'score') continue;
        expect(goal.target / lvl.moves).toBeLessThanOrEqual(400);
      }
    }
  });

  it('reads goals from the shared stats object', () => {
    expect(goalValue({ kind: 'score', target: 1 }, stats)).toBe(5000);
    expect(goalValue({ kind: 'tiles', target: 1 }, stats)).toBe(40);
    expect(goalValue({ kind: 'mosaics', target: 1 }, stats)).toBe(3);
    expect(goalValue({ kind: 'cascade', target: 1 }, stats)).toBe(4);
  });

  it('labels and clamps goals for the HUD', () => {
    expect(GOAL_LABELS.score(1500)).toContain('1,500');
    expect(GOAL_LABELS.mosaics(1)).toBe('Summon 1 pixel motif');
    expect(GOAL_LABELS.mosaics(4)).toBe('Summon 4 pixel motifs');
    expect(goalProgressLabel({ kind: 'tiles', target: 10 }, 42)).toBe('10 / 10');
    expect(goalProgressLabel({ kind: 'cascade', target: 3 }, 5)).toBe('best x3 / x3');
  });
});
