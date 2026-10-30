import type { Goal, LevelDef } from '../core/levels';
import { GOAL_LABELS, goalProgressLabel } from '../core/levels';

export interface GoalView {
  goal: Goal;
  progress: number;
}

export interface OverlayAction {
  label: string;
  action: string;
  primary?: boolean;
}

/**
 * Overlay content is declared as data, never as HTML: the HUD builds the DOM
 * itself, so nothing that flows in from the game can inject markup.
 */
export interface OverlaySpec {
  eyebrow?: string;
  title: string;
  paragraphs?: readonly string[];
  /** Icon + line rows for the help screen. */
  howto?: readonly { icon: string; text: string }[];
  /** Label/value rows for the results screen. */
  results?: readonly { label: string; value: string }[];
  /** 0-3 fills the star row on the level-complete card. */
  stars?: number;
  actions: OverlayAction[];
}

export interface HudHandlers {
  onRestart: () => void;
  onToggleSound: () => void;
  onHelp: () => void;
  onOverlayAction: (action: string) => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

/** DOM chrome around the canvas: score, goals, buttons, toast, modal. */
export class Hud {
  private readonly levelChip = el<HTMLElement>('level-chip');
  private readonly levelName = el<HTMLElement>('level-name');
  private readonly levelSub = el<HTMLElement>('level-sub');
  private readonly scoreEl = el<HTMLElement>('score');
  private readonly movesEl = el<HTMLElement>('moves');
  private readonly goalsEl = el<HTMLUListElement>('goals');
  private readonly hintEl = el<HTMLElement>('hint');
  private readonly toastEl = el<HTMLElement>('toast');
  private readonly overlayEl = el<HTMLElement>('overlay');
  private readonly overlayEyebrow = el<HTMLElement>('overlay-eyebrow');
  private readonly overlayTitle = el<HTMLElement>('overlay-title');
  private readonly overlayBody = el<HTMLElement>('overlay-body');
  private readonly overlayDetail = el<HTMLElement>('overlay-detail');
  private readonly overlayActions = el<HTMLElement>('overlay-actions');
  private readonly soundBtn = el<HTMLButtonElement>('btn-sound');
  private readonly soundLabel = el<HTMLElement>('sound-label');

  private readonly handlers: HudHandlers;
  private shownScore = 0;
  private targetScore = 0;
  private scoreRaf = 0;
  private toastTimer = 0;
  private goalNodes = new Map<string, { li: HTMLLIElement; progress: HTMLElement; bar: HTMLElement }>();

  constructor(handlers: HudHandlers) {
    this.handlers = handlers;
    document.getElementById('btn-restart')?.addEventListener('click', () => handlers.onRestart());
    document.getElementById('btn-help')?.addEventListener('click', () => handlers.onHelp());
    this.soundBtn.addEventListener('click', () => handlers.onToggleSound());
    this.overlayEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      if (btn?.dataset.action) this.handlers.onOverlayAction(btn.dataset.action);
    });
  }

  setLevel(level: LevelDef, total: number): void {
    this.levelChip.textContent = `Level ${level.id} of ${total}`;
    this.levelName.textContent = level.name;
    this.levelSub.textContent = `${level.subtitle} · ${level.width}×${level.height}`;
    this.hintEl.textContent = level.hint;
    this.goalNodes.clear();
    this.goalsEl.innerHTML = '';
    for (const goal of level.goals) {
      const li = document.createElement('li');
      li.className = 'goal';
      const top = document.createElement('div');
      top.className = 'goal-top';
      const label = document.createElement('span');
      label.className = 'goal-label';
      label.textContent = GOAL_LABELS[goal.kind](goal.target);
      const progress = document.createElement('span');
      progress.className = 'goal-progress';
      progress.textContent = goalProgressLabel(goal, 0);
      top.append(label, progress);
      const bar = document.createElement('div');
      bar.className = 'goal-bar';
      const fill = document.createElement('i');
      bar.append(fill);
      li.append(top, bar);
      this.goalsEl.append(li);
      this.goalNodes.set(`${goal.kind}:${goal.target}`, { li, progress, bar: fill });
    }
  }

  setScore(score: number, animate = true): void {
    this.targetScore = score;
    if (!animate || this.shownScore === score) {
      this.shownScore = score;
      this.scoreEl.textContent = String(score);
      return;
    }
    if (this.scoreRaf) return;
    const from = this.shownScore;
    const start = performance.now();
    const step = (now: number): void => {
      const p = Math.min(1, (now - start) / 420);
      const eased = 1 - Math.pow(1 - p, 3);
      this.shownScore = Math.round(from + (this.targetScore - from) * eased);
      this.scoreEl.textContent = String(this.shownScore);
      this.scoreRaf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    this.scoreRaf = requestAnimationFrame(step);
    this.bump(this.scoreEl);
  }

  setMoves(left: number, total: number): void {
    this.movesEl.textContent = String(Math.max(0, left));
    this.movesEl.classList.toggle('low', left <= Math.max(3, Math.floor(total * 0.2)));
  }

  setGoals(view: readonly GoalView[]): void {
    for (const { goal, progress } of view) {
      const node = this.goalNodes.get(`${goal.kind}:${goal.target}`);
      if (!node) continue;
      node.progress.textContent = goalProgressLabel(goal, progress);
      node.bar.style.width = `${Math.min(100, (progress / goal.target) * 100)}%`;
      node.li.classList.toggle('done', progress >= goal.target);
    }
  }

  toast(text: string, ms = 1500): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  setMuted(muted: boolean): void {
    this.soundBtn.setAttribute('aria-pressed', String(muted));
    this.soundLabel.textContent = muted ? 'Muted' : 'Sound';
  }

  showOverlay(spec: OverlaySpec): void {
    this.overlayEyebrow.textContent = spec.eyebrow ?? '';
    this.overlayEyebrow.hidden = !spec.eyebrow;
    this.overlayTitle.textContent = spec.title;

    this.overlayBody.replaceChildren(...(spec.paragraphs ?? []).map((text) => {
      const p = document.createElement('p');
      p.textContent = text;
      return p;
    }));

    const detail: Node[] = [];
    if (spec.stars !== undefined) detail.push(this.buildStars(spec.stars));
    if (spec.results) detail.push(this.buildResults(spec.results));
    if (spec.howto) detail.push(this.buildHowto(spec.howto));
    this.overlayDetail.replaceChildren(...detail);

    this.overlayActions.replaceChildren(
      ...spec.actions.map((action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = action.primary ? 'btn-primary' : 'btn';
        btn.textContent = action.label;
        btn.dataset.action = action.action;
        return btn;
      }),
    );

    this.overlayEl.hidden = false;
    this.overlayActions.querySelector<HTMLButtonElement>('.btn-primary')?.focus();
  }

  private buildStars(count: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'stars';
    for (let i = 0; i < 3; i++) {
      const star = document.createElement('span');
      star.textContent = '★';
      if (i < Math.max(0, Math.min(3, count))) star.classList.add('on');
      wrap.append(star);
    }
    return wrap;
  }

  private buildResults(rows: readonly { label: string; value: string }[]): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'results';
    for (const row of rows) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = row.label;
      const value = document.createElement('b');
      value.textContent = row.value;
      li.append(label, value);
      list.append(li);
    }
    return list;
  }

  private buildHowto(rows: readonly { icon: string; text: string }[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'howto';
    for (const row of rows) {
      const item = document.createElement('div');
      const icon = document.createElement('b');
      icon.textContent = row.icon;
      const text = document.createElement('span');
      text.textContent = row.text;
      item.append(icon, text);
      wrap.append(item);
    }
    return wrap;
  }

  hideOverlay(): void {
    this.overlayEl.hidden = true;
  }

  /** Keyboard affordance for Enter on an open modal. */
  activatePrimary(): void {
    this.overlayActions.querySelector<HTMLButtonElement>('.btn-primary')?.click();
  }

  get overlayOpen(): boolean {
    return !this.overlayEl.hidden;
  }

  private bump(node: HTMLElement): void {
    node.classList.remove('bump');
    void node.offsetWidth; // force reflow so the animation restarts
    node.classList.add('bump');
  }

  destroy(): void {
    if (this.scoreRaf) cancelAnimationFrame(this.scoreRaf);
    window.clearTimeout(this.toastTimer);
  }
}
