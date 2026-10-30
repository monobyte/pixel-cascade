import { Container, Text, TextStyle } from 'pixi.js';
import { easings, Tweener } from './tweener';

interface Float {
  text: Text;
  t: number;
  life: number;
  y0: number;
  rise: number;
}

export interface FloatOptions {
  color?: number;
  size?: number;
  rise?: number;
  life?: number;
  bold?: boolean;
}

/** Transient world-space labels: score pops, "CASCADE x3", motif names. */
export class FloatLayer {
  readonly container = new Container();

  private readonly floats: Float[] = [];
  private readonly tweens: Tweener;
  private readonly baseStyle: Partial<TextStyle> = {
    fontFamily: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
    fontWeight: '800',
    fill: 0xffffff,
    stroke: { color: 0x120c22, width: 6, alpha: 0.9 },
    align: 'center',
  };

  constructor(tweens: Tweener) {
    this.tweens = tweens;
  }

  pop(value: string, x: number, y: number, opts: FloatOptions = {}): Promise<void> {
    const size = opts.size ?? 26;
    const life = opts.life ?? 900;
    const text = new Text({
      text: value,
      style: { ...this.baseStyle, fontSize: size, fill: opts.color ?? 0xffffff },
    });
    text.anchor.set(0.5);
    text.x = x;
    text.y = y;
    text.scale.set(0.2);
    this.container.addChild(text);

    const f: Float = { text, t: 0, life, y0: y, rise: opts.rise ?? 54 };
    this.floats.push(f);

    return this.tweens
      .tween({
        duration: life,
        ease: easings.linear,
        onUpdate: (p) => {
          const popIn = easings.backOut(Math.min(1, p / 0.28));
          text.scale.set(0.2 + 0.95 * popIn - 0.25 * Math.max(0, p - 0.6));
          text.y = f.y0 - f.rise * easings.cubicOut(p);
          text.alpha = p > 0.65 ? 1 - (p - 0.65) / 0.35 : 1;
        },
      })
      .then(() => {
        const i = this.floats.indexOf(f);
        if (i >= 0) this.floats.splice(i, 1);
        text.destroy();
      });
  }

  clear(): void {
    for (const f of this.floats) f.text.destroy();
    this.floats.length = 0;
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }
}
