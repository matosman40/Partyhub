import { useEffect, useState } from 'react';
import { api } from '../api.js';

/** Jeux de code : chaque version installée, son état, et la revue avant approbation. */

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
}

export interface CodeGameReview extends CodeGameSummary {
  description: string;
  author: string;
  files: { path: string; size: number; sha256: string }[];
  sources: { server: string; client: string };
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

export function CodeGamesAdmin({ refreshToken, onChanged }: { refreshToken: number; onChanged: () => void }) {
  const [games, setGames] = useState<CodeGameSummary[] | null>(null);
  const [review, setReview] = useState<CodeGameReview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const res = await api<{ closedRooms: number }>(
        `/api/admin/code-games/${encodeURIComponent(current.id)}/${encodeURIComponent(current.version)}/approve`,
        { method: 'POST', body: JSON.stringify({ sha256: current.sha256 }) },
      );
      const closed = res.closedRooms > 0 ? ` ${res.closedRooms} salle(s) de l’ancienne version ont été fermées.` : '';
      setNotice(`« ${current.name} » ${current.version} est approuvé et active.${closed}`);
      setReview(null);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
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
    </div>
  );
}
