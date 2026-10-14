import { useEffect, useState } from 'react';
import { MEDIA_KIND_ICON, MEDIA_KIND_LABEL, type MediaQuizDefinition } from '@partyhub/shared';
import { api } from '../api.js';
import { MediaGameEditor, type MediaGameRecord } from './MediaGameEditor.js';

/**
 * Jeux de questions médias (« Devine le film », « Devine la chanson »…) : liste, création,
 * duplication, export et import au format JSON, suppression.
 */
export function MediaGamesAdmin({ onChanged }: { onChanged: () => void }) {
  const [records, setRecords] = useState<MediaGameRecord[] | null>(null);
  const [editing, setEditing] = useState<{
    record: MediaGameRecord | null;
    initial: MediaQuizDefinition | null;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ games: MediaGameRecord[] }>('/api/admin/media-games');
      setRecords(res.games);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function duplicate(record: MediaGameRecord) {
    await run(
      () => api(`/api/admin/media-games/${encodeURIComponent(record.id)}/duplicate`, { method: 'POST' }),
      `« ${record.definition.name} » a été copié.`,
    );
  }

  async function remove(record: MediaGameRecord) {
    if (!window.confirm(`Supprimer « ${record.definition.name} » ? Les salles qui le jouent seront fermées.`)) return;
    await run(
      () => api(`/api/admin/media-games/${encodeURIComponent(record.id)}`, { method: 'DELETE' }),
      `« ${record.definition.name} » a été supprimé.`,
    );
  }

  async function importFile(file: File) {
    setError(null);
    setNotice(null);
    try {
      const data = JSON.parse(await file.text()) as unknown;
      await api('/api/admin/media-games/import', { method: 'POST', body: JSON.stringify(data) });
      setNotice(`« ${file.name} » a été importé.`);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof SyntaxError ? 'Ce fichier n’est pas un JSON valide.' : (err as Error).message);
    }
  }

  if (editing) {
    return (
      <MediaGameEditor
        key={editing.record?.id ?? 'new'}
        editing={editing.record}
        initial={editing.initial}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="stack">
      <p className="muted">
        Un jeu de questions médias est une suite d’extraits : un film, une chanson, ou une scène. Les joueurs tapent le
        titre sur leur téléphone pendant que l’extrait joue sur l’écran principal. Le média n’est jamais envoyé aux
        téléphones.
      </p>

      <div className="ed-new">
        <button type="button" className="btn primary" onClick={() => setEditing({ record: null, initial: null })}>
          Nouveau jeu de questions
        </button>
        <label className="btn ghost">
          Importer un fichier
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {records === null && <p className="muted">Chargement…</p>}
      {records?.length === 0 && <p className="muted">Aucun jeu de questions médias pour l’instant.</p>}

      <ul className="ed-list">
        {records?.map((r) => (
          <li key={r.id} className="ed-list-item">
            <div className="ed-list-preview media-badge" aria-hidden="true">
              {r.definition.icon || MEDIA_KIND_ICON[r.definition.kind]}
            </div>
            <div className="ed-list-body">
              <strong>{r.definition.name}</strong>
              <span className="muted small">
                {r.definition.mode === 'sous-titres' ? 'Sous-titres' : MEDIA_KIND_LABEL[r.definition.kind]} ·{' '}
                {r.definition.items.length} extrait(s) · {r.definition.rules.questionCount} par partie
              </span>
              {r.missingAssets.length > 0 && (
                <span className="error small">
                  {r.missingAssets.length} fichier(s) manquent dans la médiathèque : ce jeu ne peut pas être joué.
                </span>
              )}
            </div>
            <div className="ed-list-actions">
              <button
                type="button"
                className="btn ghost small"
                onClick={() => setEditing({ record: r, initial: r.definition })}
              >
                Modifier
              </button>
              <button type="button" className="btn ghost small" onClick={() => duplicate(r)}>
                Dupliquer
              </button>
              <a
                className="btn ghost small"
                href={`/api/admin/media-games/${encodeURIComponent(r.id)}/export`}
                download
              >
                Exporter
              </a>
              <button type="button" className="btn ghost small" onClick={() => remove(r)}>
                Supprimer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
