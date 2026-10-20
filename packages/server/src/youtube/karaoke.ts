import type { KaraokeLookup, KaraokeYoutube } from '@partyhub/games';
import { YOUTUBE_ERROR_MESSAGES, YoutubeError, type Youtube, type YoutubeErrorCode } from './search.js';

/**
 * Accès YouTube du karaoké, pour les travaux du jeu : la clé reste au serveur, et une erreur devient un résultat
 * « ok: false » avec le message en français (le jeu n'a jamais à lever d'exception).
 */
export function karaokeYoutube(youtube: Youtube): KaraokeYoutube {
  const refused = <T>(error: unknown): KaraokeLookup<T> => {
    const code: YoutubeErrorCode = error instanceof YoutubeError ? error.code : 'unavailable';
    return { ok: false, code, message: YOUTUBE_ERROR_MESSAGES[code] };
  };
  return {
    async search(query) {
      try {
        return { ok: true, value: await youtube.search(query) };
      } catch (error) {
        return refused(error);
      }
    },
    async video(videoId) {
      try {
        return { ok: true, value: await youtube.video(videoId) };
      } catch (error) {
        return refused(error);
      }
    },
  };
}
