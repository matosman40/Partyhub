import type { GameCategory } from '@partyhub/shared';
import { CATEGORY_LABEL, PLAYER_CHOICES } from '../catalog/labels.js';
import { AI_LABEL, DURATION_LABEL, type AiChoice, type CatalogFilters, type Duration } from '../catalog/filters.js';

const DURATION_CHOICES = Object.keys(DURATION_LABEL) as Duration[];
const AI_CHOICES = Object.keys(AI_LABEL) as AiChoice[];

/**
 * Panneau des filtres du catalogue. À gauche sur grand écran ; sur téléphone, il s’ouvre
 * depuis le bouton « Filtres » (le parent gère `hidden`).
 */
export function CatalogFilterPanel({
  id,
  hidden,
  filters,
  categories,
  recentCount,
  activeCount,
  onChange,
  onReset,
}: {
  id: string;
  hidden: boolean;
  filters: CatalogFilters;
  /** Catégories présentes dans le catalogue, seules proposées. */
  categories: GameCategory[];
  /** Nombre de jeux joués récemment sur cet appareil. */
  recentCount: number;
  activeCount: number;
  onChange: (patch: Partial<CatalogFilters>) => void;
  onReset: () => void;
}) {
  function toggleCategory(c: GameCategory) {
    const next = filters.categories.includes(c)
      ? filters.categories.filter((x) => x !== c)
      : [...filters.categories, c];
    onChange({ categories: next });
  }

  return (
    <aside id={id} className="filters-panel" aria-label="Filtres des jeux" hidden={hidden}>
      <div className="filter-field">
        <label htmlFor="filtre-joueurs" className="filter-label">
          Nombre de joueurs
        </label>
        <select
          id="filtre-joueurs"
          value={filters.players ?? ''}
          onChange={(e) => onChange({ players: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">Peu importe</option>
          {PLAYER_CHOICES.map((n) => (
            <option key={n} value={n}>
              {n === 1 ? '1 joueur' : `${n} joueurs`}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="filter-group">
        <legend>Type de jeu</legend>
        {categories.map((c) => (
          <label key={c} className="filter-option">
            <input type="checkbox" checked={filters.categories.includes(c)} onChange={() => toggleCategory(c)} />
            <span>{CATEGORY_LABEL[c]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="filter-group">
        <legend>Durée</legend>
        {DURATION_CHOICES.map((d) => (
          <label key={d} className="filter-option">
            <input
              type="radio"
              name="filtre-duree"
              checked={filters.duration === d}
              onChange={() => onChange({ duration: d })}
            />
            <span>{DURATION_LABEL[d]}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="filter-group">
        <legend>Intelligence artificielle</legend>
        {AI_CHOICES.map((a) => (
          <label key={a} className="filter-option">
            <input type="radio" name="filtre-ia" checked={filters.ai === a} onChange={() => onChange({ ai: a })} />
            <span>{AI_LABEL[a]}</span>
          </label>
        ))}
        <p className="filter-note">Les jeux « Avec IA » s’appuient sur une IA quand elle est configurée.</p>
      </fieldset>

      <fieldset className="filter-group">
        <legend>Historique</legend>
        <label className="filter-option">
          <input
            type="checkbox"
            checked={filters.recent}
            disabled={recentCount === 0 && !filters.recent}
            onChange={(e) => onChange({ recent: e.target.checked })}
          />
          <span>Joués récemment</span>
        </label>
        <p className="filter-note">
          {recentCount === 0
            ? 'Aucune partie lancée sur cet appareil pour l’instant.'
            : 'Mémorisé sur cet appareil seulement.'}
        </p>
      </fieldset>

      <button type="button" className="link-btn filters-reset" disabled={activeCount === 0} onClick={onReset}>
        Effacer les filtres
      </button>
    </aside>
  );
}
