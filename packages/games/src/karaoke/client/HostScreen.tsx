import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { MediaStage, type HostMedia } from '../../media-quiz/client/MediaStage.js';

function seconds(ms: number): number {
  return Math.ceil(ms / 1000);
}

/** Écran principal : le passage avec le son, la voix rejouée sans l’image, puis la note du public. */
export function KaraokeHost({ publicState: pub, hostState, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'ready') {
    return (
      <section className="karaoke-host card fade-in">
        <h2>{pub.name}</h2>
        <p className="muted">Chacun chante un passage à tour de rôle. Les téléphones cherchent les chansons.</p>
      </section>
    );
  }

  if (pub.phase === 'final') {
    return (
      <section className="karaoke-host card fade-in">
        <h2>Fin du karaoké</h2>
        <ol className="karaoke-ranking">
          {pub.ranking.map((entry: { playerId: string; name: string; points: number; rank: number }) => (
            <li key={entry.playerId}>
              <span>{entry.name}</span>
              <span>{entry.points} points</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const onScreen = pub.phase === 'sing' || pub.phase === 'replay';
  const media = (hostState?.media ?? null) as HostMedia | null;

  return (
    <section className="karaoke-host fade-in">
      <header className="karaoke-head">
        <span className="muted small">
          Passage {pub.index + 1} sur {pub.total}
        </span>
        <h2>{pub.singerName}</h2>
        {pub.song && (
          <p className="karaoke-song">
            <strong>{pub.song.title}</strong>
            {pub.song.channel && <span className="muted"> · {pub.song.channel}</span>}
          </p>
        )}
      </header>

      {pub.phase === 'pick' && (
        <p className="karaoke-line">
          {pub.singerName} choisit sa chanson <span className="karaoke-count">{seconds(remaining)} s</span>
        </p>
      )}

      {onScreen && (
        <div className="karaoke-screen">
          <MediaStage media={media} active={onScreen} kind="film" picture muted={Boolean(hostState?.muted)} />
        </div>
      )}

      {pub.phase === 'replay' && hostState?.clip && (
        <>
          <p className="karaoke-line">Le rejeu de {pub.singerName}</p>
          <audio key={`clip-${pub.index}`} autoPlay src={hostState.clip} />
        </>
      )}

      {pub.phase === 'sing' && (
        <p className="karaoke-line">
          {pub.singerName} chante, les autres aussi <span className="karaoke-count">{seconds(remaining)} s</span>
        </p>
      )}

      {pub.phase === 'vote' && (
        <div className="karaoke-line">
          <p>
            Notez {pub.singerName} : {pub.ratedCount} / {pub.listenerCount} notes
          </p>
          {hostState?.pending?.length > 0 && <p className="muted small">Il manque : {hostState.pending.join(', ')}</p>}
        </div>
      )}

      {pub.phase === 'reveal' && (
        <div className="karaoke-line">
          {pub.abandoned ? (
            <p>Passage arrêté : aucun point.</p>
          ) : pub.average === null ? (
            <p>Pas de note pour ce passage.</p>
          ) : (
            <p>
              Moyenne : {pub.average.toFixed(1).replace('.', ',')} sur 5 · <strong>+{pub.gained} points</strong> pour{' '}
              {pub.singerName}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
