import { useState } from 'react';
import { api } from '../api.js';

interface RestoreSummary {
  cardGames: number;
  mediaGames: number;
  details: number;
  notices: number;
  skipped: string[];
}

/**
 * Sauvegarde complète et restauration. La restauration ajoute les jeux personnalisés
 * (rien n'est écrasé) et remplace les textes et notices des jeux intégrés qu'elle contient.
 */
export function BackupPanel({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(file: File) {
    if (!window.confirm(`Restaurer « ${file.name} » ? Les jeux de la sauvegarde seront ajoutés à ceux existants.`)) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const data = JSON.parse(await file.text()) as unknown;
      const res = await api<{ ok: true; summary: RestoreSummary }>('/api/admin/backup/import', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setSummary(res.summary);
      onChanged();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Ce fichier n’est pas un JSON valide.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        La sauvegarde contient les jeux de cartes, les jeux de questions médias (avec leurs références aux fichiers),
        et les textes et notices modifiés des jeux intégrés. Les fichiers de la médiathèque ne sont pas inclus : pensez
        à les conserver à part.
      </p>
      <div className="ed-new">
        <a className="btn primary" href="/api/admin/backup" download>
          Télécharger une sauvegarde
        </a>
        <label className="btn ghost">
          Restaurer une sauvegarde
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restore(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {busy && <p className="muted" role="status">Restauration en cours…</p>}
      {summary && (
        <div className="notice" role="status">
          Restauré : {summary.cardGames} jeu(x) de cartes, {summary.mediaGames} jeu(x) de questions médias,{' '}
          {summary.details} présentation(s) de jeux intégrés, {summary.notices} notice(s).
          {summary.skipped.length > 0 && (
            <>
              <br />
              Non restauré(s) : {summary.skipped.join(' ; ')}
            </>
          )}
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
