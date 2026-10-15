import { useEffect, useRef, useState } from 'react';
import type { PlayerViewProps } from '../../client/types.js';
import { unlockAudio } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { BanquiseStage, type BanquiseView } from './Stage.js';
import { BanquiseControls } from './Controls.js';

const LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A', 'q', 'Q']);
const RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D']);
const JUMP_KEYS = new Set([' ', 'ArrowUp', 'w', 'W', 'z', 'Z']);
const PUSH_KEYS = new Set(['e', 'E', 'Enter', 'x', 'X']);

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

/** Téléphone : la banquise, votre personnage, et les commandes en bas de l'écran. */
export function BanquisePlayer({ publicState, playerState, playerId, send }: PlayerViewProps) {
  const pub = publicState as BanquiseView | undefined;
  const me = playerState as
    | {
        points: number;
        rank: number | null;
        alive: boolean;
        grounded: boolean;
        canJump: boolean;
        pushReadyIn: number;
        gained: number | null;
      }
    | undefined;
  const phase = pub?.phase;
  const canControl = phase === 'play' && !!me?.alive;
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  // Direction demandée : seules les variations sont envoyées au serveur.
  const held = useRef({ left: false, right: false });
  const sentDir = useRef(0);
  const sendRef = useRef(send);
  sendRef.current = send;
  const canControlRef = useRef(canControl);
  canControlRef.current = canControl;

  const syncDir = () => {
    const dir = (held.current.right ? 1 : 0) - (held.current.left ? 1 : 0);
    if (dir === sentDir.current) return;
    sentDir.current = dir;
    void sendRef.current('input', { dir });
  };

  const setSide = (side: 'left' | 'right', down: boolean) => {
    if (down && !canControlRef.current) return;
    held.current[side] = down;
    syncDir();
  };

  const jump = () => {
    if (!canControlRef.current) return;
    void sendRef.current('jump').then((res) => {
      if (!res.ok) setError(null);
    });
  };

  const push = () => {
    if (!canControlRef.current) return;
    setError(null);
    void sendRef.current('push').then((res) => {
      if (!res.ok) setError(res.error ?? 'Poussée refusée');
    });
  };

  // Hors d'une manche, plus aucune direction maintenue.
  useEffect(() => {
    if (canControl) return;
    held.current = { left: false, right: false };
    syncDir();
  }, [canControl]);

  // Clavier : flèches ou A/D pour marcher, Espace ou W pour sauter, E ou Entrée pour pousser.
  const keysRef = useRef({ setSide, jump, push });
  keysRef.current = { setSide, jump, push };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (rootRef.current?.offsetParent === null) return;
      if (LEFT_KEYS.has(e.key)) {
        e.preventDefault();
        if (!e.repeat) keysRef.current.setSide('left', true);
      } else if (RIGHT_KEYS.has(e.key)) {
        e.preventDefault();
        if (!e.repeat) keysRef.current.setSide('right', true);
      } else if (JUMP_KEYS.has(e.key)) {
        e.preventDefault();
        if (!e.repeat) keysRef.current.jump();
      } else if (PUSH_KEYS.has(e.key)) {
        e.preventDefault();
        if (!e.repeat) keysRef.current.push();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (LEFT_KEYS.has(e.key)) keysRef.current.setSide('left', false);
      else if (RIGHT_KEYS.has(e.key)) keysRef.current.setSide('right', false);
    };
    const blur = () => {
      keysRef.current.setSide('left', false);
      keysRef.current.setSide('right', false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  if (!pub) return null;
  if (phase === 'final') return <FinalScreen points={me?.points ?? 0} rank={me?.rank ?? null} />;
  if (phase === 'ready') {
    return <WaitingScreen title="Préparez-vous !" text="La banquise se forme sur l’écran principal." />;
  }

  const stage = (
    <div className="arena arena-player" onPointerDownCapture={() => unlockAudio()}>
      <BanquiseStage view={pub} youId={playerId} label={`Votre banquise, niveau ${pub.level}`} />
    </div>
  );
  const footer = (
    <div className="player-foot">
      <SoundToggle />
    </div>
  );

  const hud = (
    <ul className="hud-chips" aria-label="Votre situation">
      <li className="hud-chip">
        Niveau {pub.level} / {pub.levelCount}
      </li>
      <li className="hud-chip">{me?.alive ? 'Sur la glace' : 'À l’eau'}</li>
      <li className="hud-chip">{me?.points ?? 0} pts</li>
    </ul>
  );

  if (phase === 'level-over') {
    const won = (me?.gained ?? 0) > 0;
    return (
      <section ref={rootRef} className="player-game fade-in">
        {stage}
        {footer}
        <p className="big">{won ? 'Niveau gagné !' : me?.alive ? 'Niveau terminé' : 'Tombé à l’eau'}</p>
        <p className="muted">
          {pub.winnerName ? `${pub.winnerName} gagne le niveau.` : 'Personne ne gagne ce niveau.'}
        </p>
        {hud}
      </section>
    );
  }

  const dock = (
    <div className="control-dock">
      <BanquiseControls
        disabled={!canControl}
        canJump={!!me?.canJump}
        pushCooldownMs={me?.pushReadyIn ?? 0}
        onHold={setSide}
        onJump={jump}
        onPush={push}
      />
    </div>
  );

  return (
    <section ref={rootRef} className="player-game fade-in">
      {stage}
      {footer}
      {phase === 'countdown' && <p className="big">Prêt ?</p>}
      {hud}
      {!me?.alive && phase === 'play' && (
        <>
          <p className="big">Tombé à l’eau</p>
          <p className="muted">Suivez la fin du niveau sur l’écran principal.</p>
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
