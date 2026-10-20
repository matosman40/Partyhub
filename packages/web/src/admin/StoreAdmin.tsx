import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api.js';
import {
  FILTER_LABEL,
  FILTER_ORDER,
  JOB_STATE_LABEL,
  SORT_LABEL,
  countByFilter,
  describeOutcome,
  filterGames,
  installableIds,
  isInstallable,
  isInstalled,
  isRemovable,
  isUpdatable,
  jobProgress,
  jobTitle,
  quotaLine,
  quotaWarning,
  removableIds,
  shortStatus,
  statusText,
  updatableIds,
  type JobAction,
  type JobView,
  type Outcome,
  type RateLimit,
  type StoreFilter,
  type StoreGame,
  type StoreSort,
} from './storeView.js';

interface Catalog {
  repo: string;
  tokenConfigured: boolean;
  autoUpdate: boolean;
  checkedAt: string | null;
  rateLimit: RateLimit | null;
  games: StoreGame[];
  error: string | null;
}

interface RemoveResult {
  removed: string[];
  failed: { id: string; error: string }[];
  closedRooms: number;
}

/** Intervalle de lecture de la file pendant qu’elle tourne. */
const JOB_POLL_MS = 1000;

/**
 * Magasin de jeux : tout le dépôt sur une page. On cherche, on filtre, on coche les jeux à installer ou à mettre à
 * jour, ou on installe tout d’un coup. Les jeux se traitent un par un dans une file, dont la progression s’affiche.
 * La mise à jour automatique se règle une fois, pour tout le dépôt. Les jeux intégrés ne se téléchargent pas.
 */
export function StoreAdmin({ onChanged }: { onChanged: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StoreFilter>('tous');
  const [sort, setSort] = useState<StoreSort>('nom');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState('');
  const [showRepo, setShowRepo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const jobRunning = job !== null && job.finishedAt === null;
  const games = useMemo(() => catalog?.games ?? [], [catalog]);
  const visible = useMemo(() => filterGames(games, { query, filter, sort }), [games, query, filter, sort]);
  const counts = useMemo(() => countByFilter(games), [games]);
  const focus = games.find((game) => game.id === focusId) ?? null;

  async function load(refresh = false) {
    try {
      setCatalog(await api<Catalog>(`/api/admin/store${refresh ? '?refresh=1' : ''}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadJob() {
    try {
      setJob((await api<{ job: JobView | null }>('/api/admin/store/jobs/current')).job);
    } catch {
      // Pas de file à afficher : la page reste utilisable.
    }
  }

  useEffect(() => {
    void load();
    void loadJob();
    // Une seule lecture au montage : le reste suit les actions de l’administrateur.
  }, []);

  // Pendant qu’une file tourne, on lit sa progression. À la fin, le catalogue est relu.
  useEffect(() => {
    if (!jobRunning) return;
    const timer = window.setInterval(async () => {
      try {
        const current = (await api<{ job: JobView | null }>('/api/admin/store/jobs/current')).job;
        setJob(current);
        if (current && current.finishedAt !== null) {
          await load(true);
          onChanged();
        }
      } catch {
        // Lecture ratée : on réessaie au tour suivant.
      }
    }, JOB_POLL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobRunning]);

  async function run(action: () => Promise<void>, refresh = true) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (refresh) await load(true);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startJob(action: JobAction, ids: string[]) {
    setError(null);
    setMessage(null);
    try {
      const res = await api<{ job: JobView }>('/api/admin/store/jobs', {
        method: 'POST',
        body: JSON.stringify({ action, ids }),
      });
      setJob(res.job);
      setSelected(new Set());
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function confirmAndStart(action: JobAction, ids: string[]) {
    if (ids.length === 0) return;
    const question =
      action === 'install'
        ? `Installer ${ids.length} jeu${ids.length > 1 ? 'x' : ''} du dépôt ? Ils sont téléchargés l’un après l’autre.`
        : `Mettre à jour ${ids.length} jeu${ids.length > 1 ? 'x' : ''} ?`;
    if (!window.confirm(question)) return;
    void startJob(action, ids);
  }

  /* Actions sur un seul jeu, depuis sa fiche. */

  async function installOne(game: StoreGame) {
    await run(async () => {
      const res = await api<{ outcome: Outcome }>(`/api/admin/store/games/${encodeURIComponent(game.id)}/install`, {
        method: 'POST',
      });
      setMessage(`${game.name} : ${describeOutcome(res.outcome)}`);
    });
  }

  async function updateOne(game: StoreGame) {
    await run(async () => {
      const res = await api<{ outcome: Outcome }>(`/api/admin/store/games/${encodeURIComponent(game.id)}/update`, {
        method: 'POST',
      });
      setMessage(`${game.name} : ${describeOutcome(res.outcome)}`);
    });
  }

  async function removeOne(game: StoreGame) {
    if (!window.confirm(`Supprimer ${game.name} de PartyHub ? Ses parties en cours seront fermées.`)) return;
    await run(async () => {
      const res = await api<{ closedRooms: number }>(`/api/admin/store/games/${encodeURIComponent(game.id)}`, {
        method: 'DELETE',
      });
      const closed = res.closedRooms > 0 ? ` ${res.closedRooms} partie(s) en cours fermée(s).` : '';
      setMessage(`${game.name} supprimé.${closed}`);
    });
  }

  async function removeSelected(ids: string[]) {
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Supprimer ${ids.length} jeu${ids.length > 1 ? 'x' : ''} de PartyHub ? Leurs parties en cours seront fermées.`,
      )
    ) {
      return;
    }
    await run(async () => {
      const res = await api<RemoveResult>('/api/admin/store/remove', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      const failed =
        res.failed.length > 0
          ? ` ${res.failed.length} n’ont pas pu être supprimés : ${res.failed.map((f) => f.id).join(', ')}.`
          : '';
      setMessage(`${res.removed.length} jeu(x) supprimé(s).${failed}`);
      setSelected(new Set());
    });
  }

  async function setAutoUpdate(enabled: boolean) {
    await run(async () => {
      const res = await api<{ autoUpdate: boolean; touched: number }>('/api/admin/store/auto-update', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      setMessage(
        res.autoUpdate
          ? `Mise à jour automatique rétablie pour ${res.touched} jeu(x) installé(s).`
          : `Mise à jour automatique coupée pour ${res.touched} jeu(x) installé(s).`,
      );
    });
  }

  async function changeRepo(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/api/admin/store/repo', { method: 'PUT', body: JSON.stringify({ repo: repoInput.trim() }) });
      setMessage(`Dépôt de jeux : ${repoInput.trim()}.`);
      setRepoInput('');
      setShowRepo(false);
      setFocusId(null);
      setSelected(new Set());
    });
  }

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const chosen = games.filter((game) => selected.has(game.id));
  const selInstall = chosen.filter(isInstallable).map((game) => game.id);
  const selUpdate = chosen.filter(isUpdatable).map((game) => game.id);
  const selRemove = chosen.filter(isRemovable).map((game) => game.id);
  const allInstall = installableIds(games);
  const allUpdate = updatableIds(games);
  const allRemovable = removableIds(games);
  const locked = busy || jobRunning;
  // Le quota ne concerne que les serveurs sans jeton : avec un jeton, GitHub accorde beaucoup plus d’appels.
  const quota = catalog && !catalog.tokenConfigured ? catalog.rateLimit : null;
  const now = Date.now();
  const installWarning = quotaWarning(quota, allInstall.length, now);

  return (
    <div className="store-admin">
      <section className="store-top" aria-label="Dépôt de jeux">
        <div className="store-repo">
          <p className="muted small">
            Dépôt : <code>{catalog?.repo ?? '…'}</code>
            {catalog?.checkedAt && ` · lu à ${new Date(catalog.checkedAt).toLocaleTimeString('fr-FR')}`}
            {catalog &&
              !catalog.tokenConfigured &&
              ' · sans GITHUB_TOKEN, GitHub limite les appels à 60 par heure : le catalogue est gardé dix minutes.'}
          </p>
          {quota && (
            <p className="store-quota small" role="status">
              {quotaLine(quota, now)}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn ghost small" disabled={locked} onClick={() => run(async () => {})}>
              Actualiser le catalogue
            </button>
            <button type="button" className="link-btn" onClick={() => setShowRepo((shown) => !shown)}>
              {showRepo ? 'Annuler' : 'Changer de dépôt'}
            </button>
          </div>
          {showRepo && (
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
              <button type="submit" className="btn ghost" disabled={locked || !repoInput.trim()}>
                Changer de dépôt
              </button>
            </form>
          )}
        </div>
        <label className="store-switch">
          <input
            type="checkbox"
            checked={catalog?.autoUpdate ?? true}
            disabled={!catalog || locked}
            onChange={(e) => void setAutoUpdate(e.target.checked)}
          />
          <span>
            <strong>Mise à jour automatique de tous les jeux du dépôt</strong>
            <span className="muted small">Vérifiée chaque jour. Les jeux installés plus tard suivent ce réglage.</span>
          </span>
        </label>
      </section>

      <div className="store-toolbar">
        <input
          type="search"
          className="store-search"
          placeholder="Chercher un jeu, un auteur, un type…"
          aria-label="Chercher dans le magasin"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="store-sort">
          <span className="muted small">Trier</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as StoreSort)}>
            {(Object.keys(SORT_LABEL) as StoreSort[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="store-filters" role="group" aria-label="Filtrer les jeux">
        {FILTER_ORDER.map((key) => (
          <button key={key} type="button" className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {FILTER_LABEL[key]} <span className="muted small">{counts[key]}</span>
          </button>
        ))}
      </div>

      {installWarning && (
        <p className="store-quota is-warning small" role="alert">
          {installWarning}
        </p>
      )}
      <div className="store-bulk">
        <button
          type="button"
          className="btn primary small"
          disabled={locked || allInstall.length === 0}
          onClick={() => confirmAndStart('install', allInstall)}
        >
          Installer tout le dépôt ({allInstall.length})
        </button>
        <button
          type="button"
          className="btn ghost small"
          disabled={locked || allUpdate.length === 0}
          onClick={() => confirmAndStart('update', allUpdate)}
        >
          Mettre à jour tout ({allUpdate.length})
        </button>
        <button
          type="button"
          className="btn ghost small"
          disabled={locked || allRemovable.length === 0}
          onClick={() => void removeSelected(allRemovable)}
        >
          Supprimer tous les jeux installés ({allRemovable.length})
        </button>
      </div>

      {job && <JobPanel job={job} onDismiss={() => setJob(null)} />}

      {selected.size > 0 && (
        <div className="store-selection" role="region" aria-label="Jeux sélectionnés">
          <strong>{selected.size} sélectionné(s)</strong>
          <button
            type="button"
            className="btn primary small"
            disabled={locked || selInstall.length === 0}
            onClick={() => confirmAndStart('install', selInstall)}
          >
            Installer ({selInstall.length})
          </button>
          <button
            type="button"
            className="btn ghost small"
            disabled={locked || selUpdate.length === 0}
            onClick={() => confirmAndStart('update', selUpdate)}
          >
            Mettre à jour ({selUpdate.length})
          </button>
          <button
            type="button"
            className="btn ghost small"
            disabled={locked || selRemove.length === 0}
            onClick={() => void removeSelected(selRemove)}
          >
            Supprimer ({selRemove.length})
          </button>
          <button type="button" className="link-btn" onClick={() => setSelected(new Set(visible.map((g) => g.id)))}>
            Sélectionner les {visible.length} visibles
          </button>
          <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
            Tout désélectionner
          </button>
        </div>
      )}

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
      {catalog && !catalog.error && games.length === 0 && (
        <p className="muted">Aucun jeu publié dans ce dépôt pour l’instant.</p>
      )}

      <div className="store-body">
        <ul className="store-list" aria-label="Jeux du dépôt">
          {visible.length === 0 && games.length > 0 && <li className="muted">Aucun jeu ne correspond à ce filtre.</li>}
          {visible.map((game) => (
            <li key={game.id} className={`store-row${focusId === game.id ? ' is-focus' : ''}`}>
              <input
                type="checkbox"
                aria-label={`Sélectionner ${game.name}`}
                checked={selected.has(game.id)}
                disabled={busy}
                onChange={() => toggle(game.id)}
              />
              <button
                type="button"
                className="store-row-main"
                aria-current={focusId === game.id ? 'true' : undefined}
                onClick={() => setFocusId(game.id)}
              >
                <Thumb game={game} />
                <span className="store-row-text">
                  <strong>{game.name}</strong>
                  <span className="muted small">
                    {game.author || 'Auteur inconnu'} · {game.moduleLabel} · v{game.latestVersion}
                  </span>
                </span>
                <span className={`badge store-badge is-${game.status}`}>{shortStatus(game)}</span>
              </button>
            </li>
          ))}
        </ul>

        <aside className="store-detail" aria-live="polite" aria-label="Fiche du jeu">
          {focus ? (
            <GameDetail
              game={focus}
              locked={locked}
              onInstall={() => void installOne(focus)}
              onUpdate={() => void updateOne(focus)}
              onRemove={() => void removeOne(focus)}
            />
          ) : (
            <p className="muted">Choisissez un jeu pour voir sa fiche.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function coverUrl(game: StoreGame): string {
  return `/api/admin/store/games/${encodeURIComponent(game.id)}/cover`;
}

function Thumb({ game }: { game: StoreGame }) {
  if (!game.hasCover) {
    return (
      <span className="store-thumb store-thumb-empty" aria-hidden="true">
        🧩
      </span>
    );
  }
  return (
    <img
      className="store-thumb"
      src={coverUrl(game)}
      alt=""
      loading="lazy"
      onError={(e) => {
        e.currentTarget.hidden = true;
      }}
    />
  );
}

function GameDetail({
  game,
  locked,
  onInstall,
  onUpdate,
  onRemove,
}: {
  game: StoreGame;
  locked: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onRemove: () => void;
}): ReactNode {
  const installedHere = isInstalled(game);
  return (
    <article className="store-detail-card">
      {game.hasCover ? (
        <img className="store-cover" src={coverUrl(game)} alt="" loading="lazy" />
      ) : (
        <div className="store-cover store-cover-empty" aria-hidden="true">
          🧩
        </div>
      )}
      <h3>{game.name}</h3>
      <p className="muted small">
        {game.author || 'Auteur inconnu'} · {game.moduleLabel} · version {game.latestVersion}
      </p>
      {game.description && <p>{game.description}</p>}
      <p>
        <span className="badge">{statusText(game)}</span>
      </p>
      {installedHere && game.autoUpdate && <p className="muted small">Mise à jour automatique chaque jour</p>}
      {game.error && <p className="error small">{game.error}</p>}
      {game.lastError && <p className="error small">Dernier échec : {game.lastError}</p>}
      <div className="store-card-actions">
        {isInstallable(game) && (
          <button type="button" className="btn primary small" disabled={locked} onClick={onInstall}>
            Installer
          </button>
        )}
        {isUpdatable(game) && (
          <button type="button" className="btn primary small" disabled={locked} onClick={onUpdate}>
            Mettre à jour
          </button>
        )}
        {installedHere && !isUpdatable(game) && !game.builtin && (
          <button type="button" className="btn ghost small" disabled={locked} onClick={onUpdate}>
            Vérifier
          </button>
        )}
        {isRemovable(game) && (
          <button type="button" className="btn ghost small" disabled={locked} onClick={onRemove}>
            Supprimer
          </button>
        )}
      </div>
    </article>
  );
}

function JobPanel({ job, onDismiss }: { job: JobView; onDismiss: () => void }) {
  const { done, total, finished } = jobProgress(job);
  return (
    <section className="store-job" aria-live="polite" aria-label="Opération en cours">
      <p>
        <strong>{jobTitle(job.action)}</strong> :{' '}
        {finished ? `terminée, ${done} sur ${total}.` : `${done} sur ${total} traité(s).`}
      </p>
      <progress max={total} value={done} aria-label={`${done} sur ${total}`} />
      <ul className="store-job-items">
        {job.items.map((item) => (
          <li key={item.id} className={`store-job-item is-${item.state}`}>
            <span>{item.name}</span>
            <span className="badge">{JOB_STATE_LABEL[item.state]}</span>
            {item.message && <span className="muted small">{item.message}</span>}
          </li>
        ))}
      </ul>
      {finished && (
        <button type="button" className="link-btn" onClick={onDismiss}>
          Masquer
        </button>
      )}
    </section>
  );
}
