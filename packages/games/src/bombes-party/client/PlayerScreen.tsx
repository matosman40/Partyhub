import { useEffect, useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { BoardCanvas } from './BoardCanvas.js';
import { Gamepad } from './Gamepad.js';
import type { BoardView, Dir, Mount } from './render.js';

const MOUNT_ICON: Record<Mount, { icon: string; label: string }> = {
  kangaroo: { icon: '🦘', label: 'Kangourou' },
  dino: { icon: '🦖', label: 'Dinosaure' },
};

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};
const BOMB_KEYS = new Set([' ', 'Enter', 'x', 'X']);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function BombesPartyPlayer({ publicState: pub, playerState: me, send }: PlayerViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const rootRef = useRef<HTMLElement>(null);

  const phase: string | undefined = pub?.phase;
  const canAct = phase === 'play' && !!me?.alive;

  const move = (dir: Dir) => {
    if (!canAct) return;
    void send('move', { dir }).then((res) => {
      if (!res.ok) setError(res.error ?? 'Déplacement refusé');
    });
  };

  const bomb = () => {
    if (!canAct) return;
    setError(null);
    void send('bomb').then((res) => {
      if (!res.ok) setError(res.error ?? 'Bombe refusée');
    });
  };

  // Clavier (flèches, WASD, Espace / Entrée / X). Ignoré quand l'écran est masqué
  // (plusieurs sièges peuvent coexister dans le même navigateur).
  const keyRef = useRef({ move, bomb });
  keyRef.current = { move, bomb };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (rootRef.current?.offsetParent === null) return;
      const dir = KEY_DIR[e.key];
      if (dir) {
        e.preventDefault();
        keyRef.current.move(dir);
      } else if (BOMB_KEYS.has(e.key) && !e.repeat) {
        e.preventDefault();
        keyRef.current.bomb();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pluie de confettis à la fin d'une manche gagnée par ce joueur.
  const wonRound = phase === 'round-over' && (me?.gained ?? 0) > 0;
  useEffect(() => {
    if (wonRound) setCelebrate((c) => c + 1);
  }, [wonRound]);

  // Le premier appui sur l'écran débloque le son du navigateur.
  const onPointerDown = () => unlockAudio();

  if (!pub) return null;
  if (phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  const view = pub as BoardView;
  const board = (
    <div className="arena arena-player" data-pos={me ? `${me.x},${me.y}` : undefined}>
      <BoardCanvas view={view} label="Votre plateau" celebrate={celebrate} />
    </div>
  );

  const footer = (
    <div className="player-foot">
      <SoundToggle />
    </div>
  );

  // Commandes fixes en bas : visibles en permanence pendant la manche.
  const dock = (
    <div className="control-dock">
      <Gamepad onMove={move} onBomb={bomb} disabled={!canAct} />
    </div>
  );

  if (phase === 'round-over') {
    const won = (me?.gained ?? 0) > 0;
    return (
      <section ref={rootRef} className="player-game fade-in" onPointerDownCapture={onPointerDown}>
        {board}
        {footer}
        <p className="big">{won ? 'Manche gagnée !' : 'Manche terminée'}</p>
        <p className="muted">Total : {me?.points ?? 0} pts</p>
        {dock}
      </section>
    );
  }

  const mount = me?.mount ? MOUNT_ICON[me.mount as Mount] : null;
  const speedLevel = me?.speed ?? 0;

  return (
    <section ref={rootRef} className="player-game fade-in" onPointerDownCapture={onPointerDown}>
      {board}
      {footer}

      {me?.alive ? (
        <>
          <ul className="hud-chips" aria-label="Vos bonus">
            <li className="hud-chip" title="Bombes posées / maximum">
              <span aria-hidden="true">💣</span> {me.placed} / {me.maxBombs}
            </li>
            <li className="hud-chip" title="Portée des explosions">
              <span aria-hidden="true">🔥</span> {me.range}
            </li>
            <li className="hud-chip" title="Vitesse">
              <span aria-hidden="true">👟</span> {speedLevel}
            </li>
            {mount && (
              <li className="hud-chip is-mount" title={mount.label}>
                <span aria-hidden="true">{mount.icon}</span> {mount.label}
              </li>
            )}
          </ul>
        </>
      ) : (
        <>
          <p className="big">Éliminé</p>
          <p className="muted">Suivez la fin de la manche sur l’écran principal.</p>
        </>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {dock}
    </section>
  );
}
