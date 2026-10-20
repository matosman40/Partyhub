import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Breadcrumb } from '../components/Breadcrumb.js';
import { SearchButton } from '../nav/SearchButton.js';
import {
  FILTER_LABEL,
  SORT_LABEL,
  featuredGame,
  formatSize,
  matchesFilter,
  matchesQuery,
  matchesType,
  sortGames,
  storeTypes,
  type StoreFilter,
  type StoreGame,
  type StoreSort,
  type StoreStatus,
  parseStoreParams,
  serializeStoreParams,
  type StoreParams,
} from '../admin/store-filters.js';

/** Catalogue lu sur le serveur : public. Installer, mettre à jour ou supprimer demande la session administrateur. */
interface Catalog {
  repo: string;
  tokenConfigured: boolean;
  checkedAt: string | null;
  nextCheckAt: string | null;
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

function clock(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
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
      src={`/api/store/games/${encodeURIComponent(game.id)}/cover`}
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
 * Magasin de jeux : les jeux publiés dans le dépôt de jeux, accessibles depuis l’accueil. Le catalogue est gardé
 * sur le serveur et relu une fois par jour. Les jeux intégrés à l’application ne se téléchargent pas.
 */
export function StorePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [admin, setAdmin] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Recherche, filtre, type et tri vivent dans l’adresse : un lien partagé ouvre la même liste.
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseStoreParams(searchParams);
  const { q: query, f: filter, t: type, s: sort } = params;
  function setParams(patch: Partial<StoreParams>) {
    setSearchParams(serializeStoreParams({ ...params, ...patch }), { replace: true });
  }
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    try {
      setCatalog(await api<Catalog>('/api/store'));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    api<{ authenticated: boolean }>('/api/admin/session')
      .then((res) => setAdmin(res.authenticated))
      .catch(() => setAdmin(false));
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function refreshCatalog() {
    return run(async () => {
      setCatalog(await api<Catalog>('/api/admin/store/refresh', { method: 'POST' }));
    });
  }

  function install(game: StoreGame) {
    return run(async () => {
      const res = await api<{ outcome: Outcome }>(`/api/admin/store/games/${encodeURIComponent(game.id)}/install`, {
        method: 'POST',
      });
      setMessage(`${game.name} : ${describe(res.outcome)}`);
    });
  }

  function update(game: StoreGame) {
    return run(async () => {
      const res = await api<{ outcome: Outcome }>(`/api/admin/store/games/${encodeURIComponent(game.id)}/update`, {
        method: 'POST',
      });
      setMessage(`${game.name} : ${describe(res.outcome)}`);
    });
  }

  function remove(game: StoreGame) {
    if (!window.confirm(`Supprimer ${game.name} de PartyHub ? Ses parties en cours seront fermées.`)) return;
    return run(async () => {
      const res = await api<{ closedRooms: number }>(`/api/admin/store/games/${encodeURIComponent(game.id)}`, {
        method: 'DELETE',
      });
      const closed = res.closedRooms > 0 ? ` ${res.closedRooms} partie(s) en cours fermée(s).` : '';
      setMessage(`${game.name} supprimé.${closed}`);
    });
  }

  function changeRepo(event: FormEvent) {
    event.preventDefault();
    return run(async () => {
      await api('/api/admin/store/repo', { method: 'PUT', body: JSON.stringify({ repo: repoInput.trim() }) });
      setMessage(`Dépôt de jeux : ${repoInput.trim()}.`);
      setRepoInput('');
    });
  }

  /** Boutons d’action d’un jeu, réservés à l’administrateur. Identiques sur la carte et sur la fiche. */
  function actions(game: StoreGame) {
    if (!admin) return null;
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

  const adminHint = !admin && (
    <p className="muted small">
      Pour installer, mettre à jour ou supprimer un jeu, <Link to="/admin">connectez-vous en administrateur</Link>.
    </p>
  );

  if (openGame) {
    return (
      <main className="page store-page fade-in">
        <div className="stack">
          <Breadcrumb
            items={[
              { label: 'Accueil', to: '/' },
              { label: 'Magasin de jeux', onClick: () => setOpenId(null) },
              { label: openGame.name },
            ]}
          />
          {notices}
          <article className="store-detail">
            <div className="store-detail-head">
              <StoreCover game={openGame} className="store-detail-cover" />
              <div className="store-detail-info">
                <h2>{openGame.name}</h2>
                <p className="muted small">
                  {openGame.author || 'Auteur non renseigné'} · {openGame.moduleLabel} · version{' '}
                  {openGame.latestVersion}
                </p>
                <span className={`store-pill store-pill-${openGame.status}`}>{PILL_LABEL[openGame.status]}</span>
                <p className="small">{statusText(openGame)}</p>
                {openGame.error && <p className="error small">{openGame.error}</p>}
                {openGame.lastError && <p className="error small">Dernier échec : {openGame.lastError}</p>}
                <div className="store-card-actions">{actions(openGame)}</div>
                {admin && openGame.status === 'en_revue' && (
                  <p className="small">
                    <Link to="/admin?section=creation&sub=paquets">Voir la revue dans Paquets et sources</Link>
                  </p>
                )}
                {admin && (openGame.status === 'a_jour' || openGame.status === 'mise_a_jour') && (
                  <p className="small">
                    <Link to="/admin?section=jeux&sub=presentation">Modifier la présentation de ce jeu</Link>
                  </p>
                )}
                {adminHint}
              </div>
            </div>

            <section className="store-detail-section" aria-label="Description">
              <h3>Description</h3>
              <p>{openGame.description.trim() || 'Aucune description pour ce jeu.'}</p>
            </section>

            <section className="store-detail-section" aria-label="Informations">
              <h3>Informations</h3>
              <dl className="store-details">
                <dt>Identifiant</dt>
                <dd>
                  <code>{openGame.id}</code>
                </dd>
                <dt>Version disponible</dt>
                <dd>{openGame.latestVersion}</dd>
                <dt>Taille du paquet</dt>
                <dd>{formatSize(openGame.size)}</dd>
                <dt>Version installée</dt>
                <dd>{openGame.installedVersion ?? 'aucune'}</dd>
                {openGame.pendingVersion && (
                  <>
                    <dt>Version en attente de revue</dt>
                    <dd>{openGame.pendingVersion}</dd>
                  </>
                )}
                {admin && (
                  <>
                    <dt>Mise à jour automatique</dt>
                    <dd>{openGame.autoUpdate ? 'oui, chaque jour' : 'non'}</dd>
                  </>
                )}
              </dl>
            </section>
          </article>
        </div>
      </main>
    );
  }

  return (
    <main className="page store-page fade-in">
      <div className="stack">
        <div className="row store-top">
          <Breadcrumb items={[{ label: 'Accueil', to: '/' }, { label: 'Magasin de jeux' }]} />
          <SearchButton />
        </div>
        <header>
          <h1>Magasin de jeux</h1>
          <p className="muted">
            Les jeux publiés dans le dépôt de jeux. Les jeux intégrés à l’application ne se téléchargent pas.
          </p>
        </header>

        {catalog && (
          <p className="muted small">
            Dépôt : <code>{catalog.repo}</code>
            {catalog.checkedAt && ` · lu le ${clock(catalog.checkedAt)}`}
            {catalog.nextCheckAt && ` · prochaine lecture automatique le ${clock(catalog.nextCheckAt)}`}
            {admin && !catalog.tokenConfigured && (
              <> · sans GITHUB_TOKEN, GitHub limite les appels : le catalogue n’est relu qu’une fois par jour.</>
            )}
          </p>
        )}

        {admin && (
          <div className="row">
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void refreshCatalog()}>
              Actualiser le catalogue
            </button>
          </div>
        )}
        {adminHint}

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
              <h2>{featured.name}</h2>
              <p>{shorten(featured.description, 240)}</p>
              <p className="muted small">
                {featured.author || 'Auteur non renseigné'} · {featured.moduleLabel} · version {featured.latestVersion}{' '}
                · {formatSize(featured.size)}
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
                onChange={(e) => setParams({ q: e.target.value })}
                placeholder="Nom, auteur, type ou description"
              />
            </label>
            <label className="field">
              <span>Trier par</span>
              <select value={sort} onChange={(e) => setParams({ s: e.target.value as StoreSort })}>
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
                  onClick={() => setParams({ f: key })}
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
                  onClick={() => setParams({ t: null })}
                >
                  Tous les types
                </button>
                {types.map((label) => (
                  <button
                    key={label}
                    type="button"
                    className={`store-tag${type === label ? ' active' : ''}`}
                    aria-pressed={type === label}
                    onClick={() => setParams({ t: label })}
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
                  {game.author ? ` · ${game.author}` : ''} · {formatSize(game.size)}
                </span>
                <span className={`store-pill store-pill-${game.status}`}>{PILL_LABEL[game.status]}</span>
                {game.description && <span className="muted small">{shorten(game.description, 120)}</span>}
                {game.error && <span className="error small">{game.error}</span>}
              </div>
              <div className="store-card-actions">{actions(game)}</div>
            </li>
          ))}
        </ul>

        {admin && (
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
        )}
      </div>
    </main>
  );
}
