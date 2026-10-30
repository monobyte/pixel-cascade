/**
 * Terminal preview of the motif library — lets me eyeball the pixel art
 * without booting a browser. `node scripts/dump-art.ts`
 */
import { allMotifs, buildMotif } from '../src/core/patterns.ts';

const BLOCK = '█';
const EMPTY = '·';

function render(rows: readonly string[], label: string): void {
  console.log(`\n${label}`);
  for (const row of rows) {
    let line = '  ';
    for (const ch of row) line += ch === '.' ? EMPTY : BLOCK;
    console.log(line);
  }
}

for (const m of allMotifs()) render(m.rows, `T${m.tier}  ${m.name}  ${m.width}x${m.height}  ${m.pixelCount}px`);

for (const tier of [4, 5] as const) {
  for (const i of [0, 1]) render(buildMotif(tier, i).rows, `T${tier}  ${buildMotif(tier, i).name} (framed)`);
}
