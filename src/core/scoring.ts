import { MAX_TIER } from './patterns';
import type { MatchGroup, ScorePart } from './types';

/** Per-tile base value before multipliers. */
export const TILE_VALUE = 30;

/** Multiplier applied to a whole round, indexed by (cascade - 1). */
export const CASCADE_MULTIPLIERS = [1, 1.75, 2.75, 4, 5.5, 7.5, 10, 13] as const;

export function cascadeMultiplier(cascade: number): number {
  return CASCADE_MULTIPLIERS[Math.min(cascade, CASCADE_MULTIPLIERS.length) - 1] ?? 1;
}

/** Quadratic reward for long runs: 3→0, 4→45, 5→180, 6→405... */
export function sizeBonus(size: number): number {
  const over = size - 3;
  return over > 0 ? over * over * 45 : 0;
}

export function groupScore(group: MatchGroup, cascade: number): number {
  const raw = group.cells.length * TILE_VALUE + sizeBonus(group.cells.length);
  return Math.round(raw * cascadeMultiplier(cascade));
}

/** Human-readable breakdown for the score popup / results screen. */
export function roundParts(groups: readonly MatchGroup[], cascade: number): ScorePart[] {
  const parts: ScorePart[] = [];
  let totalTiles = 0;
  let best: MatchGroup | null = null;
  for (const g of groups) {
    totalTiles += g.cells.length;
    if (!best || g.cells.length > best.cells.length) best = g;
  }
  if (groups.length > 1) {
    parts.push({ label: `${groups.length} groups`, value: totalTiles * TILE_VALUE });
  }
  if (best && best.cells.length > 3) {
    parts.push({ label: `Best x${best.cells.length}`, value: sizeBonus(best.cells.length) });
  }
  const mult = cascadeMultiplier(cascade);
  if (cascade > 1) parts.push({ label: `Cascade x${cascade}`, value: Math.round(mult * 100) });
  return parts;
}

export function roundScore(groups: readonly MatchGroup[], cascade: number): number {
  let sum = 0;
  for (const g of groups) sum += groupScore(g, cascade);
  return sum;
}

/** Bonus for summoning a pixel motif; scales with how elaborate it is. */
export function mosaicBonus(tier: number): number {
  return 100 + Math.max(0, tier - 1) * 150;
}

/**
 * Higher power = bigger / more detailed motif. Combines cascade depth with
 * raw volume so both a long chain and one huge group feel rewarding.
 */
export function mosaicPower(totalCleared: number, maxCascade: number, biggestGroup: number): number {
  return totalCleared + (maxCascade - 1) * 9 + Math.max(0, biggestGroup - 3) * 4;
}

export function mosaicTier(power: number): number {
  if (power < 10) return 1;
  if (power < 20) return 2;
  if (power < 32) return 3;
  if (power < 50) return 4;
  return MAX_TIER;
}

/** Stars for the level-complete screen. */
export function starsFor(score: number, target: number): 0 | 1 | 2 | 3 {
  if (score >= target * 2) return 3;
  if (score >= target * 1.4) return 2;
  if (score >= target) return 1;
  return 0;
}
