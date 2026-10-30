/**
 * Every visual is generated at runtime — no image assets.
 *
 * Candies are rendered smooth: a shape function is sampled into an occupancy
 * mask, a chamfer distance transform gives the true distance to the silhouette,
 * and lighting is evaluated continuously from it. No pixel lattice, no
 * quantisation — they read as glossy vector candy next to the crisp HUD text.
 *
 * The *pixel* look belongs to the effects layer instead: `makePixelCanvas`
 * backs the shatter fragments and the mosaic that assembles into a motif, and
 * those stay hard-edged and nearest-sampled on purpose. That contrast — smooth
 * candies, pixel debris — is what makes the shatter read as a transformation.
 */

export interface CandySkin {
  readonly name: string;
  readonly base: string;
  readonly glow: string;
}

export const CANDY_SKINS: readonly CandySkin[] = [
  { name: 'Cherry', base: '#ff3b5c', glow: '#ff98ac' },
  { name: 'Tangerine', base: '#ff8a2b', glow: '#ffc98a' },
  { name: 'Lemon', base: '#ffd63d', glow: '#fff2a8' },
  { name: 'Lime', base: '#3ddc68', glow: '#a6f5bd' },
  { name: 'Berry', base: '#3aa0ff', glow: '#a8d6ff' },
  { name: 'Grape', base: '#b16bff', glow: '#dcc0ff' },
  { name: 'Bubble', base: '#22e0d6', glow: '#a2f7f2' },
];

/** Texture edge length. ~1.7x the largest cell the board can ask for at 2x DPR. */
export const CANDY_TEXTURE_SIZE = 256;

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [12, 8, 26];
const WHITE: Rgb = [255, 255, 255];
const SQRT2 = Math.SQRT2;

/* ------------------------------------------------------------------ colour */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blend(from: Rgb, to: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k,
  ];
}

/* ------------------------------------------------------------------ shapes */

type ShapeFn = (u: number, v: number) => boolean;

const inCircle = (cx: number, cy: number, r: number): ShapeFn => (u, v) => {
  const du = u - cx;
  const dv = v - cy;
  return du * du + dv * dv <= r * r;
};

const roundedSquare = (half: number, corner: number): ShapeFn => (u, v) => {
  const du = Math.abs(u - 0.5);
  const dv = Math.abs(v - 0.52);
  if (du > half || dv > half) return false;
  const cu = du - (half - corner);
  const cv = dv - (half - corner);
  if (cu > 0 && cv > 0) return cu * cu + cv * cv <= corner * corner;
  return true;
};

/** Straight-sided n-point star, one point facing up. */
const star = (points: number, outer: number, inner: number): ShapeFn => (u, v) => {
  const dx = u - 0.5;
  const dy = v - 0.52;
  const r = Math.hypot(dx, dy);
  if (r > outer) return false;
  const seg = Math.PI / points; // one point -> valley half-period
  const theta = (Math.atan2(dy, dx) + Math.PI * 2.5) % (2 * seg); // shift so a point faces up
  const t = theta / seg; // 0..2
  const f = t <= 1 ? t : 2 - t; // 0 at a point, 1 at a valley
  return r <= outer + (inner - outer) * f;
};

/** Flat-sided hexagon: straight shoulders tapering to flat top/bottom. */
const hexagon = (w: number, h: number): ShapeFn => (u, v) => {
  const du = Math.abs(u - 0.5);
  const dv = Math.abs(v - 0.52);
  if (du > w || dv > h) return false;
  const shoulder = h * 0.45;
  if (dv <= shoulder) return true;
  return du <= w * (1 - (dv - shoulder) / (h - shoulder));
};

const heart: ShapeFn = (u, v) => {
  const x = (u - 0.5) * 2.35;
  const y = -(v - 0.56) * 2.35;
  const t = x * x + y * y - 1;
  return t * t * t - x * x * y * y * y <= 0;
};

/** Classic teardrop: round body with a tapered tip. */
const droplet: ShapeFn = (u, v) => {
  const du = u - 0.5;
  const cy = 0.6;
  const r = 0.36;
  if (du * du + (v - cy) * (v - cy) <= r * r) return true;
  const tipY = 0.1;
  const joinY = cy - r * 0.42;
  if (v < tipY || v > joinY) return false;
  return Math.abs(du) <= r * 0.78 * ((v - tipY) / (joinY - tipY));
};

/** kind index -> silhouette. Kinds actually used by levels must be readable by
 * shape alone, so the board stays playable without relying on colour. */
const SHAPES: readonly ShapeFn[] = [
  inCircle(0.5, 0.52, 0.44), // orb
  roundedSquare(0.42, 0.16), // cube
  star(5, 0.47, 0.22), // star
  droplet, // teardrop
  hexagon(0.44, 0.44), // gem
  heart, // heart
  roundedSquare(0.34, 0.3), // lozenge (7th colour, if a level uses it)
];

/* ------------------------------------------------------------- pixel candy */

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Two-pass chamfer distance transform over the occupancy mask: for every inside
 * pixel, the distance in pixels to the nearest outside pixel. This is what lets
 * the outline, the rim light and the antialiased edge all be derived from real
 * geometry instead of being painted on.
 */
function distanceField(inside: Uint8Array, size: number): Float32Array {
  const inf = size * 4;
  const dist = new Float32Array(size * size).fill(inf);
  for (let i = 0; i < inside.length; i++) if (!inside[i]) dist[i] = 0;

  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= size || y >= size ? inf : (dist[y * size + x] as number);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!inside[i]) continue;
      dist[i] = Math.min(
        at(x, y),
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + SQRT2,
        at(x + 1, y - 1) + SQRT2,
      );
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (!inside[i]) continue;
      dist[i] = Math.min(
        at(x, y),
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x - 1, y + 1) + SQRT2,
        at(x + 1, y + 1) + SQRT2,
      );
    }
  }
  return dist;
}

/** 3x3 coverage of the pixel at `x,y`, used only on boundary pixels. */
function coverage(shape: ShapeFn, size: number, x: number, y: number): number {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    const v = (y + (sy + 0.5) / 3) / size;
    for (let sx = 0; sx < 3; sx++) {
      if (shape((x + (sx + 0.5) / 3) / size, v)) hits++;
    }
  }
  return hits / 9;
}

/**
 * Render one candy, smooth, into a `size x size` canvas.
 *
 * Lighting is a single top-left key light: a continuous Lambert falloff for the
 * body, a distance-derived dark outline, a rim light on the surfaces facing the
 * key, and one broad specular highlight.
 */
export function makeCandyCanvas(kind: number, size: number = CANDY_TEXTURE_SIZE): HTMLCanvasElement {
  const skin = CANDY_SKINS[kind % CANDY_SKINS.length] as CandySkin;
  const shape = SHAPES[kind % SHAPES.length] as ShapeFn;
  const S = Math.max(24, Math.round(size));

  const base = hexToRgb(skin.base);
  const glow = hexToRgb(skin.glow);

  const out = canvasOf(S, S);
  const octx = out.getContext('2d');
  if (!octx) throw new Error('2d context unavailable');

  const inside = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      inside[y * S + x] = shape((x + 0.5) / S, v) ? 1 : 0;
    }
  }

  const dist = distanceField(inside, S);
  const outlineW = Math.max(1.5, S * 0.032);
  const rimW = Math.max(1.5, S * 0.028);

  const solid = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= S || y >= S ? 0 : (inside[y * S + x] as number);
  const near = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= S || y >= S ? 0 : (dist[y * S + x] as number);

  const img = octx.createImageData(S, S);
  const data = img.data;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (!inside[i]) continue;

      // Antialias only where the silhouette actually cuts a pixel.
      const interior = solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1);
      const alpha = interior ? 1 : coverage(shape, S, x, y);
      if (alpha <= 0) continue;

      const d = near(x, y);
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;

      // Continuous Lambert falloff from the key light.
      const dl = Math.hypot(u - 0.3, v - 0.26) / 1.05;
      const lum = clamp01((1.02 - dl * 0.92 - 0.12) / 0.72);
      let rgb = blend(base, BLACK, 0.62 * (1 - lum));
      rgb = blend(rgb, glow, 0.16 * lum);

      // Broad specular highlight, smooth rather than a cluster of lit pixels.
      const spec = smoothstep(1 - Math.hypot(u - 0.3, v - 0.26) / 0.24);
      rgb = blend(rgb, WHITE, 0.7 * spec);

      // Rim light on surfaces turned toward the key, sitting just inside the
      // outline so the silhouette keeps its bite.
      const facesKey = near(x, y - 1) < near(x, y + 1) - 0.5 || near(x - 1, y) < near(x + 1, y) - 0.5;
      if (facesKey && d > outlineW && d < outlineW + rimW) {
        rgb = blend(rgb, glow, 0.75 * smoothstep((outlineW + rimW - d) / rimW));
      }

      // Outline: darken toward the silhouette edge, eased so it has no hard step.
      if (d < outlineW) {
        rgb = blend(rgb, BLACK, 0.82 * smoothstep((outlineW - d) / outlineW));
      }

      const o = i * 4;
      data[o] = Math.round(rgb[0]);
      data[o + 1] = Math.round(rgb[1]);
      data[o + 2] = Math.round(rgb[2]);
      data[o + 3] = Math.round(alpha * 255);
    }
  }

  octx.putImageData(img, 0, 0);
  return out;
}

/**
 * Crisp square with a thin dark rim — the universal particle pixel. This is the
 * one place the hard pixel grid is meant to survive: shatter fragments and
 * mosaic pixels. The rim is deliberately slim, because mosaic pixels tile
 * edge-to-edge and a fat rim would turn an assembled motif into a dotted matrix.
 */
export function makePixelCanvas(size = 14): HTMLCanvasElement {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const rim = Math.max(1, Math.round(size * 0.08));
  ctx.fillStyle = '#0d0820';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(rim, rim, size - rim * 2, size - rim * 2);
  return c;
}

/** Feathered dark plate used to seat a motif against the board behind it. */
export function makeSoftRectCanvas(size = 128): HTMLCanvasElement {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.52);
  g.addColorStop(0, 'rgba(9,5,22,0.94)');
  g.addColorStop(0.72, 'rgba(9,5,22,0.78)');
  g.addColorStop(1, 'rgba(9,5,22,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/** Soft radial dot for additive glow / sparks. */
export function makeSparkCanvas(size = 48): HTMLCanvasElement {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
