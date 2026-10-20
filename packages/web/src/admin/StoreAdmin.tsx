import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';
import {
  FILTER_LABEL,
  SORT_LABEL,
  featuredGame,
  matchesFilter,
  matchesQuery,
  matchesType,
  sortGames,
  storeTypes,
  type StoreFilter,
  type StoreGame,
  type StoreSort,
  type StoreStatus,
} from './store-filters.js';

interface Catalog {
  repo: string;
  tokenConfigured: boolean;
  checkedAt: string | null;
  games: StoreGame[];
  error: string | null;
}

type Outcome = { ok: true; status: string; version: string } | { ok: false; error: string; issues?: string[] };

const STATUS_LABEL: Record<StoreStatus, string> = {
  integre: 'Intégré à l’application',
  non_installe: 'Non installé',
  a_jour: 'Installé, à jour',
  mise_a_jour: 'Mise à jour disponible',
  erreur: 'Échec de l’installation',
  en_revue: 'En attente de revue',
};

/** Libellé d’état avec la version : l’installée, et la nouvelle quand une mise à jour est prête. */
function statusText(game: StoreGame): string {
  if (game.status === 'mise_a_jour') return `Mise à jour disponible : ${game.installedVersion} → ${game.latestVersion}`;
  if (game.status === 'a_jour') return `Installé, à jour (${game.installedVersion})`;
  if (game.status === 'en_revue') {
    return `En attente de revue : version ${game.pendingVersion}. Approuvez-la dans « Jeux de code » pour la lancer.`;
  }
  return STATUS_LABEL[game.status];
}

/** Libellé court affiché sur la pastille d’état de chaque carte. */
const PILL_LABEL: Record<StoreStatus, string> = {
  integre: 'Intégré',
  non_installe: 'Non installé',
  a_jour: 'Installé',
  mise_a_jour: 'Mise à jour',
  erreur: 'Échec',
  en_revue: 'En revue',
};

function describe(outcome: Outcome): string {
  if (outcome.ok) return `${outcome.status} : version ${outcome.version}.`;
  return [outcome.error, ...(outcome.issues ?? [])].join(' ');
}

/** Couverture d’un jeu, ou un emplacement neutre si le paquet n’en a pas. */
function StoreCover({ game, className }: { game: StoreGame; className: string }) {
  if (!game.hasCover) {
    return (
      <div className={`${className} store-cover-empty`} aria-hidden="true">
        🧩
      </div>
    );
  }
  return (
    <img
      className={className}
      src={`/api/admin/store/games/${encodeURIComponent(game.id)}/cover`}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.hidden = true;
      }}
    />
  );
}

function shorten(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max).trimEnd()}…`;
}

/**
 * Magasin : les jeux publiés dans le dépôt de jeux. On installe un jeu, il se met à jour chaque jour, et on peut
 * le supprimer. Les jeux intégrés à l’application restent dans le code et ne se téléchargent pas.
 */
export function StoreAdmin({ onChanged }: { onChanged: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StoreFilter>('tous');
  const [type, setType] = useState<string | null>(null);
  const [sort, setSort] = useState<StoreSort>('statut');
  const [openId, setOpenId] = useState<string | null>(null);

  async function load(refresh = false) {
    try {
      const res = await api<Catalog>(`/api/admin/store${refresh ? '?refresh=1' : ''}`);
      setCatalog(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await load(true);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function install(game: StoreGame) {
    await run(async () => {
      const res = await api<{ outcome: Outcome }>(`/api/admin/store/games/${encodeURIComponent(game.id)}/install`, {
        method: 'POST',
      });
      setMessage(`${game.name} : ${describe(res.outcome)}`);
    });
  }

  async function update(game: StoreGame) {
    await run(async () => {
      const res = await api<{ outcome: Outcome }>(`/api/admin/store/games/${encodeURIComponent(game.id)}/update`, {
        method: 'POST',
      });
      setMessage(`${game.name} : ${describe(res.outcome)}`);
    });
  }

  async function remove(game: StoreGame) {
    if (!window.confirm(`Supprimer ${game.name} de PartyHub ? Ses parties en cours seront fermées.`)) return;
    await run(async () => {
      const res = await api<{ closedRooms: number }>(`/api/admin/store/games/${encodeURIComponent(game.id)}`, {
        method: 'DELETE',
      });
      const closed = res.closedRooms > 0 ? ` ${res.closedRooms} partie(s) en cours fermée(s).` : '';
      setMessage(`${game.name} supprimé.${closed}`);
    });
  }

  async function changeRepo(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/api/admin/store/repo', { method: 'PUT', body: JSON.stringify({ repo: repoInput.trim() }) });
      setMessage(`Dépôt de jeux : ${repoInput.trim()}.`);
      setRepoInput('');
    });
  }

  /** Boutons d’action d’un jeu. Identiques sur la carte et sur la fiche. */
  function actions(game: StoreGame) {
    return (
      <>
        {!game.builtin && (game.status === 'non_installe' || game.status === 'erreur') && (
          <button
            type="button"
            className="btn primary small"
            disabled={busy || game.error !== null}
            onClick={() => install(game)}
          >
            Installer
          </button>
        )}
        {!game.builtin && game.status === 'mise_a_jour' && (
          <button type="button" className="btn primary small" disabled={busy} onClick={() => update(game)}>
            Mettre à jour
          </button>
        )}
        {!game.builtin && game.status === 'a_jour' && (
          <button type="button" className="btn ghost small" disabled={busy} onClick={() => update(game)}>
            Vérifier
          </button>
        )}
        {!game.builtin && (game.status === 'a_jour' || game.status === 'mise_a_jour' || game.status === 'en_revue') && (
          <button type="button" className="btn ghost small" disabled={busy} onClick={() => remove(game)}>
            Supprimer
          </button>
        )}
      </>
    );
  }

  const games = catalog?.games ?? [];
  const types = storeTypes(games);
  const visible = sortGames(
    games.filter((g) => matchesFilter(g, filter) && matchesQuery(g, query) && matchesType(g, type)),
    sort,
  );
  const featured = featuredGame(games);
  const openGame = openId ? (games.find((g) => g.id === openId) ?? null) : null;
  const browsing = filter === 'tous' && query.trim() === '' && type === null;

  const notices = (
    <>
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {catalog?.error && (
        <p className="error" role="alert">
          {catalog.error}
        </p>
      )}
    </>
  );

  if (openGame) {
    return (
      <div className="stack">
        <button type="button" className="btn ghost small" onClick={() => setOpenId(null)}>
          ← Retour au magasin
        </button>
        {notices}
        <article className="store-detail">
          <div className="store-detail-head">
            <StoreCover game={openGame} className="store-detail-cover" />
            <div className="store-detail-info">
              <h3>{openGame.name}</h3>
              <p className="muted small">
                {openGame.author || 'Auteur non renseigné'} · {openGame.moduleLabel} · version {openGame.latestVersion}
              </p>
              <span className={`store-pill store-pill-${openGame.status}`}>{PILL_LABEL[openGame.status]}</span>
              <p className="small">{statusText(openGame)}</p>
              {openGame.error && <p className="error small">{openGame.error}</p>}
              {openGame.lastError && <p className="error small">Dernier échec : {openGame.lastError}</p>}
              <div className="store-card-actions">{actions(openGame)}</div>
            </div>
          </div>

          <section className="store-detail-section" aria-label="Description">
            <h4>Description</h4>
            <p>{openGame.description.trim() || 'Aucune description pour ce jeu.'}</p>
          </section>

          <section className="store-detail-section" aria-label="Informations">
            <h4>Informations</h4>
            <dl className="store-details">
              <dt>Identifiant</dt>
              <dd>
                <code>{openGame.id}</code>
              </dd>
              <dt>Version disponible</dt>
              <dd>{openGame.latestVersion}</dd>
              <dt>Version installée</dt>
              <dd>{openGame.installedVersion ?? 'aucune'}</dd>
              {openGame.pendingVersion && (
                <>
                  <dt>Version en attente de revue</dt>
                  <dd>{openGame.pendingVersion}</dd>
                </>
              )}
              <dt>Mise à jour automatique</dt>
              <dd>{openGame.autoUpdate ? 'oui, chaque jour' : 'non'}</dd>
            </dl>
          </section>
        </article>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Les jeux publiés dans le dépôt de jeux. Installez-en un : il se met à jour chaque jour, et vous pouvez le
        supprimer à tout moment. Les jeux intégrés à l’application ne se téléchargent pas.
      </p>

      {catalog && (
        <p className="muted small">
          Dépôt : <code>{catalog.repo}</code>
          {catalog.checkedAt && ` · lu à ${new Date(catalog.checkedAt).toLocaleTimeString('fr-FR')}`}
          {!catalog.tokenConfigured &&
            ' · sans GITHUB_TOKEN, GitHub limite les appels à 60 par heure : le catalogue est gardé dix minutes.'}
        </p>
      )}

      <div className="row">
        <button type="button" className="btn ghost" disabled={busy} onClick={() => run(async () => {})}>
          Actualiser le catalogue
        </button>
      </div>

      {notices}
      {catalog === null && !error && <p className="muted">Chargement…</p>}
      {catalog?.games.length === 0 && !catalog.error && (
        <p className="muted">Aucun jeu publié dans ce dépôt pour l’instant.</p>
      )}

      {featured && browsing && (
        <section className="store-hero" aria-label="À la une">
          <StoreCover game={featured} className="store-hero-art" />
          <div className="store-hero-info">
            <span className="store-kicker">À la une</span>
            <h3>{featured.name}</h3>
            <p>{shorten(featured.description, 240)}</p>
            <p className="muted small">
              {featured.author || 'Auteur non renseigné'} · {featured.moduleLabel} · version {featured.latestVersion}
            </p>
            <div className="store-card-actions">
              {actions(featured)}
              <button type="button" className="btn ghost small" onClick={() => setOpenId(featured.id)}>
                Voir la fiche
              </button>
            </div>
          </div>
        </section>
      )}

      {games.length > 0 && (
        <div className="store-toolbar">
          <label className="field">
            <span>Rechercher</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nom, auteur, type ou description"
            />
          </label>
          <label className="field">
            <span>Trier par</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as StoreSort)}>
              {(Object.keys(SORT_LABEL) as StoreSort[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          <div className="store-filters" role="group" aria-label="Filtrer par état">
            {(Object.keys(FILTER_LABEL) as StoreFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`btn small ${filter === key ? 'primary' : 'ghost'}`}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
          </div>
          {types.length > 0 && (
            <div className="store-tags" role="group" aria-label="Filtrer par type de jeu">
              <button
                type="button"
                className={`store-tag${type === null ? ' active' : ''}`}
                aria-pressed={type === null}
                onClick={() => setType(null)}
              >
                Tous les types
              </button>
              {types.map((label) => (
                <button
                  key={label}
                  type="button"
                  className={`store-tag${type === label ? ' active' : ''}`}
                  aria-pressed={type === label}
                  onClick={() => setType(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <p className="muted small" aria-live="polite">
            {visible.length} jeu(x) affiché(s) sur {games.length}.
          </p>
        </div>
      )}

      {games.length > 0 && visible.length === 0 && <p className="muted">Aucun jeu ne correspond à ces critères.</p>}

      <ul className="store-grid">
        {visible.map((game) => (
          <li key={game.id} className="store-card">
            <button
              type="button"
              className="store-card-open"
              onClick={() => setOpenId(game.id)}
              aria-label={`Voir la fiche de ${game.name}`}
            >
              <StoreCover game={game} className="store-cover" />
              <span className="store-card-title">{game.name}</span>
            </button>
            <div className="store-card-body">
              <span className="muted small">
                {game.moduleLabel} · v{game.latestVersion}
                {game.author ? ` · ${game.author}` : ''}
              </span>
              <span className={`store-pill store-pill-${game.status}`}>{PILL_LABEL[game.status]}</span>
              {game.description && <span className="muted small">{shorten(game.description, 120)}</span>}
              {game.error && <span className="error small">{game.error}</span>}
            </div>
            <div className="store-card-actions">{actions(game)}</div>
          </li>
        ))}
      </ul>

      <form className="ed-new" onSubmit={changeRepo}>
        <label className="field">
          <span>Autre dépôt de jeux : auteur/nom</span>
          <input
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="auteur/jeux-partyhub"
            required
          />
        </label>
        <button type="submit" className="btn ghost" disabled={busy || !repoInput.trim()}>
          Changer de dépôt
        </button>
      </form>
    </div>
  );
}
