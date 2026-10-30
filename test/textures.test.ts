import { describe, expect, it } from 'vitest';
import { CANDY_TEXTURE_SIZE } from '../src/render/textures';

describe('CANDY_TEXTURE_SIZE', () => {
  it('leaves headroom over the largest cell the board can request', () => {
    // The board caps cells at 82 CSS px, drawn at 0.92 of that on a 2x display
    // is ~151 device px. A 256 texture downsamples that with real margin, so
    // linear filtering has samples to average instead of aliasing the edge.
    const worstCaseDevicePx = 82 * 0.92 * 2;
    expect(CANDY_TEXTURE_SIZE).toBeGreaterThanOrEqual(worstCaseDevicePx * 1.5);
  });
});
