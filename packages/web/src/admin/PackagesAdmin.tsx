import { useEffect, useState } from 'react';
import { api } from '../api.js';

export interface PackageRecord {
  id: string;
  gameId: string;
  name: string;
  version: string;
  description: string;
  author: string;
  module: 'cards' | 'board' | 'quiz' | 'recipe';
  sha256: string;
  size: number;
  enabled: boolean;
  status: 'actif' | 'désactivé' | 'erreur';
  error?: string;
  installedAt: string;
}

/** Copie modifiable d’un paquet, avec son état par rapport au paquet d’origine. */
interface PackageCopy {
  gameId: string;
  packageId: string;
  name: string;
  copiedVersion: string;
  currentVersion: string | null;
  modified: boolean;
  updateAvailable: boolean;
  originMissing: boolean;
}

interface PackageVersion {
  version: string;
  sha256: string;
  size: number;
  installedAt: string;
  active: boolean;
}

/** Section de l’administration où retrouver la copie modifiable, selon le type de jeu. */
const COPY_SECTION: Record<'cards' | 'board' | 'quiz', string> = {
  cards: 'Jeux de cartes',
  board: 'Jeux de plateau',
  quiz: 'Jeux de questions médias',
};

const STATUS_LABEL: Record<PackageRecord['status'], string> = {
  actif: 'Actif',
  désactivé: 'Désactivé',
  erreur: 'Erreur',
};

/** Paquets .phgame : import, versions, activation, désactivation, copie et suppression. */
export function PackagesAdmin({ onChanged }: { onChanged: () => void }) {
  const [records, setRecords] = useState<PackageRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Paquet dont la liste des versions est dépliée, et les versions déjà chargées par paquet. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [versionsById, setVersionsById] = useState<Record<string, PackageVersion[]>>({});
  const [copies, setCopies] = useState<PackageCopy[]>([]);

  async function load() {
    try {
      const [packagesRes, copiesRes] = await Promise.all([
        api<{ packages: PackageRecord[] }>('/api/admin/packages'),
        api<{ copies: PackageCopy[] }>('/api/admin/package-copies'),
      ]);
      setRecords(packagesRes.packages);
      setCopies(copiesRes.copies);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadVersions(id: string) {
    try {
      const res = await api<{ versions: PackageVersion[] }>(`/api/admin/packages/${encodeURIComponent(id)}/versions`);
      setVersionsById((current) => ({ ...current, [id]: res.versions }));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function importFile(file: File) {
    setError(null);
    setIssues([]);
    setNotice(null);
    setBusy(true);
    try {
      // Le fichier part tel quel (archive binaire) : le helper JSON de l’API ne convient pas ici.
      const res = await fetch('/api/admin/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: await file.arrayBuffer(),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: string[];
        unchanged?: boolean;
        active?: boolean;
        id?: string;
      };
      if (!res.ok) {
        setError(data.error ?? 'Import refusé.');
        setIssues(data.issues ?? []);
        return;
      }
      if (data.unchanged) setNotice('Ce paquet est déjà installé à l’identique.');
      else if (data.active) setNotice('Paquet installé.');
      else setNotice('Version conservée, sans la rendre active. Choisissez-la dans « Versions » pour la jouer.');
      await load();
      if (data.id && openId === data.id) await loadVersions(data.id);
      onChanged();
    } catch {
      setError('Connexion impossible. Vérifiez le réseau.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(record: PackageRecord) {
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/packages/${encodeURIComponent(record.id)}/status`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !record.enabled }),
      });
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleVersions(record: PackageRecord) {
    if (openId === record.id) {
      setOpenId(null);
      return;
    }
    setOpenId(record.id);
    await loadVersions(record.id);
  }

  async function activate(record: PackageRecord, version: string) {
    setError(null);
    setNotice(null);
    try {
      await api(
        `/api/admin/packages/${encodeURIComponent(record.id)}/versions/${encodeURIComponent(version)}/activate`,
        {
          method: 'POST',
        },
      );
      setNotice(`Version ${version} jouée à la place de la version ${record.version}.`);
      await load();
      await loadVersions(record.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeVersion(record: PackageRecord, version: string) {
    if (
      !window.confirm(
        `Supprimer la version ${version} conservée de « ${record.name} » ? Elle ne pourra plus être rejouée sans réimport.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/packages/${encodeURIComponent(record.id)}/versions/${encodeURIComponent(version)}`, {
        method: 'DELETE',
      });
      setNotice(`Version ${version} supprimée.`);
      await loadVersions(record.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy(record: PackageRecord) {
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ name: string; module: 'cards' | 'board' | 'quiz' }>(
        `/api/admin/packages/${encodeURIComponent(record.id)}/copy`,
        { method: 'POST' },
      );
      setNotice(`Copie créée : « ${res.name} ». Modifiez-la dans « ${COPY_SECTION[res.module]} ».`);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /** Remplace une copie par la version active du paquet. Une copie modifiée demande une confirmation. */
  async function updateCopy(copy: PackageCopy) {
    if (
      copy.modified &&
      !window.confirm(
        `« ${copy.name} » a été modifiée. La remplacer par la version ${copy.currentVersion ?? ''} du paquet ? Ses modifications seront perdues.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/package-copies/${encodeURIComponent(copy.gameId)}/update`, {
        method: 'POST',
        body: JSON.stringify({ force: copy.modified }),
      });
      setNotice(`« ${copy.name} » mise à jour à la version ${copy.currentVersion ?? ''}. Son nom est conservé.`);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(record: PackageRecord) {
    if (
      !window.confirm(
        `Supprimer le paquet « ${record.name} » ? Ses fichiers et toutes ses versions seront effacés, et les salles qui le jouent seront fermées.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/packages/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Un paquet .phgame contient un jeu complet dans un seul fichier. Il est vérifié avant installation : une archive
        altérée ou un fichier non déclaré est refusé. Une version plus récente remplace la version jouée ; une version
        plus ancienne est conservée sans être jouée, et vous la choisissez dans « Versions ». Le nom, l’icône, la
        description et les réglages par défaut d’un paquet se modifient dans les sections « Présentation » et « Réglages
        par défaut ». Son contenu (cartes, cases, questions) ne change pas : créez une copie modifiable pour le
        transformer. Une copie garde le lien avec son paquet : elle signale les nouvelles versions, et peut être
        remplacée par la nouvelle version (son nom est conservé ; une copie modifiée demande une confirmation).
      </p>
      <div className="stack">
        <label className="btn primary">
          Importer un paquet (.phgame)
          <input
            type="file"
            accept=".phgame,application/zip"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </label>
        {busy && <span className="muted">Vérification du paquet…</span>}
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="error small">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      {records === null && <p className="muted">Chargement…</p>}
      {records?.length === 0 && <p className="muted">Aucun paquet installé pour l’instant.</p>}

      <ul className="ed-list">
        {records?.map((r) => (
          <li key={r.id} className="ed-list-item">
            <div className="ed-list-preview" aria-hidden="true">
              📦
            </div>
            <div className="ed-list-body">
              <strong>{r.name}</strong>
              <span className="muted small">
                {r.id} · version {r.version} · {STATUS_LABEL[r.status]}
                {r.author ? ` · ${r.author}` : ''}
              </span>
              {r.description && <span className="muted small">{r.description}</span>}
              {r.error && <span className="error small">{r.error}</span>}
              {copies
                .filter((c) => c.packageId === r.id)
                .map((c) => (
                  <div key={c.gameId} className="row small">
                    <span className="small">
                      Copie « {c.name} » · version copiée {c.copiedVersion}
                    </span>
                    {c.modified && <span className="badge">modifiée</span>}
                    {c.updateAvailable && <span className="badge">mise à jour disponible : {c.currentVersion}</span>}
                    {c.updateAvailable && (
                      <button type="button" className="btn ghost small" onClick={() => updateCopy(c)}>
                        Mettre la copie à jour
                      </button>
                    )}
                  </div>
                ))}
              {openId === r.id && (
                <div className="stack small">
                  {versionsById[r.id] === undefined && <span className="muted small">Chargement des versions…</span>}
                  {versionsById[r.id]?.map((v) => (
                    <div key={v.version} className="row">
                      <span className="small">
                        Version {v.version}
                        {v.active ? ' · jouée' : ' · conservée'} · importée le{' '}
                        {new Date(v.installedAt).toLocaleDateString('fr-FR')}
                      </span>
                      {!v.active && (
                        <>
                          <button type="button" className="btn ghost small" onClick={() => activate(r, v.version)}>
                            Jouer cette version
                          </button>
                          <button
                            type="button"
                            className="link-btn small"
                            onClick={() => removeVersion(r, v.version)}
                            aria-label={`Supprimer la version ${v.version} de ${r.name}`}
                          >
                            Supprimer
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="ed-list-actions">
              {r.status !== 'erreur' && (
                <button type="button" className={r.enabled ? 'btn primary' : 'btn ghost'} onClick={() => toggle(r)}>
                  {r.enabled ? 'Activé' : 'Désactivé'}
                </button>
              )}
              <button
                type="button"
                className="btn ghost small"
                aria-expanded={openId === r.id}
                onClick={() => toggleVersions(r)}
              >
                Versions
              </button>
              {r.status === 'actif' && r.module !== 'recipe' && (
                <button type="button" className="btn ghost small" onClick={() => copy(r)}>
                  Créer une copie modifiable
                </button>
              )}
              <button type="button" className="btn ghost small" onClick={() => remove(r)}>
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>
      {copies
        .filter((c) => c.originMissing)
        .map((c) => (
          <p key={c.gameId} className="muted small">
            Copie « {c.name} » : le paquet d’origine a été supprimé. La copie reste modifiable et ne reçoit plus de
            mises à jour.
          </p>
        ))}
    </div>
  );
}
