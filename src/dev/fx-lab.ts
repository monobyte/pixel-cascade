/**
 * Dev-only FX harness (http://localhost:5173/fx-lab.html).
 *
 * Lets the shatter and the motif assembly be inspected frame-by-frame without
 * replaying a whole cascade: `?tier=4&freeze=1` spawns tier 4 and parks the
 * particle clock at the hold phase for screenshots.
 */
import { Application, Texture } from 'pixi.js';
import { ParticleField } from '../render/particles';
import { buildMotif, type Tier } from '../core/patterns';
import { makePixelCanvas, makeSoftRectCanvas, makeSparkCanvas, CANDY_SKINS } from '../render/textures';

const params = new URLSearchParams(location.search);
const tier = Math.min(5, Math.max(1, Number(params.get('tier') ?? 3))) as Tier;
const index = Number(params.get('index') ?? 0);
const freeze = params.get('freeze') === '1';
const pixelScale = Number(params.get('pixel') ?? 0.46);

const stage = document.getElementById('stage');
if (!stage) throw new Error('#stage missing');

const app = new Application();
await app.init({ resizeTo: stage, backgroundAlpha: 0, antialias: false, autoDensity: true });
stage.appendChild(app.canvas);

const pixelTex = Texture.from(makePixelCanvas(14));
pixelTex.source.style.scaleMode = 'nearest';
const sparkTex = Texture.from(makeSparkCanvas(64));
const softTex = Texture.from(makeSoftRectCanvas(128));

declare global {
  interface Window {
    /** Dev harness handle for inspecting particle state. */
    __fx?: ParticleField;
  }
}

const fx = new ParticleField(pixelTex, sparkTex, softTex);
app.stage.addChild(fx.normal, fx.additive);
window.__fx = fx;

let paused = freeze;
let elapsed = 0;

function shatter(): void {
  const skin = CANDY_SKINS[Math.floor(Math.random() * CANDY_SKINS.length)] as (typeof CANDY_SKINS)[number];
  const color = parseInt(skin.base.slice(1), 16);
  fx.shatter(app.screen.width / 2, app.screen.height / 2, color, {
    count: 40,
    size: 14,
    speed: 0.3,
    gravity: 0.0024,
    life: 900,
  });
  fx.spark(app.screen.width / 2, app.screen.height / 2, color, 160, 300);
}

const bar = document.getElementById('bar');
const button = (label: string, on: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', on);
  bar?.appendChild(b);
};

button(`shatter`, shatter);
for (let t = 1; t <= 5; t++) {
  button('motif T' + t, () => {
    fx.clear();
    spawnAt(t as Tier, 600_000);
    paused = true;
  });
}
button(paused ? 'resume' : 'freeze', () => {
  paused = !paused;
});
button('clear', () => fx.clear());

function spawnAt(t: Tier, holdMs: number): void {
  const motif = buildMotif(t, index);
  const cell = Math.min(app.screen.width, app.screen.height) / 10;
  const sources = Array.from({ length: 9 }, (_, i) => ({
    x: app.screen.width / 2 + ((i % 3) - 1) * cell,
    y: app.screen.height / 2 + (Math.floor(i / 3) - 1) * cell,
  }));
  fx.mosaic(motif, {
    cx: app.screen.width / 2,
    cy: app.screen.height / 2,
    pixel: cell * pixelScale,
    sources,
    rainMs: 40,
    assembleMs: 260,
    holdMs,
    exitMs: 400,
  });
  elapsed = 0;
}

app.ticker.add((ticker) => {
  if (paused) return;
  const dt = ticker.deltaMS;
  elapsed += dt;
  fx.update(dt);
});

// Park the clock just past assembly so the motif is fully formed.
spawnAt(tier, 600_000);
if (freeze) {
  for (let i = 0; i < 60; i++) fx.update(16);
}
