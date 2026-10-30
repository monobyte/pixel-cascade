# Pixel Cascade

A browser match-3 where clearing candy is only the first half of the trick.

Every cleared tile **shatters into pixel shards**, those shards rain down under
gravity, and then they **reassemble into a pixel-art motif** — a heart, a gem,
a key, a crown — that hangs on the board for a moment before drifting away.
Longer cascades and bigger matches summon larger, rarer motifs, so the payoff
for a good chain is a picture, not just a number.

TypeScript throughout, no image or audio files: all art is drawn procedurally
into canvases at boot, and all sound is synthesised with WebAudio.

## Run it

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm test     # 62 unit tests
pnpm build    # production bundle in dist/
```

## How it plays

- **Swap** a candy onto an adjacent one (drag, or tap two neighbours). A swap
  only sticks if it makes a match.
- **Match 3+** of a colour. Runs of 4 and 5 pay a quadratic size bonus.
- **Cascades**: refills that match again chain, and each round multiplies that
  round's score.
- **Motifs**: once the board settles, the shattered pixels assemble. Motif tier
  rises with tiles cleared, longest cascade, and biggest single group.
- **Levels**: five short levels with goals — score, tiles shattered, a cascade
  target, or summoning motifs. Stars are awarded for surplus score and unused
  moves.

Keys: `R` restart · `M` mute · `H` help · `Enter` confirms the overlay.

## Layout

```text
src/
  core/        pure model — no DOM, no Pixi, fully unit tested
    rng.ts         seeded mulberry32; every random draw goes through it
    board.ts       board state, matching, gravity, refill, reshuffle
    resolver.ts    resolveBoard(): the full cascade, simulated up front
    scoring.ts     tile/size/cascade/motif scoring and stars
    patterns.ts    pixel-art motif library (tiers 1-3 authored, 4-5 framed)
    levels.ts      the five levels and their goals
  render/      presentation
    textures.ts    candies, pixel, spark and glow sprites, drawn at boot
    particles.ts   pooled shards / sparks / mosaic assembly
    board-view.ts  sprites, plate, swap / clear / fall animations
    tweener.ts     promise-based tween scheduler with generation tokens
  audio/sfx.ts procedural WebAudio sound effects
  ui/hud.ts    score, goals, toasts, modal overlay
  game.ts      state machine: input, level flow, cascade playback, goals
  main.ts      boot
```

### The one design decision worth knowing

`resolveBoard()` simulates the **entire** cascade before anything is drawn and
returns an ordered script of rounds, falls and score parts. The view replays
that script. Rules stay pure and testable, and the model can never drift out of
sync with the animation.

Tiles carry stable `id`s, so gravity and refill animate the *same* sprite across
board changes instead of cross-fading two.

The pool in `particles.ts` grows on demand to a hard ceiling; assembly of a
motif resolves only when every pixel has landed exactly on its grid slot.

## Development tools

- `fx-lab.html` — dev-only page (`/fx-lab.html`) that isolates the shatter and
  mosaic effects with sliders, so the signature effect can be judged without
  playing a level. Query params: `?tier=3&freeze=1`. Not part of the build.
- `scripts/dump-art.ts` — `npx vite-node scripts/dump-art.ts` writes the candy
  and motif art to PNGs for eyeballing.
- `scripts/play-move.py`, `scripts/playthrough.py` — drive the real game through
  [agent-browser](https://github.com/vercel-labs/agent-browser) to verify input,
  cascades and the win/lose overlays in a real browser:

  ```bash
  agent-browser open http://localhost:5173/
  AGENT_BROWSER_SESSION=<session> python3 scripts/playthrough.py
  ```

## Notes

- Candy kinds are distinguishable by **silhouette** as well as colour, so the
  board stays readable for colour-blind players.
- The board sizes itself from the stage box; the Pixi canvas is pinned out of
  flow so its intrinsic size can never feed back into the layout.
- Everything random is seeded, so a level replays identically.
