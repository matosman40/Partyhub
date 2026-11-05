import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Ranking, TimerBar, type RankRow } from '../../client/ui.js';
import { PhotoMap, type MapMarker } from './PhotoMap.js';
import { Viewfinder } from './Viewfinder.js';

interface Placement {
  playerId: string;
  name: string;
  pin: { lat: number; lon: number } | null;
  km: number | null;
  gained: number;
}

/** Écran principal de Photo mystère : la photo dans le viseur, puis la carte des points à la révélation. */
export function PhotoHost({ publicState: pub, now }: HostViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') {
    return (
      <section className="pm-host fade-in final">
        <h2 className="big-title">Classement final</h2>
        <Ranking entries={pub.ranking as RankRow[]} />
      </section>
    );
  }

  if (pub.phase === 'ready' || !pub.photo) {
    return (
      <section className="pm-host fade-in">
        <h2 className="big-title">Photo mystère</h2>
        <p className="muted">Chacun place son point sur la carte. Plus on est près, plus on gagne.</p>
      </section>
    );
  }

  const revealed = pub.phase === 'reveal';
  const placements = pub.placements as Placement[];
  const markers: MapMarker[] = revealed
    ? placements
        .filter((p) => p.pin)
        .map((p) => ({ key: p.playerId, name: p.name, lat: p.pin!.lat, lon: p.pin!.lon, tone: 'other' as const }))
    : [];
  if (revealed && pub.answer) {
    markers.push({ key: 'answer', name: pub.answer.place, lat: pub.answer.lat, lon: pub.answer.lon, tone: 'answer' });
  }
  const links =
    revealed && pub.answer
      ? placements
          .filter((p) => p.pin)
          .map((p) => ({
            from: { key: p.playerId, name: p.name, lat: p.pin!.lat, lon: p.pin!.lon, tone: 'other' as const },
            to: {
              key: `answer-${p.playerId}`,
              name: pub.answer.place,
              lat: pub.answer.lat,
              lon: pub.answer.lon,
              tone: 'answer' as const,
            },
          }))
      : [];

  return (
    <section className={`pm-host fade-in${revealed ? ' is-revealed' : ''}`}>
      <Viewfinder src={pub.photo.src} round={pub.round} total={pub.total} />

      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          <p className="pm-status">
            Placez votre point sur la carte · {pub.placedCount} / {pub.playerCount} ont placé
          </p>
        </>
      )}

      {revealed && pub.answer && (
        <>
          <h2 className="pm-answer">
            {pub.answer.place} <span className="muted">· {pub.answer.country}</span>
          </h2>
          <p className="pm-credit">
            Photo : {pub.answer.credit} · {pub.answer.license} ·{' '}
            <a href={pub.answer.source} target="_blank" rel="noreferrer">
              source
            </a>
          </p>
        </>
      )}

      <PhotoMap
        label={revealed ? 'Carte : la bonne place et les points des joueurs' : 'Carte du monde'}
        markers={markers}
        links={links}
      />

      {revealed && (
        <ul className="pm-results" aria-label="Distances à la bonne place">
          {placements.map((p) => (
            <li key={p.playerId}>
              <span>{p.name}</span>
              <span className="muted">{p.km === null ? 'pas de point' : `${p.km.toLocaleString('fr-FR')} km`}</span>
              <span className="pm-gain">+{p.gained}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
