import { useEffect, useId, useRef, useState } from 'react';
import type { CharacterSpec } from '@partyhub/shared';
import { WebcamPhoto, webcamAvailable } from './WebcamPhoto.js';
import { fileToPortraitDataUrl } from './portraitImage.js';
import {
  mergePortraitCharacter,
  PORTRAIT_CONSENT_TEXT,
  requestPortraitCharacter,
  usePortraitFeature,
} from './portraitApi.js';

type Status = 'idle' | 'reading' | 'sending' | 'error' | 'done';

/** Le bouton « Créer mon personnage » n’est possible qu’avec une photo, le consentement, et sans envoi en cours. */
export function canCreateFromPhoto(hasPhoto: boolean, consent: boolean, status: Status): boolean {
  return hasPhoto && consent && status !== 'sending' && status !== 'reading';
}

/**
 * Création du personnage à partir d’une photo de portrait. La photo reste dans la mémoire de cet écran le temps de
 * l’envoi : elle est effacée (état et page) dès la réponse, réussie ou non, et à la fermeture. Rien n’est affiché
 * si le serveur ne propose pas la fonction (`available` force la valeur, pour les tests).
 */
export function PortraitCharacter({
  current,
  disabled = false,
  onApply,
  available,
  defaultOpen = false,
}: {
  current: CharacterSpec;
  disabled?: boolean;
  onApply: (spec: CharacterSpec) => void;
  available?: boolean | null;
  defaultOpen?: boolean;
}) {
  const feature = usePortraitFeature();
  const enabled = available ?? feature;
  const [open, setOpen] = useState(defaultOpen);
  const [photo, setPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState('');
  const [webcam, setWebcam] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ids = useId();

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!enabled) return null;

  function clearPhoto() {
    setPhoto(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  function close() {
    abortRef.current?.abort();
    clearPhoto();
    setConsent(false);
    setWebcam(false);
    setStatus('idle');
    setMessage('');
    setOpen(false);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setStatus('reading');
    setMessage('Préparation de la photo…');
    try {
      setPhoto(await fileToPortraitDataUrl(file));
      setStatus('idle');
      setMessage('');
    } catch (err) {
      clearPhoto();
      setStatus('error');
      setMessage((err as Error).message);
    } finally {
      // Le fichier d’origine (avec ses métadonnées) n’est pas gardé par le champ.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function create() {
    if (!photo || !consent) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('sending');
    setMessage('Analyse de la photo en cours…');
    try {
      const received = await requestPortraitCharacter(photo, controller.signal);
      onApply(mergePortraitCharacter(received, current));
      clearPhoto();
      setConsent(false);
      setStatus('done');
      setMessage('Votre personnage est prêt et enregistré : vous pouvez encore le modifier ci-dessous.');
    } catch (err) {
      if (controller.signal.aborted) return;
      clearPhoto();
      setStatus('error');
      setMessage((err as Error).message);
    }
  }

  const sending = status === 'sending';
  const canCreate = canCreateFromPhoto(photo !== null, consent, status);

  return (
    <section className="portrait-box" aria-label="Créer depuis une photo">
      {!open ? (
        <button type="button" className="btn ghost portrait-open" disabled={disabled} onClick={() => setOpen(true)}>
          Créer depuis une photo
        </button>
      ) : (
        <div className="portrait-panel stack">
          <p className="muted small portrait-intro">
            Une photo de votre visage, de face et bien éclairée. Elle sert uniquement à choisir les traits de votre
            personnage.
          </p>

          {webcam ? (
            <WebcamPhoto
              onCapture={(dataUrl) => {
                setPhoto(dataUrl);
                setWebcam(false);
                setStatus('idle');
                setMessage('');
              }}
              onCancel={() => setWebcam(false)}
            />
          ) : (
            <div className="portrait-pick">
              <label className="portrait-file-label" htmlFor={`${ids}-file`}>
                Choisir une photo
              </label>
              <input
                ref={fileRef}
                id={`${ids}-file`}
                className="portrait-file-input"
                type="file"
                accept="image/*"
                capture="user"
                disabled={sending}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              {webcamAvailable() && (
                <button type="button" className="btn" disabled={sending} onClick={() => setWebcam(true)}>
                  Utiliser la webcam
                </button>
              )}
            </div>
          )}

          {photo && (
            <figure className="portrait-preview">
              <img src={photo} alt="Aperçu de la photo choisie (visible seulement sur cet appareil)" />
              <button type="button" className="btn ghost" disabled={sending} onClick={clearPhoto}>
                Retirer la photo
              </button>
            </figure>
          )}

          <label className="portrait-consent" htmlFor={`${ids}-consent`}>
            <input
              id={`${ids}-consent`}
              type="checkbox"
              checked={consent}
              disabled={sending}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>{PORTRAIT_CONSENT_TEXT}</span>
          </label>

          <div className="portrait-actions">
            <button type="button" className="btn primary" disabled={!canCreate} onClick={() => void create()}>
              Créer mon personnage
            </button>
            <button type="button" className="btn ghost" onClick={close}>
              Fermer
            </button>
          </div>

          <div className="portrait-status" role="status" aria-live="polite">
            {sending && <span className="portrait-spinner" aria-hidden="true" />}
            {status === 'error' ? <span className="error small">{message}</span> : <span>{message}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
