import { Container, Sprite, Texture } from 'pixi.js';

export interface BackgroundTheme {
  readonly top: string;
  readonly mid: string;
  readonly bottom: string;
  readonly dust: string;
}

export const THEMES: readonly BackgroundTheme[] = [
  { top: '#1b1040', mid: '#2b1360', bottom: '#0d0722', dust: '#8f7bff' },
  { top: '#0d2a4a', mid: '#123a63', bottom: '#061223', dust: '#66d9ff' },
  { top: '#3a1030', mid: '#5c1747', bottom: '#150618', dust: '#ff9ec7' },
  { top: '#0f3330', mid: '#14514a', bottom: '#04140f', dust: '#8ff5c0' },
  { top: '#2a1a05', mid: '#4a2c07', bottom: '#160c02', dust: '#ffcf7a' },
];

interface Dust {
  sprite: Sprite;
  vx: number;
  vy: number;
  twinkle: number;
  seed: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Ambient layer: a soft three-stop vertical gradient plus a slow parallax
 * drift of chunky pixels. Deliberately cheap — one quad and ~70 sprites.
 */
export class BackgroundLayer {
  readonly container = new Container();

  private readonly gradient: Sprite;
  private readonly vignette: Sprite;
  private readonly dustLayer = new Container();
  private readonly dust: Dust[] = [];
  private readonly dustTex: Texture;
  private w = 1;
  private h = 1;
  private theme: BackgroundTheme = THEMES[0] as BackgroundTheme;

  constructor(dustTex: Texture) {
    this.dustTex = dustTex;
    this.gradient = new Sprite(makeGradientTexture(this.theme));
    this.gradient.anchor.set(0);
    this.vignette = new Sprite(makeVignetteTexture());
    this.vignette.anchor.set(0);
    this.container.addChild(this.gradient, this.dustLayer, this.vignette);
    this.dustLayer.blendMode = 'add';
  }

  resize(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.gradient.width = this.w;
    this.gradient.height = this.h;
    this.vignette.width = this.w;
    this.vignette.height = this.h;
    this.seedDust();
  }

  setTheme(index: number): void {
    const next = THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length] as BackgroundTheme;
    if (next === this.theme) return;
    this.theme = next;
    this.gradient.texture.destroy(true);
    this.gradient.texture = makeGradientTexture(next);
    const tint = parseInt(next.dust.slice(1), 16);
    for (const d of this.dust) d.sprite.tint = tint;
  }

  private seedDust(): void {
    for (const d of this.dust) d.sprite.destroy();
    this.dust.length = 0;
    const count = 70;
    const tint = parseInt(this.theme.dust.slice(1), 16);
    for (let i = 0; i < count; i++) {
      const s = new Sprite(this.dustTex);
      s.anchor.set(0.5);
      const size = 2 + Math.random() * 5;
      s.scale.set(size / 48);
      s.x = Math.random() * this.w;
      s.y = Math.random() * this.h;
      s.alpha = 0.12 + Math.random() * 0.4;
      s.tint = tint;
      this.dustLayer.addChild(s);
      this.dust.push({
        sprite: s,
        vx: (Math.random() - 0.5) * 0.012,
        vy: -0.005 - Math.random() * 0.018,
        twinkle: 0.5 + Math.random(),
        seed: Math.random() * 100,
      });
    }
  }

  update(dt: number, t: number): void {
    const frame = Math.min(dt, 48);
    for (const d of this.dust) {
      d.sprite.x += d.vx * frame;
      d.sprite.y += d.vy * frame;
      if (d.sprite.y < -20) {
        d.sprite.y = this.h + 20;
        d.sprite.x = Math.random() * this.w;
      }
      if (d.sprite.x < -20) d.sprite.x = this.w + 20;
      else if (d.sprite.x > this.w + 20) d.sprite.x = -20;
      d.sprite.alpha = 0.16 + 0.34 * (0.5 + 0.5 * Math.sin(t * 0.0012 * d.twinkle + d.seed));
    }
  }

  destroy(): void {
    for (const d of this.dust) d.sprite.destroy();
    this.dust.length = 0;
    this.gradient.texture.destroy(true);
    this.vignette.texture.destroy(true);
    this.container.destroy({ children: true });
  }
}

function makeGradientTexture(theme: BackgroundTheme): Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  const [tr, tg, tb] = hexToRgb(theme.top);
  const [mr, mg, mb] = hexToRgb(theme.mid);
  const [br, bg, bb] = hexToRgb(theme.bottom);
  g.addColorStop(0, `rgb(${tr},${tg},${tb})`);
  g.addColorStop(0.55, `rgb(${mr},${mg},${mb})`);
  g.addColorStop(1, `rgb(${br},${bg},${bb})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return Texture.from(c);
}

function makeVignetteTexture(): Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}
