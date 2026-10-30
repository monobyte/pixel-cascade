import { describe, expect, it } from 'vitest';
import { boardFromRows } from '../src/core/board';
import { MAX_TIER } from '../src/core/patterns';
import { createRng } from '../src/core/rng';
import { resolveBoard } from '../src/core/resolver';
import {
  CASCADE_MULTIPLIERS,
  cascadeMultiplier,
  groupScore,
  mosaicBonus,
  mosaicPower,
  mosaicTier,
  roundParts,
  roundScore,
  sizeBonus,
  starsFor,
} from '../src/core/scoring';

function groupsOf(rows: readonly string[], kindCount = 6) {
  return boardFromRows(rows, kindCount).findMatches();
}

describe('scoring', () => {
  it('pays a flat rate for a bare three', () => {
    const g = groupsOf(['.....', '.111.', '.....', '.....', '.....'])[0];
    expect(g).toBeDefined();
    expect(groupScore(g!, 1)).toBe(90);
    expect(sizeBonus(3)).toBe(0);
  });

  it('rewards long runs quadratically', () => {
    expect(sizeBonus(2)).toBe(0);
    expect(sizeBonus(3)).toBe(0);
    expect(sizeBonus(4)).toBe(45);
    expect(sizeBonus(5)).toBe(180);
    expect(sizeBonus(6)).toBe(405);
    const g = groupsOf(['11111', '.....', '.....', '.....', '.....'])[0];
    expect(groupScore(g!, 1)).toBe(5 * 30 + 180);
  });

  it('scales monotonically with cascade depth', () => {
    const g = groupsOf(['.....', '.111.', '.....', '.....', '.....'])[0];
    let prev = 0;
    for (let c = 1; c <= CASCADE_MULTIPLIERS.length; c++) {
      const s = groupScore(g!, c);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
    expect(cascadeMultiplier(1)).toBe(1);
    expect(cascadeMultiplier(99)).toBe(CASCADE_MULTIPLIERS[CASCADE_MULTIPLIERS.length - 1]);
  });

  it('sums every group in a round', () => {
    const gs = groupsOf(['111..', '.....', '222..', '.....', '.....']);
    expect(gs).toHaveLength(2);
    expect(roundScore(gs, 1)).toBe(groupScore(gs[0]!, 1) + groupScore(gs[1]!, 1));
  });

  it('describes rounds with human-readable parts', () => {
    const gs = groupsOf(['111..', '.....', '222..', '.....', '.....']);
    const parts = roundParts(gs, 3);
    expect(parts.some((p) => p.label.includes('groups'))).toBe(true);
    expect(parts.some((p) => p.label.includes('Cascade'))).toBe(true);
    expect(roundParts(groupsOf(['111..', '.....', '.....', '.....', '.....']), 1)).toHaveLength(0);
  });

  it('escalates motif tier with cascade depth and volume', () => {
    expect(mosaicTier(mosaicPower(3, 1, 3))).toBe(1);
    expect(mosaicTier(mosaicPower(12, 1, 4))).toBe(2);
    expect(mosaicTier(mosaicPower(14, 2, 5))).toBe(3);
    expect(mosaicTier(mosaicPower(22, 3, 4))).toBe(4);
    expect(mosaicTier(mosaicPower(40, 6, 8))).toBe(MAX_TIER);
    for (let cleared = 3; cleared < 60; cleared++) {
      for (let cascade = 1; cascade < 8; cascade++) {
        const t = mosaicTier(mosaicPower(cleared, cascade, 3));
        expect(t).toBeGreaterThanOrEqual(1);
        expect(t).toBeLessThanOrEqual(MAX_TIER);
      }
    }
  });

  it('pays more for grander motifs', () => {
    expect(mosaicBonus(1)).toBeLessThan(mosaicBonus(2));
    expect(mosaicBonus(2)).toBeLessThan(mosaicBonus(5));
    expect(mosaicBonus(1)).toBe(100);
  });

  it('grades stars against the target', () => {
    expect(starsFor(900, 1000)).toBe(0);
    expect(starsFor(1000, 1000)).toBe(1);
    expect(starsFor(1450, 1000)).toBe(2);
    expect(starsFor(2100, 1000)).toBe(3);
  });

  it('produces sane totals for a real board', () => {
    const b = boardFromRows(['11122', '22112', '11221', '22112', '11122'], 3);
    const res = resolveBoard(b, createRng(12));
    expect(res.score).toBe(res.rounds.reduce((n, r) => n + r.score, 0));
    expect(res.score).toBeGreaterThan(0);
  });
});
