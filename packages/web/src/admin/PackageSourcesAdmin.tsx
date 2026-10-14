import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api.js';

interface SourceRecord {
  id: string;
  repo: string;
  private: boolean;
  autoUpdate: boolean;
  packageId: string | null;
  installedVersion: string | null;
  latestVersion: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
}

type Outcome = { ok: true; status: string; version: string } | { ok: false; error: string; issues?: string[] };

function describe(outcome: Outcome): string {
  if (outcome.ok) return `${outcome.status} : version ${outcome.version}.`;
  return [outcome.error, ...(outcome.issues ?? [])].join(' ');
}

/** Sources GitHub : dépôts dont la dernière release fournit un paquet .phgame, mis à jour à la demande ou chaque jour. */
export function PackageSourcesAdmin({ onChanged }: { onChanged: () => void }) {
  const [sources, setSources] = useState<SourceRecord[] | null>(null);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [repo, setRepo] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ sources: SourceRecord[]; tokenConfigured: boolean }>('/api/admin/package-sources');
      setSources(res.sources);
      setTokenConfigured(res.tokenConfigured);
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
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const res = await api<{ ok: true; id: string; outcome: Outcome }>('/api/admin/package-sources', {
        method: 'POST',
        body: JSON.stringify({ repo: repo.trim(), private: isPrivate, autoUpdate }),
      });
      setMessage(`${repo.trim()} : ${describe(res.outcome)}`);
      setRepo('');
      setIsPrivate(false);
      setAutoUpdate(false);
    });
  }

  async function check(source: SourceRecord) {
    await run(async () => {
      const res = await api<{ outcome: Outcome }>(`/api/admin/package-sources/${encodeURIComponent(source.id)}/check`, {
        method: 'POST',
      });
      setMessage(`${source.repo} : ${describe(res.outcome)}`);
    });
  }

  async function checkAll() {
    await run(async () => {
      const res = await api<{ results: { repo: string; outcome: Outcome }[] }>('/api/admin/package-sources/check-all', {
        method: 'POST',
      });
      const failed = res.results.filter((r) => !r.outcome.ok).length;
      setMessage(`${res.results.length} source(s) vérifiée(s)${failed ? `, ${failed} en erreur` : ''}.`);
    });
  }

  async function toggleAuto(source: SourceRecord) {
    await run(async () => {
      await api(`/api/admin/package-sources/${encodeURIComponent(source.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ autoUpdate: !source.autoUpdate }),
      });
    });
  }

  async function remove(source: SourceRecord) {
    if (!window.confirm(`Supprimer la source ${source.repo} ? Le paquet installé reste en place, sans mise à jour.`))
      return;
    await run(async () => {
      await api(`/api/admin/package-sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' });
    });
  }

  return (
    <div className="stack">
      <p className="muted">
        Installe et met à jour un jeu depuis la dernière release d’un dépôt GitHub (auteur/nom). La release doit
        contenir le fichier <code>.phgame</code> et son <code>.sha256</code>. Une seule version par jeu est installée.
      </p>

      <form className="ed-new" onSubmit={add}>
        <label className="field">
          <span>Dépôt : auteur/nom, ou auteur/depot/jeu pour un dépôt commun</span>
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="auteur/mon-jeu" required />
        </label>
        <label className="field">
          <span>
            <input
              type="checkbox"
              checked={isPrivate}
              disabled={!tokenConfigured}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />{' '}
            Dépôt privé
          </span>
          {!tokenConfigured && (
            <span className="muted small">Demande GITHUB_TOKEN dans la configuration du serveur.</span>
          )}
        </label>
        <label className="field">
          <span>
            <input type="checkbox" checked={autoUpdate} onChange={(e) => setAutoUpdate(e.target.checked)} /> Mise à jour
            automatique (une fois par jour)
          </span>
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          Ajouter la source
        </button>
        <button type="button" className="btn ghost" disabled={busy || !sources?.length} onClick={checkAll}>
          Vérifier toutes les sources
        </button>
      </form>

      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sources === null && <p className="muted">Chargement…</p>}
      {sources?.length === 0 && <p className="muted">Aucune source GitHub pour l’instant.</p>}

      <ul className="ed-list">
        {sources?.map((s) => (
          <li key={s.id} className="ed-list-item">
            <div className="ed-list-preview" aria-hidden="true">
              🔗
            </div>
            <div className="ed-list-body">
              <strong>
                {s.repo}
                {s.private ? ' · privé' : ''}
              </strong>
              <span className="muted small">
                {s.packageId ? `${s.packageId} ${s.installedVersion ?? ''}` : 'Pas encore installé'}
                {s.latestVersion ? ` · dernière release ${s.latestVersion}` : ''}
                {s.lastCheckedAt ? ` · vérifié le ${new Date(s.lastCheckedAt).toLocaleString('fr-FR')}` : ''}
                {s.autoUpdate ? ' · mise à jour automatique' : ''}
              </span>
              {s.lastError && <span className="error small">{s.lastError}</span>}
            </div>
            <div className="ed-list-actions">
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => check(s)}>
                Vérifier et mettre à jour
              </button>
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => toggleAuto(s)}>
                {s.autoUpdate ? 'Désactiver l’automatique' : 'Activer l’automatique'}
              </button>
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => remove(s)}>
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
