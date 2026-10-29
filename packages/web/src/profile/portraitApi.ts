import { useEffect, useState } from 'react';
import type {
  CharacterSpec,
  PortraitCharacterResponse,
  PortraitErrorCode,
  PortraitErrorResponse,
} from '@partyhub/shared';
import { authHeaders } from './session.js';

/** Texte exact de la case de consentement. */
export const PORTRAIT_CONSENT_TEXT =
  'J’accepte que cette photo soit envoyée à Cloudflare (Workers AI) pour créer mon personnage. Elle n’est pas conservée par PartyHub : seul le personnage est gardé. Pour un enfant, l’accord d’un parent est nécessaire.';

const UNAVAILABLE =
  'La création à partir d’une photo est indisponible pour le moment : choisissez votre personnage à la main.';

export const PORTRAIT_ERROR_MESSAGES: Record<PortraitErrorCode, string> = {
  consent_required: 'Cochez d’abord la case d’accord pour envoyer la photo.',
  unauthorized: 'Votre profil n’est plus reconnu. Reconnectez-vous, puis réessayez.',
  too_large: 'Cette photo est trop lourde. Essayez une photo plus petite.',
  bad_type: 'Ce format n’est pas pris en charge. Choisissez une photo JPEG, PNG ou WebP.',
  no_face: 'Je ne vois pas de visage : prenez une photo de face, bien éclairée.',
  several_faces: 'Une seule personne à la fois, s’il vous plaît.',
  rate_limited: 'Trop d’essais, réessayez dans quelques minutes.',
  unavailable: UNAVAILABLE,
  provider_error: UNAVAILABLE,
};

/** Message français adapté au code d’erreur du serveur (message générique si le code est inconnu). */
export function portraitErrorMessage(code: unknown): string {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(PORTRAIT_ERROR_MESSAGES, code)) {
    return PORTRAIT_ERROR_MESSAGES[code as PortraitErrorCode];
  }
  return UNAVAILABLE;
}

/**
 * Personnage reçu appliqué au personnage actuel : teint, coiffure, cheveux, accessoire et expression viennent de
 * la photo ; la couleur du corps et le reste (attitude, etc.) restent ceux de la personne. Aucun pack.
 */
export function mergePortraitCharacter(received: CharacterSpec, current: CharacterSpec): CharacterSpec {
  return {
    ...current,
    skin: received.skin,
    hair: received.hair,
    hairColor: received.hairColor,
    accessory: received.accessory,
    expression: received.expression,
    pack: null,
    look: null,
  };
}

/** Lit la réponse de `GET /api/features` : la fonction n’est visible que si `portrait` vaut vrai. */
export function portraitEnabled(features: unknown): boolean {
  return !!features && typeof features === 'object' && (features as { portrait?: unknown }).portrait === true;
}

/** `null` tant que la réponse n’est pas là ; `false` en cas d’erreur (fonction masquée, sans message). */
export function usePortraitFeature(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/features', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => setEnabled(portraitEnabled(data)))
      .catch(() => {
        if (!controller.signal.aborted) setEnabled(false);
      });
    return () => controller.abort();
  }, []);
  return enabled;
}

/** Envoie la photo réduite ; renvoie le personnage ou lève une erreur au message français. */
export async function requestPortraitCharacter(image: string, signal?: AbortSignal): Promise<CharacterSpec> {
  let res: Response;
  try {
    res = await fetch('/api/characters/from-photo', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ image, consent: true }),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error('Connexion impossible. Vérifiez le réseau.', { cause: err });
  }
  const data = (await res.json().catch(() => null)) as Partial<
    PortraitCharacterResponse & PortraitErrorResponse
  > | null;
  if (!res.ok || !data?.character) {
    throw new Error(portraitErrorMessage(res.status === 401 ? 'unauthorized' : data?.code));
  }
  return data.character;
}
