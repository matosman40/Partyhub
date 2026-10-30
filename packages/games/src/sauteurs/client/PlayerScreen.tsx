import { useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SENSOR_SEND_HZ, defaultCharacterFor, type CharacterSpec, type SensorSample } from '@partyhub/shared';
import type { PlayerViewProps } from '../../client/types.js';
import { AvatarsContext } from '../../client/avatar-context.js';
import { vibrate } from '../../client/device.js';
import { useRemaining } from '../../client/hooks.js';
import { PixelSprite } from '../../client/PixelSprite.js';
import { SensorSenderContext } from '../../client/sensors.js';
import { FinalScreen, WaitingScreen } from '../../client/ui.js';
import { formatSeconds } from './hud.js';
import { KeyboardState, controlsToSample } from './input.js';
import type { SauteursMine, SauteursPub } from './types.js';

export function SauteursPlayer({ publicState, playerState, playerId, now }: PlayerViewProps) {
  const pub = publicState as SauteursPub | null;
  const mine = playerState as SauteursMine | null;
  const avatars = useContext(AvatarsContext);
  if (!pub) return null;
  const me = pub.players.find((p) => p.id === playerId);
  const name = me?.name ?? '';
  const spec: CharacterSpec = avatars[name]?.character ?? defaultCharacterFor(name || playerId);
  const ranked = pub.ranking.find((r) => r.playerId === playerId);

  if (pub.phase === 'ready') {
    return (
      <section className="player-game fade-in sau-wait">
        <PixelSprite spec={spec} kind="pose" index="repos" scale={6} label="Votre personnage" />
        <p className="big">Préparez-vous !</p>
        <p className="muted">Tournez le téléphone en paysage : ◀ ▶ à gauche, SAUT à droite.</p>
      </section>
    );
  }
  if (pub.phase === 'final') return <FinalScreen points={mine?.points ?? ranked?.points ?? 0} rank={ranked?.rank} />;
  if (pub.phase === 'between') {
    const m = mine?.mine;
    return (
      <section className="player-game fade-in sau-wait">
        <PixelSprite
          spec={spec}
          kind="pose"
          index={m && m.finishTick !== null ? (m.rank === 1 ? 'victoire' : 'joie') : 'defaite'}
          scale={6}
          label="Votre personnage"
        />
        <p className="verdict">
          {m && m.finishTick !== null ? `Arrivé ${m.rank}${m.rank === 1 ? 'er' : 'e'} !` : 'Pas arrivé'}
        </p>
        {m && (
          <p className="muted">
            {m.finishTick !== null ? `${formatSeconds(m.finishTick)} · ` : ''}
            {m.coins} pièces · {m.deaths} chutes
          </p>
        )}
        {m && <p className="big-number">+{m.points}</p>}
        <p className="muted">Total : {mine?.points ?? 0} pts</p>
      </section>
    );
  }
  if (pub.phase === 'playing' && mine && !mine.racing) {
    return <WaitingScreen title="Niveau en cours" text="Vous rejoindrez la course au prochain niveau." />;
  }
  return (
    <Controller
      key={`${pub.step}`}
      pub={pub}
      now={now}
      spec={spec}
      points={mine?.points ?? ranked?.points ?? 0}
      rank={ranked?.rank ?? null}
      count={pub.ranking.length}
    />
  );
}

type Held = { left: boolean; right: boolean; jump: boolean };
const REST: SensorSample = { x: 0, y: 0, energy: 0 };

/**
 * La manette : deux boutons ◀ ▶ à gauche, un très grand bouton SAUT à droite. Chaque bouton réagit aux événements
 * pointeur (on peut tenir ▶ et SAUT en même temps), sans défilement ni zoom. Les commandes partent sur le canal
 * capteurs à 30 Hz tant qu'un bouton est tenu, immédiatement à chaque changement, et un dernier échantillon de repos
 * part au relâchement.
 */
function Controller({
  pub,
  now,
  spec,
  points,
  rank,
  count,
}: {
  pub: SauteursPub;
  now: number;
  spec: CharacterSpec;
  points: number;
  rank: number | null;
  count: number;
}) {
  const send = useContext(SensorSenderContext);
  const sendRef = useRef(send);
  const [held, setHeld] = useState<Held>({ left: false, right: false, jump: false });
  const [frame, setFrame] = useState<0 | 1 | 2 | 3>(0);
  const [facingLeft, setFacingLeft] = useState(false);
  const remaining = useRemaining(pub.startedAt, now);

  const heldRef = useRef<Held>({ left: false, right: false, jump: false });
  const padPointers = useRef(new Map<number, 'left' | 'right'>());
  const jumpPointers = useRef(new Set<number>());
  const keyboard = useRef(new KeyboardState());
  const lastSent = useRef<SensorSample | null>(null);
  const lastSentAt = useRef(0);
  const timer = useRef(0);
  const padRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sendRef.current = send;
  });

  const emit = (sample: SensorSample, force: boolean) => {
    const t = performance.now();
    if (!force && t - lastSentAt.current < 1000 / SENSOR_SEND_HZ - 6) return;
    lastSent.current = sample;
    lastSentAt.current = t;
    sendRef.current?.(sample);
  };

  /** Recalcule les boutons tenus ; envoie tout de suite si quelque chose a changé. */
  const refresh = () => {
    const kb = keyboard.current.held;
    const pads = [...padPointers.current.values()];
    const next: Held = {
      left: pads.includes('left') || kb.left,
      right: pads.includes('right') || kb.right,
      jump: jumpPointers.current.size > 0 || kb.jump,
    };
    const prev = heldRef.current;
    if (next.left === prev.left && next.right === prev.right && next.jump === prev.jump) return;
    heldRef.current = next;
    setHeld(next);
    if (next.left !== next.right) setFacingLeft(next.left);
    if (next.jump && !prev.jump) vibrate(18);
    const sample = controlsToSample(next);
    const anything = next.left || next.right || next.jump;
    // Changement : envoi immédiat (le dernier est l'échantillon de repos du relâchement).
    emit(anything ? sample : REST, true);
    if (anything && !timer.current) {
      timer.current = window.setInterval(() => {
        const h = heldRef.current;
        if (h.left || h.right || h.jump) emit(controlsToSample(h), false);
      }, 1000 / SENSOR_SEND_HZ);
    } else if (!anything && timer.current) {
      window.clearInterval(timer.current);
      timer.current = 0;
    }
  };

  // Hors de la course (ou démontage) : plus rien n'est envoyé, un dernier repos est signalé.
  useEffect(() => {
    const pads = padPointers.current;
    const jumps = jumpPointers.current;
    const kb = keyboard.current;
    return () => {
      window.clearInterval(timer.current);
      timer.current = 0;
      pads.clear();
      jumps.clear();
      kb.reset();
      const was = lastSent.current;
      if (was && (was.x !== 0 || was.energy !== 0)) sendRef.current?.(REST);
      lastSent.current = null;
      heldRef.current = { left: false, right: false, jump: false };
    };
  }, []);

  // Repli clavier (essai sur ordinateur) : mêmes commandes, même canal.
  useEffect(() => {
    const kb = keyboard.current;
    const on = (down: boolean) => (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (kb.set(e.code, down)) {
        e.preventDefault();
        refresh();
      }
    };
    const onDown = on(true);
    const onUp = on(false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Le coureur « court sur place » tant qu'on tient une direction.
  const moving = held.left !== held.right;
  useEffect(() => {
    if (!moving) {
      setFrame(0);
      return;
    }
    const id = window.setInterval(() => setFrame((f) => ((f + 1) % 4) as 0 | 1 | 2 | 3), 110);
    return () => window.clearInterval(id);
  }, [moving]);

  // Quel côté de la croix touche ce doigt ? La moitié gauche ou droite de la zone.
  const sideOf = (e: ReactPointerEvent<HTMLElement>): 'left' | 'right' => {
    const r = (padRef.current ?? e.currentTarget).getBoundingClientRect();
    return e.clientX < r.left + r.width / 2 ? 'left' : 'right';
  };
  const capture = (e: ReactPointerEvent<HTMLElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Identifiant de pointeur inconnu (événement synthétique) : le suivi se fait sans capture.
    }
  };
  const padDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    capture(e);
    padPointers.current.set(e.pointerId, sideOf(e));
    refresh();
  };
  const padMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!padPointers.current.has(e.pointerId)) return;
    const side = sideOf(e);
    if (padPointers.current.get(e.pointerId) !== side) {
      padPointers.current.set(e.pointerId, side);
      refresh();
    }
  };
  const padUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (padPointers.current.delete(e.pointerId)) refresh();
  };
  const jumpDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    capture(e);
    jumpPointers.current.add(e.pointerId);
    refresh();
  };
  const jumpUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (jumpPointers.current.delete(e.pointerId)) refresh();
  };

  const seconds = Math.ceil(remaining / 1000);
  const countingDown = pub.startedAt > 0 && remaining > 0;
  const noMenu = (e: { preventDefault: () => void }) => e.preventDefault();

  return (
    <section className="sau-pad" aria-label="Manette de la course" onContextMenu={noMenu}>
      <header className="sau-pad-top">
        <span className="sau-pad-level">
          {pub.level?.name ?? 'Course'} · {pub.step}/{pub.levelCount}
        </span>
        <span className="sau-pad-score">
          {rank !== null && count > 1 ? `${rank}ᵉ sur ${count} · ` : ''}
          {points} pts
        </span>
      </header>

      <div className="sau-pad-runner">
        {countingDown ? (
          <p className="sau-pad-count" role="status" aria-live="assertive">
            {seconds}
          </p>
        ) : (
          <PixelSprite
            spec={spec}
            kind={held.jump ? 'pose' : 'walk'}
            index={held.jump ? 'joie' : undefined}
            dir="side"
            frame={frame}
            scale={6}
            mirrored={facingLeft && !held.jump}
            label="Votre coureur"
          />
        )}
      </div>

      <div
        ref={padRef}
        className="sau-pad-dir"
        onPointerDown={padDown}
        onPointerMove={padMove}
        onPointerUp={padUp}
        onPointerCancel={padUp}
        onLostPointerCapture={padUp}
      >
        <button
          type="button"
          className={`sau-btn sau-btn-left${held.left ? ' is-held' : ''}`}
          aria-label="Courir à gauche"
          aria-pressed={held.left}
        >
          ◀
        </button>
        <button
          type="button"
          className={`sau-btn sau-btn-right${held.right ? ' is-held' : ''}`}
          aria-label="Courir à droite"
          aria-pressed={held.right}
        >
          ▶
        </button>
      </div>

      <button
        type="button"
        className={`sau-btn sau-btn-jump${held.jump ? ' is-held' : ''}`}
        aria-label="Sauter (maintenir pour sauter plus haut)"
        aria-pressed={held.jump}
        onPointerDown={jumpDown}
        onPointerUp={jumpUp}
        onPointerCancel={jumpUp}
        onLostPointerCapture={jumpUp}
      >
        SAUT
      </button>
    </section>
  );
}
