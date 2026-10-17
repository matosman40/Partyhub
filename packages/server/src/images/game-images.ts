import type { GameImage, GameImageKind, GameImages } from '@partyhub/shared';
import type { ImageLibrary, StoredImage } from './library.js';
import type { ImageProvider } from './providers.js';

/**
 * Bibliothèque d'images partagée par les jeux (`ctx.images`). Un jeu demande une image ; le serveur essaie les
 * fournisseurs dans l'ordre, garde le résultat, et renvoie sa fiche. Une demande qui échoue renvoie null : le jeu
 * garde son rendu de secours.
 *
 * Garde-fous : délai global par demande, plafond journalier, et plafond par catégorie et par thème (un fonds de
 * décor ne s'accumule pas indéfiniment : au-delà, le jeu pioche dans ceux qui existent déjà).
 */

/** Nombre maximal d'images gardées pour une catégorie et un thème. */
export const POOL_MAX: Record<GameImageKind, number> = { portrait: 300, fond: 12 };

/** Longueur maximale d'une description envoyée à un fournisseur. */
const PROMPT_MAX = 1000;

export interface GameImagesLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface GameImagesOptions {
  providers: ImageProvider[];
  library: ImageLibrary;
  maxPerDay: number;
  /** Délai maximal pour une demande, fournisseurs compris. */
  timeoutMs: number;
  poolMax?: Record<GameImageKind, number>;
  logger?: GameImagesLogger;
}

/** Adresse publique d'une image gardée. */
export function gameImageUrl(id: string): string {
  return `/api/ai-images/${id}`;
}

function toGameImage(image: StoredImage): GameImage {
  return { id: image.id, kind: image.kind, tag: image.tag, url: gameImageUrl(image.id) };
}

export function createGameImages(options: GameImagesOptions): GameImages {
  const { providers, library, maxPerDay, timeoutMs, logger } = options;
  const poolMax = options.poolMax ?? POOL_MAX;

  return {
    available() {
      return providers.length > 0;
    },

    async generate(request) {
      if (providers.length === 0) return null;
      const prompt = request.prompt.trim().slice(0, PROMPT_MAX);
      if (prompt === '') return null;
      if (library.count(request.kind, request.tag) >= poolMax[request.kind]) return null;
      if (library.usedToday() >= maxPerDay) {
        logger?.warn({ event: 'images.daily-limit', limit: maxPerDay }, 'Plafond journalier d’images atteint');
        return null;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      if (request.signal?.aborted) controller.abort();
      request.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        for (const provider of providers) {
          if (controller.signal.aborted) return null;
          try {
            const image = await provider.generate(prompt, controller.signal);
            const stored = library.add({
              kind: request.kind,
              tag: request.tag,
              prompt,
              provider: provider.id,
              image,
            });
            library.recordUse();
            logger?.info({ event: 'images.generated', provider: provider.id, kind: request.kind }, 'Image générée');
            return toGameImage(stored);
          } catch (err) {
            logger?.warn(
              {
                event: 'images.failover',
                provider: provider.id,
                retryable: (err as { retryable?: boolean }).retryable,
              },
              'Fournisseur d’images en échec : le suivant prend le relais',
            );
          }
        }
        return null;
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
      }
    },

    list(kind, tag) {
      return library.list(kind, tag).map(toGameImage);
    },
  };
}
