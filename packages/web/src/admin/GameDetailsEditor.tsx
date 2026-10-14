import { useState, type FormEvent } from 'react';
import type { CatalogGame } from '@partyhub/shared';
import { api } from '../api.js';

/**
 * Nom, icône et description d'un jeu intégré. Les règles du jeu ne se modifient pas :
 * seule sa présentation change, partout où le jeu apparaît.
 */
export function GameDetailsEditor({ game, onSaved }: { game: CatalogGame; onSaved: () => void }) {
  const [name, setName] = useState(game.name);
  const [icon, setIcon] = useState(game.icon);
  const [description, setDescription] = useState(game.description);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function fill(details: { name: string; icon: string; description: string }) {
    setName(details.name);
    setIcon(details.icon);
    setDescription(details.description);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/admin/game-details/${encodeURIComponent(game.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), icon: icon.trim(), description: description.trim() }),
      });
      setMessage({ ok: true, text: 'Enregistré. Les prochaines salles utiliseront ce nom.' });
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
      await api(`/api/admin/game-details/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
      fill(game.defaultDetails);
      setMessage({ ok: true, text: 'Nom, icône et description d’origine restaurés.' });
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
        {game.customDetails && <span className="badge">modifié</span>}
      </summary>
      <form className="stack" onSubmit={save} style={{ marginTop: '1rem' }}>
        <div className="ed-grid-2">
          <label className="field">
            <span>Nom</span>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Icône</span>
            <input value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Description (affichée dans le catalogue)</span>
          <textarea rows={2} maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="section-head">
          <button type="submit" className="btn primary" disabled={busy}>
            Enregistrer
          </button>
          {game.customDetails && (
            <button type="button" className="btn ghost" disabled={busy} onClick={restore}>
              Restaurer l’origine
            </button>
          )}
        </div>
        {message && (
          <p className={message.ok ? 'notice' : 'error'} role="status">
            {message.text}
          </p>
        )}
      </form>
    </details>
  );
}
