import { useState } from 'react';
import type { CatalogGame } from '@partyhub/shared';
import { CATEGORY_LABEL } from '../catalog/labels.js';
import { artStyle, playersLabel } from '../catalog/display.js';
import { GameLogo } from './GameLogo.js';
import { GameCard } from './GameCard.js';

/** « 1 joueur », « 4 joueurs », « 2 à 6 joueurs ». */
export function playersText(game: Pick<CatalogGame, 'minPlayers' | 'maxPlayers'>): string {
  if (game.minPlayers === game.maxPlayers) return game.minPlayers === 1 ? '1 joueur' : `${game.minPlayers} joueurs`;
  return `${playersLabel(game)} joueurs`;
}

/** Captures du jeu : une image en grand, les autres en vignettes. */
function Gallery({ name, photos }: { name: string; photos: string[] }) {
  const [index, setIndex] = useState(0);
  const current = photos[index] ?? photos[0];
  return (
    <section className="sheet-gallery" aria-labelledby="sheet-shots">
      <h2 id="sheet-shots">Captures</h2>
      <figure className="sheet-shot">
        <img
          src={current}
          alt={`Capture de ${name}, ${index + 1} sur ${photos.length}`}
          width={1280}
          height={720}
          loading="lazy"
        />
      </figure>
      {photos.length > 1 && (
        <ul className="sheet-thumbs" aria-label="Choisir une capture">
          {photos.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                aria-label={`Capture ${i + 1}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                <img src={src} alt="" width={1280} height={720} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="filter-note">Prises sur des parties d’essai avec des robots.</p>
    </section>
  );
}

/**
 * Fiche d'un jeu, sur le modèle d'une page de boutique : en-tête aux couleurs du jeu avec les
 * actions, puis les captures, la notice, la fiche technique et les autres jeux de la même catégorie.
 * Présentation seule : la page gère les appels à l'API et la navigation.
 */
export function GameSheet({
  game,
  recent,
  sameCategory,
  photos = [],
  creating,
  trying,
  error,
  onCreate,
  onTry,
}: {
  game: CatalogGame;
  /** Le jeu a été lancé récemment depuis cet appareil. */
  recent: boolean;
  /** Autres jeux de la même catégorie, déjà filtrés et limités par la page. */
  sameCategory: CatalogGame[];
  /** Adresses des captures du jeu (vide tant qu'il n'en a pas). */
  photos?: string[];
  creating: boolean;
  trying: boolean;
  error: string | null;
  onCreate: () => void;
  onTry: () => void;
}) {
  const busy = creating || trying;
  const { notice } = game;

  return (
    <article className="game-sheet">
      <header className="sheet-hero" style={artStyle(game.id, game.name)}>
        <div className="sheet-art" aria-hidden="true">
          <GameLogo gameId={game.id} name={game.name} className="sheet-logo" />
        </div>
        <div className="sheet-intro">
          <p className="sheet-kicker">{CATEGORY_LABEL[game.category]}</p>
          <h1 className="sheet-title">{game.name}</h1>
          <p className="sheet-lede">{game.description}</p>
          <ul className="sheet-tags" aria-label="Repères">
            <li className="tag">{playersText(game)}</li>
            <li className="tag">environ {game.durationMin} min</li>
            {game.ai && <li className="tag tag-ai">Avec IA</li>}
          </ul>
          <div className="sheet-actions">
            <button type="button" className="btn primary big" disabled={busy} onClick={onCreate}>
              {creating ? 'Création…' : 'Créer la salle'}
            </button>
            <button type="button" className="btn big" disabled={busy} onClick={onTry}>
              {trying ? 'Préparation…' : 'Essayer seul'}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </header>

      <div className="sheet-body">
        <div className="sheet-main">
          {photos.length > 0 && <Gallery key={game.id} name={game.name} photos={photos} />}

          <section className="sheet-section" aria-labelledby="sheet-about">
            <h2 id="sheet-about">À propos</h2>
            <p className="sheet-goal">{notice.goal}</p>

            {notice.steps.length > 0 && (
              <>
                <h3>Déroulé</h3>
                <ol className="sheet-steps">
                  {notice.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </>
            )}

            {notice.tips.length > 0 && (
              <>
                <h3>Astuces</h3>
                <ul className="sheet-tips">
                  {notice.tips.map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <aside className="sheet-facts" aria-labelledby="sheet-facts-title">
          <h2 id="sheet-facts-title">Fiche technique</h2>
          <dl>
            <div>
              <dt>Type</dt>
              <dd>{CATEGORY_LABEL[game.category]}</dd>
            </div>
            <div>
              <dt>Joueurs</dt>
              <dd>{playersText(game)}</dd>
            </div>
            <div>
              <dt>Durée</dt>
              <dd>environ {game.durationMin} min</dd>
            </div>
            <div>
              <dt>Intelligence artificielle</dt>
              <dd>{game.ai ? 'Oui, quand elle est configurée' : 'Non'}</dd>
            </div>
            <div>
              <dt>Appareils</dt>
              <dd>Un écran commun et les téléphones des joueurs</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{game.version}</dd>
            </div>
            <div>
              <dt>Sur cet appareil</dt>
              <dd>{recent ? 'Joué récemment' : 'Pas encore lancé depuis cet appareil'}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {sameCategory.length > 0 && (
        <section className="sheet-related" aria-labelledby="sheet-related-title">
          <h2 id="sheet-related-title">Dans la même catégorie</h2>
          <ul>
            {sameCategory.map((g) => (
              <li key={g.id}>
                <GameCard game={g} compact />
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
