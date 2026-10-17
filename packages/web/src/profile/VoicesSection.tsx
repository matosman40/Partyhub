import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  VOICE_MAX_PER_PROFILE,
  VOICE_MAX_SECONDS,
  VOICE_NAME_MAX,
  voiceNameSchema,
  type VoiceClip,
} from '@partyhub/shared';
import { api } from '../api.js';
import { voiceUrl } from '../components/voiceQueue.js';
import { authHeaders } from './session.js';
import { checkVoiceFile, defaultVoiceName, pickRecordingType } from './voiceRecording.js';

interface Notice {
  ok: boolean;
  text: string;
}

interface Draft {
  blob: Blob;
  url: string;
  name: string;
  seconds: number;
}

/** Les voix de profil : enregistrer (micro) ou importer un fichier, nommer, écouter, renommer, supprimer. */
export function VoicesSection() {
  const [voices, setVoices] = useState<VoiceClip[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<{ seconds: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | undefined>(undefined);
  const tickRef = useRef<number | undefined>(undefined);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const draftUrlRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ voices: VoiceClip[] }>('/api/profiles/me/voices', { headers: authHeaders() });
      setVoices(r.voices);
    } catch (err) {
      setVoices([]);
      setNotice({ ok: false, text: (err as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      window.clearTimeout(stopTimerRef.current);
      window.clearInterval(tickRef.current);
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      previewRef.current?.pause();
      if (draftUrlRef.current) URL.revokeObjectURL(draftUrlRef.current);
    };
  }, [load]);

  function setDraftFrom(blob: Blob, seconds: number) {
    if (draftUrlRef.current) URL.revokeObjectURL(draftUrlRef.current);
    const url = URL.createObjectURL(blob);
    draftUrlRef.current = url;
    setDraft({ blob, url, seconds, name: defaultVoiceName(voices ?? []) });
  }

  function discardDraft() {
    if (draftUrlRef.current) URL.revokeObjectURL(draftUrlRef.current);
    draftUrlRef.current = null;
    setDraft(null);
  }

  function stopRecording() {
    window.clearTimeout(stopTimerRef.current);
    window.clearInterval(tickRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }

  async function startRecording() {
    setNotice(null);
    const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    if (!canRecord || typeof MediaRecorder === 'undefined') {
      setNotice({
        ok: false,
        text: 'L’enregistrement demande une connexion sécurisée (https) et un navigateur récent. Choisissez plutôt un fichier audio.',
      });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice({
        ok: false,
        text: 'Accès au micro refusé. Autorisez le micro dans votre navigateur, ou choisissez un fichier audio.',
      });
      return;
    }
    const type = pickRecordingType((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      window.clearInterval(tickRef.current);
      setRecording(null);
      const seconds = (Date.now() - startedAt) / 1000;
      const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
      if (blob.size === 0) {
        setNotice({ ok: false, text: 'Rien n’a été enregistré. Réessayez.' });
        return;
      }
      const error = checkVoiceFile(blob.size, Number.POSITIVE_INFINITY);
      if (error) {
        setNotice({ ok: false, text: error });
        return;
      }
      setDraftFrom(blob, Math.min(seconds, VOICE_MAX_SECONDS));
    };
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setRecording({ seconds: 0 });
    tickRef.current = window.setInterval(() => {
      setRecording({ seconds: Math.min(VOICE_MAX_SECONDS, Math.floor((Date.now() - startedAt) / 1000)) });
    }, 250);
    // L’enregistrement s’arrête tout seul à la limite.
    stopTimerRef.current = window.setTimeout(stopRecording, VOICE_MAX_SECONDS * 1000);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setNotice(null);
    const sizeError = checkVoiceFile(file.size, Number.NaN);
    if (sizeError) {
      setNotice({ ok: false, text: sizeError });
      return;
    }
    const probe = new Audio();
    const url = URL.createObjectURL(file);
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const error = checkVoiceFile(file.size, probe.duration);
      URL.revokeObjectURL(url);
      if (error) {
        setNotice({ ok: false, text: error });
        return;
      }
      setDraftFrom(file, Number.isFinite(probe.duration) ? probe.duration : 0);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      setNotice({ ok: false, text: 'Ce fichier n’est pas un son lisible.' });
    };
    probe.src = url;
  }

  async function saveDraft() {
    if (!draft) return;
    const name = voiceNameSchema.safeParse(draft.name);
    if (!name.success) {
      setNotice({ ok: false, text: name.error.issues[0]?.message ?? 'Nom invalide.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api<{ voice: VoiceClip }>(`/api/profiles/me/voices?name=${encodeURIComponent(name.data)}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': draft.blob.type || 'application/octet-stream' },
        body: draft.blob,
      });
      discardDraft();
      setNotice({ ok: true, text: `« ${name.data} » est enregistrée.` });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function rename(voice: VoiceClip, nextName: string) {
    const name = voiceNameSchema.safeParse(nextName);
    if (!name.success) {
      setNotice({ ok: false, text: name.error.issues[0]?.message ?? 'Nom invalide.' });
      return;
    }
    setNotice(null);
    try {
      await api(`/api/profiles/me/voices/${encodeURIComponent(voice.id)}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ name: name.data }),
      });
      setNotice({ ok: true, text: 'Nom modifié.' });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  }

  async function remove(voice: VoiceClip) {
    setNotice(null);
    try {
      await api(`/api/profiles/me/voices/${encodeURIComponent(voice.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      setNotice({ ok: true, text: `« ${voice.name} » est supprimée.` });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: (err as Error).message });
    }
  }

  function play(url: string) {
    previewRef.current?.pause();
    const el = new Audio(url);
    previewRef.current = el;
    void el.play().catch(() => {
      setNotice({ ok: false, text: 'Impossible de lire cette voix ici.' });
    });
  }

  const count = voices?.length ?? 0;
  const canAdd = voices !== null && count < VOICE_MAX_PER_PROFILE && !draft && !recording;

  return (
    <section className="card stack voices" aria-labelledby="voices-title">
      <h2 id="voices-title">Mes voix</h2>
      <p className="muted small">
        Enregistrez jusqu’à {VOICE_MAX_PER_PROFILE} courts sons, de {VOICE_MAX_SECONDS} secondes au maximum, nommés
        comme vous voulez. Pendant une partie, vous les envoyez depuis votre téléphone : l’écran principal les joue.
      </p>

      {voices === null ? (
        <p className="muted">Chargement…</p>
      ) : voices.length === 0 ? (
        <p className="muted small">Aucune voix pour l’instant.</p>
      ) : (
        <ul className="voice-list">
          {voices.map((voice) => (
            <VoiceRow
              key={voice.id}
              voice={voice}
              onPlay={() => play(voiceUrl(voice.id))}
              onRename={(name) => void rename(voice, name)}
              onRemove={() => void remove(voice)}
            />
          ))}
        </ul>
      )}

      {canAdd && (
        <div className="voice-add">
          <button type="button" className="btn primary" onClick={() => void startRecording()} disabled={busy}>
            Enregistrer une voix ({VOICE_MAX_SECONDS} s max)
          </button>
          <label className="btn ghost small voice-file">
            Choisir un fichier audio
            <input type="file" accept="audio/*" onChange={onFile} className="visually-hidden" />
          </label>
        </div>
      )}

      {recording && (
        <div className="voice-recording" role="status">
          <span className="voice-dot" aria-hidden="true" />
          <span>
            Enregistrement… {recording.seconds} / {VOICE_MAX_SECONDS} s
          </span>
          <button type="button" className="btn small" onClick={stopRecording}>
            Arrêter
          </button>
        </div>
      )}

      {draft && (
        <div className="stack voice-draft">
          <audio controls src={draft.url} preload="metadata" />
          <label className="field">
            <span>Nom de la voix</span>
            <input
              value={draft.name}
              maxLength={VOICE_NAME_MAX}
              autoComplete="off"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="voice-add">
            <button type="button" className="btn primary" onClick={() => void saveDraft()} disabled={busy}>
              Enregistrer dans mon profil
            </button>
            <button type="button" className="btn ghost" onClick={discardDraft} disabled={busy}>
              Recommencer
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className={notice.ok ? 'muted small' : 'error small'} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
    </section>
  );
}

export function VoiceRow({
  voice,
  onPlay,
  onRename,
  onRemove,
}: {
  voice: VoiceClip;
  onPlay: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(voice.name);
  const [confirming, setConfirming] = useState(false);
  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== voice.name;

  return (
    <li className="voice-row">
      <input
        aria-label={`Nom de la voix « ${voice.name} »`}
        value={name}
        maxLength={VOICE_NAME_MAX}
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
      />
      <div className="voice-row-actions">
        <button type="button" className="btn small ghost" onClick={onPlay}>
          Écouter
        </button>
        {changed && (
          <button type="button" className="btn small" onClick={() => onRename(trimmed)}>
            Renommer
          </button>
        )}
        {confirming ? (
          <button type="button" className="btn small danger" onClick={onRemove}>
            Confirmer la suppression
          </button>
        ) : (
          <button type="button" className="btn small ghost" onClick={() => setConfirming(true)}>
            Supprimer
          </button>
        )}
      </div>
    </li>
  );
}
