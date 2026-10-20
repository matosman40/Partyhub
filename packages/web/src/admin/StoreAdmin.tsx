import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';
import {
  FILTER_LABEL,
  matchesFilter,
  matchesQuery,
  type StoreFilter,
  type StoreGame,
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

function describe(outcome: Outcome): string {
  if (outcome.ok) return `${outcome.status} : version ${outcome.version}.`;
  return [outcome.error, ...(outcome.issues ?? [])].join(' ');
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
  const [openDetails, setOpenDetails] = useState<string | null>(null);

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

  const games = catalog?.games ?? [];
  const visible = games.filter((g) => matchesFilter(g, filter) && matchesQuery(g, query));

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
      {catalog === null && !error && <p className="muted">Chargement…</p>}
      {catalog?.games.length === 0 && !catalog.error && (
        <p className="muted">Aucun jeu publié dans ce dépôt pour l’instant.</p>
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
          <div className="store-filters" role="group" aria-label="Filtrer les jeux">
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
          <p className="muted small" aria-live="polite">
            {visible.length} jeu(x) affiché(s) sur {games.length}.
          </p>
        </div>
      )}

      {games.length > 0 && visible.length === 0 && <p className="muted">Aucun jeu ne correspond à ce filtre.</p>}

      <ul className="store-grid">
        {visible.map((game) => (
          <li key={game.id} className="store-card">
            {game.hasCover ? (
              <img
                className="store-cover"
                src={`/api/admin/store/games/${encodeURIComponent(game.id)}/cover`}
                alt=""
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.hidden = true;
                }}
              />
            ) : (
              <div className="store-cover store-cover-empty" aria-hidden="true">
                🧩
              </div>
            )}
            <div className="store-card-body">
              <strong>{game.name}</strong>
              <span className="muted small">
                {game.moduleLabel} · version {game.latestVersion}
                {game.author ? ` · ${game.author}` : ''}
              </span>
              {game.description && <span className="muted small">{game.description}</span>}
              <span className="badge">{statusText(game)}</span>
              {game.autoUpdate && <span className="muted small">Mise à jour automatique chaque jour</span>}
              {game.error && <span className="error small">{game.error}</span>}
              {game.lastError && <span className="error small">Dernier échec : {game.lastError}</span>}
              <button
                type="button"
                className="btn ghost small"
                aria-expanded={openDetails === game.id}
                onClick={() => setOpenDetails(openDetails === game.id ? null : game.id)}
              >
                {openDetails === game.id ? 'Masquer les détails' : 'Détails'}
              </button>
              {openDetails === game.id && (
                <dl className="store-details">
                  <dt>Identifiant</dt>
                  <dd>
                    <code>{game.id}</code>
                  </dd>
                  <dt>Version disponible</dt>
                  <dd>{game.latestVersion}</dd>
                  <dt>Version installée</dt>
                  <dd>{game.installedVersion ?? 'aucune'}</dd>
                  {game.pendingVersion && (
                    <>
                      <dt>Version en attente de revue</dt>
                      <dd>{game.pendingVersion}</dd>
                    </>
                  )}
                  <dt>Auteur</dt>
                  <dd>{game.author || 'non renseigné'}</dd>
                  <dt>Type</dt>
                  <dd>{game.moduleLabel}</dd>
                  <dt>Mise à jour automatique</dt>
                  <dd>{game.autoUpdate ? 'oui, chaque jour' : 'non'}</dd>
                  {game.description && (
                    <>
                      <dt>Description</dt>
                      <dd>{game.description}</dd>
                    </>
                  )}
                </dl>
              )}
            </div>
            <div className="store-card-actions">
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
              {!game.builtin &&
                (game.status === 'a_jour' || game.status === 'mise_a_jour' || game.status === 'en_revue') && (
                  <button type="button" className="btn ghost small" disabled={busy} onClick={() => remove(game)}>
                    Supprimer
                  </button>
                )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
