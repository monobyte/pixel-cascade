import { Application, Container, Texture } from 'pixi.js';
import { Sfx } from './audio/sfx';
import { Board } from './core/board';
import { LEVELS, goalValue, type Goal } from './core/levels';
import { MAX_TIER, buildMotif, tierLabel, type Tier } from './core/patterns';
import { resolveBoard, swapCreatesMatch } from './core/resolver';
import { createRng, type Rng } from './core/rng';
import { mosaicBonus, mosaicPower, mosaicTier, starsFor } from './core/scoring';
import type { Cell } from './core/types';
import { BackgroundLayer } from './render/background';
import { BoardView, makeCandyTextures } from './render/board-view';
import { FloatLayer } from './render/float-text';
import { ParticleField } from './render/particles';
import { Tweener } from './render/tweener';
import { CANDY_SKINS, makePixelCanvas, makeSoftRectCanvas, makeSparkCanvas } from './render/textures';
import type { GoalView, Hud } from './ui/hud';

type Phase = 'boot' | 'intro' | 'idle' | 'resolving' | 'over';

const MIN_CELL = 32;
const MAX_CELL = 82;

export interface GameDeps {
  stage: HTMLElement;
  hud: Hud;
  sfx: Sfx;
}

/**
 * Orchestrates model -> presentation. The model is authoritative and updated
 * up-front (`resolveBoard` settles the whole cascade immediately); the view
 * then replays the returned script. Input is locked for the duration, and a
 * generation token makes any in-flight animation sequence abort on restart.
 */
export class Game {
  private readonly app = new Application();
  private readonly deps: GameDeps;

  private readonly world = new Container();
  private bg!: BackgroundLayer;
  private view!: BoardView;
  private fx!: ParticleField;
  private floats!: FloatLayer;
  private readonly tweens = new Tweener();

  private board!: Board;
  private rng: Rng = createRng();
  private candyTextures: Texture[] = [];
  private pixelTex!: Texture;
  private sparkTex!: Texture;
  private softTex!: Texture;

  private levelIndex = 0;
  private movesLeft = 0;
  private score = 0;
  private tilesCleared = 0;
  private bigMosaics = 0;
  private bestCascade = 0;
  private motifCursor = 0;

  private phase: Phase = 'boot';
  private gen = 0;
  private originX = 0;
  private originY = 0;
  private dragging: { cell: Cell; x: number; y: number; fired: boolean } | null = null;
  private selected: Cell | null = null;
  private pointerDown = false;
  private clock = 0;
  private ready = false;

  constructor(deps: GameDeps) {
    this.deps = deps;
  }

  /* ------------------------------------------------------------- lifecycle */

  async start(): Promise<void> {
    await this.app.init({
      resizeTo: this.deps.stage,
      antialias: false,
      backgroundAlpha: 0,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
      powerPreference: 'high-performance',
    });
    this.deps.stage.appendChild(this.app.canvas);
    // Pixi writes inline width/height onto the canvas (autoDensity + resizeTo),
    // which outrank the stylesheet. Left in flow, the canvas's own height feeds
    // back into the stage's measured height and the two inflate each other, so
    // on short viewports the board drifts below the fold. Pinning it to the
    // stage box makes the stage the single source of truth for size.
    Object.assign(this.app.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
    } satisfies Partial<CSSStyleDeclaration>);

    this.pixelTex = Texture.from(makePixelCanvas(14));
    this.sparkTex = Texture.from(makeSparkCanvas(64));
    this.softTex = Texture.from(makeSoftRectCanvas(128));
    this.pixelTex.source.style.scaleMode = 'nearest';

    this.bg = new BackgroundLayer(this.sparkTex);
    this.fx = new ParticleField(this.pixelTex, this.sparkTex, this.softTex);
    this.floats = new FloatLayer(this.tweens);
    this.app.stage.addChild(this.bg.container, this.world);
    this.world.addChild(this.fx.normal, this.fx.additive, this.floats.container);

    this.app.ticker.add((ticker) => {
      const dt = ticker.deltaMS;
      this.clock += dt;
      this.tweens.update(dt);
      this.fx.update(dt);
      this.bg.update(dt, this.clock);
    });

    this.ready = true;
    this.bindPointer();
    window.addEventListener('keydown', this.onKey);

    this.loadLevel(0);
    this.showStartOverlay();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.unbindPointer();
    this.tweens.cancel();
    this.fx.clear();
    this.floats.clear();
    this.view?.destroy();
    this.fx.destroy();
    this.floats.destroy();
    this.bg?.destroy();
    for (const t of this.candyTextures) t.destroy(true);
    this.app.destroy(true, { children: true });
  }

  /* ---------------------------------------------------------------- layout */

  /** Public hook for the ResizeObserver in main.ts. */
  relayout(): void {
    this.layout();
  }

  private layout(): void {
    // ResizeObserver can fire before Application.init() has resolved.
    if (!this.ready) return;
    const w = this.app.screen.width || 800;
    const h = this.app.screen.height || 600;
    this.bg.resize(w, h);
    if (!this.view) return;
    const margin = Math.min(48, Math.min(w, h) * 0.1);
    const cell = Math.max(
      MIN_CELL,
      Math.min(MAX_CELL, Math.floor((Math.min(w, h) - margin) / Math.max(this.board.w, this.board.h))),
    );
    this.view.setCellSize(cell);
    const m = this.view.metricsView;
    this.originX = Math.round((w - m.width) / 2);
    this.originY = Math.round((h - m.height) / 2);
    this.view.container.x = this.originX;
    this.view.container.y = this.originY;
    this.fx.normal.x = this.originX;
    this.fx.normal.y = this.originY;
    this.fx.additive.x = this.originX;
    this.fx.additive.y = this.originY;
    this.floats.container.x = this.originX;
    this.floats.container.y = this.originY;
  }

  private cellToWorld(c: Cell): { x: number; y: number } {
    const p = this.view.centerOfCell(c);
    return { x: p.x, y: p.y };
  }

  /* ----------------------------------------------------------------- level */

  private loadLevel(index: number): void {
    const level = LEVELS[index] as (typeof LEVELS)[number];
    this.levelIndex = index;
    this.gen++;
    this.phase = 'intro';
    this.tweens.cancel();
    this.fx.clear();
    this.floats.clear();
    this.view?.clearHighlight();

    this.rng = createRng();
    this.board = new Board(level.width, level.height, level.kinds);
    this.board.fillWithoutMatches(this.rng);
    if (!this.board.hasValidMove()) this.board.reshuffle(this.rng);

    this.candyTextures.forEach((t) => t.destroy(true));
    this.candyTextures = makeCandyTextures(level.kinds);

    this.view?.destroy();
    this.view = new BoardView(this.board, this.candyTextures, this.tweens, 60);
    this.world.addChildAt(this.view.container, 0);

    this.score = 0;
    this.movesLeft = level.moves;
    this.tilesCleared = 0;
    this.bigMosaics = 0;
    this.bestCascade = 0;
    this.selected = null;
    this.dragging = null;

    this.bg.setTheme(index);
    this.layout();
    this.deps.hud.setLevel(level, LEVELS.length);
    this.deps.hud.setScore(0, false);
    this.deps.hud.setMoves(this.movesLeft, level.moves);
    this.pushGoals();

    this.view.rebuild();
    void this.playIntro();
  }

  private async playIntro(): Promise<void> {
    const gen = this.gen;
    await this.view.playIntro();
    if (gen !== this.gen) return;
    this.phase = 'idle';
  }

  private currentLevel() {
    return LEVELS[this.levelIndex] as (typeof LEVELS)[number];
  }

  private goalView(): GoalView[] {
    const stats = {
      score: this.score,
      tilesCleared: this.tilesCleared,
      bigMosaics: this.bigMosaics,
      bestCascade: this.bestCascade,
    };
    return this.currentLevel().goals.map((goal: Goal) => ({ goal, progress: goalValue(goal, stats) }));
  }

  private pushGoals(): void {
    this.deps.hud.setGoals(this.goalView());
  }

  private goalsMet(): boolean {
    return this.goalView().every(({ goal, progress }) => progress >= goal.target);
  }

  /* ----------------------------------------------------------------- input */

  private onKey = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (key === 'r') this.restart();
    else if (key === 'm') this.toggleSound();
    else if (key === 'h') this.showHelp();
    else if (key === 'enter' && this.deps.hud.overlayOpen) this.deps.hud.activatePrimary();
  };

  toggleSound(): void {
    const muted = !this.deps.sfx.isMuted;
    this.deps.sfx.setMuted(muted);
    this.deps.hud.setMuted(muted);
    if (!muted) this.deps.sfx.click();
  }

  restart(): void {
    this.deps.sfx.unlock();
    this.deps.hud.hideOverlay();
    this.deps.sfx.click();
    this.loadLevel(this.levelIndex);
  }

  nextLevel(): void {
    this.deps.hud.hideOverlay();
    this.loadLevel(Math.min(this.levelIndex + 1, LEVELS.length - 1));
  }

  restartFromStart(): void {
    this.deps.hud.hideOverlay();
    this.loadLevel(0);
  }

  private canvasPoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left - this.originX, y: e.clientY - rect.top - this.originY };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.deps.sfx.unlock();
    this.deps.sfx.resume();
    if (this.phase !== 'idle') return;
    const p = this.canvasPoint(e);
    const cell = this.view.cellAt(p.x, p.y);
    if (!cell) return;
    this.pointerDown = true;
    this.dragging = { cell, x: e.clientX, y: e.clientY, fired: false };
    this.view.showHighlight([cell], 0xffffff, 0.9);
    this.deps.sfx.select();
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const drag = this.dragging;
    if (!drag || drag.fired || !this.pointerDown) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const threshold = this.view.metricsView.cell * 0.34;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;

    const horizontal = Math.abs(dx) > Math.abs(dy);
    const target = {
      x: drag.cell.x + (horizontal ? (dx > 0 ? 1 : -1) : 0),
      y: drag.cell.y + (horizontal ? 0 : dy > 0 ? 1 : -1),
    };
    drag.fired = true;
    this.dragging = null;
    this.pointerDown = false;
    this.selected = null;
    void this.attemptSwap(drag.cell, target);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const drag = this.dragging;
    this.pointerDown = false;
    if (!drag || drag.fired) {
      this.dragging = null;
      return;
    }
    this.dragging = null;

    // Tap-to-select / tap-to-swap, for keyboard-less and accessibility play.
    const p = this.canvasPoint(e);
    const cell = this.view.cellAt(p.x, p.y);
    if (!cell) {
      this.selected = null;
      this.view.clearHighlight();
      return;
    }
    if (this.selected && (this.selected.x !== cell.x || this.selected.y !== cell.y)) {
      const from = this.selected;
      this.selected = null;
      this.view.clearHighlight();
      void this.attemptSwap(from, cell);
      return;
    }
    this.selected = cell;
    this.view.showHighlight([cell], 0xffd166, 1);
    this.deps.sfx.select();
  };

  private bindPointer(): void {
    const c = this.app.canvas;
    c.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private unbindPointer(): void {
    const c = this.app.canvas;
    c.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }

  /* ------------------------------------------------------------- swapping */

  private async attemptSwap(from: Cell, to: Cell): Promise<void> {
    if (this.phase !== 'idle') return;
    if (!this.board.inBounds(to.x, to.y)) {
      this.view.clearHighlight();
      return;
    }
    const ia = this.board.idx(from.x, from.y);
    const ib = this.board.idx(to.x, to.y);
    const ta = this.board.cells[ia];
    const tb = this.board.cells[ib];
    if (!ta || !tb) {
      this.view.clearHighlight();
      return;
    }

    this.phase = 'resolving';
    this.view.clearHighlight();
    const gen = this.gen;
    const ids: [number, number] = [ta.id, tb.id];
    const valid = swapCreatesMatch(this.board, ia, ib);

    if (!valid) {
      this.deps.sfx.rejected();
      await this.view.playSwap(from, to, ids);
      if (gen !== this.gen) return;
      await this.view.playRejected(from, to, ids);
      if (gen !== this.gen) return;
      this.phase = 'idle';
      return;
    }

    this.deps.sfx.swap();
    this.board.swapCells(ia, ib);
    await this.view.playSwap(from, to, ids);
    if (gen !== this.gen) return;

    await this.settle(gen);
  }

  /** Play back every cascade round the model produced, then score and close. */
  private async settle(gen: number): Promise<void> {
    const res = resolveBoard(this.board, this.rng);
    if (res.rounds.length === 0) {
      this.phase = 'idle';
      return;
    }

    let lastCleared: Cell[] = [];
    for (const round of res.rounds) {
      if (gen !== this.gen) return;

      const colorByCell = new Map<string, string>();
      for (const group of round.groups) {
        const skin = CANDY_SKINS[group.kind % CANDY_SKINS.length] as (typeof CANDY_SKINS)[number];
        for (const c of group.cells) colorByCell.set(`${c.x},${c.y}`, skin.base);
      }

      for (const c of round.cleared) {
        const p = this.cellToWorld(c);
        const hex = colorByCell.get(`${c.x},${c.y}`) ?? '#ffffff';
        this.fx.shatter(p.x, p.y, parseHex(hex), {
          count: 12,
          size: this.view.metricsView.cell * 0.19,
          speed: 0.26,
          gravity: 0.0026,
          upkick: 0.05,
        });
        this.fx.spark(p.x, p.y, parseHex(hex), this.view.metricsView.cell * 1.15, 210);
      }

      this.deps.sfx.pop(round.cascade, res.biggestGroup);
      if (round.cascade > 1) this.deps.sfx.cascadeBeat(round.cascade);

      const jobs: Promise<void>[] = [this.view.playClear(round.cleared), this.tweens.wait(150)];
      if (round.cascade >= 2) jobs.push(this.view.shake(1.6 + round.cascade * 0.9, 260));
      if (round.cascade >= 3) jobs.push(this.view.flash(0.3));
      await Promise.all(jobs);
      if (gen !== this.gen) return;

      this.score += round.score;
      this.deps.hud.setScore(this.score);
      const centroid = this.centroid(round.cleared);
      const label = round.cascade > 1 ? `+${round.score}  CASCADE x${round.cascade}` : `+${round.score}`;
      void this.floats.pop(label, centroid.x, centroid.y, {
        color: round.cascade > 2 ? 0xffd166 : 0xffffff,
        size: Math.min(40, 20 + round.cascade * 5 + res.biggestGroup),
        rise: 62,
      });

      await this.view.playFalls(round.falls);
      if (gen !== this.gen) return;
      const far = Math.max(0, ...round.falls.map((f) => f.distance));
      if (far > 0) this.deps.sfx.land(far);
      lastCleared = round.cleared;
    }

    if (gen !== this.gen) return;
    this.tilesCleared += res.clearedCount;
    this.bestCascade = Math.max(this.bestCascade, res.maxCascade);

    await this.summonMotif(res.clearedCount, res.maxCascade, res.biggestGroup, lastCleared, gen);
    if (gen !== this.gen) return;

    this.movesLeft = Math.max(0, this.movesLeft - 1);
    this.deps.hud.setMoves(this.movesLeft, this.currentLevel().moves);
    this.pushGoals();

    await this.ensurePlayable(gen);
    if (gen !== this.gen) return;

    this.phase = 'idle';
    this.checkOutcome();
  }

  /* -------------------------------------------------------------- the twist */

  private async summonMotif(
    clearedCount: number,
    maxCascade: number,
    biggestGroup: number,
    lastCleared: readonly Cell[],
    gen: number,
  ): Promise<void> {
    const tier = mosaicTier(mosaicPower(clearedCount, maxCascade, biggestGroup)) as Tier;
    const motif = buildMotif(tier, this.motifCursor++);
    const m = this.view.metricsView;
    const pixel = m.cell * (tier <= 2 ? 0.5 : tier === 3 ? 0.46 : 0.42);
    const centre = lastCleared.length > 0 ? this.centroid(lastCleared) : this.cellToWorld({ x: (this.board.w - 1) / 2, y: (this.board.h - 1) / 2 });

    // Keep the picture inside the plate so it never rains off the board.
    const halfW = (motif.width * pixel) / 2;
    const halfH = (motif.height * pixel) / 2;
    const cx = clamp(centre.x, halfW + m.pad, m.width - halfW - m.pad);
    const cy = clamp(centre.y, halfH + m.pad, m.height - halfH - m.pad);

    const sources = (lastCleared.length > 0 ? lastCleared : [{ x: this.board.w >> 1, y: this.board.h >> 1 }]).map(
      (c) => this.cellToWorld(c),
    );

    this.fx.mosaic(motif, {
      cx,
      cy,
      pixel,
      sources,
      onAssembled: () => {
        if (gen === this.gen) this.deps.sfx.motif(tier);
      },
    });

    const bonus = mosaicBonus(tier);
    this.score += bonus;
    this.deps.hud.setScore(this.score);
    if (tier >= 2) this.bigMosaics++;

    void this.floats.pop(`${tierLabel(tier)} · ${motif.name}  +${bonus}`, cx, cy - halfH - 14, {
      color: tier >= 4 ? 0xffd166 : tier >= 2 ? 0xa8d6ff : 0xffffff,
      size: Math.min(34, 18 + tier * 3),
      rise: 34,
      life: 1500,
    });
    if (tier >= 3) this.deps.hud.toast(`${tierLabel(tier)}: ${motif.name}  +${bonus}`, 1700);
  }

  private centroid(cells: readonly Cell[]): { x: number; y: number } {
    if (cells.length === 0) return this.cellToWorld({ x: (this.board.w - 1) / 2, y: (this.board.h - 1) / 2 });
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      sx += c.x;
      sy += c.y;
    }
    return this.cellToWorld({ x: sx / cells.length, y: sy / cells.length });
  }

  /** Deadlocked boards reshuffle themselves rather than stalling the run. */
  private async ensurePlayable(gen: number): Promise<void> {
    if (this.board.hasValidMove()) return;
    this.deps.hud.toast('No moves left — reshuffling');
    this.deps.sfx.reshuffle();
    await this.view.playOut();
    if (gen !== this.gen) return;
    this.board.reshuffle(this.rng);
    this.view.rebuild();
    await this.view.playIntro();
  }

  /* --------------------------------------------------------------- outcome */

  private checkOutcome(): void {
    const level = this.currentLevel();
    if (this.goalsMet()) {
      this.phase = 'over';
      this.deps.sfx.levelWin();
      const stars = starsFor(this.score, scoreTarget(level.goals));
      const last = this.levelIndex >= LEVELS.length - 1;
      this.deps.hud.showOverlay({
        eyebrow: last ? 'Run complete' : 'Level complete',
        title: last ? 'You cleared every board' : `${level.name} cleared`,
        stars,
        paragraphs: last
          ? ['Every motif summoned, every goal met. The pixels have stopped falling.']
          : ['The board is quiet. Take what you earned and move up.'],
        results: [
          { label: 'Score', value: this.score.toLocaleString() },
          { label: 'Tiles shattered', value: String(this.tilesCleared) },
          { label: 'Best cascade', value: `x${this.bestCascade}` },
          { label: 'Motifs tier 2+', value: String(this.bigMosaics) },
          { label: 'Moves to spare', value: String(this.movesLeft) },
        ],
        actions: last
          ? [{ label: 'Play again', action: 'restart-run', primary: true }]
          : [
              { label: 'Next level', action: 'next', primary: true },
              { label: 'Replay', action: 'replay' },
            ],
      });
      return;
    }

    if (this.movesLeft <= 0) {
      this.phase = 'over';
      this.deps.sfx.levelLose();
      this.deps.hud.showOverlay({
        eyebrow: 'Out of moves',
        title: level.name,
        paragraphs: ['The pixels ran out before the goals did. Set up drops that chain.'],
        results: this.goalView().map(({ goal, progress }) => ({
          label: goalLabel(goal),
          value: `${Math.min(progress, goal.target).toLocaleString()} / ${goal.target.toLocaleString()}`,
        })),
        actions: [
          { label: 'Retry level', action: 'replay', primary: true },
          { label: 'Back to level 1', action: 'restart-run' },
        ],
      });
    }
  }

  /* ---------------------------------------------------------------- overlays */

  private showStartOverlay(): void {
    this.deps.hud.showOverlay({
      eyebrow: 'Match · Shatter · Summon',
      title: 'Pixel Cascade',
      paragraphs: [
        'Swap adjacent candy to line up three or more. Cleared candy does not just vanish — it shatters into pixels that rain down and briefly assemble into a pixel-art motif.',
        'Longer cascades summon bigger, more detailed pictures and pay much better.',
      ],
      howto: [
        { icon: '⇄', text: 'Drag a tile onto a neighbour, or tap one then the other.' },
        { icon: '✦', text: 'A 3-match summons a tiny sprite; deep chains build gilded 13×13 motifs.' },
        { icon: '×', text: 'Every cascade round multiplies the score — chain drops, not just matches.' },
        { icon: '⌨', text: 'Keys: R restart · M mute · H help · Enter confirms.' },
      ],
      actions: [{ label: 'Start playing', action: 'start', primary: true }],
    });
  }

  showHelp(): void {
    const level = this.currentLevel();
    this.deps.hud.showOverlay({
      eyebrow: `Level ${level.id} · ${level.name}`,
      title: 'How to play',
      howto: [
        { icon: '⇄', text: 'Drag or tap two adjacent tiles to swap them. A swap only sticks if it makes a match.' },
        { icon: '≡', text: 'Match 3+ of a colour. Runs of 4 and 5 pay a quadratic size bonus.' },
        { icon: '×', text: 'Refills that match again cascade, and each round multiplies the whole round score.' },
        { icon: '✦', text: 'After the board settles, the shattered pixels assemble into a motif. Tier 2+ counts toward mosaic goals.' },
        { icon: '⌨', text: 'R restart · M mute · H help · Enter confirms.' },
      ],
      results: this.goalView().map(({ goal, progress }) => ({
        label: goalLabel(goal),
        value: `${Math.min(progress, goal.target).toLocaleString()} / ${goal.target.toLocaleString()}`,
      })),
      actions: [{ label: 'Back to the board', action: 'close', primary: true }],
    });
  }

  handleOverlayAction(action: string): void {
    switch (action) {
      case 'start':
      case 'close':
        this.deps.sfx.unlock();
        this.deps.sfx.click();
        this.deps.hud.hideOverlay();
        break;
      case 'next':
        this.nextLevel();
        break;
      case 'replay':
        this.restart();
        break;
      case 'restart-run':
        this.restartFromStart();
        break;
      default:
        this.deps.hud.hideOverlay();
    }
  }

  /** A legal swap, for the hint affordance and the browser smoke test. */
  hint(): [Cell, Cell] | null {
    const move = this.board.findValidMove();
    if (!move) return null;
    return [
      { x: this.board.colOf(move[0]), y: this.board.rowOf(move[0]) },
      { x: this.board.colOf(move[1]), y: this.board.rowOf(move[1]) },
    ];
  }

  /**
   * Play the first legal swap through the normal input path. Backs the autoplay
   * smoke test and any hint affordance.
   */
  async playHint(): Promise<boolean> {
    if (this.phase !== 'idle') return false;
    const move = this.hint();
    if (!move) return false;
    await this.attemptSwap(move[0], move[1]);
    return true;
  }

  /** Resolve once the board accepts input again, or the run ends. */
  async waitIdle(timeoutMs = 8000): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (this.phase !== 'idle' && this.phase !== 'over' && performance.now() < deadline) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    }
  }

  /** Client-space centre of a cell — lets tests drive real pointer input. */
  cellCenterClient(c: Cell): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    const p = this.view.centerOfCell(c);
    return { x: rect.left + this.originX + p.x, y: rect.top + this.originY + p.y };
  }

  /** Exposed for the browser smoke test. */
  get boardSnapshot(): string {
    return this.board.toString();
  }

  get state(): { phase: Phase; level: number; score: number; moves: number; live: number; tier: number } {
    return {
      phase: this.phase,
      level: this.levelIndex + 1,
      score: this.score,
      moves: this.movesLeft,
      live: this.fx?.live ?? 0,
      tier: MAX_TIER,
    };
  }
}

function parseHex(hex: string): number {
  return parseInt(hex.replace('#', ''), 16) || 0xffffff;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function scoreTarget(goals: readonly Goal[]): number {
  const scoreGoal = goals.find((g) => g.kind === 'score');
  return scoreGoal ? scoreGoal.target : 1;
}

function goalLabel(goal: Goal): string {
  const labels: Record<Goal['kind'], string> = {
    score: 'Score',
    tiles: 'Tiles cleared',
    mosaics: 'Motifs tier 2+',
    cascade: 'Best cascade',
  };
  return labels[goal.kind];
}
