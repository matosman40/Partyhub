import { useEffect, useRef, useState } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { startMusic, stopMusic } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, Ranking, TimerBar, WaitingScreen } from '../../client/ui.js';
import { BoardCanvas } from './BoardCanvas.js';
import type { BoardView } from './render.js';

/** Durée d'affichage de l'annonce de manche (« Manche n », puis « GO ! »). */
const INTRO_STEP_MS = 900;

export function BombesPartyHost({ publicState: pub, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  const [intro, setIntro] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(0);
  const lastRound = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  // Annonce de chaque manche, puis musique de fond tant qu'elle dure.
  useEffect(() => {
    if (pub?.phase !== 'play' || lastRound.current === pub.round) return;
    lastRound.current = pub.round;
    clearTimers();
    setIntro(`Manche ${pub.round + 1}`);
    timers.current.push(
      window.setTimeout(() => setIntro('GO !'), INTRO_STEP_MS),
      window.setTimeout(() => setIntro(null), INTRO_STEP_MS * 2),
    );
  }, [pub?.phase, pub?.round]);

  useEffect(() => {
    if (pub?.phase === 'play') startMusic();
    else if (pub?.phase === 'final') stopMusic();
  }, [pub?.phase]);

  // Pluie de confettis quand une manche est gagnée.
  useEffect(() => {
    if (pub?.phase === 'round-over' && pub.winnerName) setCelebrate((c) => c + 1);
  }, [pub?.phase, pub?.winnerName]);

  useEffect(
    () => () => {
      clearTimers();
      stopMusic();
    },
    [],
  );

  if (!pub) return null;

  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title="En attente du lancement…"
        text="Chaque joueur prend son personnage sur son téléphone."
      />
    );
  }

  const view = pub as BoardView;
  const alive = view.units.filter((u) => u.alive).length;
  const showIntro = intro !== null && pub.phase === 'play';

  return (
    <section className="game-host fade-in">
      <div className="round-info">
        <span>
          Manche {pub.round + 1} / {pub.total} · {alive} en vie
        </span>
        <SoundToggle />
      </div>

      <div className="arena">
        <BoardCanvas view={view} label="Plateau de jeu" celebrate={celebrate} />
        {showIntro && (
          <div className="intro-card" key={intro} aria-live="assertive">
            {intro}
          </div>
        )}
        {pub.phase === 'round-over' && (
          <div className="round-banner" aria-live="polite">
            <p className="round-banner-title">
              {pub.winnerName ? `${pub.winnerName} gagne la manche` : 'Personne ne gagne cette manche'}
            </p>
            {pub.winnerName && <p className="round-banner-points">+100 pts</p>}
          </div>
        )}
      </div>

      {pub.phase === 'play' && <TimerBar remaining={remaining} total={pub.durationMs} />}
      <Ranking entries={pub.ranking} />
    </section>
  );
}
