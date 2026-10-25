import { VOICE_MAX_MS } from '@partyhub/shared';

/**
 * Micro pour les vues des jeux de code. La vue tourne dans un cadre sandboxé, sans origine : le navigateur y refuse
 * `getUserMedia`. C'est donc la page (de confiance) qui ouvre le micro et enregistre, à la demande de la vue.
 * La vue ne reçoit que la voix enregistrée, sous forme de data URL.
 */

export type VoiceResult = { ok: true; data: string } | { ok: false; error: string };

export interface VoiceCapture {
  /** Résultat : la voix enregistrée, ou la raison de l'échec / de l'arrêt. */
  done: Promise<VoiceResult>;
  /** Arrête tout de suite le micro. Sans données : `done` renvoie une erreur. */
  stop(): void;
}

/** Message en français pour un refus ou une absence de micro. */
export function micErrorMessage(err: unknown): string {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'Le micro n’est pas disponible sur cette page : ouvrez PartyHub en HTTPS.';
  }
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Accès au micro refusé. Autorisez-le dans les réglages du navigateur, puis réessayez.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Aucun micro trouvé sur cet appareil.';
  return 'Impossible d’utiliser le micro.';
}

/** Ouvre le micro, sans rien enregistrer : sert à demander l'autorisation avant de lancer un passage. */
export async function checkMicrophone(): Promise<VoiceResult> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return { ok: true, data: '' };
  } catch (err) {
    return { ok: false, error: micErrorMessage(err) };
  }
}

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function pickType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('lecture impossible'));
    reader.readAsDataURL(blob);
  });
}

/** Enregistre la voix pendant `ms` millisecondes (borné à 30 s), ou jusqu'à `stop()`. */
export function startVoiceCapture(ms: number): Promise<VoiceCapture> {
  const duration = Math.min(Math.max(Math.floor(ms) || 0, 1000), VOICE_MAX_MS);
  return navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      if (typeof MediaRecorder === 'undefined') {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('MediaRecorder indisponible');
      }
      const type = pickType();
      const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24_000 });
      const chunks: Blob[] = [];
      let stopped = false;
      let cancelled = false;

      const release = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      const done = new Promise<VoiceResult>((resolve) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => {
          release();
          resolve({ ok: false, error: 'L’enregistrement a échoué.' });
        };
        recorder.onstop = () => {
          release();
          if (cancelled) {
            resolve({ ok: false, error: 'Enregistrement arrêté.' });
            return;
          }
          const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
          if (blob.size === 0) {
            resolve({ ok: false, error: 'Rien n’a été enregistré.' });
            return;
          }
          readAsDataUrl(blob).then(
            (data) => resolve({ ok: true, data }),
            () => resolve({ ok: false, error: 'L’enregistrement a échoué.' }),
          );
        };
      });

      const timer = window.setTimeout(() => stop(), duration);
      function stop(): void {
        if (stopped) return;
        stopped = true;
        window.clearTimeout(timer);
        if (recorder.state !== 'inactive') recorder.stop();
        else release();
      }

      recorder.start();
      return {
        done: done.finally(() => window.clearTimeout(timer)),
        stop: () => {
          cancelled = true;
          release();
          stop();
        },
      } satisfies VoiceCapture;
    })
    .catch((err: unknown) => ({
      done: Promise.resolve<VoiceResult>({ ok: false, error: micErrorMessage(err) }),
      stop: () => undefined,
    }));
}
