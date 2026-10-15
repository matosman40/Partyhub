import { useEffect, useRef } from 'react';
import type { HostViewProps } from '../../client/types.js';
import { play, startMusic, stopMusic } from '../../client/audio.js';
import { SoundToggle } from '../../client/SoundToggle.js';
import { useRemaining } from '../../client/hooks.js';
import { FinalHost, Ranking, WaitingScreen } from '../../client/ui.js';
import { BanquiseStage, type BanquiseView } from './Stage.js';

/** Écran principal : la banquise, le niveau, le vent, les éliminés et le classement. */
export function BanquiseHost({ publicState, now }: HostViewProps) {
  const pub = publicState as BanquiseView | undefined;
  const remaining = useRemaining(pub?.endsAt, now);
  const lastPhase = useRef<string | null>(null);
  const lastFallen = useRef(0);

  // Sons aux changements de phase, et chaque chute.
  useEffect(() => {
    if (!pub) return;
    if (pub.phase !== lastPhase.current) {
      if (pub.phase === 'play') {
        startMusic();
        play('start');
      } else if (pub.phase === 'level-over') {
        play(pub.winners.length > 0 ? 'win' : 'die');
      } else if (pub.phase === 'final') {
        stopMusic();
        play('final');
      }
      lastPhase.current = pub.phase;
    }
  }, [pub]);

  useEffect(() => {
    const count = pub?.fallen.length ?? 0;
    if (count > lastFallen.current) play('die');
    lastFallen.current = count;
  }, [pub?.fallen.length]);

  useEffect(() => () => stopMusic(), []);

  if (!pub) return null;
  if (pub.phase === 'final') return <FinalHost ranking={pub.ranking} />;
  if (pub.phase === 'ready') {
    return (
      <WaitingScreen
        title="En attente du lancement…"
        text="Chaque joueur prend son personnage sur son téléphone. La banquise fond dès le premier niveau."
      />
    );
  }

  const alive = pub.bodies.filter((b) => b.alive).length;
  const countdown = pub.phase === 'countdown' ? Math.ceil(remaining / 1000) : 0;
  const erodingSoon = pub.phase === 'play' && pub.erodeAt !== null ? Math.ceil((pub.erodeAt - pub.now) / 1000) : null;

  return (
    <section className="game-host fade-in ban-host">
      <div className="round-info">
        <span>
          Niveau {pub.level} / {pub.levelCount} · {pub.levelName}
        </span>
        {pub.phase === 'play' && <span>{alive} sur la glace</span>}
        <SoundToggle />
      </div>
      <p className="muted ban-hint">{pub.levelHint}</p>

      <div className="arena ban-arena">
        <BanquiseStage view={pub} label={`Banquise, niveau ${pub.level} : ${pub.levelName}`} />
        {pub.phase === 'countdown' && countdown > 0 && (
          <div className="intro-card" key={countdown} aria-live="assertive">
            {countdown}
          </div>
        )}
        {pub.phase === 'level-over' && (
          <div className="round-banner" aria-live="polite">
            <p className="round-banner-title">
              {pub.winnerName ? `${pub.winnerName} gagne le niveau` : 'Personne ne gagne ce niveau'}
            </p>
            {pub.winners.length > 0 && <p className="round-banner-points">+100 pts</p>}
          </div>
        )}
      </div>

      {pub.phase === 'play' && (
        <p className="muted ban-status">
          {erodingSoon !== null && erodingSoon > 0
            ? `La fonte commence dans ${erodingSoon} s`
            : 'La banquise fond par les bords'}
        </p>
      )}

      {pub.fallen.length > 0 && (
        <p className="ban-fallen">
          <span className="muted">Tombés à l’eau :</span> {pub.fallen.map((f) => f.name).join(', ')}
        </p>
      )}

      {pub.history.length > 0 && (
        <ul className="ban-history" aria-label="Niveaux joués">
          {pub.history.map((h) => (
            <li key={h.level}>
              <span className="muted">Niveau {h.level}</span> {h.winnerNames.join(' et ') || '—'}
            </li>
          ))}
        </ul>
      )}

      <Ranking entries={pub.ranking} />
    </section>
  );
}
