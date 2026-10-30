/**
 * Pixel-art motif library.
 *
 * Cleared candy rains down and assembles into one of these. Higher tiers are
 * literally bigger: tiers 1-3 use hand-authored grids at 5/7/9 cells wide,
 * tiers 4-5 wrap a tier-3 motif in a generated frame so a long cascade
 * visibly produces a larger, more decorated picture.
 */

export type Tier = 1 | 2 | 3 | 4 | 5;

/** Highest motif tier; also the deepest cascade tier the scorer can award. */
export const MAX_TIER: Tier = 5;

export interface PixelPattern {
  readonly name: string;
  readonly rows: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
}

export interface Motif {
  readonly name: string;
  readonly tier: Tier;
  readonly rows: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
}

const EMPTY = '.';

/* ------------------------------------------------------------------ tier 1 */

const TIER1: readonly PixelPattern[] = [
  {
    name: 'Heart',
    rows: ['rr.rr', 'rrrrr', 'rrrrr', '.rrr.', '..r..'],
    palette: { r: '#ff4d6d', l: '#ffd7de' },
  },
  {
    name: 'Sparkle',
    rows: ['..s..', '..s..', 'sssss', '..s..', '..s..'],
    palette: { s: '#fff6c9' },
  },
  {
    name: 'Bubble',
    rows: ['.ddd.', 'dlldd', 'dllld', 'ddddd', '.ddd.'],
    palette: { d: '#4fc3f7', l: '#e3f7ff' },
  },
  {
    name: 'Cherry',
    rows: ['..g..', '.g.g.', 'rr.rr', 'rr.rr'],
    palette: { g: '#5fd06b', r: '#ef3e5d' },
  },
  {
    name: 'Gem',
    rows: ['.ggg.', 'glllg', 'glllg', '.lll.', '..l..'],
    palette: { g: '#26c6da', l: '#b9f4ff' },
  },
];

/* ------------------------------------------------------------------ tier 2 */

const TIER2: readonly PixelPattern[] = [
  {
    name: 'Mushroom',
    rows: [
      '.rrrrr.',
      'rwrrrwr',
      'rrrrrrr',
      '..sss..',
      '..sys..',
      '..sss..',
      '.sssss.',
    ],
    palette: { r: '#ef3e5d', w: '#fff2f2', s: '#f5deb0', y: '#c98b4b' },
  },
  {
    name: 'Flower',
    rows: [
      '.p...p.',
      'pp.p.pp',
      '.ppppp.',
      '.pyyyp.',
      '.ppppp.',
      'pp.p.pp',
      '.p...p.',
    ],
    palette: { p: '#c77dff', y: '#ffd166' },
  },
  {
    name: 'Cat',
    rows: [
      'k.....k',
      'kk...kk',
      'kkkkkkk',
      'kwkkkwk',
      'kkkdkkk',
      '.kkkkk.',
      '..k.k..',
    ],
    palette: { k: '#ffb703', w: '#2b2118', d: '#ff7b9c' },
  },
  {
    name: 'Invader',
    rows: [
      'x.....x',
      '.x...x.',
      'xxxxxxx',
      'x.xxx.x',
      'xxxxxxx',
      '..x.x..',
      '.x...x.',
    ],
    palette: { x: '#5eead4' },
  },
  {
    name: 'Apple',
    rows: [
      '...g...',
      '..ggg..',
      '.laaaa.',
      '.aaaaa.',
      'aaaaaaa',
      'aaaaaaa',
      '.aaaaa.',
    ],
    palette: { g: '#4caf50', a: '#ff5252', l: '#ffd2d2' },
  },
];

/* ------------------------------------------------------------------ tier 3 */

const TIER3: readonly PixelPattern[] = [
  {
    name: 'Crown',
    rows: [
      '.y..y..y.',
      '.y..y..y.',
      'yy.yyy.yy',
      'yyyyyyyyy',
      'yryryryry',
      'yyyyyyyyy',
      '.yyyyyyy.',
    ],
    palette: { y: '#ffd166', r: '#ef3e5d' },
  },
  {
    name: 'Ghost',
    rows: [
      '..wwwww..',
      '.wwwwwww.',
      'wwbbwbbww',
      'wwbbwbbww',
      'wwwwwwwww',
      'wwmmmmmww',
      'wwwwwwwww',
      'w.w.w.w.w',
    ],
    palette: { w: '#eef3ff', b: '#2b3a67', m: '#3d4f80' },
  },
  {
    name: 'Rocket',
    rows: [
      '....r....',
      '...rrr...',
      '..rrbrr..',
      '..rrbrr..',
      '.rrrrrrr.',
      'frrrrrrrf',
      'ffrrrrrff',
      '...ooo...',
      '..o...o..',
    ],
    palette: { r: '#e8ecf5', b: '#4fc3f7', f: '#ef3e5d', o: '#ffa62b' },
  },
  {
    name: 'Tree',
    rows: [
      '....g....',
      '...ggg...',
      '..gmgmg..',
      '.ggggggg.',
      '..ggggg..',
      '.gmgggmg.',
      'ggggggggg',
      '...bdb...',
      '...bdb...',
    ],
    palette: { g: '#3ec46d', m: '#ffd166', b: '#a06a3c', d: '#7a4a26' },
  },
  {
    name: 'Skull',
    rows: [
      '.wwwwwww.',
      'wwwwwwwww',
      'wwbbwbbww',
      'wwbbwbbww',
      'wwwwdwwww',
      '.wwwwwww.',
      'w.w.w.w.w',
      '.wwwwwww.',
    ],
    palette: { w: '#f2f5ff', b: '#20233a', d: '#8ea2c9' },
  },
];

/* ------------------------------------------------------------------ frames */

const FRAME_ACCENT = ['#ffe66d', '#7ce7ff', '#ff9ec7', '#b6ff8f', '#ffb86b'] as const;
const FRAME_INNER = ['#3a2d5e', '#1f2a44', '#402448', '#233047', '#3d2a4f'] as const;

/** Grid chars reserved for generated frame pixels. */
const CH_SPARK = '*';
const CH_ACCENT = 'a';
const CH_INNER = 'i';

/**
 * Surround a motif with `pad` rings of frame pixels: outer ring in the bright
 * accent, inner rings in a deep tint, with sparkles on corners and edge
 * midpoints. Keeps the hand-authored art as the hero while making high tiers
 * physically larger.
 */
function ringFrame(rows: readonly string[], pad: number): string[] {
  const w = (rows[0]?.length ?? 0) + pad * 2;
  const h = rows.length + pad * 2;
  const midX = (w - 1) / 2;
  const midY = (h - 1) / 2;
  const out: string[] = [];

  for (let y = 0; y < h; y++) {
    let line = '';
    for (let x = 0; x < w; x++) {
      const inner = rows[y - pad];
      const stamped = inner !== undefined ? inner[x - pad] : undefined;
      if (stamped !== undefined && stamped !== EMPTY) {
        line += stamped;
        continue;
      }
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge >= pad) {
        line += EMPTY;
        continue;
      }
      const onBorder = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const onMid =
        ((y === 0 || y === h - 1) && Math.abs(x - midX) < 1) ||
        ((x === 0 || x === w - 1) && Math.abs(y - midY) < 1);
      line += onBorder || onMid ? CH_SPARK : pad > 1 && edge > 0 ? CH_INNER : CH_ACCENT;
    }
    out.push(line);
  }
  return out;
}

function baseFor(tier: Tier, index: number): { base: PixelPattern; pad: number } {
  if (tier === 1) return { base: pickAt(TIER1, index), pad: 0 };
  if (tier === 2) return { base: pickAt(TIER2, index), pad: 0 };
  // Tiers 1/2/3 are bare 5/7/9-wide art; 4 and 5 add 1 or 2 frame rings,
  // landing on 11 and 13 wide (MAX_MOTIF_WIDTH).
  if (tier === 3) return { base: pickAt(TIER3, index), pad: 0 };
  return { base: pickAt(TIER3, index), pad: tier === 4 ? 1 : 2 };
}

function pickAt(list: readonly PixelPattern[], index: number): PixelPattern {
  return list[Math.abs(index) % list.length] as PixelPattern;
}

function countPixels(rows: readonly string[]): number {
  let n = 0;
  for (const row of rows) for (const ch of row) if (ch !== EMPTY) n++;
  return n;
}

/** Build the concrete motif for a tier. `index` selects within the tier. */
export function buildMotif(tier: Tier, index: number): Motif {
  const { base, pad } = baseFor(tier, index);
  const accent = FRAME_ACCENT[Math.abs(index) % FRAME_ACCENT.length] as string;
  const inner = FRAME_INNER[Math.abs(index) % FRAME_INNER.length] as string;
  const rows = pad > 0 ? ringFrame(base.rows, pad) : [...base.rows];
  const palette: Record<string, string> = { ...base.palette };
  if (pad > 0) {
    palette[CH_SPARK] = '#ffffff';
    palette[CH_ACCENT] = accent;
    palette[CH_INNER] = inner;
  }
  const name = pad > 0 ? `Gilded ${base.name}` : base.name;
  return {
    name,
    tier,
    rows,
    palette,
    width: rows[0]?.length ?? 0,
    height: rows.length,
    pixelCount: countPixels(rows),
  };
}

export const MAX_MOTIF_WIDTH = 13;

/** Every authored motif, for the help screen and art sanity checks. */
export function allMotifs(): Motif[] {
  const out: Motif[] = [];
  for (let tier = 1; tier <= 3; tier++) {
    const count = [TIER1.length, TIER2.length, TIER3.length][tier - 1] as number;
    for (let i = 0; i < count; i++) out.push(buildMotif(tier as Tier, i));
  }
  return out;
}

export function tierLabel(tier: Tier): string {
  const labels: Record<Tier, string> = {
    1: 'PIXEL',
    2: 'SPRITE',
    3: 'MOTIF',
    4: 'GILDED MOTIF',
    5: 'GRAND MOTIF',
  };
  return labels[tier];
}
