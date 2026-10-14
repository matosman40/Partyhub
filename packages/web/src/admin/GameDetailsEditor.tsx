import { useState, type FormEvent } from 'react';
import type { CatalogGame } from '@partyhub/shared';
import { api } from '../api.js';
import { openRoomsText } from './messages.js';

/**
 * Nom, icône, description et durée estimée d'un jeu intégré ou importé. Les règles et le nombre
 * de joueurs ne se modifient pas ici : seule la présentation change, partout où le jeu apparaît.
 */
export function GameDetailsEditor({ game, onSaved }: { game: CatalogGame; onSaved: () => void }) {
  const [name, setName] = useState(game.name);
  const [icon, setIcon] = useState(game.icon);
  const [description, setDescription] = useState(game.description);
  const [duration, setDuration] = useState(String(game.durationMin));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function fill(details: { name: string; icon: string; description: string; durationMin?: number }) {
    setName(details.name);
    setIcon(details.icon);
    setDescription(details.description);
    setDuration(String(details.durationMin ?? game.durationMin));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const minutes = Number(duration);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      setMessage({ ok: false, text: 'La durée estimée doit être un nombre entier de minutes, entre 1 et 240.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ openRooms: number }>(`/api/admin/game-details/${encodeURIComponent(game.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          icon: icon.trim(),
          description: description.trim(),
          durationMin: minutes,
        }),
      });
      setMessage({ ok: true, text: `Enregistré. ${openRoomsText(res.openRooms)}` });
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
      setMessage({ ok: true, text: 'Nom, icône, description et durée d’origine restaurés.' });
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
        <label className="field">
          <span>Durée estimée, en minutes (affichée dans le catalogue et le salon)</span>
          <input
            type="number"
            min={1}
            max={240}
            step={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
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
