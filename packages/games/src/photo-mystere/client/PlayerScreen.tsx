import type { PlayerViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { TimerBar } from '../../client/ui.js';
import { PhotoMap, type MapMarker } from './PhotoMap.js';
import { Viewfinder } from './Viewfinder.js';

/**
 * Téléphone de Photo mystère : la photo dans le viseur et la carte. Toucher la carte pose ou déplace son point ;
 * le serveur ne révèle les autres points qu’à la fin de la manche.
 */
export function PhotoPlayer({ publicState: pub, playerState: me, send, now }: PlayerViewProps) {
  const remaining = useRemaining(pub?.endsAt, now);
  if (!pub) return null;

  if (pub.phase === 'final') {
    return (
      <section className="pm-player fade-in">
        <h2 className="big-title">Fin de partie</h2>
        <p>
          {me?.points ?? 0} points · {me?.rank ? `${me.rank}ᵉ` : ''}
        </p>
      </section>
    );
  }

  if (pub.phase === 'ready' || !pub.photo) {
    return (
      <section className="pm-player fade-in">
        <p className="muted">La partie va commencer, regardez l’écran principal.</p>
      </section>
    );
  }

  const revealed = pub.phase === 'reveal';
  const myPin = me?.myPin ?? null;
  const markers: MapMarker[] = [];
  if (myPin) markers.push({ key: 'me', name: 'Votre point', lat: myPin.lat, lon: myPin.lon, tone: 'me' });
  if (revealed && pub.answer) {
    markers.push({ key: 'answer', name: pub.answer.place, lat: pub.answer.lat, lon: pub.answer.lon, tone: 'answer' });
  }
  const links =
    revealed && pub.answer && myPin
      ? [
          {
            from: { key: 'me', name: 'Votre point', lat: myPin.lat, lon: myPin.lon, tone: 'me' as const },
            to: {
              key: 'answer-me',
              name: pub.answer.place,
              lat: pub.answer.lat,
              lon: pub.answer.lon,
              tone: 'answer' as const,
            },
          },
        ]
      : [];

  function pick(lat: number, lon: number) {
    void send('place', { lat, lon });
  }

  return (
    <section className="pm-player fade-in">
      <Viewfinder src={pub.photo.src} round={pub.round} total={pub.total} />

      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          <p className="pm-hint">
            {myPin ? 'Point posé. Touchez ailleurs pour le déplacer.' : 'Touchez la carte où la photo a été prise.'}
          </p>
          <PhotoMap label="Carte : touchez le lieu" markers={markers} onPick={pick} />
        </>
      )}

      {revealed && pub.answer && (
        <>
          <h2 className="pm-answer">{pub.answer.place}</h2>
          <p className="pm-status">
            {me?.km === null || me?.km === undefined
              ? 'Pas de point posé pour cette photo.'
              : `À ${me.km.toLocaleString('fr-FR')} km · +${me.gained} points`}
          </p>
          <PhotoMap label="Carte : la bonne place et votre point" markers={markers} links={links} />
        </>
      )}
    </section>
  );
}
