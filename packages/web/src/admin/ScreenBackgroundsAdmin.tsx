import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { loadScreenBackgrounds, SCREEN_KEYS, SCREEN_LABELS, type ScreenKey } from '../screenBackgrounds.js';
import type { AssetRecord } from './AssetLibrary.js';

/** Fonds d’écran : une image de la médiathèque par écran, ou le décor d’origine. */

type Choice = Record<ScreenKey, string | null>;

const ORIGINAL = 'Décor d’origine';

export function ScreenBackgroundsAdmin({ libraryVersion }: { libraryVersion: number }) {
  const [draft, setDraft] = useState<Choice | null>(null);
  const [images, setImages] = useState<AssetRecord[] | null>(null);
  const [all, setAll] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ backgrounds: Choice }>('/api/admin/screen-backgrounds')
      .then((res) => setDraft(res.backgrounds))
      .catch((err: Error) => setMessage({ ok: false, text: err.message }));
  }, []);

  // Les images se mettent à jour quand la médiathèque change, sans toucher aux choix en cours.
  useEffect(() => {
    api<{ assets: AssetRecord[] }>('/api/admin/assets')
      .then((res) => setImages(res.assets.filter((asset) => asset.kind === 'image')))
      .catch((err: Error) => setMessage({ ok: false, text: err.message }));
  }, [libraryVersion]);

  function choose(key: ScreenKey, id: string) {
    setDraft((current) => (current ? { ...current, [key]: id || null } : current));
  }

  function applyToAll() {
    const id = all || null;
    setDraft(Object.fromEntries(SCREEN_KEYS.map((key) => [key, id])) as Choice);
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/admin/screen-backgrounds', { method: 'PUT', body: JSON.stringify({ backgrounds: draft }) });
      await loadScreenBackgrounds();
      setMessage({ ok: true, text: 'Fonds enregistrés. Les écrans déjà ouverts les prennent au prochain chargement.' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!draft || !images) {
    return message ? (
      <p className="error" role="status">
        {message.text}
      </p>
    ) : (
      <p className="muted small">Chargement des fonds…</p>
    );
  }

  const imageOptions = images.map((asset) => (
    <option key={asset.id} value={asset.id}>
      {asset.name}
    </option>
  ));

  return (
    <div className="stack">
      {images.length === 0 && (
        <p className="muted small">
          Aucune image dans la médiathèque. Ajoutez-en une dans la section au-dessus, puis revenez ici.
        </p>
      )}

      <div className="screen-bg-row">
        <label className="field">
          <span>Même fond pour tous les écrans</span>
          <select value={all} onChange={(e) => setAll(e.target.value)} disabled={images.length === 0}>
            <option value="">{ORIGINAL}</option>
            {imageOptions}
          </select>
        </label>
        <button type="button" className="btn ghost" onClick={applyToAll}>
          Appliquer à tous les écrans
        </button>
      </div>

      {SCREEN_KEYS.map((key) => {
        const id = draft[key];
        return (
          <div className="screen-bg-row" key={key}>
            <label className="field">
              <span>{SCREEN_LABELS[key]}</span>
              <select value={id ?? ''} onChange={(e) => choose(key, e.target.value)}>
                <option value="">{ORIGINAL}</option>
                {imageOptions}
              </select>
            </label>
            {id && <img className="screen-bg-thumb" src={`/api/assets/${id}`} alt="" />}
          </div>
        );
      })}

      <div className="screen-bg-row">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          Enregistrer les fonds
        </button>
      </div>

      {message && (
        <p className={message.ok ? 'notice' : 'error'} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}
