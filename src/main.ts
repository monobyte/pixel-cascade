import { Game } from './game';
import { Sfx } from './audio/sfx';
import { Hud } from './ui/hud';

function boot(): void {
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('#stage is missing from index.html');

  const sfx = new Sfx();
  let game: Game | null = null;

  const hud = new Hud({
    onRestart: () => game?.restart(),
    onToggleSound: () => game?.toggleSound(),
    onHelp: () => game?.showHelp(),
    onOverlayAction: (action) => game?.handleOverlayAction(action),
  });

  game = new Game({ stage, hud, sfx });
  void game.start();

  // Keep the board centred and correctly scaled as the window changes shape.
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => game?.relayout());
  });
  observer.observe(stage);

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && hud.overlayOpen) {
      e.preventDefault();
      hud.activatePrimary();
    }
  });

  // First gesture unlocks WebAudio (browsers require it).
  const unlock = (): void => {
    sfx.unlock();
    sfx.resume();
  };
  window.addEventListener('pointerdown', unlock, { once: true });

  (window as { __pixelCascade?: Game }).__pixelCascade = game;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
