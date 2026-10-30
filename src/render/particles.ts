import { Container, Sprite, Texture } from 'pixi.js';
import type { Motif } from '../core/patterns';
import { easings } from './tweener';

type Phase = 'fall' | 'seek' | 'hold' | 'exit';

interface Particle {
  active: boolean;
  sprite: Sprite;
  mode: 'shard' | 'spark' | 'mosaic';
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  baseSize: number;
  rot: number;
  spin: number;
  t: number;
  life: number;
  gravity: number;
  drag: number;
  alpha0: number;
  // mosaic
  tx: number;
  ty: number;
  phase: Phase;
  tSeek: number;
  tHold: number;
  tExit: number;
  seed: number;
  shimmer: number;
  owner: Pending | null;
  countedLanded: boolean;
}

export interface ShatterOptions {
  count?: number;
  size?: number;
  speed?: number;
  spread?: number;
  gravity?: number;
  life?: number;
  /** Bias the burst upward/outward, e.g. after a clear. */
  upkick?: number;
}

export interface MosaicOptions {
  /** World-space centre of the assembled motif. */
  cx: number;
  cy: number;
  pixel: number;
  /** Where the pixels rain out from — usually the cleared cells. */
  sources: ReadonlyArray<{ x: number; y: number }>;
  rainMs?: number;
  assembleMs?: number;
  holdMs?: number;
  exitMs?: number;
  /** Called when every pixel has landed (input can already be live by then). */
  onAssembled?: () => void;
}

export interface MosaicHandle {
  readonly motif: Motif;
  readonly assembled: Promise<void>;
  readonly done: Promise<void>;
}

interface Pending {
  total: number;
  landed: number;
  retired: number;
  assembledFired: boolean;
  resolveAssembled: () => void;
  resolveDone: () => void;
  /** Soft plate behind the motif so it reads against bright candy. */
  plate: Sprite | null;
  elapsed: number;
  fadeIn: number;
  fadeOutAt: number;
  lifeMs: number;
}

const MAX_PARTICLES = 1400;

/**
 * One pooled sprite system for everything that is not a tile: shatter
 * fragments, additive sparks, and the mosaic pixels that assemble into motifs.
 * Single texture + two containers (normal and additive) keeps it to two draws.
 */
export class ParticleField {
  readonly normal = new Container();
  readonly additive = new Container();

  private readonly pixelTex: Texture;
  private readonly sparkTex: Texture;
  private readonly softTex: Texture | null;
  private pool: Particle[] = [];
  private cursor = 0;
  private liveCount = 0;
  private pendings: Pending[] = [];

  constructor(pixelTex: Texture, sparkTex: Texture, softTex: Texture | null = null) {
    this.pixelTex = pixelTex;
    this.sparkTex = sparkTex;
    this.softTex = softTex;
    this.additive.blendMode = 'add';
  }

  get live(): number {
    return this.liveCount;
  }

  /**
   * Take a free slot, growing the pool on demand up to MAX_PARTICLES. Scans
   * forward from `cursor` so frequently recycled slots stay cache-friendly.
   */
  private obtain(): Particle | null {
    const n = this.pool.length;
    for (let i = 0; i < n; i++) {
      const slot = this.pool[(this.cursor + i) % n];
      if (slot && !slot.active) {
        this.cursor = (this.cursor + i + 1) % n;
        return slot;
      }
    }
    if (n >= MAX_PARTICLES) return null;
    const created = this.createParticle();
    this.pool.push(created);
    this.cursor = 0;
    return created;
  }

  private createParticle(): Particle {
    const sprite = new Sprite(this.pixelTex);
    sprite.anchor.set(0.5);
    sprite.visible = false;
    return {
      active: false,
      sprite,
      mode: 'shard',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 4,
      baseSize: 4,
      rot: 0,
      spin: 0,
      t: 0,
      life: 500,
      gravity: 0,
      drag: 0.002,
      alpha0: 1,
      tx: 0,
      ty: 0,
      phase: 'fall',
      tSeek: 0,
      tHold: 0,
      tExit: 0,
      seed: Math.random() * 1000,
      shimmer: 0,
      owner: null,
      countedLanded: false,
    };
  }

  private emit(
    mode: Particle['mode'],
    x: number,
    y: number,
    color: number,
    size: number,
  ): Particle | null {
    const p = this.obtain();
    if (!p) return null;
    p.active = true;
    p.mode = mode;
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.size = size;
    p.baseSize = size;
    p.rot = 0;
    p.spin = 0;
    p.t = 0;
    p.life = 600;
    p.gravity = 0;
    p.drag = 0.0016;
    p.alpha0 = 1;
    p.phase = 'fall';
    p.tSeek = 0;
    p.tHold = 0;
    p.tExit = 0;
    p.shimmer = 0;
    p.owner = null;
    p.countedLanded = false;
    p.seed = Math.random() * 1000;

    const s = p.sprite;
    s.texture = mode === 'spark' ? this.sparkTex : this.pixelTex;
    s.visible = true;
    s.tint = color;
    s.alpha = 1;
    s.rotation = 0;
    s.anchor.set(0.5);
    if (!s.parent) (mode === 'spark' ? this.additive : this.normal).addChild(s);
    this.liveCount++;
    return p;
  }

  /** Candy exploding into chunky pixels that rain down under gravity. */
  shatter(x: number, y: number, color: number, opts: ShatterOptions = {}): void {
    const count = opts.count ?? 10;
    const size = opts.size ?? 5;
    const speed = opts.speed ?? 0.24;
    const spread = opts.spread ?? Math.PI * 2;
    const gravity = opts.gravity ?? 0.0022;
    const life = opts.life ?? 720;
    const upkick = opts.upkick ?? 0.06;

    for (let i = 0; i < count; i++) {
      const p = this.emit('shard', x, y, color, size * (0.7 + Math.random() * 0.7));
      if (!p) return;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const v = speed * (0.35 + Math.random());
      p.vx = Math.cos(a) * v * (spread >= Math.PI * 1.9 ? 1.6 : 1);
      p.vy = Math.sin(a) * v - upkick;
      p.gravity = gravity;
      p.life = life * (0.7 + Math.random() * 0.6);
      p.spin = (Math.random() - 0.5) * 0.012;
      p.rot = Math.random() * Math.PI;
    }
  }

  /** Short additive flare — the "pop" light on top of a clear. */
  spark(x: number, y: number, color: number, size = 26, life = 260): void {
    const p = this.emit('spark', x, y, color, size);
    if (!p) return;
    p.life = life;
    p.gravity = 0;
    p.drag = 0.004;
  }

  /** Small drifting dust for ambience. */
  dust(x: number, y: number, color: number, size = 3, life = 2600): void {
    const p = this.emit('spark', x, y, color, size);
    if (!p) return;
    p.life = life;
    p.vy = -0.006 - Math.random() * 0.01;
    p.vx = (Math.random() - 0.5) * 0.012;
    p.gravity = 0;
    p.drag = 0;
    p.alpha0 = 0.5;
  }

  /**
   * Rain the cleared tiles' pixels down, then snap them into the motif grid,
   * hold, and evaporate. Pixels are recruited from `sources` so the picture
   * visibly grows out of the explosion that made it.
   */
  mosaic(motif: Motif, opts: MosaicOptions): MosaicHandle {
    const rain = opts.rainMs ?? 180;
    const assemble = opts.assembleMs ?? 420;
    const hold = opts.holdMs ?? 850;
    const exit = opts.exitMs ?? 420;
    const sources = opts.sources.length > 0 ? opts.sources : [{ x: opts.cx, y: opts.cy }];

    const origins: Particle[] = [];
    let idx = 0;
    let lifeMs = 0;
    for (let gy = 0; gy < motif.height; gy++) {
      for (let gx = 0; gx < motif.width; gx++) {
        const ch = (motif.rows[gy] as string)[gx] as string;
        if (ch === '.') continue;
        const color = motif.palette[ch] ?? '#ffffff';
        const p = this.emit('mosaic', 0, 0, parseColor(color), opts.pixel);
        if (!p) continue;
        const src = sources[idx % sources.length] as { x: number; y: number };
        idx++;
        p.x = src.x + (Math.random() - 0.5) * opts.pixel * 2.5;
        p.y = src.y + (Math.random() - 0.5) * opts.pixel * 2.5;
        p.vx = (Math.random() - 0.5) * 0.18;
        p.vy = 0.05 + Math.random() * 0.12;
        p.gravity = 0.0016;
        p.drag = 0.0009;
        p.tx = opts.cx + (gx - (motif.width - 1) / 2) * opts.pixel;
        p.ty = opts.cy + (gy - (motif.height - 1) / 2) * opts.pixel;
        // Diagonal wave so the picture draws itself rather than popping in.
        const wave = (gx + gy) / (motif.width + motif.height);
        p.tSeek = rain + wave * assemble * 0.55 + Math.random() * 60;
        p.tHold = p.tSeek + assemble;
        p.tExit = p.tHold + hold + wave * 90;
        p.life = p.tExit + exit;
        lifeMs = Math.max(lifeMs, p.life);
        p.phase = 'fall';
        p.rot = (Math.random() - 0.5) * 0.5;
        p.spin = 0;
        origins.push(p);
      }
    }

    // Dark plate fades in under the picture, so the motif stays legible even
    // when it lands on top of bright candy, then fades out with the pixels.
    let plate: Sprite | null = null;
    if (this.softTex && origins.length > 0) {
      plate = new Sprite(this.softTex);
      plate.anchor.set(0.5);
      plate.x = opts.cx;
      plate.y = opts.cy;
      plate.alpha = 0;
      plate.scale.set(
        ((motif.width * opts.pixel) / 128) * 1.55,
        ((motif.height * opts.pixel) / 128) * 1.55,
      );
      this.normal.addChildAt(plate, 0);
    }

    const pending: Pending = {
      total: origins.length,
      landed: 0,
      retired: 0,
      assembledFired: false,
      resolveAssembled: () => undefined,
      resolveDone: () => undefined,
      plate,
      elapsed: 0,
      fadeIn: rain + assemble * 0.75,
      fadeOutAt: Math.max(0, lifeMs - exit),
      lifeMs,
    };
    const assembled = new Promise<void>((r) => (pending.resolveAssembled = r));
    const done = new Promise<void>((r) => (pending.resolveDone = r));
    for (const p of origins) p.owner = pending;
    this.pendings.push(pending);
    if (origins.length === 0) {
      pending.assembledFired = true;
      pending.resolveAssembled();
      pending.resolveDone();
      this.pendings = this.pendings.filter((q) => q !== pending);
    } else {
      // Callback the game uses to surface the motif name / bonus on landing.
      if (opts.onAssembled) {
        const fire = pending.resolveAssembled;
        pending.resolveAssembled = () => {
          opts.onAssembled?.();
          fire();
        };
      }
    }
    return { motif, assembled, done };
  }

  update(dt: number): void {
    if (this.liveCount === 0 && this.pendings.length === 0) return;
    const frame = Math.min(dt, 48);

    for (const q of this.pendings) {
      q.elapsed += frame;
      // Fire the moment the whole picture has landed — not later, when the
      // first pixel happens to start evaporating.
      if (!q.assembledFired && q.total > 0 && q.landed >= q.total) {
        q.assembledFired = true;
        q.resolveAssembled();
      }
      if (!q.plate) continue;
      const peak = 0.74;
      let a: number;
      if (q.elapsed < q.fadeIn) a = peak * easings.quadOut(q.elapsed / Math.max(1, q.fadeIn));
      else if (q.elapsed < q.fadeOutAt) a = peak;
      else a = peak * Math.max(0, 1 - (q.elapsed - q.fadeOutAt) / Math.max(1, q.lifeMs - q.fadeOutAt));
      q.plate.alpha = a;
      if (a <= 0.002 && q.elapsed > q.fadeOutAt) {
        q.plate.destroy();
        q.plate = null;
      }
    }

    for (const p of this.pool) {
      if (!p.active) continue;
      p.t += frame;

      let alpha = 1;
      let scaleMul = 1;
      let finished = false;

      if (p.mode === 'mosaic') {
        if (p.t < p.tSeek) {
          // free-fall rain
          p.vy += p.gravity * frame;
          p.vx *= 1 - p.drag * frame;
          p.x += p.vx * frame;
          p.y += p.vy * frame;
          p.rot += p.spin * frame;
          scaleMul = 0.75;
        } else if (p.t < p.tHold) {
          // home in on the grid slot
          const span = Math.max(1, p.tHold - p.tSeek);
          const k = easings.cubicOut(Math.min(1, (p.t - p.tSeek) / span));
          const follow = Math.min(1, 0.22 + k * 0.5);
          const wobble = Math.sin(p.t * 0.02 + p.seed) * (1 - k) * 3;
          p.x += (p.tx + wobble - p.x) * follow;
          p.y += (p.ty - p.y) * follow;
          p.rot += (0 - p.rot) * 0.2;
          scaleMul = 0.7 + 0.42 * easings.backOut(k);
        } else if (p.t < p.tExit) {
          // Landed: snap exactly onto the grid. Exponential homing alone never
          // fully converges, and a half-pixel offset blurs the whole picture.
          p.x = p.tx;
          p.y = p.ty;
          p.rot = 0;
          scaleMul = 1;
          alpha = 0.88 + 0.12 * Math.sin(p.t * 0.014 + p.seed);
          if (!p.countedLanded && p.owner) {
            p.countedLanded = true;
            p.owner.landed++;
          }
        } else {
          // evaporate upward
          const span = Math.max(1, p.life - p.tExit);
          const k = Math.min(1, (p.t - p.tExit) / span);
          p.y -= 0.05 * k * frame;
          p.x += Math.sin(p.seed + p.t * 0.01) * 0.02 * frame;
          alpha = (1 - k) * (0.88 + 0.12 * Math.sin(p.seed));
          scaleMul = 1 - 0.5 * k;
          finished = p.t >= p.life;
        }
      } else {
        p.vy += p.gravity * frame;
        p.vx *= 1 - p.drag * frame;
        p.vy *= 1 - p.drag * frame;
        p.x += p.vx * frame;
        p.y += p.vy * frame;
        p.rot += p.spin * frame;
        const k = Math.min(1, p.t / p.life);
        alpha = Math.max(0, p.mode === 'spark' ? 1 - k * k : 1 - easings.quadIn(k));
        scaleMul = Math.max(0.05, p.mode === 'spark' ? 0.6 + 0.9 * easings.quadOut(k) : 1 - 0.35 * k);
        finished = p.t >= p.life;
      }

      p.sprite.x = p.x;
      p.sprite.y = p.y;
      p.sprite.rotation = p.rot;
      p.sprite.alpha = alpha * p.alpha0;
      p.sprite.scale.set((Math.max(1, p.baseSize) / 12) * scaleMul);

      if (finished) {
        const owner = p.owner;
        this.retire(p);
        if (owner) {
          owner.retired++;
          if (owner.retired >= owner.total) {
            this.pendings = this.pendings.filter((q) => q !== owner);
            owner.resolveDone();
          }
        }
      }
    }
  }

  /** Fire any mosaic whose pixels never arrived (e.g. cleared mid-flight). */
  private settlePendings(): void {
    const list = this.pendings;
    this.pendings = [];
    for (const q of list) {
      if (q.plate) {
        q.plate.destroy();
        q.plate = null;
      }
      if (!q.assembledFired) {
        q.assembledFired = true;
        q.resolveAssembled();
      }
      q.resolveDone();
    }
  }

  private retire(p: Particle): void {
    p.active = false;
    p.sprite.visible = false;
    this.liveCount = Math.max(0, this.liveCount - 1);
  }

  /** Immediately drop everything (level restart / transition). */
  clear(): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      this.retire(p);
    }
    this.settlePendings();
  }

  destroy(): void {
    this.clear();
    for (const p of this.pool) p.sprite.destroy();
    this.pool.length = 0;
    this.normal.destroy({ children: false });
    this.additive.destroy({ children: false });
  }
}

function parseColor(hex: string): number {
  const clean = hex.startsWith('#') ? hex : '#ffffff';
  return parseInt(clean.slice(1), 16) || 0xffffff;
}
