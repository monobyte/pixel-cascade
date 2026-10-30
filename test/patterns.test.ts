import { describe, expect, it } from 'vitest';
import { MAX_TIER, allMotifs, buildMotif, tierLabel } from '../src/core/patterns';

describe('pixel motif library', () => {
  it('every authored motif is a rectangular grid', () => {
    const motifs = allMotifs();
    expect(motifs.length).toBeGreaterThanOrEqual(15);
    for (const m of motifs) {
      expect(m.width).toBeGreaterThan(0);
      expect(m.height).toBe(m.rows.length);
      for (const row of m.rows) {
        expect(row.length).toBe(m.width);
      }
    }
  });

  it('only uses palette colours', () => {
    for (const m of allMotifs()) {
      for (const row of m.rows) {
        for (const ch of row) {
          if (ch === '.') continue;
          expect(m.palette[ch], `${m.name} char '${ch}'`).toBeDefined();
          expect(m.palette[ch]).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
      }
    }
  });

  it('draws real pictures, not blank or solid grids', () => {
    for (const m of allMotifs()) {
      expect(m.pixelCount).toBeGreaterThan(6);
      expect(m.pixelCount).toBeLessThan(m.width * m.height);
    }
  });

  it('grows with tier: size and pixel budget both increase', () => {
    const t1 = buildMotif(1, 0);
    const t2 = buildMotif(2, 0);
    const t3 = buildMotif(3, 0);
    const t4 = buildMotif(4, 0);
    const t5 = buildMotif(5, 0);
    expect(t2.width).toBeGreaterThan(t1.width);
    expect(t3.width).toBeGreaterThan(t2.width);
    expect(t4.width).toBe(t3.width + 2);
    expect(t5.width).toBe(t3.width + 4);
    expect(t2.pixelCount).toBeGreaterThan(t1.pixelCount);
    expect(t3.pixelCount).toBeGreaterThan(t2.pixelCount);
    expect(t4.pixelCount).toBeGreaterThan(t3.pixelCount);
    expect(t5.pixelCount).toBeGreaterThan(t4.pixelCount);
    expect(t5.width).toBeLessThanOrEqual(13);
  });

  it('stamps the motif inside its generated frame', () => {
    const framed = buildMotif(5, 1);
    const bare = buildMotif(3, 1);
    const pad = (framed.width - bare.width) / 2;
    for (let y = 0; y < bare.height; y++) {
      for (let x = 0; x < bare.width; x++) {
        const src = (bare.rows[y] as string)[x] as string;
        const dst = (framed.rows[y + pad] as string)[x + pad] as string;
        if (src !== '.') expect(dst).toBe(src);
      }
    }
  });

  it('frames are fully populated', () => {
    const framed = buildMotif(4, 0);
    const row0 = framed.rows[0] as string;
    expect(row0.includes('.')).toBe(false);
    expect(framed.palette['*']).toBeDefined();
    expect(framed.palette['a']).toBeDefined();
  });

  it('wraps indices safely for any integer', () => {
    for (const i of [0, 1, 7, 100, -3]) {
      for (let tier = 1; tier <= MAX_TIER; tier++) {
        const m = buildMotif(tier as 1 | 2 | 3 | 4 | 5, i);
        expect(m.pixelCount).toBeGreaterThan(0);
      }
    }
  });

  it('labels tiers distinctly', () => {
    const labels = new Set([1, 2, 3, 4, 5].map((t) => tierLabel(t as 1)));
    expect(labels.size).toBe(5);
  });
});
