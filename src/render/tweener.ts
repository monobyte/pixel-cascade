/**
 * Minimal promise-based tween/scheduler. The game state machine is written as
 * straight-line async code (`await tween(...)` / `await Promise.all([...])`),
 * which keeps animation sequencing readable while staying driven by a single
 * rAF clock. `cancel()` resolves pending awaits and the caller checks a
 * generation token, so a restart can never resurrect an old animation.
 */

export type Easer = (t: number) => number;

export const easings = {
  linear: (t: number): number => t,
  quadOut: (t: number): number => 1 - (1 - t) * (1 - t),
  quadIn: (t: number): number => t * t,
  cubicOut: (t: number): number => 1 - Math.pow(1 - t, 3),
  cubicInOut: (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  backOut: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  elasticOut: (t: number): number => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  bounceOut: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  /** 0 -> 1 -> 0, for pops and flashes. */
  pulse: (t: number): number => Math.sin(t * Math.PI),
} satisfies Record<string, Easer>;

interface Tween {
  readonly duration: number;
  readonly delay: number;
  readonly ease: Easer;
  readonly onUpdate: (progress: number, eased: number) => void;
  readonly onDone: () => void;
  elapsed: number;
  done: boolean;
}

export class Tweener {
  private tweens: Tween[] = [];
  private cancelling = false;

  get active(): number {
    return this.tweens.length;
  }

  get busy(): boolean {
    return this.tweens.length > 0;
  }

  tween(options: {
    duration: number;
    delay?: number;
    ease?: Easer;
    onUpdate?: (progress: number, eased: number) => void;
  }): Promise<void> {
    const { duration, delay = 0, ease = easings.linear, onUpdate } = options;
    if (duration <= 0 && delay <= 0) {
      onUpdate?.(1, 1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const t: Tween = {
        duration,
        delay,
        ease,
        onUpdate: onUpdate ?? (() => undefined),
        onDone: resolve,
        elapsed: -delay,
        done: false,
      };
      this.tweens.push(t);
    });
  }

  wait(ms: number): Promise<void> {
    return this.tween({ duration: ms });
  }

  /** Advance every tween. Call once per frame with frame delta in ms. */
  update(dt: number): void {
    if (this.tweens.length === 0) return;
    this.cancelling = false;
    const finished: Tween[] = [];
    for (const t of this.tweens) {
      t.elapsed += dt;
      if (t.elapsed <= 0) continue;
      const p = t.duration <= 0 ? 1 : Math.min(1, t.elapsed / t.duration);
      t.onUpdate(p, t.ease(p));
      if (p >= 1) {
        t.done = true;
        finished.push(t);
      }
    }
    if (finished.length > 0) {
      const set = new Set(finished);
      this.tweens = this.tweens.filter((t) => !set.has(t));
      for (const t of finished) {
        if (!t.done) continue;
        t.done = false;
        t.onDone();
      }
    }
  }

  /**
   * Drop all pending tweens and resolve their awaits. Any in-flight async
   * sequence must check its generation token before touching the view again.
   */
  cancel(): void {
    if (this.cancelling) return;
    this.cancelling = true;
    const pending = this.tweens;
    this.tweens = [];
    for (const t of pending) {
      if (!t.done) {
        t.done = true;
        t.onDone();
      }
    }
    this.cancelling = false;
  }
}
