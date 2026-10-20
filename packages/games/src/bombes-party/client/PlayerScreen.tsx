import { useEffect, useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { BoardCanvas } from './BoardCanvas.js';
import { Gamepad, type RideAction, type RideOptions } from './Gamepad.js';
import type { BoardView, Dir } from './render.js';

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
/** Gestes du kangourou au clavier : Q soulève, E lance, F frappe. */
const RIDE_KEYS: Record<string, RideAction> = { q: 'lift', Q: 'lift', e: 'throw', E: 'throw', f: 'kick', F: 'kick' };
const NO_RIDE: RideOptions = { lift: false, kick: false, throw: false };

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
  const ride: RideOptions | null = me?.mount === 'kangaroo' ? ((me.ride as RideOptions | undefined) ?? NO_RIDE) : null;

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

  const rideWith = (action: RideAction) => {
    if (!canAct) return;
    setError(null);
    void send(action).then((res) => {
      if (!res.ok) setError(res.error ?? 'Geste refusé');
    });
  };

  // Clavier (flèches, WASD, Espace / Entrée / X, Q E F). Ignoré quand l’écran est masqué
  // (plusieurs sièges peuvent coexister dans le même navigateur).
  const keyRef = useRef({ move, bomb, rideWith });
  keyRef.current = { move, bomb, rideWith };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (rootRef.current?.offsetParent === null) return;
      const dir = KEY_DIR[e.key];
      const action = RIDE_KEYS[e.key];
      if (dir) {
        e.preventDefault();
        keyRef.current.move(dir);
      } else if (action && !e.repeat) {
        e.preventDefault();
        keyRef.current.rideWith(action);
      } else if (BOMB_KEYS.has(e.key) && !e.repeat) {
        e.preventDefault();
        keyRef.current.bomb();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pluie de confettis à la fin d’une manche gagnée par ce joueur.
  const wonRound = phase === 'round-over' && (me?.gained ?? 0) > 0;
  useEffect(() => {
    if (wonRound) setCelebrate((c) => c + 1);
  }, [wonRound]);

  // Le premier appui sur l’écran débloque le son du navigateur.
  const onPointerDown = () => unlockAudio();

  if (!pub) return null;
  if (phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La partie va commencer sur l’écran principal." />;
  }

  const view = pub as BoardView;
  const board = (
    <div className="arena arena-player" data-pos={me ? `${me.x},${me.y}` : undefined}>
      <BoardCanvas view={view} label="Votre plateau" celebrate={celebrate} focus={me ? { x: me.x, y: me.y } : null} />
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
      <Gamepad onMove={move} onBomb={bomb} onRide={rideWith} ride={ride} disabled={!canAct} />
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

  return (
    <section ref={rootRef} className="player-game fade-in" onPointerDownCapture={onPointerDown}>
      {board}
      {footer}

      {me?.alive ? (
        me.carrying && <p className="muted ride-hint">Bombe soulevée : lancez-la ou frappez-la.</p>
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
