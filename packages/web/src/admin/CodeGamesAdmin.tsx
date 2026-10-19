import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api.js';
import { CodeEditorAdmin } from './CodeEditorAdmin.js';

/** Jeux de code : chaque version installée, son état, et la revue avant approbation. */

/** Un fichier du dossier de dépôt, tel que la dernière lecture l'a trouvé. */
interface DropFileReport {
  name: string;
  status: 'en_attente' | 'deja_recu' | 'refuse';
  message: string;
  issues: string[];
}

interface DropState {
  folder: string;
  files: DropFileReport[];
}

const DROP_LABEL: Record<DropFileReport['status'], string> = {
  en_attente: 'En attente de revue',
  deja_recu: 'Déjà reçu',
  refuse: 'Refusé',
};

export type CodeGameStatus = 'en_attente' | 'active' | 'remplacee' | 'erreur';

export interface CodeGameSummary {
  id: string;
  version: string;
  name: string;
  sha256: string;
  size: number;
  signer: string;
  installedAt: string;
  status: CodeGameStatus;
  error?: string;
  /** Le jeu actif demande des travaux d’IA : l’administrateur peut l’autoriser à utiliser la clé du serveur. */
  aiJobs: boolean;
  aiEnabled: boolean;
}

/** Ligne de différence : inchangée (' '), ajoutée (+), retirée (-), ou passage masqué (…). */
export interface DiffLine {
  kind: ' ' | '+' | '-' | '…';
  text: string;
}

/** Différence avec la version active (seulement les lignes modifiées et leur contexte). */
export interface CodeGameChanges {
  from: string;
  server: DiffLine[];
  client: DiffLine[];
  counts: { server: { added: number; removed: number }; client: { added: number; removed: number } };
}

export interface CodeGameReview extends CodeGameSummary {
  description: string;
  author: string;
  files: { path: string; size: number; sha256: string }[];
  sources: { server: string; client: string };
  changes: CodeGameChanges | null;
}

const STATUS_LABEL: Record<CodeGameStatus, string> = {
  en_attente: 'En attente de revue',
  active: 'Active',
  remplacee: 'Remplacée',
  erreur: 'Erreur',
};

const keyOf = (game: CodeGameSummary) => `${game.id}@${game.version}`;

/** Taille lisible, pour le code affiché à la revue. */
function kilo(bytes: number): string {
  return bytes < 1024 ? `${bytes} o` : `${(bytes / 1024).toFixed(1)} Ko`;
}

/** Ce qui change par rapport à la version active : seulement les lignes modifiées, avec leur contexte. */
function ChangesView({ changes }: { changes: CodeGameChanges }) {
  return (
    <section className="stack" aria-label={`Changements depuis la version ${changes.from}`}>
      <h4>Changements depuis la version {changes.from}</h4>
      <p className="small muted">
        Code serveur : {changes.counts.server.added} ligne(s) ajoutée(s), {changes.counts.server.removed} retirée(s).
        Vues : {changes.counts.client.added} ligne(s) ajoutée(s), {changes.counts.client.removed} retirée(s).
      </p>
      <DiffBlock title="Code serveur" lines={changes.server} />
      <DiffBlock title="Vues" lines={changes.client} />
    </section>
  );
}

function DiffBlock({ title, lines }: { title: string; lines: DiffLine[] }) {
  if (lines.length === 0) return <p className="small muted">{title} : aucun changement.</p>;
  return (
    <details open>
      <summary>{title} : lignes modifiées</summary>
      <pre className="small" style={{ maxHeight: '60vh', overflow: 'auto' }}>
        {lines.map((line, index) => (
          <div key={index}>{line.kind === '…' ? '…' : `${line.kind} ${line.text}`}</div>
        ))}
      </pre>
    </details>
  );
}

export function CodeGamesAdmin({ refreshToken, onChanged }: { refreshToken: number; onChanged: () => void }) {
  const [games, setGames] = useState<CodeGameSummary[] | null>(null);
  const [review, setReview] = useState<CodeGameReview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [url, setUrl] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  /** Signature de la dernière lecture du dossier : la liste des jeux ne se recharge que si elle change. */
  const lastDrop = useRef('');

  async function load() {
    try {
      const res = await api<{ games: CodeGameSummary[] }>('/api/admin/code-games');
      setGames(res.games);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    // Un nouvel import (refreshToken) relance la liste.
    void load();
  }, [refreshToken]);

  /** Le serveur relit le dossier de dépôt toutes les dix secondes : l'écran suit. */
  useEffect(() => {
    void loadDrop();
    const timer = setInterval(() => void loadDrop(), 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDrop() {
    try {
      applyDrop(await api<DropState>('/api/admin/code-intake'));
    } catch {
      // Le dossier de dépôt est un confort : son erreur ne doit pas masquer la liste des jeux.
    }
  }

  function applyDrop(next: DropState) {
    setDrop(next);
    const signature = next.files.map((f) => `${f.name}:${f.status}`).join('|');
    if (signature !== lastDrop.current) {
      lastDrop.current = signature;
      void load();
    }
  }

  async function scanNow() {
    setError(null);
    setIssues([]);
    setNotice(null);
    setBusy(true);
    try {
      applyDrop(await api<DropState>('/api/admin/code-intake/scan', { method: 'POST' }));
      setNotice('Dossier de dépôt relu.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function importUrl(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIssues([]);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api<{ id: string; version: string; unchanged: boolean }>('/api/admin/code-intake/url', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim() }),
      });
      setNotice(
        res.unchanged
          ? `« ${res.id} » ${res.version} est déjà reçu, sans modification.`
          : `« ${res.id} » ${res.version} est reçu. Relisez-le et approuvez-le ci-dessous.`,
      );
      setUrl('');
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setIssues((err as { issues?: string[] }).issues ?? []);
    } finally {
      setBusy(false);
    }
  }

  async function openReview(game: CodeGameSummary) {
    setError(null);
    setNotice(null);
    setConfirmed(false);
    try {
      const res = await api<CodeGameReview>(
        `/api/admin/code-games/${encodeURIComponent(game.id)}/${encodeURIComponent(game.version)}/review`,
      );
      setReview(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function approve(current: CodeGameReview) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ closedRooms: number; enabled?: boolean }>(
        `/api/admin/code-games/${encodeURIComponent(current.id)}/${encodeURIComponent(current.version)}/approve`,
        { method: 'POST', body: JSON.stringify({ sha256: current.sha256 }) },
      );
      const closed = res.closedRooms > 0 ? ` ${res.closedRooms} salle(s) de l’ancienne version ont été fermées.` : '';
      const state =
        res.enabled === false
          ? ' Le jeu reste désactivé : réactivez-le dans l’administration des jeux.'
          : ' Il est actif.';
      setNotice(`« ${current.name} » ${current.version} est approuvé.${state}${closed}`);
      setReview(null);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Relit les clés de confiance et les versions actives : une clé retirée arrête les jeux qu'elle a signés. */
  async function reloadAll() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api<{ stopped: string[]; closedRooms: number; active: number }>(
        '/api/admin/code-games/reload',
        { method: 'POST' },
      );
      const stopped =
        res.stopped.length > 0 ? ` Arrêtés : ${res.stopped.join(', ')} (${res.closedRooms} salle(s) fermée(s)).` : '';
      setNotice(`Jeux de code relus : ${res.active} actif(s).${stopped}`);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAi(game: CodeGameSummary) {
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/code-games/${encodeURIComponent(game.id)}/ai`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !game.aiEnabled }),
      });
      setNotice(
        game.aiEnabled
          ? `IA retirée pour « ${game.name} » : son repli habituel reprend.`
          : `IA autorisée pour « ${game.name} ». Elle utilise la clé du serveur.`,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(game: CodeGameSummary) {
    const what =
      game.status === 'active'
        ? `Supprimer le jeu « ${game.name} » ? Ses salles en cours seront fermées.`
        : `Supprimer la version ${game.version} de « ${game.name} » ?`;
    if (!window.confirm(what)) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/code-games/${encodeURIComponent(game.id)}/${encodeURIComponent(game.version)}`, {
        method: 'DELETE',
      });
      if (review && keyOf(review) === keyOf(game)) setReview(null);
      setNotice(`Version ${game.version} supprimée.`);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="stack">
      <h3>Jeux de code</h3>
      <p className="muted small">
        Un jeu de code exécute son propre code sur le serveur, à l’intérieur d’un isolat sans réseau ni accès aux
        fichiers. Il ne joue qu’après votre approbation, une fois le code relu. Une version approuvée n’est remplacée
        que par une autre version approuvée.
      </p>
      <div className="row">
        <button type="button" className="btn ghost small" onClick={reloadAll} disabled={busy}>
          Recharger les clés et les jeux
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
      <section className="stack" aria-label="Ajouter un jeu de code">
        <h4>Ajouter un jeu de code</h4>
        <p className="muted small">
          Un jeu ajouté ici arrive en revue. Il ne joue qu’après votre approbation. L’auteur le signe avec sa clé, hors
          de PartyHub.
        </p>

        <div className="stack small">
          <strong>Dossier de dépôt</strong>
          <p className="muted small">
            Déposez les fichiers .phgame dans le dossier « {drop?.folder ?? 'depot-jeux'} » de DATA_DIR. PartyHub le
            relit toutes les dix secondes.
          </p>
          {drop && drop.files.length === 0 && <span className="muted small">Aucun fichier dans le dossier.</span>}
          {drop && drop.files.length > 0 && (
            <ul className="ed-list">
              {drop.files.map((f) => (
                <li key={f.name} className="ed-list-item">
                  <div className="ed-list-body">
                    <strong>{f.name}</strong>
                    <span className="muted small">
                      {DROP_LABEL[f.status]} : {f.message}
                    </span>
                    {f.issues.map((issue) => (
                      <span key={issue} className="error small">
                        {issue}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button type="button" className="btn ghost small" onClick={scanNow} disabled={busy}>
              Relire le dossier maintenant
            </button>
          </div>
        </div>

        <form className="stack small" onSubmit={importUrl} aria-label="Importer depuis un lien">
          <strong>Lien HTTPS</strong>
          <label className="field">
            <span>Adresse du fichier .phgame</span>
            <input
              type="url"
              placeholder="https://…/mon-jeu-0.1.0.phgame"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          {issues.length > 0 && (
            <ul className="error small">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          <div className="row">
            <button type="submit" className="btn ghost small" disabled={busy || !url.trim()}>
              Importer depuis ce lien
            </button>
          </div>
        </form>
      </section>

      {games === null && <p className="muted">Chargement…</p>}
      {games?.length === 0 && <p className="muted">Aucun jeu de code importé.</p>}

      <ul className="ed-list">
        {games?.map((g) => (
          <li key={keyOf(g)} className="ed-list-item">
            <div className="ed-list-preview" aria-hidden="true">
              🧩
            </div>
            <div className="ed-list-body">
              <strong>{g.name}</strong>
              <span className="muted small">
                {g.id} · version {g.version} · {STATUS_LABEL[g.status]} · signé par {g.signer}
              </span>
              {g.error && <span className="error small">{g.error}</span>}
            </div>
            <div className="ed-list-actions">
              {(g.status === 'en_attente' || g.status === 'remplacee') && (
                <button type="button" className="btn ghost small" onClick={() => openReview(g)}>
                  {g.status === 'en_attente' ? 'Relire et approuver' : 'Relire'}
                </button>
              )}
              {g.status === 'active' && g.aiJobs && (
                <label className="small">
                  <input type="checkbox" checked={g.aiEnabled} onChange={() => toggleAi(g)} /> Autoriser l’IA du serveur
                </label>
              )}
              <button type="button" className="btn ghost small" onClick={() => remove(g)}>
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>

      {review && (
        <section className="stack" aria-label={`Revue de ${review.name}`}>
          <h4>
            Revue : {review.name} {review.version}
          </h4>
          <p className="small">
            {review.description}
            {review.author ? ` · par ${review.author}` : ''}
          </p>
          <p className="small muted">
            Empreinte du paquet : <code>{review.sha256}</code> · clé de signature <code>{review.signer}</code>
          </p>
          <table className="small">
            <thead>
              <tr>
                <th scope="col">Fichier</th>
                <th scope="col">Taille</th>
                <th scope="col">Empreinte</th>
              </tr>
            </thead>
            <tbody>
              {review.files.map((f) => (
                <tr key={f.path}>
                  <td>{f.path}</td>
                  <td>{kilo(f.size)}</td>
                  <td>
                    <code>{f.sha256.slice(0, 16)}…</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>Code serveur (règles, exécuté dans l’isolat)</summary>
            <pre className="small" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {review.sources.server}
            </pre>
          </details>
          <details>
            <summary>Code des vues (exécuté dans l’iframe)</summary>
            <pre className="small" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {review.sources.client}
            </pre>
          </details>
          {review.changes && <ChangesView changes={review.changes} />}
          {review.status === 'en_attente' && (
            <div className="row">
              <label className="row small">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                J’ai relu ce code et j’approuve son exécution sur ce serveur.
              </label>
              <button
                type="button"
                className="btn primary"
                disabled={!confirmed || busy}
                onClick={() => approve(review)}
              >
                Approuver et activer
              </button>
              <button type="button" className="btn ghost" onClick={() => setReview(null)}>
                Fermer
              </button>
            </div>
          )}
          {review.status !== 'en_attente' && (
            <button type="button" className="btn ghost" onClick={() => setReview(null)}>
              Fermer
            </button>
          )}
        </section>
      )}
      <hr />
      <CodeEditorAdmin />
    </div>
  );
}
