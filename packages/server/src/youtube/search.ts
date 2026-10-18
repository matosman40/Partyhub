/**
 * Recherche de vidéos YouTube pour le karaoké. Elle passe par le serveur : la clé d’API (YOUTUBE_API_KEY)
 * reste ici, jamais envoyée au navigateur. Sans clé, la recherche est désactivée, et l’on peut toujours
 * coller un lien. Les résultats sont gardés une heure, pour rester dans le quota quotidien de l’API
 * (une recherche coûte 100 unités sur un quota de 10 000 par jour).
 */

export interface YoutubeHit {
  videoId: string;
  title: string;
  channel: string;
}

export type YoutubeSearchCode = 'disabled' | 'invalid' | 'quota' | 'unavailable';

/** Message français affiché au joueur, selon la cause. */
export const YOUTUBE_SEARCH_MESSAGES: Record<YoutubeSearchCode, string> = {
  disabled: 'La recherche n’est pas activée sur ce serveur. Collez un lien YouTube à la place.',
  invalid: 'Tapez au moins deux caractères (80 au plus).',
  quota: 'La recherche a atteint sa limite pour aujourd’hui. Collez un lien YouTube, ou réessayez demain.',
  unavailable: 'La recherche ne répond pas pour le moment. Collez un lien YouTube, ou réessayez.',
};

export class YoutubeSearchError extends Error {
  constructor(readonly code: YoutubeSearchCode) {
    super(code);
    this.name = 'YoutubeSearchError';
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ENDPOINT = 'https://www.googleapis.com/youtube/v3/search';
const TTL_MS = 60 * 60 * 1000;
const MAX_CACHED = 200;
const TIMEOUT_MS = 8000;

export interface YoutubeSearchOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface YoutubeSearch {
  readonly enabled: boolean;
  search(query: string): Promise<YoutubeHit[]>;
}

export function createYoutubeSearch(options: YoutubeSearchOptions = {}): YoutubeSearch {
  const apiKey = options.apiKey?.trim() || undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; hits: YoutubeHit[] }>();

  return {
    enabled: apiKey !== undefined,
    async search(input: string): Promise<YoutubeHit[]> {
      const query = input.trim().replace(/\s+/g, ' ');
      if (query.length < 2 || query.length > 80) throw new YoutubeSearchError('invalid');
      if (!apiKey) throw new YoutubeSearchError('disabled');

      const key = query.toLocaleLowerCase('fr');
      const cached = cache.get(key);
      if (cached && now() - cached.at < TTL_MS) return cached.hits;

      const url = new URL(ENDPOINT);
      url.search = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        safeSearch: 'moderate',
        maxResults: '8',
        q: query,
        key: apiKey,
      }).toString();

      let response: Response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        // Le message d’erreur du réseau pourrait contenir l’adresse : on ne le garde pas.
        throw new YoutubeSearchError('unavailable');
      }
      if (response.status === 403 || response.status === 429) throw new YoutubeSearchError('quota');
      if (!response.ok) throw new YoutubeSearchError('unavailable');

      const body = (await response.json().catch(() => null)) as { items?: unknown } | null;
      const hits = parseItems(body?.items);
      if (cache.size >= MAX_CACHED) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { at: now(), hits });
      return hits;
    },
  };
}

/** Limite de débit par adresse : une recherche coûte du quota, il ne faut pas la laisser tourner en boucle. */
export function createSearchLimiter(perMinute = 30) {
  const hits = new Map<string, { start: number; count: number }>();
  return {
    allow(ip: string, at: number = Date.now()): boolean {
      const entry = hits.get(ip);
      if (!entry || at - entry.start >= 60_000) {
        hits.set(ip, { start: at, count: 1 });
        return true;
      }
      if (entry.count >= perMinute) return false;
      entry.count += 1;
      return true;
    },
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

/** Les titres renvoyés par l’API contiennent des entités HTML (`&amp;`, `&#39;`) : on les rend lisibles. */
function decodeEntities(text: string): string {
  return text.replace(/&(#39|amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? _);
}

function parseItems(items: unknown): YoutubeHit[] {
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
