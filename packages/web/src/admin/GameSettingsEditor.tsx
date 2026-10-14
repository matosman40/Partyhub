import { useState } from 'react';
import type { CatalogGame } from '@partyhub/shared';
import { api } from '../api.js';
import { viewsFor } from '../games.js';
import { openRoomsText } from './messages.js';

type Settings = Record<string, unknown>;

/**
 * Réglages par défaut d'un jeu, quelle que soit son origine (intégré, cartes, médias, plateau
 * ou paquet importé). Le formulaire est celui que l'hôte voit dans son salon. Les nouvelles
 * salles partent de ces valeurs ; une salle déjà ouverte garde les siennes.
 */
export function GameSettingsEditor({ game, onSaved }: { game: CatalogGame; onSaved: () => void }) {
  const Settings = viewsFor(game.id)?.Settings;
  const [draft, setDraft] = useState<Settings>(game.settings);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!Settings) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(game.settings);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/admin/games/${encodeURIComponent(game.id)}/settings`, {
        method: 'PUT',
        body: JSON.stringify({ settings: draft }),
      });
      setMessage({ ok: true, text: `Réglages enregistrés. ${openRoomsText(0)}` });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/admin/games/${encodeURIComponent(game.id)}/settings`, { method: 'DELETE' });
      setDraft(game.defaultSettings);
      setMessage({ ok: true, text: 'Réglages d’origine restaurés.' });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="notice-editor card">
      <summary>
        <span aria-hidden="true">{game.icon}</span> {game.name}{' '}
        {game.customSettings && <span className="badge">réglages modifiés</span>}
      </summary>
      <div className="stack" style={{ marginTop: '1rem' }}>
        <Settings settings={draft} disabled={busy} onChange={setDraft} />
        <div className="section-head">
          <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>
            Enregistrer les réglages
          </button>
          {game.customSettings && (
            <button type="button" className="btn ghost" disabled={busy} onClick={restore}>
              Revenir aux réglages d’origine
            </button>
          )}
        </div>
        {message && (
          <p className={message.ok ? 'notice' : 'error'} role="status">
            {message.text}
          </p>
        )}
      </div>
    </details>
  );
}
