import { useEffect, useState } from 'react';
import {
  MUSIC_LABELS,
  MUSIC_SLOTS,
  SFX_LABELS,
  SFX_NAMES,
  type MusicSlot,
  type SfxName,
  type SoundSettings,
} from '@partyhub/shared';
import { api } from '../api.js';
import { loadSoundSettings } from '../sounds.js';
import type { AssetRecord } from './AssetLibrary.js';

/** Sons : une piste de fond par menu, et un bruitage remplaçable par jeu, pris dans la médiathèque. */

const SILENCE = 'Silence';
const ORIGINAL = 'Son d’origine';

export function SoundSettingsAdmin({ libraryVersion }: { libraryVersion: number }) {
  const [draft, setDraft] = useState<SoundSettings | null>(null);
  const [audio, setAudio] = useState<AssetRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<{ sounds: SoundSettings }>('/api/admin/sound-settings')
      .then((res) => setDraft(res.sounds))
      .catch((err: Error) => setMessage({ ok: false, text: err.message }));
  }, []);

  // Les fichiers se mettent à jour quand la médiathèque change, sans toucher aux choix en cours.
  useEffect(() => {
    api<{ assets: AssetRecord[] }>('/api/admin/assets')
      .then((res) => setAudio(res.assets.filter((asset) => asset.kind === 'audio')))
      .catch((err: Error) => setMessage({ ok: false, text: err.message }));
  }, [libraryVersion]);

  function chooseMusic(slot: MusicSlot, id: string) {
    setDraft((current) => (current ? { ...current, music: { ...current.music, [slot]: id || null } } : current));
  }

  function chooseVolume(slot: MusicSlot, percent: number) {
    setDraft((current) =>
      current ? { ...current, musicVolume: { ...current.musicVolume, [slot]: percent } } : current,
    );
  }

  function chooseSfx(name: SfxName, id: string) {
    setDraft((current) => (current ? { ...current, sfx: { ...current.sfx, [name]: id || null } } : current));
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage(null);
    try {
      await api('/api/admin/sound-settings', { method: 'PUT', body: JSON.stringify({ sounds: draft }) });
      await loadSoundSettings();
      setMessage({ ok: true, text: 'Sons enregistrés. Les écrans ouverts les prennent au prochain chargement.' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!draft || !audio) {
    return message ? (
      <p className="error" role="status">
        {message.text}
      </p>
    ) : (
      <p className="muted small">Chargement des sons…</p>
    );
  }

  const options = audio.map((asset) => (
    <option key={asset.id} value={asset.id}>
      {asset.name}
    </option>
  ));

  return (
    <div className="stack">
      {audio.length === 0 && (
        <p className="muted small">
          Aucun fichier audio dans la médiathèque. Ajoutez-en un dans la section au-dessus (mp3, ogg, wav, flac ou m4a),
          puis revenez ici.
        </p>
      )}

      <h3>Musique de fond</h3>
      <p className="muted small">Les musiques bouclent sans fin. Le volume règle le niveau de chaque piste.</p>
      {MUSIC_SLOTS.map((slot) => {
        const id = draft.music[slot];
        return (
          <div className="screen-bg-row" key={slot}>
            <label className="field">
              <span>{MUSIC_LABELS[slot]}</span>
              <select value={id ?? ''} onChange={(e) => chooseMusic(slot, e.target.value)}>
                <option value="">{SILENCE}</option>
                {options}
              </select>
            </label>
            {id && (
              <audio
                controls
                loop
                preload="none"
                src={`/api/assets/${id}`}
                aria-label={`Écouter : ${MUSIC_LABELS[slot]}`}
              />
            )}
            <label className="field">
              <span>Volume : {draft.musicVolume[slot]} %</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={draft.musicVolume[slot]}
                disabled={!id}
                onChange={(e) => chooseVolume(slot, Number(e.target.value))}
              />
            </label>
          </div>
        );
      })}

      <h3>Bruitages des jeux</h3>
      <p className="muted small">Un fichier remplace le son synthétisé d’origine de l’effet correspondant.</p>
      {SFX_NAMES.map((name) => {
        const id = draft.sfx[name];
        return (
          <div className="screen-bg-row" key={name}>
            <label className="field">
              <span>{SFX_LABELS[name]}</span>
              <select value={id ?? ''} onChange={(e) => chooseSfx(name, e.target.value)}>
                <option value="">{ORIGINAL}</option>
                {options}
              </select>
            </label>
            {id && (
              <audio controls preload="none" src={`/api/assets/${id}`} aria-label={`Écouter : ${SFX_LABELS[name]}`} />
            )}
          </div>
        );
      })}

      <div className="screen-bg-row">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          Enregistrer les sons
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
