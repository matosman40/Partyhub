import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

interface DbBackupFile {
  name: string;
  size: number;
  createdAt: string;
}

interface DbBackupStatus {
  enabled: boolean;
  everyHours: number;
  keep: number;
  backups: DbBackupFile[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Sauvegardes automatiques de la base SQLite (profils, statistiques, parties).
 * Les fichiers restent sur le serveur : ils ne se téléchargent pas depuis cette page.
 */
export function DbBackups() {
  const [status, setStatus] = useState<DbBackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api<DbBackupStatus>('/api/admin/db-backups'));
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createNow() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ ok: true; name: string }>('/api/admin/db-backups', { method: 'POST' });
      setMessage({ ok: true, text: `Sauvegarde créée : ${res.name}.` });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return message ? (
      <p className="error" role="alert">
        {message.text}
      </p>
    ) : (
      <p className="muted">Chargement des sauvegardes…</p>
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        {status.enabled
          ? `Sauvegarde automatique toutes les ${status.everyHours} h, ${status.keep} copies conservées.`
          : 'Sauvegarde automatique désactivée (DB_BACKUP_EVERY_HOURS=0).'}{' '}
        Les fichiers sont enregistrés sur le serveur. Ils contiennent les profils et les statistiques : traitez-les
        comme des données personnelles.
      </p>
      <div>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => void createNow()}>
          {busy ? 'Sauvegarde en cours…' : 'Sauvegarder la base maintenant'}
        </button>
      </div>
      {status.backups.length === 0 ? (
        <p className="muted">Aucune sauvegarde de la base pour l’instant.</p>
      ) : (
        <ul className="stack">
          {status.backups.map((backup) => (
            <li key={backup.name}>
              {formatDate(backup.createdAt)} ({formatSize(backup.size)}) : <code>{backup.name}</code>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
