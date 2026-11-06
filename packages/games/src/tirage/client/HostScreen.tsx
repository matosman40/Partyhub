import type { HostViewProps } from '../../client/types.js';
import { useRemaining } from '../../client/hooks.js';
import { Ranking, TimerBar, type RankRow } from '../../client/ui.js';
import { PhotoMap, type MapMarker } from '../../photo-mystere/client/PhotoMap.js';

/** Écran principal de Tirage surprise : la question (avec l'image, les choix ou la carte), le temps, puis la révélation. */
export function TirageHost({ publicState: pub, now }: HostViewProps) {
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

  if (pub.phase === 'preparation') {
    return (
      <section className="pm-host fade-in">
        <h2 className="big-title">Préparation</h2>
        <p className="muted">Recherche du thème « {pub.libre?.theme} » sur Wikidata…</p>
      </section>
    );
  }

  if (pub.phase === 'ready' || !pub.question) {
    return (
      <section className="pm-host fade-in">
        <h2 className="big-title">Tirage surprise</h2>
        <p className="muted">Devinez des chiffres réels, reconnaissez un auteur, ou placez un lieu sur la carte.</p>
      </section>
    );
  }

  const revealed = pub.phase === 'reveal';
  const localisation = pub.kind === 'localiser';
  return (
    <section className="pm-host fade-in">
      <div className="round-info">
        Question {pub.round} / {pub.total}
      </div>
      <h2 className="question-title">{pub.question}</h2>
      {pub.libre?.etat === 'secours' && (
        <p className="notice">
          Thème « {pub.libre.theme} » indisponible ({pub.libre.erreur}) : questions des thèmes cochés.
        </p>
      )}
      {pub.image && (
        <figure className="tirage-image">
          <img src={pub.image} alt={localisation ? 'Lieu à placer sur la carte' : 'Tableau à identifier'} />
        </figure>
      )}
      {!revealed && (
        <>
          <TimerBar remaining={remaining} total={pub.guessSeconds * 1000} />
          {pub.kind === 'identifier' && pub.choices && (
            <ol className="tirage-choix" aria-label="Réponses possibles">
              {(pub.choices as string[]).map((texte) => (
                <li key={texte}>{texte}</li>
              ))}
            </ol>
          )}
          <p className="muted">
            {pub.answered} / {pub.playerCount} ont répondu
          </p>
        </>
      )}
      {revealed && pub.answer && pub.kind === 'estimer' && (
        <p className="pm-answer">
          {pub.answer.valeur?.toLocaleString('fr-FR')} {pub.unit}
        </p>
      )}
      {revealed && pub.answer && pub.kind !== 'estimer' && <p className="pm-answer">{pub.answer.reponse}</p>}
      {revealed && pub.answer && <p className="pm-credit">Source : {pub.answer.source}</p>}
      {revealed && pub.answer?.credit && <p className="pm-credit">Crédit : {pub.answer.credit}</p>}
      {revealed && localisation && pub.target && (
        <PhotoMap
          label="Carte : le lieu et les points des joueurs"
          markers={[
            ...pub.placements
              .filter((p: { pin: unknown }) => p.pin)
              .map((p: { playerId: string; name: string; pin: { lat: number; lon: number } }) => ({
                key: p.playerId,
                name: p.name,
                lat: p.pin.lat,
                lon: p.pin.lon,
                tone: 'other' as const,
              })),
            { key: 'lieu', name: pub.answer?.reponse ?? 'Lieu', ...pub.target, tone: 'answer' as const },
          ]}
          links={pub.placements
            .filter((p: { pin: unknown }) => p.pin)
            .map((p: { playerId: string; name: string; pin: { lat: number; lon: number } }) => ({
              from: { key: p.playerId, name: p.name, lat: p.pin.lat, lon: p.pin.lon, tone: 'other' } as MapMarker,
              to: { key: 'lieu', name: 'Lieu', ...pub.target, tone: 'answer' } as MapMarker,
            }))}
        />
      )}
      {revealed && pub.answer && (
        <ul className="pm-results" aria-label="Réponses">
          {pub.placements.map(
            (p: {
              playerId: string;
              name: string;
              guess: number | null;
              choice: string | null;
              km: number | null;
              gained: number;
            }) => (
              <li key={p.playerId}>
                <span>{p.name}</span>
                <span className="muted">
                  {localisation
                    ? p.km === null
                      ? 'pas de point'
                      : `${p.km.toLocaleString('fr-FR')} km`
                    : pub.kind === 'identifier'
                      ? (p.choice ?? 'pas de réponse')
                      : p.guess === null
                        ? 'pas d’estimation'
                        : p.guess.toLocaleString('fr-FR')}
                </span>
                <span className="pm-gain">+{p.gained}</span>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
