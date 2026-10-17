import { useState } from 'react';
import { api } from '../api.js';

interface RestoreSummary {
  cardGames: number;
  mediaGames: number;
  boardGames: number;
  details: number;
  notices: number;
  duplicates: number;
  replaced: number;
  assets: number;
  assetsPresent: number;
  skipped: string[];
}

/** Lit la réponse d’un envoi ou d’un téléchargement binaire, avec le message d’erreur du serveur. */
async function readOrThrow(res: Response): Promise<void> {
  if (res.ok) return;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(data.error ?? 'Erreur inattendue.');
}

/**
 * Sauvegarde et restauration. Deux formats :
 * - JSON : jeux, textes et notices modifiés (léger, sans les fichiers de la médiathèque) ;
 * - ZIP : la même chose plus les fichiers de la médiathèque, avec leurs identifiants.
 * La restauration ajoute ce qui manque. Les doublons (définitions identiques) ne sont pas recréés.
 * Avec « remplacer », un jeu de même nom est mis à jour au lieu d’être copié.
 */
export function BackupPanel({ onChanged }: { onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);

  async function downloadArchive() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/admin/backup/archive');
      await readOrThrow(res);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `partyhub-sauvegarde-complete-${stamp}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restore(file: File) {
    const mode = replace ? 'remplacer les jeux de même nom' : 'ajouter les jeux manquants';
    if (!window.confirm(`Restaurer « ${file.name} » en mode « ${mode} » ?`)) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const query = replace ? '?conflict=replace' : '';
      let result: { ok: true; summary: RestoreSummary };
      if (file.name.toLowerCase().endsWith('.zip')) {
        const res = await fetch(`/api/admin/backup/archive${query}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/zip' },
          body: file,
        });
        await readOrThrow(res);
        result = (await res.json()) as { ok: true; summary: RestoreSummary };
      } else {
        const data = JSON.parse(await file.text()) as unknown;
        result = await api<{ ok: true; summary: RestoreSummary }>(`/api/admin/backup/import${query}`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
      setSummary(result.summary);
      onChanged();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Ce fichier n’est pas une sauvegarde valide.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        La sauvegarde complète (ZIP) contient les jeux de cartes, de questions médias et de plateau, les textes et
        notices modifiés des jeux intégrés, et les fichiers de la médiathèque. Au-delà de 512 Mio de médias, téléchargez
        la sauvegarde sans les fichiers et copiez le dossier des médias à part.
      </p>
      <div className="ed-new">
        <button type="button" className="btn primary" onClick={() => void downloadArchive()} disabled={busy}>
          Télécharger la sauvegarde complète (ZIP)
        </button>
        <a className="btn ghost" href="/api/admin/backup" download>
          Sauvegarde sans médiathèque (JSON)
        </a>
        <label className="btn ghost">
          Restaurer une sauvegarde
          <input
            type="file"
            accept="application/zip,.zip,application/json,.json"
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
      <label className="check">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
        <span>
          Remplacer les jeux de même nom au lieu d’ajouter une copie (les jeux identiques sont toujours ignorés)
        </span>
      </label>
      {busy && (
        <p className="muted" role="status">
          Patientez…
        </p>
      )}
      {summary && (
        <div className="notice" role="status">
          Restauré : {summary.cardGames} jeu(x) de cartes, {summary.mediaGames} jeu(x) de questions médias,{' '}
          {summary.boardGames} plateau(x), {summary.details} présentation(s), {summary.notices} notice(s).
          <br />
          Fichiers de la médiathèque : {summary.assets} ajouté(s), {summary.assetsPresent} déjà présent(s). Doublons
          ignorés : {summary.duplicates}. Remplacés : {summary.replaced}.
          {summary.skipped.length > 0 && (
            <>
              <br />
              Non restauré(s) : {summary.skipped.join(' ; ')}
            </>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
