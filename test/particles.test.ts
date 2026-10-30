import { describe, expect, it } from 'vitest';
import type { Texture } from 'pixi.js';
import { ParticleField } from '../src/render/particles';
import { buildMotif } from '../src/core/patterns';

/**
 * A Texture stand-in covering exactly what `new Sprite(texture)` touches at
 * construction time. Pixi never uploads to the GPU until a renderer draws, so
 * the particle system can be exercised head-less.
 */
function fakeTexture(): Texture {
  const frame = { x: 0, y: 0, width: 14, height: 14 };
  return {
    orig: { ...frame },
    trim: null,
    default: true,
    frame,
    isValid: true,
    destroyed: false,
    source: { width: 14, height: 14, style: { scaleMode: 'nearest' } },
    setStyle() {
      /* no-op */
    },
  } as unknown as Texture;
}

function field(): ParticleField {
  return new ParticleField(fakeTexture(), fakeTexture(), fakeTexture());
}

describe('ParticleField pooling', () => {
  it('grows the pool past a single slot (regression: pool capped at 1)', () => {
    const fx = field();
    for (let i = 0; i < 250; i++) fx.shatter(10, 10, 0xff0000, { count: 4 });
    expect(fx.live).toBe(1000);
    expect(fx['pool'].length).toBeGreaterThanOrEqual(1000);
  });

  it('recycles slots instead of leaking particles', () => {
    const fx = field();
    for (let i = 0; i < 60; i++) fx.shatter(0, 0, 0x00ff00, { count: 3, life: 200 });
    const afterFirst = fx.live;
    // run every shard to death
    for (let i = 0; i < 60; i++) fx.update(32);
    expect(fx.live).toBe(0);
    for (let i = 0; i < 60; i++) fx.shatter(0, 0, 0x00ff00, { count: 3, life: 200 });
    expect(fx.live).toBe(afterFirst);
    // reuse, not growth: the pool should not double
    expect(fx['pool'].length).toBeLessThan(afterFirst * 2);
  });

  it('emits every pixel of a motif, and reports assembly', async () => {
    const fx = field();
    const motif = buildMotif(3, 1);
    const handle = fx.mosaic(motif, {
      cx: 100,
      cy: 100,
      pixel: 10,
      sources: [{ x: 0, y: 0 }],
      rainMs: 20,
      assembleMs: 100,
      holdMs: 300,
      exitMs: 100,
    });
    expect(fx.live).toBe(motif.pixelCount);

    const settled = handle.assembled.then(() => true);
    // 320ms: past the last pixel's landing time, well before the exit phase.
    for (let i = 0; i < 20; i++) fx.update(16);
    await expect(settled).resolves.toBe(true);

    // every pixel has snapped to its slot
    const pixels = fx['pool'].filter((p: { active: boolean }) => p.active);
    expect(pixels.length).toBe(motif.pixelCount);
    for (const p of pixels) {
      expect(p.sprite.x).toBe(p.tx);
      expect(p.sprite.y).toBe(p.ty);
    }
  });

  it('clear() retires everything and resolves pending handles', async () => {
    const fx = field();
    const handle = fx.mosaic(buildMotif(2, 0), { cx: 0, cy: 0, pixel: 8, sources: [] });
    expect(fx.live).toBeGreaterThan(0);
    fx.clear();
    expect(fx.live).toBe(0);
    await expect(handle.done).resolves.toBeUndefined();
  });

  it('caps at the pool ceiling under heavy load', () => {
    const fx = field();
    for (let i = 0; i < 500; i++) fx.shatter(0, 0, 0xffffff, { count: 10 });
    expect(fx.live).toBeLessThanOrEqual(1400);
  });
});
