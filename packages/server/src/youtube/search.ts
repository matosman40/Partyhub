/**
 * Accès à l’API YouTube pour le karaoké : recherche de vidéos et vérification d’une vidéo (lien collé
 * ou résultat choisi). La clé (YOUTUBE_API_KEY) reste ici, jamais envoyée au navigateur. Sans clé, tout
 * est désactivé. Les réponses sont gardées une heure : une recherche coûte 100 unités, une vérification
 * 1 unité, sur un quota de 10 000 unités par jour.
 */

export interface YoutubeHit {
  videoId: string;
  title: string;
  channel: string;
}

export interface YoutubeVideo extends YoutubeHit {
  /** Durée de la vidéo, en secondes (jamais 0 : les directs et les vidéos à venir sont refusés). */
  durationSec: number;
}

export type YoutubeErrorCode =
  'disabled' | 'invalid' | 'badId' | 'quota' | 'unavailable' | 'notFound' | 'notEmbeddable' | 'live';

/** Message français affiché au joueur, selon la cause. */
export const YOUTUBE_ERROR_MESSAGES: Record<YoutubeErrorCode, string> = {
  disabled: 'YouTube n’est pas activé sur ce serveur. Demandez à l’administrateur.',
  invalid: 'Tapez au moins deux caractères (80 au plus).',
  badId: 'Ce lien ne correspond à aucune vidéo YouTube.',
  quota: 'YouTube a atteint sa limite pour aujourd’hui. Réessayez demain.',
  unavailable: 'YouTube ne répond pas pour le moment. Réessayez dans un instant.',
  notFound: 'Cette vidéo est introuvable. Elle a peut-être été supprimée ou rendue privée.',
  notEmbeddable: 'Cette vidéo ne peut pas être lue hors de YouTube. Choisissez-en une autre.',
  live: 'Les directs et les vidéos à venir ne peuvent pas servir de karaoké. Choisissez une vidéo enregistrée.',
};

export class YoutubeError extends Error {
  constructor(readonly code: YoutubeErrorCode) {
    super(code);
    this.name = 'YoutubeError';
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 200;
const TIMEOUT_MS = 8000;

export interface YoutubeOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface Youtube {
  readonly enabled: boolean;
  search(query: string): Promise<YoutubeHit[]>;
  video(videoId: string): Promise<YoutubeVideo>;
}

/** Cache à durée limitée, borné : le plus ancien part quand il est plein. */
class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();

  constructor(private readonly now: () => number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at >= TTL_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    if (this.entries.size >= MAX_CACHED) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { at: this.now(), value });
  }
}

/** Appelle l’API. Ne laisse jamais filtrer l’adresse (et donc la clé) dans une erreur. */
async function callApi(fetchImpl: typeof fetch, base: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(base);
  url.search = new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new YoutubeError('unavailable');
  }
  const body = (await response.json().catch(() => null)) as ApiBody | null;
  if (response.status === 403 || response.status === 429) {
    // Google renvoie un motif précis : seul le dépassement de quota intéresse le joueur.
    const reason = body?.error?.errors?.[0]?.reason ?? '';
    if (/quota|limit/i.test(reason)) throw new YoutubeError('quota');
    throw new YoutubeError('unavailable');
  }
  if (!response.ok) throw new YoutubeError('unavailable');
  return body;
}

interface ApiBody {
  items?: unknown;
  error?: { errors?: Array<{ reason?: string }> };
}

export function createYoutube(options: YoutubeOptions = {}): Youtube {
  const apiKey = options.apiKey?.trim() || undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const searches = new TtlCache<YoutubeHit[]>(now);
  const videos = new TtlCache<YoutubeVideo>(now);

  return {
    enabled: apiKey !== undefined,

    async search(input: string): Promise<YoutubeHit[]> {
      const query = input.trim().replace(/\s+/g, ' ');
      if (query.length < 2 || query.length > 80) throw new YoutubeError('invalid');
      if (!apiKey) throw new YoutubeError('disabled');

      const key = query.toLocaleLowerCase('fr');
      const cached = searches.get(key);
      if (cached) return cached;

      const body = await callApi(fetchImpl, SEARCH_URL, {
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        safeSearch: 'moderate',
        maxResults: '8',
        q: query,
        key: apiKey,
      });
      const hits = parseSearchItems((body as ApiBody | null)?.items);
      searches.set(key, hits);
      return hits;
    },

    async video(input: string): Promise<YoutubeVideo> {
      const videoId = input.trim();
      if (!VIDEO_ID.test(videoId)) throw new YoutubeError('badId');
      if (!apiKey) throw new YoutubeError('disabled');

      const cached = videos.get(videoId);
      if (cached) return cached;

      const body = (await callApi(fetchImpl, VIDEOS_URL, {
        part: 'snippet,contentDetails,status',
        id: videoId,
        key: apiKey,
      })) as ApiBody | null;
      const items = body?.items;
      const item = Array.isArray(items) ? (items[0] as VideoItem | undefined) : undefined;
      if (!item) throw new YoutubeError('notFound');
      if (item.snippet?.liveBroadcastContent && item.snippet.liveBroadcastContent !== 'none') {
        throw new YoutubeError('live');
      }
      if (item.status?.embeddable !== true) throw new YoutubeError('notEmbeddable');
      const durationSec = parseIsoDuration(item.contentDetails?.duration);
      if (durationSec === 0) throw new YoutubeError('live');

      const video: YoutubeVideo = {
        videoId,
        title: decodeEntities(String(item.snippet?.title ?? '')).slice(0, 100),
        channel: decodeEntities(String(item.snippet?.channelTitle ?? '')).slice(0, 60),
        durationSec,
      };
      videos.set(videoId, video);
      return video;
    },
  };
}

/** Limite de débit par adresse : une recherche ou une vérification coûte du quota, il ne faut pas les laisser tourner en boucle. */
export function createSearchLimiter(perMinute = 30, windowMs = 60_000) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    allow(ip: string, at: number = Date.now()): boolean {
      // Sans ménage, la table grossit avec chaque adresse vue : on retire les fenêtres closes.
      if (hits.size > 5000) {
        for (const [address, entry] of hits) {
          if (at - entry.start >= windowMs) hits.delete(address);
        }
      }
      const entry = hits.get(ip);
      if (!entry || at - entry.start >= windowMs) {
        hits.set(ip, { start: at, count: 1 });
        return true;
      }
      if (entry.count >= perMinute) return false;
      entry.count += 1;
      return true;
    },
  };
}

interface VideoItem {
  snippet?: { title?: unknown; channelTitle?: unknown; liveBroadcastContent?: string };
  contentDetails?: { duration?: unknown };
  status?: { embeddable?: unknown };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** Les titres renvoyés par l’API contiennent des entités HTML (`&amp;`, `&#39;`) : on les rend lisibles. */
function decodeEntities(text: string): string {
  return text.replace(/&(#39|amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? _);
}

/** Durée ISO 8601 de l’API (`PT1H2M3S`, `PT45S`) en secondes. 0 si elle est absente ou inconnue. */
export function parseIsoDuration(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 0;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function parseSearchItems(items: unknown): YoutubeHit[] {
  if (!Array.isArray(items)) return [];
  const hits: YoutubeHit[] = [];
  for (const item of items) {
    const id = (item as { id?: { videoId?: unknown } } | null)?.id?.videoId;
    const snippet = (item as { snippet?: { title?: unknown; channelTitle?: unknown } } | null)?.snippet;
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || typeof snippet?.title !== 'string') continue;
    hits.push({
      videoId: id,
      title: decodeEntities(snippet.title).slice(0, 100),
      channel: typeof snippet.channelTitle === 'string' ? decodeEntities(snippet.channelTitle).slice(0, 60) : '',
    });
  }
  return hits;
}
