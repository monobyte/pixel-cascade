/** Level definitions. Goals are AND-ed and must all be met inside `moves`. */

export type GoalKind = 'score' | 'tiles' | 'mosaics' | 'cascade';

export interface Goal {
  readonly kind: GoalKind;
  readonly target: number;
}

export interface LevelDef {
  readonly id: number;
  readonly name: string;
  readonly subtitle: string;
  readonly width: number;
  readonly height: number;
  readonly kinds: number;
  readonly moves: number;
  readonly goals: readonly Goal[];
  readonly hint: string;
}

export const GOAL_LABELS: Record<GoalKind, (target: number) => string> = {
  score: (t) => `Score ${t.toLocaleString()}`,
  tiles: (t) => `Clear ${t} tiles`,
  mosaics: (t) => `Summon ${t} pixel motif${t === 1 ? '' : 's'}`,
  cascade: (t) => `Chain a x${t} cascade`,
};

export function goalProgressLabel(goal: Goal, progress: number): string {
  const p = Math.min(progress, goal.target);
  const formatters: Record<GoalKind, () => string> = {
    score: () => `${p.toLocaleString()} / ${goal.target.toLocaleString()}`,
    tiles: () => `${p} / ${goal.target}`,
    mosaics: () => `${p} / ${goal.target}`,
    cascade: () => `best x${p} / x${goal.target}`,
  };
  return formatters[goal.kind]();
}

export const LEVELS: readonly LevelDef[] = [
  {
    id: 1,
    name: 'Sugar Meadow',
    subtitle: 'Learn the swap',
    width: 8,
    height: 8,
    kinds: 5,
    moves: 18,
    goals: [{ kind: 'score', target: 1500 }],
    hint: 'Drag a candy onto a neighbour. Line up 3 or more of the same colour.',
  },
  {
    id: 2,
    name: 'Pixel Rain',
    subtitle: 'Shatter quota',
    width: 8,
    height: 8,
    kinds: 5,
    moves: 20,
    goals: [{ kind: 'tiles', target: 45 }],
    hint: 'Big groups shatter into more pixels — and build bigger motifs.',
  },
  {
    id: 3,
    name: 'Prism Reef',
    subtitle: 'Chase cascades',
    width: 9,
    height: 9,
    kinds: 6,
    moves: 22,
    goals: [
      { kind: 'score', target: 4000 },
      { kind: 'cascade', target: 3 },
    ],
    hint: 'A cascade multiplies every point. Set up drops that match twice.',
  },
  {
    id: 4,
    name: 'Mosaic Temple',
    subtitle: 'Motif collector',
    width: 9,
    height: 9,
    kinds: 6,
    moves: 24,
    goals: [
      { kind: 'mosaics', target: 5 },
      { kind: 'score', target: 3500 },
    ],
    hint: 'Only tier-2 motifs and up count toward the mosaic goal.',
  },
  {
    id: 5,
    name: 'Rainbow Spire',
    subtitle: 'Final ascent',
    width: 10,
    height: 10,
    kinds: 6,
    moves: 26,
    goals: [
      { kind: 'score', target: 9000 },
      { kind: 'mosaics', target: 4 },
      { kind: 'cascade', target: 4 },
    ],
    hint: 'Everything at once. Long chains are the only way through.',
  },
];

/** How much progress a resolution contributes to each goal kind. */
export function goalValue(
  goal: Goal,
  stats: {
    score: number;
    tilesCleared: number;
    /** Only motifs at tier >= 2 count, so the goal asks for something real. */
    bigMosaics: number;
    bestCascade: number;
  },
): number {
  const table: Record<GoalKind, number> = {
    score: stats.score,
    tiles: stats.tilesCleared,
    mosaics: stats.bigMosaics,
    cascade: stats.bestCascade,
  };
  return table[goal.kind];
}
