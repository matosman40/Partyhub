import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.js';

interface UpdateRelease {
  version: string;
  name: string;
  publishedAt: string;
  notes: string;
  url: string;
  newer: boolean;
}

interface UpdateStatus {
  state: 'waiting' | 'running' | 'done' | 'failed' | 'rolled-back';
  version: string | null;
  from: string | null;
  message: string;
  at: string;
}

interface UpdateView {
  current: string;
  repo: string;
  checkedAt: string | null;
  checkError: string | null;
  releases: UpdateRelease[];
  updater: { installed: boolean; seenAt: string | null };
  pending: { version: string; requestedAt: string; backup: string | null } | null;
  status: UpdateStatus | null;
  openRooms: number;
  inGame: number;
  canUpdate: boolean;
  blockedReason: string | null;
}

const STATE_LABEL: Record<UpdateStatus['state'], string> = {
  waiting: 'en attente',
  running: 'en cours',
  done: 'réussie',
  failed: 'échouée',
  'rolled-back': 'annulée, retour à la version précédente',
};

/**
 * Notes de version : seuls les titres et les listes à puces sont mis en forme. Le texte passe par React,
 * qui l’échappe : aucun HTML ni lien n’est interprété.
 */
function renderNotes(notes: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
    items = [];
  };
  for (const raw of notes.split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      items.push(bullet[1] ?? '');
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(
      heading ? (
        <p key={blocks.length}>
          <strong>{heading[1]}</strong>
        </p>
      ) : (
        <p key={blocks.length}>{line}</p>
      ),
    );
  }
  flush();
  return blocks;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Version en cours, changelog des versions publiées, et mise à jour en deux temps (demande, puis
 * confirmation). L’application ne touche pas à Docker : elle transmet la demande à l’hôte, qui l’exécute.
 */
export function UpdatePanel() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    try {
      setView(await api<UpdateView>(`/api/admin/update${refresh ? '?refresh=1' : ''}`));
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // Pendant une mise à jour, l’état est relu toutes les 15 secondes : le serveur redémarre pendant ce temps.
  const underway =
    view !== null && (view.pending !== null || view.status?.state === 'running' || view.status?.state === 'waiting');
  useEffect(() => {
    if (!underway) return;
    const timer = window.setInterval(() => void load(false), 15_000);
    return () => window.clearInterval(timer);
  }, [underway, load]);

  async function install(version: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/admin/update', { method: 'POST', body: JSON.stringify({ version }) });
      setConfirming(null);
      setMessage({
        ok: true,
        text: `Mise à jour vers la version ${version} demandée. Le serveur redémarrera dans une minute environ : les salons ouverts seront fermés.`,
      });
      await load(false);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/admin/update', { method: 'DELETE' });
      setMessage({ ok: true, text: 'Demande de mise à jour annulée.' });
      await load(false);
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return loadError ? (
      <p className="error" role="alert">
        {loadError}
      </p>
    ) : (
      <p className="muted">Chargement des versions…</p>
    );
  }

  const newest = view.releases.find((release) => release.newer);

  return (
    <div className="stack">
      <p>
        Version en cours : <strong>{view.current}</strong>
        {view.releases.length > 0 && !newest && <span className="muted"> (la plus récente publiée)</span>}
      </p>

      {view.checkError ? (
        <p className="error" role="alert">
          {view.checkError}
        </p>
      ) : (
        <p className="muted small">
          {view.checkedAt
            ? `Versions publiées vérifiées le ${formatDate(view.checkedAt)} sur GitHub.`
            : 'Versions publiées pas encore vérifiées.'}
        </p>
      )}

      {view.pending && (
        <p className="notice" role="status">
          Mise à jour vers la version {view.pending.version} demandée le {formatDate(view.pending.requestedAt)}.
          {view.inGame > 0 && ' Elle attend la fin des parties en cours.'}{' '}
          <button type="button" className="link-btn" disabled={busy} onClick={() => void cancel()}>
            Annuler la demande
          </button>
        </p>
      )}

      {view.status && (
        <p
          className={view.status.state === 'failed' || view.status.state === 'rolled-back' ? 'error' : 'muted'}
          role="status"
        >
          Dernière mise à jour ({formatDate(view.status.at)}) : {STATE_LABEL[view.status.state]}. {view.status.message}
        </p>
      )}

      {view.blockedReason && !view.pending && <p className="muted">{view.blockedReason}</p>}

      <ul className="stack update-releases">
        {view.releases.map((release) => (
          <li key={release.version} className="stack">
            <details open={release.newer}>
              <summary>
                <strong>{release.version}</strong>
                {release.version === view.current && <span className="badge"> en cours</span>}
                {release.publishedAt && <span className="muted"> — {formatDate(release.publishedAt)}</span>}
              </summary>
              <div className="update-notes">
                {release.notes ? renderNotes(release.notes) : <p className="muted">Pas de notes pour cette version.</p>}
              </div>
            </details>

            {release.newer &&
              (confirming === release.version ? (
                <div className="stack">
                  <p>
                    PartyHub redémarrera pour passer en version {release.version}. Une copie de la base est faite avant
                    ; les profils et statistiques sont conservés.
                    {view.openRooms > 0 && ` ${view.openRooms} salon(s) ouvert(s) seront fermés.`}
                  </p>
                  <div>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void install(release.version)}
                    >
                      {busy ? 'Demande en cours…' : `Confirmer la mise à jour vers ${release.version}`}
                    </button>{' '}
                    <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(null)}>
                      Ne pas mettre à jour
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={!view.canUpdate || busy}
                    onClick={() => setConfirming(release.version)}
                  >
                    Installer la version {release.version}
                  </button>
                </div>
              ))}
          </li>
        ))}
      </ul>

      {view.releases.length === 0 && !view.checkError && (
        <p className="muted">Aucune version publiée pour l’instant.</p>
      )}

      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}
      {loadError && view && (
        <p className="muted small" role="status">
          Le serveur ne répond pas pour l’instant : l’état se rafraîchira seul.
        </p>
      )}

      <div>
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => void load(true)}>
          Vérifier les nouvelles versions
        </button>
      </div>
    </div>
  );
}
