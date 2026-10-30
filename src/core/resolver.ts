import type { Board } from './board';
import type { Rng } from './rng';
import { roundParts, roundScore } from './scoring';
import type { Cell, Resolution, Round } from './types';

/**
 * Clear -> collapse -> refill, repeatedly, until the board is quiet.
 *
 * The whole resolution is simulated up-front (the board ends in its final
 * state) and handed back as an ordered script the renderer plays back. Keeping
 * simulation and presentation apart means the rules can be unit-tested without
 * a browser, and the view can never desync from the model.
 */
/**
 * Hard ceiling on cascade depth. Real cascades settle in well under ten rounds,
 * so hitting this means the resolution stopped making progress. It exists so
 * that a future rules bug degrades into a truncated cascade instead of an
 * unbounded loop that freezes the tab.
 */
const MAX_CASCADE = 100;

export function resolveBoard(board: Board, rng: Rng): Resolution {
  const rounds: Round[] = [];
  let score = 0;
  let biggestGroup = 0;
  let clearedCount = 0;

  for (let cascade = 1; cascade <= MAX_CASCADE; cascade++) {
    const groups = board.findMatches();
    if (groups.length === 0) break;

    // Deduplicate within THIS round only. An L or T puts one cell into a
    // horizontal and a vertical run, so the same index can legitimately appear
    // twice per round — but after a refill that same index holds a brand-new
    // tile which may well match again in a later round. Carrying the set across
    // rounds would skip clearing it, leaving matched tiles on the board while
    // the loop spun forever looking for progress that could never come.
    const seenThisRound = new Set<number>();
    const cleared: Cell[] = [];
    const clearedHere: number[] = [];
    for (const g of groups) {
      biggestGroup = Math.max(biggestGroup, g.cells.length);
      for (const c of g.cells) {
        const i = board.idx(c.x, c.y);
        if (seenThisRound.has(i)) continue;
        seenThisRound.add(i);
        clearedHere.push(i);
        cleared.push(c);
      }
    }

    // A match always yields at least one cell, so this is unreachable today;
    // it is the belt-and-braces that makes "clear nothing" impossible to loop on.
    if (clearedHere.length === 0) break;

    const roundScoreValue = roundScore(groups, cascade);
    score += roundScoreValue;

    board.clearCells(clearedHere);
    const falls = [...board.collapse(), ...board.spawnIncoming(rng)];
    clearedCount += clearedHere.length;

    rounds.push({
      cascade,
      groups,
      cleared,
      score: roundScoreValue,
      parts: roundParts(groups, cascade),
      falls,
    });
  }

  return {
    rounds,
    clearedCount,
    maxCascade: rounds.length,
    score,
    biggestGroup,
  };
}

/** True when `a`/`b` swapped would create at least one match. Leaves board untouched. */
export function swapCreatesMatch(board: Board, a: number, b: number): boolean {
  if (!board.areAdjacent(a, b)) return false;
  board.swapCells(a, b);
  const ok = board.findMatches().length > 0;
  board.swapCells(a, b);
  return ok;
}
